"""Image normalization and mask math for the spike (SPEC.md section 7).

The TypeScript app (src/lib/server/images.ts) must reproduce these formulas:
- dilate: disk structuring element, |dx| <= isqrt(r^2 - dy^2)
- feather: separable Gaussian, kernel radius ceil(3 * sigma), edge pixels
  replicated, alpha = round_half_up(255 * value)
- composite radius = round_half_up(clamp(0.015 * bikeWidth, 6, 24))
- composite sigma = clamp(0.005 * bikeWidth, 3, 8)
- grayscale 0.299 R + 0.587 G + 0.114 B; drift = mean |dGray| / 255 outside
  the dilated union; threshold 0.05
- blend = round_half_up(base + (edited - base) * alpha / 255), so alpha 0 keeps
  the base pixel exactly
round_half_up is floor(x + 0.5), which matches JavaScript Math.round for x >= 0.
"""

from __future__ import annotations

import io
import math
from dataclasses import dataclass, field

import numpy as np
from PIL import Image, ImageCms, ImageOps

MAX_EDGE = 2048
MAX_BYTES = 1_250_000
QUALITY = 82
MIN_QUALITY = 60
MAX_INPUT_PIXELS = 40_000_000
MAX_SOURCE_BYTES = 25 * 1024 * 1024
WARN_EDGE = 800
MIN_EDGE = 256
# Nordlicht canvas token (PLAN.md 8.4); app code reads it from tokens.css.
BACKGROUND = (0xD3, 0xE3, 0xF5)
HEIC_MESSAGE = ("HEIC is not supported in this demo. On your Mac, open the photo in Preview "
                "and export it as JPEG, then upload that file.")
HEIF_BRANDS = {b"heic", b"heix", b"hevc", b"hevx", b"heim", b"heis", b"hevm", b"hevs",
               b"mif1", b"msf1"}
DRIFT_THRESHOLD = 0.05
ASPECT_LIMIT = 0.02
SMALL_EDGE = 1024


