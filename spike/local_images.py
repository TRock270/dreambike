"""Offline image checks. No Meta calls.

python spike/local_images.py --fixture-set all

Synthetic checks always run (formats, EXIF, byte bounds, mask math, clicks,
documented SAM record placement). Owned-fixture checks run only for files that
exist in fixtures/; missing files are reported as skipped under U09.
"""

from __future__ import annotations

import asyncio
import io
import math
import struct
import zlib
from typing import Callable

import numpy as np
from PIL import Image

import common
import imaging
from meta_sam_parser import (decode_mask_to_raster, image_segmentation_format,
                             parse_responses_stream)

Check = tuple[str, str, str]  # name, status (passed/failed/skipped), detail


def expect_error(data: bytes, code: str, message: str | None = None) -> tuple[bool, str]:
    try:
        imaging.normalize(data)
    except imaging.ImageError as err:
        ok = err.code == code and (message is None or err.message == message)
        return ok, f"{err.code}"
    except Exception as exc:  # anything else would be a 500 in the app
        return False, f"unexpected {type(exc).__name__}"
    return False, "accepted"


def png_header_only(width: int, height: int) -> bytes:
    """A PNG whose IHDR claims a size; pixel data is absent on purpose."""
    def chunk(kind: bytes, payload: bytes) -> bytes:
        return (struct.pack(">I", len(payload)) + kind + payload
                + struct.pack(">I", zlib.crc32(kind + payload)))
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", b"") + chunk(b"IEND", b"")


def to_bytes(img: Image.Image, fmt: str, **kw) -> bytes:
    buf = io.BytesIO()
    img.save(buf, fmt, **kw)
    return buf.getvalue()


# ------------------------------------------------------------- format checks

