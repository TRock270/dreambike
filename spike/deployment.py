"""No-paid-call deployment checks (SPEC.md 12; repeated on the live origin in T14).

python spike/deployment.py --origin http://localhost:3000

Checks health/budget responses, cross-origin rejection, the body-size bound,
and demo asset integrity. It never sends a request that could reach Meta: the
POST probes carry a foreign Origin or an oversized body and must be rejected
before any reservation.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys

import requests

EXIT_PASSED, EXIT_ASSERTION, EXIT_CONFIG = 0, 1, 2


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--origin", required=True)
    args = parser.parse_args()
    origin = args.origin.rstrip("/")
    checks: list[tuple[str, bool, str]] = []
    try:
        health = requests.get(f"{origin}/api/health", timeout=5)
    except requests.RequestException as exc:
        print(f"[exit 2] App not reachable at {origin} ({type(exc).__name__}).", file=sys.stderr)
        return EXIT_CONFIG
    body = health.json() if health.headers.get("content-type", "").startswith("application/json") else {}
    checks.append(("health 200 with ok=true", health.status_code == 200 and body.get("ok") is True,
                   f"{health.status_code} mode={body.get('mode')}"))
    checks.append(("health is no-store", "no-store" in health.headers.get("cache-control", ""),
                   health.headers.get("cache-control", "")))

    session = requests.Session()
    budget = session.get(f"{origin}/api/budget", timeout=5)
    b = budget.json() if budget.ok else {}
    checks.append(("budget 200 with dayET and liveEnabled", budget.status_code == 200
                   and "dayET" in b and "liveEnabled" in b, f"{budget.status_code}"))
    if b and not b.get("liveEnabled"):
        checks.append(("disabled live mode reports unknown spend as null",
                       b.get("spentTodayMicroUsd") is None, f"{b.get('spentTodayMicroUsd')}"))

    foreign = session.post(f"{origin}/api/check", data=b"{}", timeout=5,
                           headers={"Origin": "https://example.invalid",
                                    "Content-Type": "application/json"})
    checks.append(("foreign Origin rejected with 403", foreign.status_code == 403,
                   f"{foreign.status_code}"))
    big = session.post(f"{origin}/api/check", data=b"x" * 4_000_000, timeout=20,
                       headers={"Origin": origin, "Content-Type": "application/json"})
    checks.append(("4 MB body rejected (413) before any paid work", big.status_code == 413,
                   f"{big.status_code}"))

    manifest = requests.get(f"{origin}/demo/project.json", timeout=10)
    if manifest.status_code == 200:
        assets = manifest.json().get("assets", [])
        bad = []
        for asset in assets:
            r = requests.get(f"{origin}{asset['path']}", timeout=20)
            if r.status_code != 200 or hashlib.sha256(r.content).hexdigest() != asset["hash"]:
                bad.append(asset["path"])
        checks.append(("demo assets match manifest hashes", not bad and bool(assets),
                       f"{len(assets)} assets, {len(bad)} bad"))
    else:
        checks.append(("demo manifest present", False, f"{manifest.status_code}"))

    for name, ok, detail in checks:
        print(f"{'PASSED' if ok else 'FAILED':7s} {name}  ({detail})")
    print(json.dumps({"passed": sum(c[1] for c in checks), "failed": sum(not c[1] for c in checks)}))
    return EXIT_PASSED if all(c[1] for c in checks) else EXIT_ASSERTION


if __name__ == "__main__":
    sys.exit(main())
