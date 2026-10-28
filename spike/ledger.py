"""Shared budget ledger admin and self-test. Redis only; never calls Meta.

python spike/ledger.py status
python spike/ledger.py init --spent-usd 0.00 --confirm-reconciled
python spike/ledger.py selftest

init sets the lifetime total once, after the owner has reconciled any earlier
calls with the Meta Billing page. It refuses to overwrite an existing total.
selftest exercises reserve.lua/settle.lua in a throwaway namespace and deletes
its keys afterwards.
"""

from __future__ import annotations

import argparse
import json
import uuid
from concurrent.futures import ThreadPoolExecutor

import common


def redis_from_config() -> tuple[common.Config, common.RedisRest]:
    config = common.Config.load()
    if not (config.redis_url and config.redis_token):
        raise common.SpikeExit(common.EXIT_CONFIG, "UPSTASH_REDIS_REST_URL/TOKEN not configured.")
    return config, common.RedisRest(config.redis_url, config.redis_token)


def cmd_status() -> int:
    config, redis = redis_from_config()
    keys = common.bucket_keys(common.NAMESPACE, config.phase, "T0", common.day_et(), "local", "local")
    for name, key in zip(["lifetime", "phase", "ticket T0", "day", "visitor local", "ip local"], keys):
        flat = redis.command("HGETALL", key) or []
        print(f"{name:14s} {dict(zip(flat[::2], flat[1::2])) or 'missing'}")
    print(f"halt flag      {redis.command('GET', f'{common.NAMESPACE}:halt') or 'none'}")
    print(f"ledger entries {redis.command('LLEN', f'{common.NAMESPACE}:ledger')}")
    print(f"readiness      {json.dumps(config.readiness())}")
    return common.EXIT_PASSED


def cmd_init(spent_usd: str, confirmed: bool) -> int:
    if not confirmed:
        raise common.SpikeExit(common.EXIT_CONFIG, "Pass --confirm-reconciled after checking the "
                               "Meta Billing page for earlier spend.")
    _, redis = redis_from_config()
    key = f"{common.NAMESPACE}:lifetime"
    created = redis.command("HSETNX", key, "spent", common.usd_to_micro(spent_usd))
    if created != 1:
        raise common.SpikeExit(common.EXIT_BUDGET, "Lifetime total already exists; not changed.")
    redis.command("HSETNX", key, "reserved", 0)
    print(f"Lifetime total initialized at {spent_usd} USD.")
    return common.EXIT_PASSED


def cmd_selftest() -> int:
    config, redis = redis_from_config()
    ns = "{dreambike:selftest-" + uuid.uuid4().hex[:8] + "}"
    config.pricing_verified_at = config.pricing_verified_at or "selftest"
    config.phase = "development"
    config.ticket_cap = 1_000_000  # $1 for the test ticket
    results: list[tuple[str, bool, str]] = []

    def budget() -> common.Budget:
        b = common.Budget.__new__(common.Budget)
        b.config, b.ticket, b.ns, b.redis = config, "selftest", ns, redis
        return b

    try:
        try:
            budget().reserve("/t", "m", 1000, "fp", 1)
            results.append(("missing lifetime fails closed", False, "reserved"))
        except common.SpikeExit as exc:
            results.append(("missing lifetime fails closed", "lifetime_uninitialized" in exc.message,
                            exc.message))
        redis.command("HSET", f"{ns}:lifetime", "spent", 0, "reserved", 0)

        b = budget()
        res = b.reserve("/t", "m", 100_000, "fp-a", 1, request_key="req-a")
        try:
            b.reserve("/t", "m", 100_000, "fp-a", 1, request_key="req-a")
            results.append(("duplicate request ID refused", False, "reserved twice"))
        except common.SpikeExit as exc:
            results.append(("duplicate request ID refused", "reserved" in exc.message, exc.message))
        b.settle(res, "settled", 40_000)
        t = b.totals()
        results.append(("settle refunds the difference", t["ticket"]["spent"] == 40_000
                        and t["ticket"]["reserved"] == 0, json.dumps(t["ticket"])))
        try:
            b.reserve("/t", "m", 1, "fp-a", 1, request_key="req-a")
            results.append(("completed duplicate refused", False, "reserved"))
        except common.SpikeExit as exc:
            results.append(("completed duplicate refused", "settled" in exc.message, exc.message))

        res = b.reserve("/t", "m", 100_000, "fp-b", 1)
        b.settle(res, "unknown")
        t = b.totals()
        results.append(("unknown outcome keeps full reservation", t["ticket"]["spent"] == 140_000,
                        json.dumps(t["ticket"])))
        res = b.reserve("/t", "m", 100_000, "fp-c", 1)
        b.settle(res, "released")
        t = b.totals()
        results.append(("released 429 frees money, keeps attempt count",
                        t["ticket"]["spent"] == 140_000 and t["visitor_day"]["count:m"] == 3,
                        json.dumps(t["visitor_day"])))

        # 20 concurrent $0.10 reservations against $0.86 remaining: at most 8 fit.
        def attempt(i: int) -> bool:
            try:
                budget().reserve("/t", "m", 100_000, f"race-{i}", 1)
                return True
            except common.SpikeExit:
                return False
        with ThreadPoolExecutor(20) as pool:
            granted = sum(pool.map(attempt, range(20)))
        t = b.totals()
        used = t["ticket"]["spent"] + t["ticket"]["reserved"]
        results.append(("concurrent reservations never exceed the cap",
                        granted == 8 and used <= 1_000_000, f"granted={granted}, used={used}"))

        # Clear the race's outstanding reservations (test namespace only).
        for k in common.bucket_keys(ns, "development", "selftest", common.day_et(), "local", "local"):
            redis.command("HSET", k, "reserved", 0)
        res2 = b.reserve("/t", "m", 1_000, "fp-d", 1)
        b.settle(res2, "settled", 5_000)
        halted = redis.command("GET", f"{ns}:halt")
        try:
            b.reserve("/t", "m", 1, "fp-e", 1)
            blocked = False
        except common.SpikeExit as exc:
            blocked = "halted" in exc.message
        results.append(("charge above reservation halts further calls",
                        halted == "over_reservation" and blocked, f"halt={halted}"))
    finally:
        cursor = "0"
        while True:
            cursor, keys = redis.command("SCAN", cursor, "MATCH", f"{ns}*", "COUNT", 200)
            if keys:
                redis.command("DEL", *keys)
            if cursor == "0":
                break

    for name, ok, detail in results:
        print(f"{'PASSED' if ok else 'FAILED':7s} {name}  ({detail})")
    return common.EXIT_PASSED if all(r[1] for r in results) else common.EXIT_ASSERTION


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("status")
    init = sub.add_parser("init")
    init.add_argument("--spent-usd", required=True)
    init.add_argument("--confirm-reconciled", action="store_true")
    sub.add_parser("selftest")
    args = p.parse_args()
    if args.cmd == "status":
        return cmd_status()
    if args.cmd == "init":
        return cmd_init(args.spent_usd, args.confirm_reconciled)
    return cmd_selftest()


if __name__ == "__main__":
    common.run_main(main)
