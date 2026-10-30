"""Shared spike helpers: configuration, budget ledger, Meta HTTP, evidence, and checks.

Every paid call goes through `paid_call()`, which reserves money in the shared
Redis ledger (budget/reserve.lua) before dispatch and settles it afterwards
(budget/settle.lua). Nothing here prints secrets, prompts, images, or raw
response bodies. Private artifacts go to spike/out/, which is gitignored.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import math
import os
import re
import sys
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Callable
from zoneinfo import ZoneInfo

import requests
from dotenv import dotenv_values

REPO = Path(__file__).resolve().parent.parent
FIXTURES = REPO / "fixtures"
CONSENT = REPO / "consent"
OUT = REPO / "spike" / "out"
PROMPTS = REPO / "prompts"
BUDGET_DIR = REPO / "budget"
META_BASE = "https://api.meta.ai/v1"
NAMESPACE = "{dreambike:hackathon-2026}"
ET = ZoneInfo("America/New_York")

# Exit codes from SPEC.md section 12.
EXIT_PASSED = 0
EXIT_ASSERTION = 1
EXIT_CONFIG = 2
EXIT_BUDGET = 3
EXIT_UPSTREAM = 4
EXIT_SKIPPED = 5

FIXTURE_SETS = {
    "plain": ["plain-wall-right.jpg"],
    "all": ["plain-wall-right.jpg", "plain-wall-left.jpg", "cluttered.jpg",
            "exif-rotated.jpg", "heic.heic"],
}


class SpikeExit(Exception):
    """Stops a profile with one of the SPEC exit codes and a safe message."""

    def __init__(self, code: int, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


# ---------------------------------------------------------------- configuration

def load_env() -> dict[str, str]:
    """Process env wins, then .env.local, then .env. Values are never printed."""
    merged: dict[str, str] = {}
    for name in (".env", ".env.local"):
        path = REPO / name
        if path.exists():
            merged.update({k: v for k, v in dotenv_values(path).items() if v is not None})
    merged.update({k: v for k, v in os.environ.items() if k in KNOWN_KEYS})
    return merged


KNOWN_KEYS = {
    "MODEL_API_KEY", "MUSE_MODEL", "LIVE_API_ENABLED", "MOCK", "UPSTASH_REDIS_REST_URL",
    "UPSTASH_REDIS_REST_TOKEN", "VISITOR_HASH_SECRET", "PRICING_VERIFIED_AT",
    "SEARCH_QUERY_RESERVE", "DAILY_CAP_USD", "VISITOR_DAILY_CAP_USD", "PROJECT_HARD_CAP_USD",
    "DEVELOPMENT_STOP_USD", "TICKET_CAP_USD", "BUDGET_PHASE",
}


MAX_PROJECT_CAP_MICRO = 100_000_000
MAX_DAILY_CAP_MICRO = 5_000_000
MAX_DEV_STOP_MICRO = 50_000_000


def usd_to_micro(text: str) -> int:
    """Parse a decimal USD string to exact integer microdollars (no float rounding)."""
    if not re.fullmatch(r"\d+(\.\d{1,6})?", text.strip()):
        raise SpikeExit(EXIT_CONFIG, f"Invalid USD amount: {text!r}")
    whole, _, frac = text.strip().partition(".")
    return int(whole) * 1_000_000 + int((frac + "000000")[:6])


@dataclass
class Config:
    api_key: str | None
    muse_model: str
    redis_url: str | None
    redis_token: str | None
    pricing_verified_at: str | None
    search_query_reserve: int | None
    daily_cap: int
    project_cap: int
    development_stop: int
    ticket_cap: int
    phase: str

    @classmethod
    def load(cls) -> "Config":
        env = load_env()
        reserve = env.get("SEARCH_QUERY_RESERVE", "").strip()
        # Same clamps as src/lib/server/config.ts: environment values can only lower SPEC 13 defaults.
        daily = min(usd_to_micro(env.get("DAILY_CAP_USD") or "5"), MAX_DAILY_CAP_MICRO)
        return cls(
            api_key=env.get("MODEL_API_KEY") or None,
            muse_model=env.get("MUSE_MODEL") or "muse-spark-1.3-contributor",
            redis_url=(env.get("UPSTASH_REDIS_REST_URL") or "").rstrip("/") or None,
            redis_token=env.get("UPSTASH_REDIS_REST_TOKEN") or None,
            pricing_verified_at=env.get("PRICING_VERIFIED_AT") or None,
            search_query_reserve=int(reserve) if reserve.isdigit() else None,
            daily_cap=daily,
            project_cap=min(usd_to_micro(env.get("PROJECT_HARD_CAP_USD") or "100"), MAX_PROJECT_CAP_MICRO),
            development_stop=min(usd_to_micro(env.get("DEVELOPMENT_STOP_USD") or "50"), MAX_DEV_STOP_MICRO),
            ticket_cap=min(usd_to_micro(env.get("TICKET_CAP_USD") or "5"), daily),
            phase=env.get("BUDGET_PHASE") or "development",
        )

    def readiness(self) -> dict[str, bool]:
        """Booleans only, safe to print."""
        return {
            "model_api_key": self.api_key is not None,
            "muse_model_is_contributor": self.muse_model == "muse-spark-1.3-contributor",
            "redis_configured": bool(self.redis_url and self.redis_token),
            "pricing_verified": self.pricing_verified_at is not None,
            "search_query_reserve": self.search_query_reserve is not None,
            "phase_development": self.phase == "development",
        }


def load_prices() -> dict[str, Any]:
    try:
        return json.loads((BUDGET_DIR / "prices.json").read_text())
    except (OSError, ValueError) as exc:
        raise SpikeExit(EXIT_BUDGET, f"Price table unavailable ({type(exc).__name__}).") from None


# ------------------------------------------------------------------ ET day

def day_et(now: datetime | None = None) -> str:
    now = now or datetime.now(ET)
    return now.astimezone(ET).date().isoformat()


def next_midnight_et(now: datetime | None = None) -> datetime:
    """Timezone-aware next ET midnight; correct across the DST change."""
    local = (now or datetime.now(ET)).astimezone(ET)
    tomorrow = local.date() + timedelta(days=1)
    return datetime(tomorrow.year, tomorrow.month, tomorrow.day, tzinfo=ET)


# ------------------------------------------------------------ rights gate

def load_expected() -> dict[str, Any]:
    path = FIXTURES / "expected.json"
    if not path.exists():
        raise SpikeExit(EXIT_CONFIG, "fixtures/expected.json is missing (U09). "
                        "Copy spike/expected.example.json and fill it with real values.")
    return json.loads(path.read_text())


def require_rights(fixture: str) -> dict[str, Any]:
    """Paid calls need the owner's consent reference and identifier review.

    Only the consent file's existence is checked; its content is never read.
    """
    expected = load_expected()
    ref = expected.get("consentRecord")
    if not ref or not (REPO / ref).resolve().is_relative_to(CONSENT.resolve()) \
            or not (REPO / ref).exists():
        raise SpikeExit(EXIT_CONFIG, "No private consent record referenced in expected.json (U09).")
    entry = (expected.get("fixtures") or {}).get(fixture)
    if not entry:
        raise SpikeExit(EXIT_CONFIG, f"{fixture} has no entry in expected.json (U09).")
    if entry.get("identifiersReviewed") is not True or entry.get("noPeople") is not True:
        raise SpikeExit(EXIT_CONFIG, f"{fixture}: identifier/people review not confirmed (U09).")
    if not (FIXTURES / fixture).exists():
        raise SpikeExit(EXIT_CONFIG, f"fixtures/{fixture} is missing (U09).")
    return entry


# ------------------------------------------------------------------ ledger

class RedisRest:
    """Minimal Upstash REST client. 2-second timeout, fails closed."""

    def __init__(self, url: str, token: str):
        self.url = url
        self.headers = {"Authorization": f"Bearer {token}"}

    def command(self, *args: Any) -> Any:
        try:
            r = requests.post(self.url, headers=self.headers, json=[str(a) for a in args], timeout=2)
            body = r.json()
        except (requests.RequestException, ValueError) as exc:
            raise SpikeExit(EXIT_BUDGET, f"Accounting unavailable ({type(exc).__name__}).") from None
        if r.status_code != 200 or "error" in body:
            raise SpikeExit(EXIT_BUDGET, f"Accounting error (HTTP {r.status_code}).")
        return body.get("result")

    def eval_file(self, name: str, keys: list[str], args: list[Any]) -> Any:
        script = (BUDGET_DIR / name).read_text()
        return self.command("EVAL", script, len(keys), *keys, *args)


def bucket_keys(ns: str, phase: str, ticket: str, day: str, visitor: str, ip: str) -> list[str]:
    return [
        f"{ns}:lifetime", f"{ns}:phase:{phase}", f"{ns}:ticket:{ticket}", f"{ns}:day:{day}",
        f"{ns}:visitor:{visitor}:{day}", f"{ns}:ip:{ip}:{day}",
    ]


@dataclass
class Reservation:
    request_key: str
    keys: list[str]
    amount: int
    route: str
    model: str


class Budget:
    """Spike side of the shared atomic ledger. Local scripts use one fixed
    'local' visitor/IP bucket capped at the ticket cap (SPEC 13)."""

    MARKER_TTL = 48 * 3600
    AGGREGATE_TTL = 120 * 24 * 3600

    def __init__(self, config: Config, ticket: str, ns: str = NAMESPACE):
        if not (config.redis_url and config.redis_token):
            raise SpikeExit(EXIT_BUDGET, "No shared ledger configured (UPSTASH_REDIS_REST_*). "
                            "Offline work only.")
        if not config.pricing_verified_at:
            raise SpikeExit(EXIT_BUDGET, "PRICING_VERIFIED_AT is blank; paid calls stay disabled.")
        if config.phase != "development":
            raise SpikeExit(EXIT_BUDGET, "Spike scripts only run in BUDGET_PHASE=development.")
        self.config = config
        self.ticket = ticket
        self.ns = ns
        self.redis = RedisRest(config.redis_url, config.redis_token)

    def caps(self) -> list[int]:
        c = self.config
        return [c.project_cap, c.development_stop, c.ticket_cap, c.daily_cap,
                c.ticket_cap, c.ticket_cap]

    def reserve(self, route: str, model: str, amount: int, fingerprint: str,
                deadline_s: float, request_key: str | None = None) -> Reservation:
        request_key = request_key or str(uuid.uuid4())
        day = day_et()
        keys = bucket_keys(self.ns, self.config.phase, self.ticket, day, "local", "local")
        now_ms = int(time.time() * 1000)
        args = [request_key, fingerprint, amount, model, route, self.ticket, day, now_ms,
                now_ms + int((deadline_s + 30) * 1000), self.MARKER_TTL, self.AGGREGATE_TTL,
                *self.caps(), -1, -1]
        all_keys = keys + [f"{self.ns}:req:{request_key}", f"{self.ns}:ledger", f"{self.ns}:halt"]
        result = self.redis.eval_file("reserve.lua", all_keys, args)
        status, detail = result[0], result[1]
        if status != "OK":
            raise SpikeExit(EXIT_BUDGET, f"Budget {status.lower()}: {detail}")
        return Reservation(request_key, keys, amount, route, model)

    def settle(self, res: Reservation, outcome: str, charged: int = 0) -> list[Any]:
        all_keys = res.keys + [f"{self.ns}:req:{res.request_key}", f"{self.ns}:ledger",
                               f"{self.ns}:halt"]
        return self.redis.eval_file("settle.lua", all_keys,
                                    [outcome, charged, int(time.time() * 1000)])

    def totals(self) -> dict[str, dict[str, int] | None]:
        keys = bucket_keys(self.ns, self.config.phase, self.ticket, day_et(), "local", "local")
        names = ["lifetime", "phase", "ticket", "global_day", "visitor_day", "ip_day"]
        out: dict[str, dict[str, int] | None] = {}
        for name, key in zip(names, keys):
            flat = self.redis.command("HGETALL", key) or []
            fields = dict(zip(flat[::2], flat[1::2]))
            out[name] = {k: int(v) for k, v in fields.items()} if fields else None
        return out


def audit(entry: dict[str, Any]) -> None:
    """Local durable audit in spike/out/ledger.jsonl. Content-free by construction."""
    OUT.mkdir(parents=True, exist_ok=True)
    allowed = {"timestamp", "ticket", "profile", "route", "model", "attempts", "durationMs",
               "counts", "reservedMicroUsd", "settledMicroUsd", "status", "httpStatus"}
    safe = {k: v for k, v in entry.items() if k in allowed}
    safe.setdefault("timestamp", datetime.now(ET).isoformat())
    with (OUT / "ledger.jsonl").open("a") as fh:
        fh.write(json.dumps(safe, sort_keys=True) + "\n")


# ---------------------------------------------------------------- costs

def spark_charge(usage: dict[str, Any] | None, search_queries: int | None,
                 grounded: bool) -> int | None:
    """Charge from reported usage without assuming cache discounts.
    Returns None when usage is missing, which keeps the full reservation."""
    if not usage or "input_tokens" not in usage or "output_tokens" not in usage:
        return None
    p = load_prices()["prices"]["muse-spark-1.3-contributor"]
    micro = math.ceil((usage["input_tokens"] * p["inputMicroUsdPerMillionTokens"]
                       + usage["output_tokens"] * p["outputMicroUsdPerMillionTokens"]) / 1_000_000)
    if grounded:
        if search_queries is None:
            return None
        micro += search_queries * p["webSearchMicroUsdPerQuery"]
    return micro


# ---------------------------------------------------------------- Meta HTTP

@dataclass
class HttpResult:
    status: int
    body: bytes
    duration_ms: int
    headers: dict[str, str] = field(default_factory=dict)


SAFE_HEADERS = {"content-type", "retry-after", "x-ratelimit-limit-requests",
                "x-ratelimit-remaining-requests", "x-ratelimit-limit-tokens",
                "x-ratelimit-remaining-tokens"}


def meta_post(config: Config, path: str, *, json_body: dict | None = None,
              files: Any = None, data: Any = None, params: dict | None = None,
              accept: str = "application/json", deadline_s: float = 40,
              max_bytes: int = 40_000_000) -> HttpResult:
    """POST to the Meta API with a total deadline that includes body reading."""
    if not config.api_key:
        raise SpikeExit(EXIT_CONFIG, "MODEL_API_KEY is not set in .env.local or .env.")
    headers = {"Authorization": f"Bearer {config.api_key}", "Accept": accept}
    start = time.monotonic()
    try:
        r = requests.post(f"{META_BASE}{path}", headers=headers, json=json_body, files=files,
                          data=data, params=params, stream=True, timeout=(10, deadline_s))
        chunks, size = [], 0
        for chunk in r.iter_content(65536):
            chunks.append(chunk)
            size += len(chunk)
            if size > max_bytes:
                raise SpikeExit(EXIT_UPSTREAM, "Upstream response exceeded the byte bound.")
            if time.monotonic() - start > deadline_s:
                raise requests.Timeout()
    except requests.Timeout:
        raise SpikeExit(EXIT_UPSTREAM, "UPSTREAM_TIMEOUT (outcome unknown; reservation kept).")
    except requests.RequestException as exc:
        raise SpikeExit(EXIT_UPSTREAM, f"UPSTREAM_UNAVAILABLE ({type(exc).__name__}).")
    kept = {k.lower(): v for k, v in r.headers.items() if k.lower() in SAFE_HEADERS}
    return HttpResult(r.status_code, b"".join(chunks), int((time.monotonic() - start) * 1000), kept)


def parse_sse(body: bytes) -> list[dict[str, Any]]:
    """Split an SSE body into JSON events. Frames end at a blank line; a frame
    may carry several data: lines that join with newlines."""
    events = []
    text = body.decode("utf-8").replace("\r\n", "\n")
    for frame in text.split("\n\n"):
        data_lines = [ln[5:].lstrip(" ") for ln in frame.split("\n") if ln.startswith("data:")]
        if not data_lines:
            continue
        payload = "\n".join(data_lines)
        if payload.strip() == "[DONE]":
            continue
        events.append(json.loads(payload))
    return events


def paid_call(budget: Budget, *, profile: str, route: str, model: str, amount: int,
              body_for_fingerprint: bytes, deadline_s: float,
              dispatch: Callable[[], HttpResult],
              charge: Callable[[HttpResult], int | None]) -> HttpResult:
    """Reserve, dispatch once, settle. No automatic retry of anything."""
    fingerprint = hashlib.sha256(body_for_fingerprint).hexdigest()
    res = budget.reserve(route, model, amount, fingerprint, deadline_s)
    entry = {"ticket": budget.ticket, "profile": profile, "route": route, "model": model,
             "attempts": 1, "reservedMicroUsd": amount}
    try:
        result = dispatch()
    except Exception:
        budget.settle(res, "unknown")
        audit({**entry, "status": "unknown", "settledMicroUsd": amount})
        raise
    entry.update(durationMs=result.duration_ms, httpStatus=result.status)
    if result.status == 429:
        budget.settle(res, "released")
        audit({**entry, "status": "released_429", "settledMicroUsd": 0})
        return result
    try:
        charged = charge(result) if result.status == 200 else None
    except Exception:
        # A malformed 200 body still may have been billed: keep the full reservation.
        charged = None
    if charged is None:
        budget.settle(res, "unknown")
        audit({**entry, "status": "unknown", "settledMicroUsd": amount})
    else:
        budget.settle(res, "settled", charged)
        audit({**entry, "status": "settled", "settledMicroUsd": charged})
        if charged > amount:
            print(f"WARNING: charge {charged} exceeded reservation {amount}; ledger halted.",
                  file=sys.stderr)
    return result


# ---------------------------------------------------------------- evidence

SAFE_VALUE_KEYS = {"type", "status", "object", "model", "code", "role", "encoding", "reason",
                   "output_format", "finish_reason"}


def structure(value: Any, key: str | None = None, depth: int = 0) -> Any:
    """Field structure without content: types, lengths, and a few enum-like values."""
    if depth > 8:
        return "..."
    if isinstance(value, dict):
        return {k: structure(v, k, depth + 1) for k, v in value.items()}
    if isinstance(value, list):
        head = [structure(value[0], key, depth + 1)] if value else []
        return head + ([f"... len={len(value)}"] if len(value) > 1 else [])
    if isinstance(value, str):
        if key in SAFE_VALUE_KEYS and len(value) <= 64:
            return value
        return f"str[{len(value)}]"
    if isinstance(value, bool) or value is None:
        return value
    if isinstance(value, (int, float)):
        return type(value).__name__
    return type(value).__name__


def response_summary(result: HttpResult) -> dict[str, Any]:
    """Sanitized status, safe headers, and error code/type for non-200 responses."""
    summary: dict[str, Any] = {"httpStatus": result.status, "durationMs": result.duration_ms,
                               "headers": result.headers}
    if result.status != 200:
        try:
            err = json.loads(result.body).get("error", {})
            summary["error"] = {"code": err.get("code"), "type": err.get("type")}
        except (ValueError, AttributeError):
            summary["error"] = {"code": None, "type": "non_json_body"}
    return summary


def write_result(profile: str, fixture: str | None, status: str, input_hash: str,
                 summary: dict[str, Any]) -> Path:
    """Private per-profile result used for caching and for docs/api-evidence.md."""
    path = OUT / "results" / f"{profile}__{(fixture or 'none').replace('.', '_')}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"profile": profile, "fixture": fixture, "status": status,
                                "inputHash": input_hash, "at": datetime.now(ET).isoformat(),
                                "summary": summary}, indent=2, sort_keys=True))
    return path


def cached_pass(profile: str, fixture: str | None, input_hash: str) -> bool:
    path = OUT / "results" / f"{profile}__{(fixture or 'none').replace('.', '_')}.json"
    if not path.exists():
        return False
    data = json.loads(path.read_text())
    return data.get("status") == "passed" and data.get("inputHash") == input_hash


def fixture_image(name: str, allow_placeholder: bool = False) -> tuple[Any, str, bool]:
    """Normalized fixture as (Normalized, data URL, is_placeholder).

    Dry runs may use a synthetic gray placeholder to check request shape only.
    """
    import imaging  # local import keeps common.py usable without Pillow
    path = FIXTURES / name
    if path.exists():
        n = imaging.normalize(path.read_bytes())
        # Owner rule 2026-10-28: on-bike covers are refilled before ANY upload
        # (SAM, Spark, Files, edits); VIN and plate covers stay.
        n, url = refill_bike_covers(n, fixture_covers(name))
        return n, url, False
    if not allow_placeholder:
        raise SpikeExit(EXIT_CONFIG, f"fixtures/{name} is missing (U09).")
    from PIL import Image
    import io
    buf = io.BytesIO()
    Image.new("RGB", (1024, 768), (128, 128, 128)).save(buf, "PNG")
    n = imaging.normalize(buf.getvalue())
    return n, data_url("image/webp", n.data), True


def fixture_covers(name: str) -> list[dict[str, Any]]:
    """Covers recorded for a fixture in expected.json (none if absent)."""
    if not (FIXTURES / "expected.json").exists():
        return []
    entry = (load_expected().get("fixtures") or {}).get(name) or {}
    return list(entry.get("covers") or [])


def refill_bike_covers(norm: Any, covers: list[dict[str, Any]] | None) -> tuple[Any, str]:
    """Refill kind 'bike' covers on a copy; return (Normalized, data URL).

    Works on the normalized RGB, then re-encodes through imaging.normalize. Dimensions
    must not change, because every box and mask uses this bitmap.
    """
    import io
    import imaging
    from PIL import Image
    boxes = [c["box"] for c in covers or [] if c.get("kind") == "bike"]
    if not boxes:
        return norm, data_url("image/webp", norm.data)
    rgb = imaging.refill_boxes(imaging.decode_rgb(norm.data), boxes)
    buf = io.BytesIO()
    Image.fromarray(rgb).save(buf, "PNG")
    out = imaging.normalize(buf.getvalue())
    if (out.width, out.height) != (norm.width, norm.height):
        raise SpikeExit(EXIT_ASSERTION, "Cover refill changed the image size; refusing to upload.")
    return out, data_url("image/webp", out.data)


def redact_body(body: Any) -> Any:
    """Request body for dry-run printing: data URLs replaced by their length."""
    if isinstance(body, dict):
        return {k: redact_body(v) for k, v in body.items()}
    if isinstance(body, list):
        return [redact_body(v) for v in body]
    if isinstance(body, str) and body.startswith("data:"):
        return f"<data URL, {len(body)} chars>"
    if isinstance(body, str) and len(body) > 120:
        return f"<text, {len(body)} chars>"
    return body


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def data_url(mime: str, data: bytes) -> str:
    return f"data:{mime};base64,{base64.b64encode(data).decode('ascii')}"


# ------------------------------------------------------- JSON schema subset

def validate_schema(value: Any, schema: dict[str, Any], path: str = "$") -> list[str]:
    """Validate the JSON Schema subset our strict model schemas use.
    Returns a list of problems; empty means valid."""
    problems: list[str] = []
    if "anyOf" in schema:
        if all(validate_schema(value, s, path) for s in schema["anyOf"]):
            problems.append(f"{path}: matches no anyOf branch")
        return problems
    if "const" in schema and value != schema["const"]:
        problems.append(f"{path}: expected const")
    if "enum" in schema and value not in schema["enum"]:
        problems.append(f"{path}: not in enum")
    types = schema.get("type")
    if types is not None:
        types = types if isinstance(types, list) else [types]
        checks = {"object": lambda v: isinstance(v, dict), "array": lambda v: isinstance(v, list),
                  "string": lambda v: isinstance(v, str), "null": lambda v: v is None,
                  "boolean": lambda v: isinstance(v, bool),
                  "integer": lambda v: isinstance(v, int) and not isinstance(v, bool),
                  "number": lambda v: isinstance(v, (int, float)) and not isinstance(v, bool)}
        if not any(checks[t](value) for t in types):
            return [f"{path}: expected {types}"]
    if isinstance(value, dict):
        props = schema.get("properties", {})
        for req in schema.get("required", []):
            if req not in value:
                problems.append(f"{path}.{req}: missing")
        if schema.get("additionalProperties") is False:
            problems += [f"{path}.{k}: unexpected" for k in value if k not in props]
        for k, v in value.items():
            if k in props:
                problems += validate_schema(v, props[k], f"{path}.{k}")
    if isinstance(value, list):
        if "minItems" in schema and len(value) < schema["minItems"]:
            problems.append(f"{path}: too few items")
        if "maxItems" in schema and len(value) > schema["maxItems"]:
            problems.append(f"{path}: too many items")
        prefix = schema.get("prefixItems")
        for i, item in enumerate(value):
            sub = prefix[i] if prefix and i < len(prefix) else schema.get("items")
            if isinstance(sub, dict):
                problems += validate_schema(item, sub, f"{path}[{i}]")
    if isinstance(value, str):
        if "minLength" in schema and len(value) < schema["minLength"]:
            problems.append(f"{path}: too short")
        if "maxLength" in schema and len(value) > schema["maxLength"]:
            problems.append(f"{path}: too long")
        if "pattern" in schema and not re.search(schema["pattern"], value):
            problems.append(f"{path}: pattern mismatch")
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if "minimum" in schema and value < schema["minimum"]:
            problems.append(f"{path}: below minimum")
        if "maximum" in schema and value > schema["maximum"]:
            problems.append(f"{path}: above maximum")
    return problems


# ---------------------------------------------------------------- CLI

def base_parser(description: str) -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=description)
    p.add_argument("--fixture-set", choices=sorted(FIXTURE_SETS), default="plain")
    p.add_argument("--dry-run", action="store_true",
                   help="Validate configuration and request shape without HTTP.")
    p.add_argument("--force", action="store_true", help="Repeat cached passed work.")
    p.add_argument("--ticket", default="T0", help="Ticket that pays for paid calls.")
    return p


def run_main(main: Callable[[], int]) -> None:
    """Map SpikeExit to SPEC exit codes and print only safe messages."""
    try:
        code = main()
    except SpikeExit as exc:
        print(f"[exit {exc.code}] {exc.message}", file=sys.stderr)
        code = exc.code
    sys.exit(code)
