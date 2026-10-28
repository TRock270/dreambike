"""SAM 3.1 profiles of POST /v1/responses (SPEC.md 6.1, U01).

python spike/responses_sam.py --fixture-set plain --mode concept
python spike/responses_sam.py --fixture-set plain --mode points
python spike/responses_sam.py --fixture-set all --mode parts

Overlays and full-image masks go to spike/out/sam/<fixture>/ for the owner to
inspect. Mask placement stays unverified (U01) until the owner confirms the
box-relative overlay lands on an off-origin part; this script only reports
evidence that supports or contradicts it.
"""

from __future__ import annotations

import asyncio
import json
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import numpy as np

import common
import imaging
from meta_sam_parser import (PromptObject, PromptPoint, FramePrompt, ResponsesStreamError,
                             build_object_prompt, decode_mask_to_raster,
                             image_segmentation_format, parse_responses_stream)

MODEL = "sam-3.1"
DEADLINE_S = 40
CONCURRENCY = 4
ZERO_MATCH_PHRASE = "giraffe"
# Core phrases (PLAN.md 9.3): first phrase, fallback. Front/rear share a request.
CORE_PHRASES = [
    ("wheel", "motorcycle wheel"), ("front fork", "motorcycle fork"),
    ("fuel tank", "motorcycle tank"), ("handlebar", "motorcycle handlebar"),
    ("exhaust pipe", "muffler"), ("air cleaner", "air filter"),
    ("motorcycle seat", "saddle"), ("headlight", "motorcycle headlight"),
    ("fender", "motorcycle fender"), ("motorcycle frame", "frame"),
    ("engine", "motorcycle engine"), ("foot peg", "forward control"),
    ("mirror", "rearview mirror"), ("turn signal", "motorcycle indicator"),
]
COLORS = [(8, 145, 178), (91, 80, 240), (225, 29, 72), (13, 148, 136), (210, 96, 11),
          (139, 92, 246), (77, 124, 15), (71, 85, 105)]


def body_for(text: str, image_url: str) -> dict[str, Any]:
    return {
        "model": MODEL, "stream": True, "store": False,
        "metadata": {"include_confidence": "true", "mask_encoding": "one_bit"},
        "input": [{"type": "message", "role": "user", "content": [
            {"type": "input_text", "text": text},
            {"type": "input_image", "image_url": image_url},
        ]}],
    }


async def _replay(events: list[dict[str, Any]]):
    for event in events:
        yield event


def parse_records(events: list[dict[str, Any]]):
    async def run():
        return await parse_responses_stream(_replay(events), image_segmentation_format()).final_result()
    return asyncio.run(run())


def analyze(result, width: int, height: int) -> list[dict[str, Any]]:
    """Pair box and mask records by object ID and classify raster placement."""
    boxes = {r.object_id: r for r in result.records if r.kind == "box"}
    objects = []
    for rec in (r for r in result.records if r.kind == "mask"):
        raster = decode_mask_to_raster(rec.mask)
        b = rec.bounds
        bounds = (int(b.left), int(b.top), int(b.right), int(b.bottom))
        mw, mh = rec.mask.width, rec.mask.height
        if (mw, mh) == (width, height):
            placement = "full_image"
        elif (mw, mh) == (bounds[2] - bounds[0], bounds[3] - bounds[1]):
            placement = "box_sized"
        else:
            placement = "other"
        box = boxes.get(rec.object_id)
        objects.append({
            "objectId": rec.object_id, "bounds": bounds, "maskSize": (mw, mh),
            "placement": placement, "raster": raster,
            "boxMatchesBounds": box is not None and (box.left, box.top, box.right, box.bottom)
            == (b.left, b.top, b.right, b.bottom),
            "confidence": rec.confidence, "area": int(sum(raster)),
        })
    return objects


def call_sam(budget: common.Budget | None, config: common.Config, profile: str, text: str,
             image_url: str, dry_run: bool) -> tuple[common.HttpResult | None, dict[str, Any]]:
    body = body_for(text, image_url)
    if dry_run:
        return None, body
    raw = json.dumps(body).encode()
    result = common.paid_call(
        budget, profile=profile, route="/responses", model=MODEL,
        amount=common.load_prices()["reservations"]["sam-3.1"], body_for_fingerprint=raw,
        deadline_s=DEADLINE_S,
        dispatch=lambda: common.meta_post(config, "/responses", json_body=body,
                                          accept="text/event-stream", deadline_s=DEADLINE_S),
        charge=lambda r: common.load_prices()["prices"]["sam-3.1"]["perImageMicroUsd"])
    return result, body


