"""Shared budget ledger admin and self-test. Redis only; never calls Meta.

python spike/ledger.py status [--ns NAMESPACE]
python spike/ledger.py init --spent-usd 0.00 --confirm-reconciled
python spike/ledger.py set-caps --project-usd 100 --daily-usd 5 [--ns NAMESPACE]
python spike/ledger.py selftest

init sets the lifetime total once, after the owner has reconciled any earlier
calls with the Meta Billing page. It refuses to overwrite an existing total.
set-caps stores the project hard cap and the global day cap in the lifetime
hash. Both are explicit options (defaults 100 and 5 USD, refused above those;
the environment is not read) and are refused below the current spent + reserved
of the lifetime and the ET day. A stored value below the default prints a warning. reserve.lua clamps to these stored values and refuses every
reservation while they are missing, so run it once after init.
selftest exercises reserve.lua/settle.lua in a throwaway namespace (seeding its
own caps there) and deletes its keys afterwards.
"""

from __future__ import annotations

import argparse
import json
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

import common


def redis_from_config() -> tuple[common.Config, common.RedisRest]:
    config = common.Config.load()
    if not (config.redis_url and config.redis_token):
        raise common.SpikeExit(common.EXIT_CONFIG, "UPSTASH_REDIS_REST_URL/TOKEN not configured.")
    return config, common.RedisRest(config.redis_url, config.redis_token)


# SPEC 13 defaults are also the ceiling for the stored caps.
MAX_PROJECT_CAP = 100_000_000
MAX_DAILY_CAP = 5_000_000


def cmd_status(ns: str) -> int:
    config, redis = redis_from_config()
    keys = common.bucket_keys(ns, config.phase, "T0", common.day_et(), "local", "local")
    for name, key in zip(["lifetime", "phase", "ticket T0", "day", "visitor local", "ip local"], keys):
        flat = redis.command("HGETALL", key) or []
        print(f"{name:14s} {dict(zip(flat[::2], flat[1::2])) or 'missing'}")
    print(f"halt flag      {redis.command('GET', f'{ns}:halt') or 'none'}")
    print(f"ledger entries {redis.command('LLEN', f'{ns}:ledger')}")
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


def cmd_set_caps(ns: str, project_usd: str, daily_usd: str) -> int:
    _, redis = redis_from_config()
    project = common.usd_to_micro(project_usd)
    daily = common.usd_to_micro(daily_usd)
    if project > MAX_PROJECT_CAP or daily > MAX_DAILY_CAP:
        raise common.SpikeExit(common.EXIT_CONFIG, "Caps may not exceed 100 USD (project) and 5 USD (daily).")
    if project < 0 or daily < 0:
        raise common.SpikeExit(common.EXIT_CONFIG, "Caps may not be negative.")
    key = f"{ns}:lifetime"
    if redis.command("EXISTS", key) != 1:
        raise common.SpikeExit(common.EXIT_BUDGET, "Lifetime total missing; run init first.")
    spent, reserved = (int(v or 0) for v in redis.command("HMGET", key, "spent", "reserved"))
    if project < spent + reserved:
        raise common.SpikeExit(common.EXIT_BUDGET, f"Project cap {project} is below spent + reserved "
                               f"({spent + reserved}); not changed.")
    day_spent, day_reserved = (int(v or 0) for v in redis.command(
        "HMGET", f"{ns}:day:{common.day_et()}", "spent", "reserved"))
    if daily < day_spent + day_reserved:
        raise common.SpikeExit(common.EXIT_BUDGET, f"Daily cap {daily} is below today's spent + reserved "
                               f"({day_spent + day_reserved}); not changed.")
    redis.command("HSET", key, "capProjectMicroUsd", project, "capDailyMicroUsd", daily)
    print(f"Stored caps in {ns}: capProjectMicroUsd={project}, capDailyMicroUsd={daily} "
          f"(spent {spent}, reserved {reserved}).")
    if project < MAX_PROJECT_CAP:
        print(f"WARNING: stored project cap {project} is below the SPEC default {MAX_PROJECT_CAP}; "
              "the app can never raise it above this value.")
    if daily < MAX_DAILY_CAP:
        print(f"WARNING: stored daily cap {daily} is below the SPEC default {MAX_DAILY_CAP}; "
              "the app can never raise it above this value.")
    return common.EXIT_PASSED


