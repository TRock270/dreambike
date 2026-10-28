"""Muse Image profiles of POST /v1/images/edits (SPEC.md 6.2, U04).

python spike/images_edits.py --fixture-set plain --mode edit
python spike/images_edits.py --fixture-set plain --mode compose
python spike/images_edits.py --fixture-set plain --mode compare
python spike/images_edits.py --fixture-set plain --mode compose --reference rear

On-bike cover boxes (expected.json "covers", kind "bike") are refilled from their edge
pixels on a copy before upload. vin and plate covers are never touched, and nothing
is written to fixtures/.

Raw JSON body, one image per call, no mask field. Outputs are private files in
spike/out/edits/. Drift is measured against the SAM target mask from the points
profile when one exists; it is a heuristic, not an alignment proof.
"""

from __future__ import annotations

import base64
import io
import json
import time
from typing import Any

import numpy as np
from PIL import Image

import common
import imaging

MODEL = "muse-image-1.0"
DEADLINE_S = 100
NO_TOOLS = {"enable_image_search": False, "enable_web_search": False, "enable_shell": False}


def template(name: str, edit_prompt: str) -> str:
    """Expand a versioned template; only the text after the header line block is sent."""
    text = (common.PROMPTS / name).read_text()
    body = text.split("\n\n", 1)[1]
    return body.replace("{{editPrompt}}", edit_prompt.strip())


def body_for(prompt: str, images: list[str], width: int, height: int, quality: str) -> dict[str, Any]:
    return {
        "model": MODEL, "prompt": prompt, "images": [{"image_url": u} for u in images], "n": 1,
        "size": f"{width}x{height}", "response_format": "b64_json", "output_format": "webp",
        "reasoning_strength": quality, "tool_enablement": dict(NO_TOOLS),
    }


# Moved to common.py so every spike upload refills on-bike covers; kept here for callers.
refill_bike_covers = common.refill_bike_covers


def cached_edit_prompt(fixture: str, profile: str) -> str | None:
    """Reuse a passed Spark instruction instead of paying for it again."""
    path = common.OUT / "results" / f"{profile}__{fixture.replace('.', '_')}.json"
    if not path.exists():
        return None
    data = json.loads(path.read_text())
    if data.get("status") != "passed":
        return None
    return data["summary"]["parsed"]["instruction"]["editPrompt"]


def target_mask(fixture: str, width: int, height: int) -> np.ndarray | None:
    path = common.OUT / "sam" / fixture.rsplit(".", 1)[0] / "mask-points-1.png"
    if not path.exists():
        return None
    mask = np.asarray(Image.open(path).convert("L")) > 0
    return mask if mask.shape == (height, width) else None


def run_edit(config, budget, profile: str, prompt: str, images: list[str], base: Any,
             quality: str, fixture: str, dry_run: bool) -> dict[str, Any]:
    body = body_for(prompt, images, base.width, base.height, quality)
    if dry_run:
        return {"profile": profile, "dryRun": True, "body": common.redact_body(body)}
    raw = json.dumps(body).encode()
    per_image = common.load_prices()["prices"][MODEL]["perReturnedImageMicroUsd"]
    started = time.monotonic()
    result = common.paid_call(
        budget, profile=profile, route="/images/edits", model=MODEL,
        amount=common.load_prices()["reservations"][MODEL], body_for_fingerprint=raw,
        deadline_s=DEADLINE_S,
        dispatch=lambda: common.meta_post(config, "/images/edits", json_body=body,
                                          deadline_s=DEADLINE_S),
        charge=lambda r: per_image * len(json.loads(r.body).get("data") or []) or None)
    summary: dict[str, Any] = {"profile": profile, "quality": quality,
                               "wallMs": int((time.monotonic() - started) * 1000),
                               **common.response_summary(result)}
    if result.status != 200:
        return summary
    response = json.loads(result.body)
    summary["responseStructure"] = common.structure(response)
    data = response.get("data") or []
    if not data or not data[0].get("b64_json"):
        summary["problems"] = ["NO_RESULT: empty data"]
        return summary
    raw_image = base64.b64decode(data[0]["b64_json"])
    out_dir = common.OUT / "edits"
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / f"{profile}-{quality}.webp").write_bytes(raw_image)
    img = Image.open(io.BytesIO(raw_image))
    summary["generated"] = {"format": img.format, "mode": img.mode, "width": img.width,
                            "height": img.height, "bytes": len(raw_image),
                            "chunks": imaging.webp_chunks(raw_image) if img.format == "WEBP" else None}
    if "A" in img.getbands():
        alpha = np.asarray(img.getchannel("A"))
        summary["generated"]["opaque"] = bool(alpha.min() == 255)
    bounded = imaging.normalize(raw_image)
    summary["bounded"] = {"width": bounded.width, "height": bounded.height,
                          "bytes": len(bounded.data), "quality": bounded.quality}
    aspect = imaging.aspect_difference(img.width, img.height, base.width, base.height)
    summary["aspectDifference"] = round(aspect, 4)
    mask = target_mask(fixture, base.width, base.height)
    if mask is None:
        summary["drift"] = "no SAM target mask from the points profile; drift not measured"
    elif aspect <= imaging.ASPECT_LIMIT:
        resized = img.convert("RGB").resize((base.width, base.height), Image.LANCZOS)
        edited = np.asarray(resized, dtype=np.uint8)
        base_rgb = imaging.decode_rgb(base.data)
        xs = np.nonzero(mask.any(axis=0))[0]
        # Old-mask-only estimate: the app re-segments the edited part first (T5).
        res = imaging.composite(base_rgb, edited, mask, mask, int(xs.max() - xs.min() + 1),
                                "paint", (img.width, img.height))
        summary["composite"] = {"reason": res.reason, "drift": res.drift,
                                "note": "old target mask only; no edited-image SAM call"}
        Image.fromarray(res.image).save(out_dir / f"{profile}-{quality}-composite.webp")
    return summary