def run_one(budget, config, profile, label, text, n, image_url, dry_run, out_dir, points=()):
    result, body = call_sam(budget, config, profile, text, image_url, dry_run)
    if result is None:
        return {"label": label, "dryRun": True, "body": common.redact_body(body)}
    summary = {"label": label, **common.response_summary(result)}
    if result.status != 200:
        return summary
    try:
        events = common.parse_sse(result.body)
        parsed = parse_records(events)
    except (ResponsesStreamError, ValueError) as exc:
        summary["parseError"] = type(exc).__name__
        return summary
    summary["eventTypes"] = sorted({e.get("type", "?") for e in events})
    summary["outcome"] = parsed.outcome.status
    summary["diagnostics"] = [d.code for d in parsed.diagnostics]
    objects = analyze(parsed, n.width, n.height)
    summary["objects"] = [{k: v for k, v in o.items() if k != "raster"} for o in objects]
    rgb = imaging.decode_rgb(n.data)
    overlay_masks, overlay_boxes = [], []
    for i, o in enumerate(objects):
        color = COLORS[i % len(COLORS)]
        overlay_boxes.append((o["bounds"], color))
        try:
            mode = None if o["placement"] == "full_image" else "box_relative"
            full = imaging.place_mask(o["raster"], *o["maskSize"], o["bounds"], n.width, n.height,
                                      mode)
        except imaging.MaskPlacementUnknown:
            o["hypothesisPlaced"] = False
            continue
        overlay_masks.append((full, color))
        (out_dir / f"mask-{label}-{o['objectId']}.png").write_bytes(imaging.mask_png(full))
        for (x, y, positive), key in zip(points, ("positiveInside", "negativeInside")):
            summary.setdefault("pointChecks", {})[f"{o['objectId']}:{key}"] = bool(full[y, x])
    out_dir.mkdir(parents=True, exist_ok=True)
    imaging.overlay(rgb, overlay_masks, overlay_boxes, points).save(
        out_dir / f"overlay-{label}.png")
    return summary


def main() -> int:
    parser = common.base_parser(__doc__.splitlines()[0])
    parser.add_argument("--mode", choices=["concept", "points", "parts"], required=True)
    args = parser.parse_args()
    config = common.Config.load()
    fixtures = [f for f in common.FIXTURE_SETS[args.fixture_set] if not f.endswith(".heic")]
    if args.mode != "parts":
        fixtures = fixtures[:1]
    budget = None if args.dry_run else common.Budget(config, args.ticket)
    failed = False
    for fixture in fixtures:
        if not args.dry_run:
            entry = common.require_rights(fixture)
        else:
            entry = {}
        n, image_url, placeholder = common.fixture_image(fixture, allow_placeholder=args.dry_run)
        out_dir = common.OUT / "sam" / fixture.rsplit(".", 1)[0]
        out_dir.mkdir(parents=True, exist_ok=True)
        jobs: list[tuple[str, str, list]] = []
        if args.mode == "concept":
            jobs = [(p, p, []) for p in ("motorcycle", "wheel", ZERO_MATCH_PHRASE)]
        elif args.mode == "points":
            test = entry.get("pointTest") or {}
            pos, neg = test.get("positive"), test.get("negative")
            if args.dry_run and not pos:
                pos, neg = [n.width * 3 // 4, n.height * 2 // 3], [n.width // 2, n.height // 8]
            if not pos or not neg:
                raise common.SpikeExit(common.EXIT_CONFIG,
                                       f"{fixture}: pointTest.positive/negative missing (U09).")
            text = build_object_prompt(size=(n.width, n.height), objects=[PromptObject(
                id=1, prompts=[FramePrompt(frame=0, points=[
                    PromptPoint(x=pos[0], y=pos[1]),
                    PromptPoint(x=neg[0], y=neg[1], label="negative")])])])
            jobs = [("points", text, [(pos[0], pos[1], True), (neg[0], neg[1], False)])]
        else:
            jobs = [("motorcycle", "motorcycle", [])] + [(p, p, []) for p, _ in CORE_PHRASES]

        input_hash = common.sha256_hex(json.dumps(
            [args.mode, fixture, [j[1] for j in jobs], common.sha256_hex(n.data)]).encode())
        profile = f"sam_{args.mode}"
        if not args.dry_run and not args.force and common.cached_pass(profile, fixture, input_hash):
            print(f"{fixture}: {profile} cached pass (use --force to repeat)")
            continue

        with ThreadPoolExecutor(CONCURRENCY) as pool:
            summaries = list(pool.map(
                lambda j: run_one(budget, config, profile, j[0].replace(" ", "_"), j[1], n,
                                  image_url, args.dry_run, out_dir, j[2]), jobs))
        if args.mode == "parts" and not args.dry_run:
            misses = [(p, alt) for (p, alt), s in zip(CORE_PHRASES, summaries[1:])
                      if s.get("httpStatus") == 200 and not s.get("objects")]
            with ThreadPoolExecutor(CONCURRENCY) as pool:
                summaries += list(pool.map(
                    lambda m: run_one(budget, config, profile, m[1].replace(" ", "_"), m[1], n,
                                      image_url, False, out_dir), misses))

        if args.dry_run:
            print(json.dumps({"fixture": fixture, "placeholderImage": placeholder,
                              "normalized": [n.width, n.height, len(n.data)],
                              "requests": summaries}, indent=2))
            continue
        ok = all(s.get("httpStatus") == 200 and s.get("outcome") == "completed"
                 and "parseError" not in s for s in summaries)
        if args.mode == "concept":
            zero = next(s for s in summaries if s["label"] == ZERO_MATCH_PHRASE)
            ok = ok and zero.get("objects") == []
        status = "passed" if ok else "failed"
        failed |= not ok
        path = common.write_result(profile, fixture, status, input_hash, {"calls": summaries})
        print(f"{fixture}: {profile} {status}; overlays in {out_dir.relative_to(common.REPO)}; "
              f"result {path.relative_to(common.REPO)}")
        print("Owner check: open the overlays and confirm each mask covers the real part "
              "(U01). Placement is not verified by this script.")
    return common.EXIT_ASSERTION if failed else common.EXIT_PASSED


if __name__ == "__main__":
    common.run_main(main)