def raw_reserve(redis: common.RedisRest, ns: str, *, ticket: str, visitor: str, ip: str,
                request_key: str, fingerprint: str, amount: int, model: str, caps: list[int],
                visitor_count: int = -1, ip_count: int = -1) -> tuple[list[str], common.Reservation]:
    """One reserve.lua EVAL with explicit visitor/IP buckets and count limits (selftest only)."""
    day = common.day_et()
    keys = common.bucket_keys(ns, "development", ticket, day, visitor, ip)
    now_ms = int(time.time() * 1000)
    args = [request_key, fingerprint, amount, model, "/t", ticket, day, now_ms, now_ms + 60_000,
            common.Budget.MARKER_TTL, common.Budget.AGGREGATE_TTL, *caps, visitor_count, ip_count]
    all_keys = keys + [f"{ns}:req:{request_key}", f"{ns}:ledger", f"{ns}:halt"]
    result = redis.eval_file("reserve.lua", all_keys, args)
    return result, common.Reservation(request_key, keys, amount, "/t", model)


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
        # Stored caps are required: a lifetime hash without them is an accounting failure.
        redis.command("HSET", f"{ns}:lifetime", "spent", 0, "reserved", 0)
        try:
            budget().reserve("/t", "m", 1000, "fp", 1)
            results.append(("missing stored caps fail closed", False, "reserved"))
        except common.SpikeExit as exc:
            results.append(("missing stored caps fail closed", "caps_uninitialized" in exc.message,
                            exc.message))

        # The stored caps are a ceiling: a larger cap in ARGV cannot raise them.
        lifetime = f"{ns}:lifetime"
        redis.command("HSET", lifetime, "capProjectMicroUsd", 50_000, "capDailyMicroUsd", 5_000_000)
        try:
            budget().reserve("/t", "m", 100_000, "fp", 1)
            results.append(("stored project cap clamps the ARGV cap", False, "reserved"))
        except common.SpikeExit as exc:
            results.append(("stored project cap clamps the ARGV cap", "lifetime" in exc.message, exc.message))
        redis.command("HSET", lifetime, "capProjectMicroUsd", 100_000_000, "capDailyMicroUsd", 50_000)
        try:
            budget().reserve("/t", "m", 100_000, "fp", 1)
            results.append(("stored daily cap clamps the ARGV cap", False, "reserved"))
        except common.SpikeExit as exc:
            results.append(("stored daily cap clamps the ARGV cap", "global_day" in exc.message, exc.message))
        redis.command("HSET", lifetime, "capProjectMicroUsd", 100_000_000, "capDailyMicroUsd", 5_000_000)

        # Attempt-count limits: visitor 2, ip 3 (released reservations still count).
        high = [100_000_000, 50_000_000, 1_000_000, 5_000_000, 1_000_000, 1_000_000]

        def count_try(n: int, visitor: str, ip: str) -> str:
            r, held = raw_reserve(redis, ns, ticket="selftest2", visitor=visitor, ip=ip,
                                  request_key=f"count-{n}", fingerprint=f"c{n}", amount=1_000,
                                  model="mc", caps=high, visitor_count=2, ip_count=3)
            if r[0] == "OK":
                budget().settle(held, "released")
            return f"{r[0]}:{r[1]}"
        counts = [count_try(1, "cv1", "cip"), count_try(2, "cv1", "cip"), count_try(3, "cv1", "cip"),
                  count_try(4, "cv2", "cip"), count_try(5, "cv3", "cip")]
        results.append(("visitor and ip attempt-count limits", counts == [
            "OK:1000", "OK:1000", "DENIED:visitor_count", "OK:1000", "DENIED:ip_count"], ", ".join(counts)))

        # The ip cap bounds a fresh visitor bucket behind the same ip.
        capped = [100_000_000, 50_000_000, 1_000_000, 5_000_000, 1_000_000, 150_000]
        r1, held = raw_reserve(redis, ns, ticket="selftest3", visitor="iv1", ip="shared", request_key="ipc-1",
                               fingerprint="i1", amount=100_000, model="mi", caps=capped)
        r2, _ = raw_reserve(redis, ns, ticket="selftest3", visitor="iv2", ip="shared", request_key="ipc-2",
                            fingerprint="i2", amount=100_000, model="mi", caps=capped)
        budget().settle(held, "released")
        results.append(("ip cap denies a fresh visitor bucket", r1[0] == "OK" and r2 == ["DENIED", "ip_day"],
                        f"{r1[0]}, {r2}"))

        b = budget()
        res = b.reserve("/t", "m", 100_000, "fp-a", 1, request_key="req-a")
        try:
            b.reserve("/t", "m", 100_000, "fp-other", 1, request_key="req-a")
            results.append(("fingerprint conflict refused", False, "reserved"))
        except common.SpikeExit as exc:
            results.append(("fingerprint conflict refused", "conflict" in exc.message, exc.message))

        # Visitor and ip day keys expire after 48 h (the global day aggregate is kept longer).
        day = common.day_et()
        ttls = {name: int(redis.command("TTL", f"{ns}:{name}:{day}") or -1)
                for name in ("visitor:local", "ip:local")}
        day_ttl = int(redis.command("TTL", f"{ns}:day:{day}") or -1)
        results.append(("visitor and ip keys expire after 48 h",
                        all(47 * 3600 < t <= 48 * 3600 for t in ttls.values()) and day_ttl > 100 * 86400,
                        f"visitor/ip={list(ttls.values())}, day={day_ttl}"))
        try:
            b.reserve("/t", "m", 100_000, "fp-a", 1, request_key="req-a")
            results.append(("duplicate request ID refused", False, "reserved twice"))
        except common.SpikeExit as exc:
            results.append(("duplicate request ID refused", "reserved" in exc.message, exc.message))
        first = b.settle(res, "settled", 40_000)
        second = b.settle(res, "settled", 40_000)
        t = b.totals()
        results.append(("settle refunds the difference", t["ticket"]["spent"] == 40_000
                        and t["ticket"]["reserved"] == 0, json.dumps(t["ticket"])))
        results.append(("double settle is one OK then one NOOP, charged once",
                        first[0] == "OK" and second[0] == "NOOP" and t["ticket"]["spent"] == 40_000,
                        f"{first[0]}, {second[0]}"))
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
    status = sub.add_parser("status")
    status.add_argument("--ns", default=common.NAMESPACE)
    caps = sub.add_parser("set-caps")
    caps.add_argument("--ns", default=common.NAMESPACE)
    # Required on purpose: a run without values must never quietly restore a higher stored cap.
    caps.add_argument("--project-usd", required=True)
    caps.add_argument("--daily-usd", required=True)
    init = sub.add_parser("init")
    init.add_argument("--spent-usd", required=True)
    init.add_argument("--confirm-reconciled", action="store_true")
    sub.add_parser("selftest")
    args = p.parse_args()
    if args.cmd == "status":
        return cmd_status(args.ns)
    if args.cmd == "set-caps":
        return cmd_set_caps(args.ns, args.project_usd, args.daily_usd)
    if args.cmd == "init":
        return cmd_init(args.spent_usd, args.confirm_reconciled)
    return cmd_selftest()


if __name__ == "__main__":
    common.run_main(main)
