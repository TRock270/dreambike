"""Muse Spark (Contributor) profiles of POST /v1/responses (SPEC.md 6.3, U02).

python spike/responses_spark.py --fixture-set plain --mode identify
python spike/responses_spark.py --fixture-set plain --mode instruction
python spike/responses_spark.py --fixture-set plain --mode grounded

identify and instruction use strict text.format JSON schemas and no tools.
grounded stays blocked until U06 proves a billable search-query bound
(SEARCH_QUERY_RESERVE) and the fit-check prompt exists (T9).
"""

from __future__ import annotations

import json
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


def extract(response: dict[str, Any]) -> tuple[str | None, list[str], bool]:
    """Join every output_text block across all output items (never assume
    output[0]); report item types and whether a refusal appeared."""
    texts, item_types, refused = [], [], False
    for item in response.get("output") or []:
        item_types.append(item.get("type", "?"))
        for block in item.get("content") or []:
            if block.get("type") == "output_text":
                texts.append(block.get("text", ""))
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


def main() -> int:
    parser = common.base_parser(__doc__.splitlines()[0])
    parser.add_argument("--mode", choices=["identify", "instruction", "grounded"], required=True)
    args = parser.parse_args()
    config = common.Config.load()
    if args.mode == "grounded":
        if config.search_query_reserve is None:
            raise common.SpikeExit(common.EXIT_BUDGET, "Grounded calls blocked: U06 has no proven "
                                   "billable search-query bound (SEARCH_QUERY_RESERVE is blank).")
        raise common.SpikeExit(common.EXIT_SKIPPED, "Grounded profile is implemented with T9's "
                               "fit-check prompt; not available in this ticket yet.")
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