def format_checks() -> list[Check]:
    out: list[Check] = []
    heic = b"\x00\x00\x00\x18ftypheic\x00\x00\x00\x00mif1heic" + b"\x00" * 64
    ok, d = expect_error(heic, "UNSUPPORTED_FORMAT", imaging.HEIC_MESSAGE)
    out.append(("heic signature rejected with exact message", "passed" if ok else "failed", d))
    gif = to_bytes(Image.new("RGB", (300, 300)), "GIF")
    ok, d = expect_error(gif, "UNSUPPORTED_FORMAT")
    out.append(("gif rejected", "passed" if ok else "failed", d))
    jpeg = to_bytes(Image.new("RGB", (900, 600), (90, 90, 90)), "JPEG")
    ok, d = expect_error(jpeg[: len(jpeg) // 3], "INVALID_IMAGE")
    out.append(("truncated jpeg is INVALID_IMAGE, not a crash", "passed" if ok else "failed", d))
    frames = [Image.new("RGB", (400, 400), c) for c in ((255, 0, 0), (0, 0, 255))]
    anim = io.BytesIO()
    frames[0].save(anim, "WEBP", save_all=True, append_images=frames[1:], duration=100)
    ok, d = expect_error(anim.getvalue(), "UNSUPPORTED_FORMAT")
    out.append(("animated webp rejected", "passed" if ok else "failed", d))
    ok, d = expect_error(png_header_only(8000, 6000), "TOO_LARGE")
    out.append(("48 MP header rejected before decode", "passed" if ok else "failed", d))
    ok, d = expect_error(png_header_only(20000, 10000), "TOO_LARGE")
    out.append(("200 MP decompression-bomb header is TOO_LARGE", "passed" if ok else "failed", d))
    pal = Image.new("P", (900, 600), 0)
    pal.putpalette([255, 0, 0] * 256)
    pal.info["transparency"] = 0
    n = imaging.normalize(to_bytes(pal, "PNG", transparency=0))
    diff = float(np.abs(imaging.decode_rgb(n.data).reshape(-1, 3).mean(axis=0)
                        - np.array(imaging.BACKGROUND)).max())
    out.append(("palette transparency flattened, not shown as its color",
                "passed" if diff <= 3 else "failed", f"max channel difference {diff:.2f}"))
    ok, d = expect_error(to_bytes(Image.new("RGB", (200, 120)), "PNG"), "INVALID_IMAGE")
    out.append(("long edge under 256 px rejected", "passed" if ok else "failed", d))
    small = imaging.normalize(to_bytes(Image.new("RGB", (700, 500), (40, 60, 80)), "PNG"))
    out.append(("long edge under 800 px warns", "passed" if small.warnings else "failed",
                f"{len(small.warnings)} warning(s)"))
    return out


def bound_checks() -> list[Check]:
    rng = np.random.default_rng(7)
    noise = Image.fromarray(rng.integers(0, 256, (3000, 4000, 3), dtype=np.uint8))
    source = to_bytes(noise, "JPEG", quality=92)
    n = imaging.normalize(source)
    chunks = imaging.webp_chunks(n.data)
    meta = [c for c in chunks if c in ("EXIF", "ICCP", "XMP ")]
    ok = max(n.width, n.height) <= 2048 and len(n.data) <= imaging.MAX_BYTES and not meta
    oversize, d = expect_error(to_bytes(noise, "PNG"), "TOO_LARGE")
    return [("4000x3000 noise reduced to <=2048 px and <=1,250,000 bytes, no metadata",
             "passed" if ok else "failed",
             f"{len(source)} -> {n.width}x{n.height}, {len(n.data)} bytes, q={n.quality}, "
             f"chunks={chunks}"),
            ("source file over 25 MB rejected", "passed" if oversize else "failed", d)]


def exif_checks() -> list[Check]:
    """Orientation=6 means 'rotate 90 degrees clockwise to display'."""
    w, h = 600, 400
    img = Image.new("RGB", (w, h), (128, 128, 128))
    marker = (40, 30)  # stored pixel coordinate of a red square's center
    img.paste((255, 0, 0), (marker[0] - 10, marker[1] - 10, marker[0] + 10, marker[1] + 10))
    exif = Image.Exif()
    exif[0x0112] = 6
    data = to_bytes(img, "JPEG", quality=95, exif=exif.tobytes())
    n = imaging.normalize(data)
    rgb = imaging.decode_rgb(n.data)
    red = (rgb[..., 0] > 200) & (rgb[..., 1] < 80) & (rgb[..., 2] < 80)
    ys, xs = np.nonzero(red)
    found = (float(xs.mean()), float(ys.mean())) if len(xs) else (math.nan, math.nan)
    expected = (h - 1 - marker[1], marker[0])  # clockwise: (x, y) -> (H-1-y, x)
    dist = math.dist(found, expected)
    no_exif = "EXIF" not in imaging.webp_chunks(n.data)
    ok = (n.width, n.height) == (h, w) and dist <= 3 and no_exif
    return [("EXIF orientation 6 applied once, marker within 3 px, EXIF stripped",
             "passed" if ok else "failed",
             f"{n.width}x{n.height}, marker offset {dist:.2f} px, exif stripped={no_exif}")]


def alpha_checks() -> list[Check]:
    clear = Image.new("RGBA", (900, 600), (255, 0, 0, 0))
    n = imaging.normalize(to_bytes(clear, "PNG"))
    mean = imaging.decode_rgb(n.data).reshape(-1, 3).mean(axis=0)
    diff = float(np.abs(mean - np.array(imaging.BACKGROUND)).max())
    return [("transparent pixels flattened on the neutral canvas color",
             "passed" if diff <= 3 else "failed", f"max channel difference {diff:.2f}")]


# ---------------------------------------------------------------- mask math

def brute_dilate(mask: np.ndarray, r: int) -> np.ndarray:
    """Independent loop implementation used only as a cross-check."""
    h, w = mask.shape
    out = np.zeros_like(mask)
    for y, x in zip(*np.nonzero(mask)):
        for dy in range(-r, r + 1):
            for dx in range(-r, r + 1):
                if dx * dx + dy * dy <= r * r and 0 <= y + dy < h and 0 <= x + dx < w:
                    out[y + dy, x + dx] = True
    return out


def mask_checks() -> list[Check]:
    out: list[Check] = []
    rng = np.random.default_rng(3)
    sparse = rng.random((40, 50)) > 0.985
    sparse[0, 0] = sparse[39, 49] = True
    agree = all(np.array_equal(imaging.dilate(sparse, r), brute_dilate(sparse, r))
                for r in (1, 3, 6))
    out.append(("disk dilation matches brute force, including borders",
                "passed" if agree else "failed", "radii 1, 3, 6"))
    tiny = np.zeros((3, 4), bool)
    tiny[1, 2] = True
    try:
        same = np.array_equal(imaging.dilate(tiny, 6), brute_dilate(tiny, 6))
        out.append(("dilation radius larger than the mask works", "passed" if same else "failed",
                    "3x4 mask, radius 6"))
    except Exception as exc:
        out.append(("dilation radius larger than the mask works", "failed", type(exc).__name__))
    single = np.zeros((21, 21), bool)
    single[10, 10] = True
    lattice = sum(1 for dx in range(-3, 4) for dy in range(-3, 4) if dx * dx + dy * dy <= 9)
    count = int(imaging.dilate(single, 3).sum())
    out.append(("radius-3 disk has 29 pixels", "passed" if count == lattice == 29 else "failed",
                f"{count}"))

    blob = np.zeros((80, 80), bool)
    blob[20:60, 20:60] = True
    alpha = imaging.feather(blob, 3.0)
    support = math.ceil(9)
    ok = (alpha[40, 40] == 255 and alpha[0, 0] == 0 and alpha[40, 20 - support - 1] == 0
          and 0 < alpha[40, 20] < 255 and np.array_equal(alpha, alpha.T))
    out.append(("feather: solid core, zero beyond 3 sigma, symmetric",
                "passed" if ok else "failed", f"edge alpha {alpha[40, 20]}"))

    try:
        imaging.union(np.zeros((3, 3), bool), np.zeros((3, 4), bool))
        out.append(("mismatched mask dimensions raise", "failed", "no error"))
    except ValueError:
        out.append(("mismatched mask dimensions raise", "passed", "ValueError"))

    base = rng.integers(0, 256, (60, 80, 3), dtype=np.uint8)
    excl = np.zeros((60, 80), bool)
    excl[10:30, 10:30] = True
    inside_only = base.copy()
    inside_only[excl] = 0
    s1, _ = imaging.drift_check(base, base, excl)
    s2, _ = imaging.drift_check(base, inside_only, excl)
    flat = np.full((60, 80, 3), 100, np.uint8)
    s3, _ = imaging.drift_check(flat, flat + 51, excl)
    s4, n4 = imaging.drift_check(base, base, np.ones((60, 80), bool))
    ok = s1 == 0 and s2 == 0 and abs(s3 - 0.2) < 1e-9 and s4 is None and n4 == 0
    out.append(("drift: identical 0, inside-only 0, +51 gray = 0.2, no outside = None",
                "passed" if ok else "failed", f"{s1}, {s2}, {s3}, {s4}"))

    params = [imaging.composite_params(w) for w in (300, 1000, 2000)]
    ok = params == [(6, 3), (15, 5.0), (24, 8)]
    out.append(("composite radius/sigma clamps", "passed" if ok else "failed", f"{params}"))
    return out


def composite_checks() -> list[Check]:
    out: list[Check] = []
    rng = np.random.default_rng(11)
    h, w = 1152, 1536
    base = rng.integers(0, 256, (h, w, 3), dtype=np.uint8)
    old = np.zeros((h, w), bool)
    old[400:700, 500:900] = True
    new = old.copy()
    edited = base.copy()
    edited[old] = (200, 30, 30)  # a paint change confined to the part
    bike_w = 1000
    r, sigma = imaging.composite_params(bike_w)
    res = imaging.composite(base, edited, old, new, bike_w, "paint", (w, h))
    support = imaging.dilate(old, r + math.ceil(3 * sigma) + 1)
    protected_same = bool(np.array_equal(res.image[~support], base[~support]))
    core = np.zeros((h, w), bool)
    core[420:680, 520:880] = True
    core_painted = bool(np.all(res.image[core] == (200, 30, 30)))
    ok = res.composed and res.reason == "composited" and protected_same and core_painted
    out.append(("composite keeps pixels outside feather support, paints the core",
                "passed" if ok else "failed", f"reason={res.reason}, drift={res.drift}"))

    cases: list[tuple[str, Callable[[], imaging.CompositeResult], str]] = [
        ("geometry intent", lambda: imaging.composite(base, edited, old, new, bike_w, "geometry", (w, h)), "geometry"),
        ("disabled", lambda: imaging.composite(base, edited, old, new, bike_w, "paint", (w, h), enabled=False), "disabled"),
        ("small output", lambda: imaging.composite(base, edited, old, new, bike_w, "paint", (1000, 750)), "small"),
        ("aspect over 2%", lambda: imaging.composite(base, edited, old, new, bike_w, "paint", (1536, 1100)), "aspect"),
        ("missing mask", lambda: imaging.composite(base, edited, old, None, bike_w, "paint", (w, h)), "missing_mask"),
        ("no outside area", lambda: imaging.composite(base, edited, np.ones((h, w), bool), new, bike_w, "paint", (w, h)), "no_outside_area"),
        ("drift over 0.05", lambda: imaging.composite(base, np.clip(base.astype(int) + 40, 0, 255).astype(np.uint8), old, new, bike_w, "paint", (w, h)), "drift"),
    ]
    for name, run, reason in cases:
        res = run()
        ok = not res.composed and res.reason == reason
        out.append((f"fallback: {name}", "passed" if ok else "failed", res.reason))
    return out


def click_checks() -> list[Check]:
    out: list[Check] = []
    img = (2000, 1500)
    # Vertical letterbox: wide container, bars left and right.
    p = imaging.screen_to_image(500.0, 250.0, (0, 0, 1000, 500), img)
    left_bar = imaging.screen_to_image(100.0, 250.0, (0, 0, 1000, 500), img)
    # Horizontal letterbox: tall container, bars top and bottom.
    q = imaging.screen_to_image(150.0, 300.0, (0, 0, 300, 600), img)
    top_bar = imaging.screen_to_image(150.0, 10.0, (0, 0, 300, 600), img)
    ok = p == (1000, 750) and left_bar is None and q == (1000, 750) and top_bar is None
    out.append(("contain-fit clicks map through both letterbox types",
                "passed" if ok else "failed", f"{p}, {left_bar}, {q}, {top_bar}"))
    worst = 0.0
    for container in ((37, 12, 1280, 720), (0, 0, 641, 1003)):
        left, top, cw, ch = container
        scale = min(cw / img[0], ch / img[1])
        ox, oy = left + (cw - img[0] * scale) / 2, top + (ch - img[1] * scale) / 2
        for tx, ty in ((0, 0), (1999, 1499), (1234, 567), (3, 1490)):
            sx, sy = ox + (tx + 0.5) * scale, oy + (ty + 0.5) * scale
            got = imaging.screen_to_image(sx, sy, container, img)
            worst = max(worst, math.dist(got, (tx, ty)) if got else math.inf)
    out.append(("round trip within 3 px at two canvas sizes",
                "passed" if worst <= 3 else "failed", f"worst {worst:.2f} px"))
    # Displayed photo spans x 166.67..833.33 in this container; aim just inside its corner.
    edge = imaging.screen_to_image(833.333, 499.999, (0, 0, 1000, 500), img)
    out.append(("bottom-right edge clamps to width-1/height-1",
                "passed" if edge == (1999, 1499) else "failed", f"{edge}"))
    return out


# ------------------------------------------------------- SAM documented record

# Example record from the @meta-sam/parser 0.1.0 README (documentation, not an
# account response). Box x1..x2 = 211..270 inclusive, y1..y2 = 228..254.
DOC_OUTPUT = ("<0f>0<|box;x1=211;y1=228;x2=270;y2=254;w=320;h=334|>"
              "<|mask;x=0;y=0;data=27,60,~!!!!M!0c[0o91w?q1!pIH4pPRVp2B3'7`e.ioeAf6-k/#Xd8%dX9x(|>\n")


async def _events(text: str, split: int):
    lane = {"item_id": "m1", "output_index": 0, "content_index": 0}
    yield {"type": "response.output_text.delta", **lane, "delta": text[:split]}
    yield {"type": "response.output_text.delta", **lane, "delta": text[split:]}
    yield {"type": "response.output_text.done", **lane, "text": text}
    yield {"type": "response.completed"}


async def _parse(text: str, split: int):
    return await parse_responses_stream(_events(text, split), image_segmentation_format()).final_result()


def sam_doc_checks() -> list[Check]:
    out: list[Check] = []
    splits = [1, DOC_OUTPUT.index("data=") + 9, len(DOC_OUTPUT) - 3]
    results = [asyncio.run(_parse(DOC_OUTPUT, s)) for s in splits]
    masks = [[r for r in res.records if r.kind == "mask"] for res in results]
    same = all(len(m) == 1 for m in masks) and len({m[0].mask.payload for m in masks}) == 1
    out.append(("parser reassembles a mask split at arbitrary delta boundaries",
                "passed" if same else "failed", f"{[len(m) for m in masks]} mask record(s)"))
    rec = masks[0][0]
    raster = decode_mask_to_raster(rec.mask)
    b = rec.bounds
    box_w, box_h = int(b.right - b.left), int(b.bottom - b.top)
    box_sized = (rec.mask.width, rec.mask.height) == (box_w, box_h) and len(raster) == box_w * box_h
    out.append(("documented raster is box-sized; half-open bounds are x2+1/y2+1",
                "passed" if box_sized and (b.right, b.bottom) == (271, 255) else "failed",
                f"raster {rec.mask.width}x{rec.mask.height}, box {box_w}x{box_h}"))
    try:
        imaging.place_mask(raster, rec.mask.width, rec.mask.height,
                           (int(b.left), int(b.top), int(b.right), int(b.bottom)), 320, 334, None)
        out.append(("unverified placement raises MASK_PLACEMENT_UNKNOWN", "failed", "placed"))
    except imaging.MaskPlacementUnknown:
        out.append(("unverified placement raises MASK_PLACEMENT_UNKNOWN", "passed", "raised"))
    full = imaging.place_mask(raster, rec.mask.width, rec.mask.height,
                              (int(b.left), int(b.top), int(b.right), int(b.bottom)), 320, 334,
                              "box_relative")
    ys, xs = np.nonzero(full)
    inside = len(xs) > 0 and xs.min() >= b.left and xs.max() < b.right \
        and ys.min() >= b.top and ys.max() < b.bottom and int(full.sum()) == int(sum(raster))
    out.append(("box-relative hypothesis keeps every pixel inside the box",
                "passed" if inside else "failed", f"{int(full.sum())} px"))
    return out


# ---------------------------------------------------------------- fixtures

def fixture_checks(names: list[str]) -> list[Check]:
    out: list[Check] = []
    norm_dir = common.OUT / "normalized"
    for name in names:
        path = common.FIXTURES / name
        if not path.exists():
            out.append((f"fixture {name}", "skipped", "file missing (U09)"))
            continue
        data = path.read_bytes()
        if name.endswith(".heic"):
            ok, d = expect_error(data, "UNSUPPORTED_FORMAT", imaging.HEIC_MESSAGE)
            out.append((f"fixture {name} rejected locally", "passed" if ok else "failed", d))
            continue
        try:
            n = imaging.normalize(data)
        except imaging.ImageError as err:
            out.append((f"fixture {name} normalizes", "failed", err.code))
            continue
        norm_dir.mkdir(parents=True, exist_ok=True)
        (norm_dir / (path.stem + ".webp")).write_bytes(n.data)
        meta = [c for c in imaging.webp_chunks(n.data) if c in ("EXIF", "ICCP", "XMP ")]
        ok = max(n.width, n.height) <= 2048 and len(n.data) <= imaging.MAX_BYTES and not meta
        detail = f"{n.width}x{n.height}, {len(n.data)} bytes, warnings={len(n.warnings)}"
        if name == "exif-rotated.jpg":
            raw = Image.open(io.BytesIO(data))
            orient = raw.getexif().get(0x0112)
            swapped = (n.width >= n.height) != (raw.width >= raw.height) or raw.width == raw.height
            ok = ok and orient == 6 and swapped
            detail += f", source orientation={orient}, axes swapped={swapped}"
        out.append((f"fixture {name} normalizes", "passed" if ok else "failed", detail))
    return out


def main() -> int:
    args = common.base_parser(__doc__.splitlines()[0]).parse_args()
    checks = (format_checks() + bound_checks() + exif_checks() + alpha_checks() + mask_checks()
              + composite_checks() + click_checks() + sam_doc_checks()
              + fixture_checks(common.FIXTURE_SETS[args.fixture_set]))
    width = max(len(c[0]) for c in checks)
    for name, status, detail in checks:
        print(f"{status.upper():8s} {name:<{width}}  {detail}")
    counts = {s: sum(1 for c in checks if c[1] == s) for s in ("passed", "failed", "skipped")}
    print(f"\n{counts['passed']} passed, {counts['failed']} failed, {counts['skipped']} skipped")
    status = "failed" if counts["failed"] else "passed"
    common.write_result("local_images", args.fixture_set, status, "offline",
                        {"counts": counts, "checks": [list(c) for c in checks]})
    return common.EXIT_ASSERTION if counts["failed"] else common.EXIT_PASSED


if __name__ == "__main__":
    common.run_main(main)
