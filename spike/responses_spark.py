"""Muse Spark (Contributor) profiles of POST /v1/responses (SPEC.md 6.3, U02).

python spike/responses_spark.py --fixture-set plain --mode identify
python spike/responses_spark.py --fixture-set plain --mode instruction
python spike/responses_spark.py --fixture-set plain --mode grounded

identify and instruction use strict text.format JSON schemas and no tools.
grounded sends the fit-check.v1 request with web_search (T9). It needs
SEARCH_QUERY_RESERVE (at least 1) and keeps the whole reservation, because the
query count is not reported (U06) until the probe shows otherwise.
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime
from typing import Any

import common

DEADLINE_S = 40


def schema(name: str) -> dict[str, Any]:
    return json.loads((common.PROMPTS / "schemas" / f"{name}.json").read_text())


def body_for(config: common.Config, prompt_file: str, format_name: str, task: dict[str, Any],
             image_url: str | None) -> dict[str, Any]:
    content: list[dict[str, Any]] = [{"type": "input_text", "text": json.dumps(task)}]
    if image_url:
        content.append({"type": "input_image", "image_url": image_url})
    return {
        "model": config.muse_model, "stream": False, "store": False, "max_output_tokens": 4096,
        "instructions": (common.PROMPTS / prompt_file).read_text(),
        "input": [{"type": "message", "role": "user", "content": content}],
        "text": {"format": {"type": "json_schema", "name": format_name, "strict": True,
                            "schema": schema(format_name)}},
    }


# Search grounding of the TS grounded body (src/lib/server/meta.ts GROUNDED_FIELDS).
GROUNDED_FIELDS: dict[str, Any] = {
    "tools": [{"type": "web_search", "search_context_size": "low",
               "user_location": {"type": "approximate", "country": "DE"}}],
    "max_tool_calls": 2,
    "include": ["web_search_call.results"],
}
GROUNDED_DEADLINE_S = 70


def grounded_body(config: common.Config, task: dict[str, Any]) -> dict[str, Any]:
    """fit-check.v1 without its header paragraph (as the TS promptBody sends it)."""
    text = (common.PROMPTS / "fit-check.v1.md").read_text()
    body = body_for(config, "fit-check.v1.md", "fit_check_v1", task, None)
    body["instructions"] = text[text.index("\n\n") + 2:]
    return {**body, **GROUNDED_FIELDS}


def _test_item(name: str, slot: str, title: str, spec: list[tuple[str, str]], intent: str,
               product: dict[str, Any] | None) -> dict[str, Any]:
    return {"id": str(uuid.uuid5(uuid.NAMESPACE_URL, f"dreambike-t9-test/{name}")), "slot": slot,
            "title": f"TEST ITEM: {title}", "spec": [{"key": k, "value": v} for k, v in spec],
            "product": product, "intent": intent}


def grounded_items() -> list[dict[str, Any]]:
    """Four generic test items for the SPEC cases; no brands, part numbers or ABE numbers."""
    return [
        _test_item("handlebar", "handlebar", "taller handlebar, cable reach unknown",
                   [("rise", "+80 mm over stock")], "geometry", None),
        _test_item("exhaust", "exhaust", "US-market exhaust without papers",
                   [("market", "US"), ("papers", "none supplied")], "replace", None),
        _test_item("wheel", "wheel_front", "front wheel swap, ABS ring unknown",
                   [("size", "same nominal size as stock")], "geometry", None),
        # The app always sends a listing URL (Product.url); a generic test part has none,
        # so url stays null here on purpose rather than pointing at an invented page.
        _test_item("abe_part", "mirrors", "part with an ABE that carries an inspection condition",
                   [("ABE", "yes, with a condition to have the fitting inspected")], "replace",
                   {"name": "mirror set", "partNumber": None, "url": None,
                    "approvalText": "ABE; fitting must be inspected by an authority"}),
    ]


def grounded_task(bike: dict[str, Any], items: list[dict[str, Any]], batch: int = 1) -> dict[str, Any]:
    """Batch 1 checks the first three items, batch 2 the rest; activeBuild always lists all."""
    # Mirrors buildFitTask in src/lib/server/fitPolicy.ts (key order too); keep in sync.
    ordered = sorted(items, key=lambda i: (i["slot"], i["id"]))
    return {"bike": bike, "items": items[:3] if batch == 1 else items[3:],
            "activeBuild": [{"itemId": i["id"], "slot": i["slot"], "title": i["title"],
                             "spec": i.get("spec", [])} for i in ordered],
            "shopRules": [], "legalAsOf": datetime.now(common.ET).date().isoformat(),
            # Copy of LEGAL_SEED.sources in src/lib/project.ts (PLAN 16); no StVZO §19.
            "legalSources": [
                {"title": "TÜV Rheinland: Vollabnahme und Tuning",
                 "url": "https://www.tuv.com/germany/de/lp/mobilit%C3%A4t/vollabnahme/main-navigation/tuner/"},
                {"title": "StVZO §72", "url": "https://www.gesetze-im-internet.de/stvzo_2012/__72.html"},
                {"title": "StVZO §21", "url": "https://www.gesetze-im-internet.de/stvzo_2012/__21.html"}]}


def _dicts(value: Any) -> list[dict[str, Any]]:
    """Only the object entries of a list; a paid answer of any shape must still leave evidence."""
    return [v for v in value if isinstance(v, dict)] if isinstance(value, list) else []


def sanitize_search_call(item: dict[str, Any]) -> dict[str, Any]:
    """Every field of a web_search_call item; result lists become counts and URLs only."""
    out: dict[str, Any] = {}
    for key, value in item.items():
        if key == "results" and isinstance(value, list):
            out["resultCount"] = len(value)
            out["resultUrls"] = [r.get("url") for r in value if isinstance(r, dict)]
        elif key == "action" and isinstance(value, dict):
            out[key] = {k: v for k, v in value.items() if k != "results"}
            if isinstance(value.get("results"), list):
                out["actionResultCount"] = len(value["results"])
                out["actionResultUrls"] = [r.get("url") for r in value["results"] if isinstance(r, dict)]
        else:
            out[key] = value
    return out


def run_grounded(config, budget, bike: dict[str, Any], dry_run: bool, items: list[dict[str, Any]],
                 batch: int = 1) -> dict[str, Any]:
    reserve_queries = config.search_query_reserve
    prices = common.load_prices()["reservations"]
    amount = prices["spark-grounded-base"] + prices["spark-grounded-per-query"] * reserve_queries
    task = grounded_task(bike, items, batch)
    profile = "spark_grounded" if batch == 1 else f"spark_grounded_{batch}"
    body = grounded_body(config, task)
    if dry_run:
        return {"profile": profile, "dryRun": True, "reserveMicroUsd": amount,
                "body": common.redact_body(body), "task": task}
    raw = json.dumps(body).encode()
    result = common.paid_call(
        budget, profile=profile, route="/responses", model=config.muse_model, amount=amount,
        body_for_fingerprint=raw, deadline_s=GROUNDED_DEADLINE_S,
        dispatch=lambda: common.meta_post(config, "/responses", json_body=body,
                                          deadline_s=GROUNDED_DEADLINE_S),
        # The query count is not reported (U06): None keeps the full reservation.
        charge=lambda r: common.spark_charge(json.loads(r.body).get("usage"), None, True))
    summary: dict[str, Any] = {"profile": profile, "reservedMicroUsd": amount,
                               **common.response_summary(result)}
    if result.status != 200:
        return summary
    try:
        response = json.loads(result.body)
    except ValueError:
        summary["problems"] = ["response body is not JSON"]
        return summary
    if not isinstance(response, dict):
        summary["problems"] = ["response body is not an object"]
        return summary
    summary["responseStatus"] = response.get("status")
    summary["usage"] = response.get("usage")  # numbers only: full object for U06
    summary["responseStructure"] = common.structure(
        {k: v for k, v in response.items() if k not in ("instructions", "text", "tools")})
    output = _dicts(response.get("output"))
    calls = [i for i in output if i.get("type") == "web_search_call"]
    summary["webSearchCalls"] = [sanitize_search_call(i) for i in calls]
    summary["outputItemTypes"] = [i.get("type", "?") for i in output]
    summary["searched"] = any(i.get("status") == "completed" for i in calls)
    citations = [a.get("url") for i in output for b in _dicts(i.get("content"))
                 if b.get("type") == "output_text" for a in _dicts(b.get("annotations"))
                 if a.get("type") == "url_citation"]
    summary["citationUrls"] = citations
    text, _, refused = extract(response)
    summary["refused"] = refused
    if text is None:
        summary["problems"] = ["no output_text"]
        return summary
    try:
        parsed = json.loads(text)
    except ValueError:
        summary["problems"] = ["output_text is not JSON"]
        return summary
    problems = common.validate_schema(parsed, schema("fit_check_v1"))
    ids = [r.get("itemId") for r in _dicts(parsed.get("results"))] if isinstance(parsed, dict) else []
    if ids != [i["id"] for i in task["items"]]:
        problems.append("result ids differ from the requested ids")
    summary["problems"] = problems
    summary["parsed"] = parsed  # private file only
    return summary


def extract(response: dict[str, Any]) -> tuple[str | None, list[str], bool]:
    """Join every output_text block across all output items (never assume
    output[0]); report item types and whether a refusal appeared."""
    texts, item_types, refused = [], [], False
    for item in _dicts(response.get("output")):
        item_types.append(item.get("type", "?"))
        for block in _dicts(item.get("content")):
            if block.get("type") == "output_text" and isinstance(block.get("text"), str):
                texts.append(block["text"])
            elif block.get("type") == "refusal":
                refused = True
    return ("".join(texts) if texts else None), item_types, refused


def run_profile(config, budget, profile: str, prompt_file: str, format_name: str,
                task: dict[str, Any], image_url: str | None, dry_run: bool) -> dict[str, Any]:
    body = body_for(config, prompt_file, format_name, task, image_url)
    if dry_run:
        return {"profile": profile, "dryRun": True, "body": common.redact_body(body)}
    raw = json.dumps(body).encode()
    reserve = common.load_prices()["reservations"]["spark-ungrounded"]
    result = common.paid_call(
        budget, profile=profile, route="/responses", model=config.muse_model, amount=reserve,
        body_for_fingerprint=raw, deadline_s=DEADLINE_S,
        dispatch=lambda: common.meta_post(config, "/responses", json_body=body,
                                          deadline_s=DEADLINE_S),
        charge=lambda r: common.spark_charge(json.loads(r.body).get("usage"), None, False))
    summary: dict[str, Any] = {"profile": profile, **common.response_summary(result)}
    if result.status != 200:
        return summary
    response = json.loads(result.body)
    summary["responseStructure"] = common.structure(
        {k: v for k, v in response.items() if k not in ("instructions", "text", "tools")})
    summary["responseStatus"] = response.get("status")
    text, item_types, refused = extract(response)
    summary.update(outputItemTypes=item_types, refused=refused,
                   usage=common.structure(response.get("usage")))
    usage = response.get("usage") or {}
    summary["tokens"] = {k: usage.get(k) for k in ("input_tokens", "output_tokens", "total_tokens")}
    if text is None:
        summary["problems"] = ["no output_text"]
        return summary
    try:
        parsed = json.loads(text)
    except ValueError:
        summary["problems"] = ["output_text is not JSON"]
        return summary
    summary["problems"] = common.validate_schema(parsed, schema(format_name))
    summary["parsed"] = parsed  # private file only; docs get the structure
    return summary


def bike_from_expected(entry: dict[str, Any]) -> dict[str, Any]:
    b = entry.get("bike") or {}
    return {"make": b.get("make"), "model": b.get("model"), "family": b.get("family", "unknown"),
            "engine": b.get("engine"), "yearFrom": b.get("yearFrom"), "yearTo": b.get("yearTo"),
            "abs": b.get("abs", "unknown"), "style": b.get("style"),
            "facing": b.get("facing", "unknown"), "confidence": 1, "limitations": []}


def grounded_main(config, args) -> int:
    if not config.search_query_reserve:  # blank or 0
        raise common.SpikeExit(common.EXIT_BUDGET, "Grounded calls blocked: U06 has no proven "
                               "billable search-query bound (SEARCH_QUERY_RESERVE is blank or 0).")
    fixture = common.FIXTURE_SETS[args.fixture_set][0]
    # Dry run never reads the private expected file; the real run reads it at runtime.
    entry = {} if args.dry_run else common.require_rights(fixture)
    bike = bike_from_expected(entry)
    items = grounded_items()
    budget = None if args.dry_run else common.Budget(config, args.ticket)
    summary = run_grounded(config, budget, bike, args.dry_run, items, args.batch)
    profile = summary["profile"]
    if args.dry_run:
        print(json.dumps(summary, indent=2, ensure_ascii=False))
        return common.EXIT_PASSED
    input_hash = common.sha256_hex(json.dumps([grounded_task(bike, items, args.batch),
        (common.PROMPTS / "fit-check.v1.md").read_text(), config.muse_model]).encode())
    problems = summary.get("problems")
    ok = (summary.get("httpStatus") == 200 and problems == [] and not summary.get("refused")
          and summary.get("searched") is True)
    common.write_result(profile, fixture, "passed" if ok else "failed", input_hash, summary)
    print(f"{profile}: {'passed' if ok else 'failed'} (HTTP {summary.get('httpStatus')}, "
          f"searched={summary.get('searched')}, problems={problems})")
    return common.EXIT_PASSED if ok else common.EXIT_ASSERTION


def main() -> int:
    parser = common.base_parser(__doc__.splitlines()[0])
    parser.add_argument("--batch", type=int, choices=[1, 2], default=1,
                        help="grounded mode: batch 1 = test items 1-3, batch 2 = item 4")
    parser.add_argument("--mode", choices=["identify", "instruction", "grounded"], required=True)
    args = parser.parse_args()
    config = common.Config.load()
    if args.mode == "grounded":
        return grounded_main(config, args)
    fixture = common.FIXTURE_SETS[args.fixture_set][0]
    entry = {} if args.dry_run else common.require_rights(fixture)
    budget = None if args.dry_run else common.Budget(config, args.ticket)
    n, image_url, placeholder = common.fixture_image(fixture, allow_placeholder=args.dry_run)

    runs: list[tuple[str, str, str, dict[str, Any], str | None]] = []
    if args.mode == "identify":
        runs.append(("spark_identify", "identify.v1.md", "bike_identification_v1",
                     {"width": n.width, "height": n.height}, image_url))
    else:
        bike = bike_from_expected(entry)
        for mode, key in (("text", "textTest"), ("paint", "paintTest")):
            test = entry.get(key) or {}
            if args.dry_run and not test.get("request"):
                test = {"slot": "tank", "box": [100, 100, 300, 200], "request": "<owner request>"}
            if not (test.get("slot") and test.get("box") and test.get("request")):
                print(f"{fixture}: {key} incomplete in expected.json; {mode} profile skipped")
                continue
            runs.append((f"spark_instruction_{mode}", "instruction.v1.md", "edit_instruction_v1",
                         {"slot": test["slot"], "box": test["box"], "bike": bike, "mode": mode,
                          "text": test["request"], "width": n.width, "height": n.height}, None))
        ref = (common.load_expected().get("reference") if not args.dry_run else None) or {}
        if ref.get("file") and ref.get("identifiersReviewed") is True and ref.get("description"):
            _, ref_url, _ = common.fixture_image(ref["file"])
            runs.append(("spark_instruction_reference", "instruction.v1.md", "edit_instruction_v1",
                         {"slot": ref["slot"], "box": ref["box"], "bike": bike, "mode": "reference",
                          "text": ref["description"], "width": n.width, "height": n.height},
                         ref_url))
        elif not args.dry_run:
            print("reference part not configured in expected.json; reference profile skipped")
    if not runs:
        raise common.SpikeExit(common.EXIT_CONFIG, "No runnable profile; fill expected.json.")

    failed = False
    for profile, prompt_file, fmt, task, img in runs:
        input_hash = common.sha256_hex(json.dumps(
            [profile, task, (common.PROMPTS / prompt_file).read_text(), fmt,
             common.sha256_hex(img.encode()) if img else None, config.muse_model]).encode())
        if not args.dry_run and not args.force and common.cached_pass(profile, fixture, input_hash):
            print(f"{profile}: cached pass (use --force to repeat)")
            continue
        summary = run_profile(config, budget, profile, prompt_file, fmt, task, img, args.dry_run)
        if args.dry_run:
            print(json.dumps({"placeholderImage": placeholder, **summary}, indent=2))
            continue
        problems = summary.get("problems")
        ok = summary.get("httpStatus") == 200 and problems == [] and not summary.get("refused")
        if ok and task.get("mode") == "paint":
            ok = summary["parsed"]["instruction"]["intent"] == "paint"
        failed |= not ok
        common.write_result(profile, fixture, "passed" if ok else "failed", input_hash, summary)
        print(f"{profile}: {'passed' if ok else 'failed'} (HTTP {summary.get('httpStatus')}, "
              f"problems={problems})")
    return common.EXIT_ASSERTION if failed else common.EXIT_PASSED


if __name__ == "__main__":
    common.run_main(main)