class ImageError(Exception):
    """code is one of the SPEC error codes: UNSUPPORTED_FORMAT, INVALID_IMAGE, TOO_LARGE."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


class MaskPlacementUnknown(Exception):
    pass


def round_half_up(x: float) -> int:
    return math.floor(x + 0.5)


def clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


# ----------------------------------------------------------- normalization

def sniff_format(data: bytes) -> str:
    """Classify by file signature, never by the declared MIME type."""
    if len(data) >= 12 and data[4:8] == b"ftyp" and data[8:12] in HEIF_BRANDS:
        return "heic"
    if data[:3] == b"\xff\xd8\xff":
        return "jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return "unknown"


@dataclass
class Normalized:
    data: bytes
    width: int
    height: int
    quality: int
    warnings: list[str] = field(default_factory=list)


def normalize(data: bytes, max_edge: int = MAX_EDGE, max_bytes: int = MAX_BYTES) -> Normalized:
    kind = sniff_format(data)
    if kind == "heic":
        raise ImageError("UNSUPPORTED_FORMAT", HEIC_MESSAGE)
    if kind == "unknown":
        raise ImageError("UNSUPPORTED_FORMAT", "Only JPEG, PNG, and WebP photos are supported.")
    if len(data) > MAX_SOURCE_BYTES:
        raise ImageError("TOO_LARGE", "The photo file is larger than 25 MB.")
    try:
        img = Image.open(io.BytesIO(data))
    except Image.DecompressionBombError:
        raise ImageError("TOO_LARGE", "The photo has more than 40 megapixels.") from None
    except Exception:
        raise ImageError("INVALID_IMAGE", "The photo could not be read.") from None
    # Header dimensions are checked before any pixel allocation.
    if img.width * img.height > MAX_INPUT_PIXELS:
        raise ImageError("TOO_LARGE", "The photo has more than 40 megapixels.")
    if getattr(img, "is_animated", False) or getattr(img, "n_frames", 1) > 1:
        raise ImageError("UNSUPPORTED_FORMAT", "Animated images are not supported.")
    try:
        img.load()
    except Exception:
        raise ImageError("INVALID_IMAGE", "The photo is corrupt or truncated.") from None

    img = ImageOps.exif_transpose(img)
    warnings: list[str] = []
    long_edge = max(img.size)
    if long_edge < MIN_EDGE:
        raise ImageError("INVALID_IMAGE", "The photo is too small (long edge under 256 px).")
    if long_edge < WARN_EDGE:
        warnings.append("Low resolution: the long edge is under 800 px. Results may be poor.")

    # Palette transparency must become real alpha before anything else.
    if img.mode == "P" and "transparency" in img.info:
        img = img.convert("RGBA")
    icc = img.info.get("icc_profile")
    if icc:
        try:
            src = ImageCms.ImageCmsProfile(io.BytesIO(icc))
            dst = ImageCms.createProfile("sRGB")
            if img.mode in ("RGB", "RGBA"):
                img = ImageCms.profileToProfile(img, src, dst, outputMode=img.mode)
            else:
                # CMYK/L profiles describe the source mode; convert from it directly.
                img = ImageCms.profileToProfile(img, src, dst, outputMode="RGB")
        except Exception:
            warnings.append("Embedded color profile could not be applied; treated as sRGB.")

    if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
        rgba = img.convert("RGBA")
        flat = Image.new("RGB", rgba.size, BACKGROUND)
        flat.paste(rgba, mask=rgba.getchannel("A"))
        img = flat
    else:
        img = img.convert("RGB")

    if max(img.size) > max_edge:
        scale = max_edge / max(img.size)
        img = img.resize((max(1, round_half_up(img.width * scale)),
                          max(1, round_half_up(img.height * scale))), Image.LANCZOS)

    # A fresh RGB image carries no EXIF/XMP/ICC; nothing is passed to save().
    img = Image.frombytes("RGB", img.size, img.tobytes())
    quality = QUALITY
    while True:
        out = encode_webp(img, quality)
        if len(out) <= max_bytes:
            return Normalized(out, img.width, img.height, quality, warnings)
        if quality > MIN_QUALITY:
            quality = max(MIN_QUALITY, quality - 6)
            continue
        # Integer math so Python and JavaScript pick identical sizes.
        img = img.resize((max(1, img.width * 9 // 10), max(1, img.height * 9 // 10)),
                         Image.LANCZOS)


def encode_webp(img: Image.Image, quality: int) -> bytes:
    buf = io.BytesIO()
    img.save(buf, "WEBP", quality=quality, method=4)
    return buf.getvalue()


def webp_chunks(data: bytes) -> list[str]:
    """RIFF chunk names, used to prove there is no EXIF/XMP/ICCP metadata."""
    names, pos = [], 12
    while pos + 8 <= len(data):
        name = data[pos:pos + 4].decode("ascii", "replace")
        size = int.from_bytes(data[pos + 4:pos + 8], "little")
        names.append(name)
        pos += 8 + size + (size & 1)
    return names


def decode_rgb(data: bytes) -> np.ndarray:
    return np.asarray(Image.open(io.BytesIO(data)).convert("RGB"), dtype=np.uint8)


# ------------------------------------------------------------- cover refill

REFILL_MAX_ITERATIONS = 4000
REFILL_TOLERANCE = 0.01


def _check_refill_box(box, width: int, height: int) -> tuple[int, int, int, int]:
    if len(box) != 4:
        raise ValueError(f"box must have 4 values, got {len(box)}")
    left, top, right, bottom = (int(v) for v in box)
    if right <= left or bottom <= top:
        raise ValueError(f"empty or reversed box {list(box)}")
    if left < 0 or top < 0 or right > width or bottom > height:
        raise ValueError(f"box {list(box)} outside the {width}x{height} image")
    if left == 0 and top == 0 and right == width and bottom == height:
        raise ValueError("box covers the whole image; there is no outside ring")
    return left, top, right, bottom


def _refill_one(src: np.ndarray, out: np.ndarray, box: tuple[int, int, int, int]) -> None:
    """Harmonic fill of one box from the one-pixel ring just outside it.

    Only src pixels outside the box are read. Sides clipped by the image edge have
    no ring; there the fill repeats its own edge value (zero gradient). Jacobi
    iteration on the 4-neighbour Laplace equation, fixed start, so it is
    deterministic.
    """
    left, top, right, bottom = box
    h, w = bottom - top, right - left
    ring: dict[str, np.ndarray | None] = {
        "left": src[top:bottom, left - 1].astype(np.float64) if left > 0 else None,
        "right": src[top:bottom, right].astype(np.float64) if right < src.shape[1] else None,
        "top": src[top - 1, left:right].astype(np.float64) if top > 0 else None,
        "bottom": src[bottom, left:right].astype(np.float64) if bottom < src.shape[0] else None,
    }
    present = [v for v in ring.values() if v is not None]
    start = np.mean(np.concatenate(present, axis=0), axis=0)  # mean ring colour
    cur = np.broadcast_to(start, (h, w, 3)).copy()
    for _ in range(REFILL_MAX_ITERATIONS):
        pad = np.pad(cur, ((1, 1), (1, 1), (0, 0)), mode="edge")  # edge repeat = zero gradient
        if ring["left"] is not None:
            pad[1:-1, 0] = ring["left"]
        if ring["right"] is not None:
            pad[1:-1, -1] = ring["right"]
        if ring["top"] is not None:
            pad[0, 1:-1] = ring["top"]
        if ring["bottom"] is not None:
            pad[-1, 1:-1] = ring["bottom"]
        new = (pad[:-2, 1:-1] + pad[2:, 1:-1] + pad[1:-1, :-2] + pad[1:-1, 2:]) / 4.0
        delta = float(np.abs(new - cur).max())
        cur = new
        if delta < REFILL_TOLERANCE:
            break
    out[top:bottom, left:right] = np.clip(np.floor(cur + 0.5), 0, 255).astype(np.uint8)


def refill_boxes(rgb: np.ndarray, boxes) -> np.ndarray:
    """Return a copy of rgb (H x W x 3 uint8) with each [left, top, right, bottom) box
    refilled from its outside ring. Inside pixels are never read, so hidden content
    never comes back. Boxes whose rings would touch another box (overlap or
    adjacent) raise, because that ring would be old cover pixels."""
    if rgb.ndim != 3 or rgb.shape[2] != 3 or rgb.dtype != np.uint8:
        raise ValueError("rgb must be an H x W x 3 uint8 array")
    height, width = rgb.shape[:2]
    checked = [_check_refill_box(b, width, height) for b in boxes]
    for i, a in enumerate(checked):
        for b in checked[i + 1:]:
            if a[0] - 1 < b[2] and b[0] - 1 < a[2] and a[1] - 1 < b[3] and b[1] - 1 < a[3]:
                raise ValueError(f"boxes {list(a)} and {list(b)} overlap or touch")
    out = rgb.copy()
    for box in checked:
        _refill_one(rgb, out, box)
    return out


# ------------------------------------------------------------- masks

SAM_MASK_MAX_EDGE = 1024


def is_downscaled(mask_w: int, mask_h: int, box_w: int, box_h: int) -> bool:
    """True when SAM shrank a raster to a 1024 px long edge, keeping the box aspect (U01 hypothesis)."""
    if max(box_w, box_h) <= SAM_MASK_MAX_EDGE or min(box_w, box_h) <= 0:
        return False
    if box_w >= box_h:
        long_m, short_m, short_b, long_b = mask_w, mask_h, box_h, box_w
    else:
        long_m, short_m, short_b, long_b = mask_h, mask_w, box_w, box_h
    if long_m != SAM_MASK_MAX_EDGE:
        return False
    return abs(short_m - round_half_up(short_b * SAM_MASK_MAX_EDGE / long_b)) <= 1


def _upscale_nearest(arr: np.ndarray, box_w: int, box_h: int) -> np.ndarray:
    """Nearest neighbour to exactly the box, sampling at pixel centres."""
    mask_h, mask_w = arr.shape
    xs = np.minimum(mask_w - 1, ((np.arange(box_w) * 2 + 1) * mask_w) // (2 * box_w))
    ys = np.minimum(mask_h - 1, ((np.arange(box_h) * 2 + 1) * mask_h) // (2 * box_h))
    return arr[ys][:, xs]


def place_mask(raster: bytes, mask_w: int, mask_h: int, bounds: tuple[int, int, int, int],
               img_w: int, img_h: int, mode: str | None, *,
               allow_downscaled: bool = False) -> np.ndarray:
    """Convert one SAM raster to a full-image binary mask (U01).

    mode is the placement verified with owned off-origin fixtures. Until U01
    passes it is None and only a full-image raster is accepted. 'box_relative'
    copies the raster at the half-open box's top-left with clipping.
    With allow_downscaled, a raster SAM shrank to a 1024 px long edge is first
    upscaled to the box (hypothesis, unverified until the owner checks).
    """
    arr = np.frombuffer(raster, dtype=np.uint8).reshape(mask_h, mask_w)
    if mask_w == img_w and mask_h == img_h:
        return arr.astype(bool)
    left, top, right, bottom = bounds
    box_w, box_h = right - left, bottom - top
    if (mode == "box_relative" and allow_downscaled
            and is_downscaled(mask_w, mask_h, box_w, box_h)):
        arr = _upscale_nearest(arr, box_w, box_h)
        mask_w, mask_h = box_w, box_h
    if mode == "box_relative" and mask_w == box_w and mask_h == box_h:
        full = np.zeros((img_h, img_w), dtype=bool)
        x0, y0 = max(0, left), max(0, top)
        x1, y1 = min(img_w, right), min(img_h, bottom)
        if x1 > x0 and y1 > y0:
            full[y0:y1, x0:x1] = arr[y0 - top:y1 - top, x0 - left:x1 - left].astype(bool)
        return full
    raise MaskPlacementUnknown(
        f"raster {mask_w}x{mask_h}, box {right - left}x{bottom - top}, image {img_w}x{img_h}, "
        f"mode {mode}")


def _same_shape(*masks: np.ndarray) -> None:
    if len({m.shape for m in masks}) != 1:
        raise ValueError("mask dimensions differ; masks are never resized silently")


def union(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    _same_shape(a, b)
    return a | b


def clip(part: np.ndarray, bike: np.ndarray) -> np.ndarray:
    _same_shape(part, bike)
    return part & bike


def dilate(mask: np.ndarray, radius: int) -> np.ndarray:
    """Binary dilation with a disk: horizontal run per row offset via prefix sums."""
    m = mask.astype(bool)
    if radius <= 0:
        return m.copy()
    h, w = m.shape
    prefix = np.zeros((h, w + 1), dtype=np.int32)
    prefix[:, 1:] = np.cumsum(m, axis=1)
    xs = np.arange(w)
    out = np.zeros_like(m)
    # Row offsets beyond the image height contribute nothing (and would break slicing).
    for dy in range(max(-radius, 1 - h), min(radius, h - 1) + 1):
        half = math.isqrt(radius * radius - dy * dy)
        x0 = np.clip(xs - half, 0, w)
        x1 = np.clip(xs + half + 1, 0, w)
        row = (prefix[:, x1] - prefix[:, x0]) > 0
        # out(y) receives source row y + dy.
        if dy >= 0:
            out[:h - dy] |= row[dy:]
        else:
            out[-dy:] |= row[:h + dy]
    return out


def gaussian_kernel(sigma: float) -> np.ndarray:
    radius = math.ceil(3 * sigma)
    xs = np.arange(-radius, radius + 1, dtype=np.float64)
    k = np.exp(-(xs * xs) / (2 * sigma * sigma))
    return k / k.sum()


def _blur_axis(values: np.ndarray, kernel: np.ndarray, axis: int) -> np.ndarray:
    radius = len(kernel) // 2
    pad = [(0, 0), (0, 0)]
    pad[axis] = (radius, radius)
    padded = np.pad(values, pad, mode="edge")
    out = np.zeros_like(values, dtype=np.float64)
    n = values.shape[axis]
    for i, weight in enumerate(kernel):
        sl = [slice(None), slice(None)]
        sl[axis] = slice(i, i + n)
        out += weight * padded[tuple(sl)]
    return out


def feather(mask: np.ndarray, sigma: float = 1.5) -> np.ndarray:
    """Binary mask -> uint8 alpha 0..255."""
    kernel = gaussian_kernel(sigma)
    blurred = _blur_axis(_blur_axis(mask.astype(np.float64), kernel, 1), kernel, 0)
    return np.floor(blurred * 255 + 0.5).clip(0, 255).astype(np.uint8)


def to_gray(rgb: np.ndarray) -> np.ndarray:
    rgb = rgb.astype(np.float64)
    return 0.299 * rgb[..., 0] + 0.587 * rgb[..., 1] + 0.114 * rgb[..., 2]


def drift_check(base: np.ndarray, edited: np.ndarray, excluded: np.ndarray) -> tuple[float | None, int]:
    if base.shape != edited.shape or base.shape[:2] != excluded.shape:
        raise ValueError("drift operands must share dimensions")
    outside = ~excluded
    count = int(outside.sum())
    if count == 0:
        return None, 0
    diff = np.abs(to_gray(base) - to_gray(edited))[outside]
    return float(diff.mean() / 255), count


@dataclass
class CompositeResult:
    image: np.ndarray
    composed: bool
    aligned: bool
    drift: float | None
    reason: str


def composite_params(bike_width: int) -> tuple[int, float]:
    radius = round_half_up(clamp(0.015 * bike_width, 6, 24))
    sigma = clamp(0.005 * bike_width, 3, 8)
    return radius, sigma


def aspect_difference(gen_w: int, gen_h: int, base_w: int, base_h: int) -> float:
    return abs((gen_w / gen_h) / (base_w / base_h) - 1)


def composite(base: np.ndarray, edited: np.ndarray, old_mask: np.ndarray | None,
              new_mask: np.ndarray | None, bike_width: int, intent: str,
              generated_size: tuple[int, int], enabled: bool = True) -> CompositeResult:
    """Protect pixels outside the edited part. `edited` must already be resized
    to base dimensions; generated_size is the raw model output size."""
    gen_w, gen_h = generated_size
    base_h, base_w = base.shape[:2]

    def full(reason: str, drift: float | None = None, aligned: bool = False) -> CompositeResult:
        return CompositeResult(edited, False, aligned, drift, reason)

    if not enabled:
        return full("disabled")
    if intent == "geometry":
        return full("geometry")
    if min(gen_w, gen_h) < SMALL_EDGE:
        return full("small")
    if aspect_difference(gen_w, gen_h, base_w, base_h) > ASPECT_LIMIT:
        return full("aspect")
    if old_mask is None or new_mask is None:
        return full("missing_mask")
    if edited.shape != base.shape:
        raise ValueError("edited image must be resized to base dimensions first")
    radius, sigma = composite_params(bike_width)
    region = dilate(union(old_mask, new_mask), radius)
    score, _ = drift_check(base, edited, region)
    if score is None:
        return full("no_outside_area")
    if score > DRIFT_THRESHOLD:
        return full("drift", score)
    alpha = feather(region, sigma).astype(np.float64)[..., None]
    b = base.astype(np.float64)
    blended = np.floor(b + (edited.astype(np.float64) - b) * alpha / 255 + 0.5)
    return CompositeResult(blended.clip(0, 255).astype(np.uint8), True, True, score, "composited")


# ------------------------------------------------------- coordinates

def screen_to_image(px: float, py: float, container: tuple[float, float, float, float],
                    image_size: tuple[int, int]) -> tuple[int, int] | None:
    """Map a click in a contain-fit view to image pixels; None outside the photo.

    container is (left, top, width, height) of the element, not of the
    displayed image. Uses floor, as the SAM parser documentation does for
    pixel containment (recorded as a correction to SPEC's 'round').
    """
    left, top, cw, ch = container
    iw, ih = image_size
    if cw <= 0 or ch <= 0 or iw <= 0 or ih <= 0:
        return None
    scale = min(cw / iw, ch / ih)
    dw, dh = iw * scale, ih * scale
    ox, oy = left + (cw - dw) / 2, top + (ch - dh) / 2
    rx, ry = px - ox, py - oy
    if rx < 0 or ry < 0 or rx >= dw or ry >= dh:
        return None
    x = min(iw - 1, max(0, math.floor(rx * iw / dw)))
    y = min(ih - 1, max(0, math.floor(ry * ih / dh)))
    return x, y


def mask_png(mask: np.ndarray) -> bytes:
    """Full-image binary mask as 1-bit PNG (WireMask png_binary_full_image)."""
    buf = io.BytesIO()
    Image.fromarray(mask.astype(np.uint8) * 255).convert("1", dither=Image.Dither.NONE).save(
        buf, "PNG", optimize=True)
    return buf.getvalue()


def overlay(rgb: np.ndarray, masks: list[tuple[np.ndarray, tuple[int, int, int]]],
            boxes: list[tuple[tuple[int, int, int, int], tuple[int, int, int]]] = (),
            points: list[tuple[int, int, bool]] = ()) -> Image.Image:
    """Private review overlay: 35% fill, box outlines, click markers."""
    out = rgb.astype(np.float64).copy()
    for m, color in masks:
        out[m] = out[m] * 0.65 + np.array(color, dtype=np.float64) * 0.35
    img = Image.fromarray(out.astype(np.uint8))
    from PIL import ImageDraw
    draw = ImageDraw.Draw(img)
    for (l, t, r, b), color in boxes:
        draw.rectangle([l, t, r - 1, b - 1], outline=color, width=2)
    for x, y, positive in points:
        c = (0, 200, 0) if positive else (220, 0, 0)
        draw.ellipse([x - 6, y - 6, x + 6, y + 6], outline=c, width=3)
        draw.line([x - 10, y, x + 10, y], fill=c, width=1)
        draw.line([x, y - 10, x, y + 10], fill=c, width=1)
    return img