def main() -> int:
    parser = common.base_parser(__doc__.splitlines()[0])
    parser.add_argument("--mode", choices=["edit", "compose", "compare"], required=True)
    parser.add_argument("--reference", choices=["front", "rear"], default="front",
                        help="compose only: use expected.json reference (front) or referenceRear.")
    args = parser.parse_args()
    config = common.Config.load()
    fixture = common.FIXTURE_SETS[args.fixture_set][0]
    entry = {} if args.dry_run else common.require_rights(fixture)
    budget = None if args.dry_run else common.Budget(config, args.ticket)
    # Dry runs use a name that never exists, so fixtures/ is never read.
    base, base_url, placeholder = common.fixture_image(
        "base-placeholder" if args.dry_run else fixture, allow_placeholder=args.dry_run)
    if args.reference == "rear" and args.mode != "compose":
        raise common.SpikeExit(common.EXIT_CONFIG, "--reference rear works with --mode compose only.")
    # fixture_image already refilled the on-bike covers recorded in expected.json.

    if args.mode == "compose":
        ref_key = "referenceRear" if args.reference == "rear" else "reference"
        ref = {} if args.dry_run else (common.load_expected().get(ref_key) or {})
        if not args.dry_run and not (ref.get("file") and ref.get("identifiersReviewed") is True
                                     and ref.get("description")):
            raise common.SpikeExit(common.EXIT_CONFIG, "Owned reference part not configured in "
                                   f"expected.json ({ref_key}: file, identifiersReviewed, description).")
        if args.dry_run:
            _, ref_url, _ = common.fixture_image("reference-placeholder", allow_placeholder=True)
            edit_prompt = "<approved edit prompt>"
        else:
            ref_norm, _, _ = common.fixture_image(ref["file"])
            _, ref_url = refill_bike_covers(ref_norm, ref.get("covers"))
            # The cached Spark instruction describes the front reference only.
            cached = (cached_edit_prompt(fixture, "spark_instruction_reference")
                      if args.reference == "front" else None)
            edit_prompt = cached or ref["description"]
        profile = "image_compose_rear" if args.reference == "rear" else "image_compose"
        runs = [(profile, template("compose.v1.md", edit_prompt), [base_url, ref_url], "high")]
    else:
        test = entry.get("paintTest") or {}
        if args.dry_run:
            edit_prompt = "<approved edit prompt>"
        elif not test.get("request"):
            raise common.SpikeExit(common.EXIT_CONFIG, "paintTest.request missing in expected.json.")
        else:
            edit_prompt = cached_edit_prompt(fixture, "spark_instruction_paint") or test["request"]
        prompt = template("paint.v1.md", edit_prompt)
        qualities = ["low", "high"] if args.mode == "compare" else ["high"]
        runs = [(f"image_{args.mode}", prompt, [base_url], q) for q in qualities]

    failed = False
    for profile, prompt, images, quality in runs:
        input_hash = common.sha256_hex(json.dumps(
            [profile, prompt, [common.sha256_hex(u.encode()) for u in images], quality]).encode())
        if not args.dry_run and not args.force and \
                common.cached_pass(f"{profile}_{quality}", fixture, input_hash):
            print(f"{profile} {quality}: cached pass (use --force to repeat)")
            continue
        summary = run_edit(config, budget, profile, prompt, images, base, quality, fixture,
                           args.dry_run)
        if args.dry_run:
            print(json.dumps({"placeholderImage": placeholder, **summary}, indent=2))
            continue
        gen = summary.get("generated") or {}
        ok = (summary.get("httpStatus") == 200 and not summary.get("problems")
              and gen.get("width") and gen.get("opaque", True))
        failed |= not ok
        common.write_result(f"{profile}_{quality}", fixture, "passed" if ok else "failed",
                            input_hash, summary)
        print(f"{profile} {quality}: {'passed' if ok else 'failed'} "
              f"(HTTP {summary.get('httpStatus')}, {summary.get('wallMs')} ms). "
              f"Owner: review spike/out/edits/ before/after.")
    return common.EXIT_ASSERTION if failed else common.EXIT_PASSED


if __name__ == "__main__":
    common.run_main(main)
