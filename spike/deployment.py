"""No-paid-call deployment checks (SPEC.md 12 last row, 5, 13; run on the live origin in T14).

python spike/deployment.py --origin http://localhost:3000 [--expect demo_only|live]
                           [--expect-composite on|off]

Exit codes: 0 passed, 1 assertion failed, 2 config error or origin unreachable
(including deployment protection answering 401/403 on '/').

What it checks:
  0. A session cookie is issued by GET /api/budget; a same-Origin POST without
     the cookie gets 403 (proves the cookie check).
  1. Demo integrity from public/demo/project.json (DemoManifest): every
     snapshot image, top-level PNG mask and the quote PDF match sha256 and bytes;
     file names are plain; no list is empty; rights[] equals the shipped files.
  2. For each POST route: a foreign Origin WITH the cookie gives 403 (so the
     Origin check itself rejects it), and a body of BODY_LIMIT + 1 bytes with the
     right Origin and cookie gives 413. No valid or small same-origin body is sent.
  3. /api/health mode equals --expect; budget features.composite equals
     --expect-composite; demo_only budget shape; health and budget are no-store.
  4. Secret scan of '/', the same-origin /_next/static JS (also lazy chunks found
     inside JS), /api/health and /api/budget (bodies and headers) for the values
     of MODEL_API_KEY, UPSTASH_REDIS_REST_TOKEN, UPSTASH_REDIS_REST_URL and
     VISITOR_HASH_SECRET, plus the literal secret names in client JS.

It never makes a paid call and never prints a secret value, a cookie or a
response body: only check names, status codes and counts.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import uuid
from collections.abc import Callable
from urllib.parse import urljoin, urlsplit

import requests

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent))
from common import load_env  # noqa: E402

EXIT_PASSED, EXIT_ASSERTION, EXIT_CONFIG = 0, 1, 2

SESSION_COOKIE = "db_session"  # src/lib/server/http.ts SESSION_COOKIE
FOREIGN_ORIGIN = "https://example.invalid"
DEMO_FILE = re.compile(r"^[A-Za-z0-9._-]+$")  # DemoFileName in src/lib/contracts.ts

# BODY_LIMIT per POST route; each stays below Vercel's 4.5 MB request limit, so the app answers.
BODY_LIMITS: dict[str, int] = {
    "normalize": 1_300_000,    # MAX_BYTES 1_250_000 in src/lib/imageFormat.ts + 50_000
    "segment": 1_300_000,      # src/app/api/segment/route.ts
    "identify": 1_300_000,     # src/app/api/identify/route.ts
    "instruction": 1_300_000,  # src/app/api/instruction/route.ts
    "edit": 2_550_000,         # src/app/api/edit/route.ts
    "composite": 3_550_000,    # src/app/api/composite/route.ts
    "check": 100_000,          # src/app/api/check/route.ts
}

SCAN_MAX_FILES = 300
SCAN_MAX_BYTES = 20_000_000
SECRET_VALUE_KEYS = ["MODEL_API_KEY", "UPSTASH_REDIS_REST_TOKEN", "UPSTASH_REDIS_REST_URL",
                     "VISITOR_HASH_SECRET"]
SECRET_NAMES_IN_JS = ["MODEL_API_KEY", "UPSTASH_REDIS_REST_TOKEN", "VISITOR_HASH_SECRET"]
MIN_SECRET_LEN = 8

PASSED, FAILED, SKIPPED = "PASSED", "FAILED", "SKIPPED"
Check = tuple[str, str, str]


class Unreachable(Exception):
    pass


def get(session: requests.Session | None, url: str, timeout: float, **kw) -> requests.Response:
    return (session or requests).get(url, timeout=timeout, allow_redirects=False, **kw)


def probe(checks: list[Check], name: str, fn: Callable[[], tuple[bool, str]]) -> None:
    """Run one probe; any requests exception becomes FAILED with the class name only."""
    try:
        ok, detail = fn()
    except requests.RequestException as exc:
        ok, detail = False, f"request error {type(exc).__name__}"
    except (ValueError, KeyError, TypeError, AttributeError) as exc:
        ok, detail = False, f"unexpected response ({type(exc).__name__})"
    checks.append((name, PASSED if ok else FAILED, detail))


def json_of(resp: requests.Response) -> dict:
    if not resp.headers.get("content-type", "").startswith("application/json"):
        return {}
    try:
        data = resp.json()
    except ValueError:  # a truncated or invalid body fails the shape checks instead of crashing
        return {}
    return data if isinstance(data, dict) else {}


# ------------------------------------------------------------------ demo integrity

def check_demo(checks: list[Check], origin: str) -> None:
    def run() -> tuple[bool, str]:
        resp = get(None, f"{origin}/demo/project.json", 15)
        if resp.status_code != 200:
            return False, f"manifest status {resp.status_code}"
        manifest = resp.json()
        snapshot = manifest["snapshot"]
        images = [(i["file"], i["hash"], i["bytes"]) for i in snapshot["images"]]
        masks = [(m["file"], m["sha256"], m["bytes"]) for m in manifest["masks"]]
        q = manifest["quote"]
        quote = [(q["path"], q["sha256"], q["bytes"])]
        for label, lst in (("images", images), ("masks", masks), ("rights", manifest["rights"])):
            if not lst:
                return False, f"{label} list is empty"
        entries = images + masks + quote
        # The manifest is untrusted: refuse any name that is not a plain demo file name.
        for name, _, _ in entries:
            if (not isinstance(name, str) or not DEMO_FILE.fullmatch(name) or ".." in name
                    or name == "."):
                return False, "manifest holds a file name that is not plain"
        for name, _, _ in masks:
            if not name.endswith(".png"):
                return False, "a top-level mask is not a .png file"
        names = [e[0] for e in entries]
        rights = [r["file"] for r in manifest["rights"]]
        if len(set(names)) != len(names):
            return False, "two demo files share one name"
        if len(rights) != len(set(rights)) or set(rights) != set(names):
            return False, f"rights files differ from shipped files ({len(rights)} vs {len(names)})"
        bad = 0
        for name, digest, size in entries:
            r = get(None, f"{origin}/demo/{name}", 30)
            ok = (r.status_code == 200 and len(r.content) == size
                  and hashlib.sha256(r.content).hexdigest() == str(digest).lower())
            bad += 0 if ok else 1
        return bad == 0, (f"{len(images)} images, {len(masks)} masks, 1 quote, "
                          f"{len(rights)} rights, {bad} bad")

    probe(checks, "demo files match manifest hashes and sizes", run)


# ------------------------------------------------------------------ route probes

def check_routes(checks: list[Check], origin: str, cookie: str | None) -> None:
    if not cookie:
        checks.append(("route probes need the session cookie", FAILED, "no cookie available"))
        return
    cookie_header = {"Cookie": f"{SESSION_COOKIE}={cookie}"}
    for route, limit in BODY_LIMITS.items():
        url = f"{origin}/api/{route}"

        def foreign() -> tuple[bool, str]:
            # Tiny non-JSON body: a broken Origin check could only produce 400, not 403.
            r = requests.post(url, data=b"\x00not-json", timeout=10, allow_redirects=False,
                              headers={**cookie_header, "Origin": FOREIGN_ORIGIN, "X-Request-Id": str(uuid.uuid4()),
                                       "Content-Type": "application/json"})
            return r.status_code == 403, f"{r.status_code}"

        def oversize() -> tuple[bool, str]:
            try:
                r = requests.post(url, data=b"x" * (limit + 1), timeout=60, allow_redirects=False,
                                  # Most routes validate X-Request-Id before they read the body (400 otherwise).
                                  headers={**cookie_header, "Origin": origin,
                                           "X-Request-Id": str(uuid.uuid4()),
                                           "Content-Type": "application/octet-stream"})
            except requests.ConnectionError as exc:
                # The server may answer 413 from the declared Content-Length and close the
                # socket while the upload still runs; the status is then lost to the client.
                return False, (f"connection closed during upload ({type(exc).__name__}); "
                               "server may have sent 413 and closed early, status not seen")
            return r.status_code == 413, f"{r.status_code}"

        probe(checks, f"{route}: foreign Origin with cookie rejected (403)", foreign)
        probe(checks, f"{route}: {limit + 1} byte body rejected (413)", oversize)


# ------------------------------------------------------------------ secret scan

JS_URL = re.compile(r"/_next/static/[A-Za-z0-9_\-./%~\[\]]+?\.js")
JS_REL = re.compile(r"static/(?:chunks|[A-Za-z0-9_-]+)/[A-Za-z0-9_\-./%~\[\]]+?\.js")


def header_text(resp: requests.Response) -> bytes:
    return "\n".join(f"{k}: {v}" for k, v in resp.headers.items()).encode("utf-8", "replace")


def check_secrets(checks: list[Check], origin: str, session: requests.Session,
                  extra: list[requests.Response]) -> None:
    env = load_env()
    secrets = [env[k].encode() for k in SECRET_VALUE_KEYS
               if len(env.get(k, "")) >= MIN_SECRET_LEN]
    state = {"files": 0, "bytes": 0, "value_hits": 0, "name_hits": 0, "truncated": False,
             "errors": 0}

    def scan(body: bytes, headers: bytes, is_js: bool) -> None:
        if any(s in body or s in headers for s in secrets):
            state["value_hits"] += 1
        if is_js and any(n.encode() in body for n in SECRET_NAMES_IN_JS):
            state["name_hits"] += 1

    def run() -> tuple[bool, str]:
        page = get(session, f"{origin}/", 15)
        if page.status_code != 200:
            return False, f"'/' status {page.status_code}"
        scan(page.content, header_text(page), False)
        for r in extra:
            scan(r.content, header_text(r), False)
        host = urlsplit(origin).netloc
        queue: list[str] = []
        seen: set[str] = set()

        def enqueue(text: str) -> None:
            for m in JS_URL.findall(text) + [f"/_next/{m}" for m in JS_REL.findall(text)]:
                url = urljoin(origin + "/", m)
                if urlsplit(url).netloc == host and url not in seen:
                    seen.add(url)
                    queue.append(url)

        enqueue(page.text)
        while queue:
            if state["files"] >= SCAN_MAX_FILES or state["bytes"] >= SCAN_MAX_BYTES:
                state["truncated"] = True
                break
            url = queue.pop(0)
            try:
                r = get(session, url, 30)
            except requests.RequestException:
                state["errors"] += 1
                continue
            if r.status_code != 200:
                state["errors"] += 1
                continue
            state["files"] += 1
            state["bytes"] += len(r.content)
            scan(r.content, header_text(r), True)
            enqueue(r.content.decode("utf-8", "replace"))
        ok = (state["value_hits"] == 0 and state["name_hits"] == 0 and not state["truncated"]
              and state["files"] > 0)
        return ok, (f"{state['files']} JS files, {state['bytes']} bytes, "
                    f"value hits {state['value_hits']}, name hits {state['name_hits']}, "
                    f"unfetched {state['errors']}, truncated {state['truncated']}")

    # Names only: which secret keys had a local value to search for (never the values).
    scanned = [k for k in SECRET_VALUE_KEYS if len(env.get(k, "")) >= MIN_SECRET_LEN]
    label = ("client bundle and responses hold no LOCAL secret values or names" if secrets
             else "client bundle holds no secret names (values not scanned)")
    probe(checks, label, run)
    if secrets:
        checks.append(("secret value scan coverage (local .env values only; deployed-only values unchecked)", PASSED if len(scanned) == len(SECRET_VALUE_KEYS)
                       else SKIPPED, f"values searched for: {', '.join(scanned)}; "
                       f"missing locally: {', '.join(k for k in SECRET_VALUE_KEYS if k not in scanned) or 'none'}"))
    else:
        checks.append(("secret value scan (no secret values available locally)", SKIPPED,
                       "name scan still ran"))


# ------------------------------------------------------------------ main

def main() -> int:
    parser = argparse.ArgumentParser(description="No-paid-call deployment checks (SPEC.md 12).")
    parser.add_argument("--origin", required=True)
    parser.add_argument("--expect", choices=["demo_only", "live"], default="demo_only")
    parser.add_argument("--expect-composite", choices=["on", "off"], default="on")
    args = parser.parse_args()  # a bad flag value exits 2
    origin = args.origin.rstrip("/")
    checks: list[Check] = []

    try:
        health = get(None, f"{origin}/api/health", 10)
        home = get(None, f"{origin}/", 15)
    except requests.RequestException as exc:
        print(f"[exit 2] App not reachable at {origin} ({type(exc).__name__}).", file=sys.stderr)
        return EXIT_CONFIG
    if 401 in (health.status_code, home.status_code) or 403 in (health.status_code, home.status_code):
        print("[exit 2] The site answered 401/403 (deployment protection?). Checks need a public "
              "origin.", file=sys.stderr)
        return EXIT_CONFIG

    hb = json_of(health) if health.status_code == 200 else {}
    checks.append(("health 200 with ok=true", PASSED if hb.get("ok") is True else FAILED,
                   f"{health.status_code} mode={hb.get('mode')}"))
    checks.append(("health is no-store",
                   PASSED if "no-store" in health.headers.get("cache-control", "") else FAILED, ""))
    checks.append((f"health mode is {args.expect}",
                   PASSED if hb.get("mode") == args.expect else FAILED, f"mode={hb.get('mode')}"))

    # (0) Session first.
    session = requests.Session()
    budget_resp: requests.Response | None = None
    b: dict = {}
    try:
        budget_resp = get(session, f"{origin}/api/budget", 10)
        b = json_of(budget_resp) if budget_resp.status_code == 200 else {}
    except requests.RequestException as exc:
        checks.append(("budget reachable", FAILED, f"request error {type(exc).__name__}"))
    if budget_resp is not None:
        checks.append(("budget is no-store",
                       PASSED if "no-store" in budget_resp.headers.get("cache-control", "") else FAILED, ""))
        checks.append(("budget 200 with dayET and liveEnabled",
                       PASSED if "dayET" in b and "liveEnabled" in b else FAILED,
                       f"{budget_resp.status_code}"))
    cookie = session.cookies.get(SESSION_COOKIE)
    if not cookie:
        # The page proxy sets it too; fetch '/' before giving up.
        try:
            get(session, f"{origin}/", 15)
            cookie = session.cookies.get(SESSION_COOKIE)
        except requests.RequestException:
            pass
    checks.append(("session cookie is set", PASSED if cookie else FAILED, ""))

    probe(checks, "same-Origin POST without cookie rejected (403)", lambda: (
        (lambda r: (r.status_code == 403, f"{r.status_code}"))(
            requests.post(f"{origin}/api/check", data=b"\x00not-json", timeout=10,
                          allow_redirects=False,
                          headers={"Origin": origin, "Content-Type": "application/json"}))))

    # (3) Expected mode and flags.
    features = b.get("features") if isinstance(b.get("features"), dict) else {}
    want_composite = args.expect_composite == "on"
    checks.append((f"composite feature is {args.expect_composite}",
                   PASSED if features.get("composite") is want_composite else FAILED,
                   f"composite={features.get('composite')}"))
    if args.expect == "demo_only":
        ok = (b.get("liveEnabled") is False and b.get("reason") == "live_disabled"
              and b.get("spentTodayMicroUsd") is None and b.get("reservedTodayMicroUsd") is None)
        checks.append(("demo_only budget: live off, reason live_disabled, spend null",
                       PASSED if ok else FAILED,
                       f"liveEnabled={b.get('liveEnabled')} reason={b.get('reason')}"))
    else:
        ok = b.get("liveEnabled") is True and isinstance(b.get("spentTodayMicroUsd"), int)
        checks.append(("live budget: live on, spend known", PASSED if ok else FAILED,
                       f"liveEnabled={b.get('liveEnabled')}"))

    # (1) demo, (2) route probes, (4) secret scan.
    check_demo(checks, origin)
    check_routes(checks, origin, cookie)
    extra = [r for r in (health, budget_resp) if r is not None]
    check_secrets(checks, origin, session, extra)

    for name, status, detail in checks:
        print(f"{status:7s} {name}  ({detail})" if detail else f"{status:7s} {name}")
    summary = {"passed": sum(c[1] == PASSED for c in checks),
               "failed": sum(c[1] == FAILED for c in checks),
               "skipped": sum(c[1] == SKIPPED for c in checks)}
    print(json.dumps(summary))
    return EXIT_PASSED if summary["failed"] == 0 else EXIT_ASSERTION


if __name__ == "__main__":
    sys.exit(main())
