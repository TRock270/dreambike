// POST /api/composite: protect everything outside the edited part with a
// local feathered blend (SPEC.md 5, 7). No Meta call and no reservation.
import { createHash } from "node:crypto";
import { CompositePayload, CompositeResponse, ImageFile, MaskFile } from "@/lib/contracts";
import { AppError } from "@/lib/errors";
import { loadConfig } from "@/lib/server/config";
import {
  assertSameOrigin, errorResponse, jsonResponse, parseMultipart, payloadAndFiles, readBodyLimited, requestIdOf,
} from "@/lib/server/http";
import { compositeRgb, compositeSkipReason, decodeRgb, encodeRgbBounded, pngToMask, toDataUrl, webpSize } from "@/lib/server/images";

export const runtime = "nodejs";
export const maxDuration = 20;

const BODY_LIMIT = 2 * 1_250_000 + 2 * 500_000 + 50_000;

export async function POST(req: Request): Promise<Response> {
  const requestId = requestIdOf(req);
  try {
    const config = loadConfig();
    assertSameOrigin(req, config, process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL_ENV));
    const { payload: rawPayload, files } = payloadAndFiles(await parseMultipart(req, await readBodyLimited(req, BODY_LIMIT)),
      ["base", "edited"], ["oldMask", "newMask"]);
    const parsed = CompositePayload.safeParse(rawPayload);
    const base = ImageFile.safeParse(files.base);
    const edited = ImageFile.safeParse(files.edited);
    const oldFile = files.oldMask ? MaskFile.safeParse(files.oldMask) : null;
    const newFile = files.newMask ? MaskFile.safeParse(files.newMask) : null;
    if (!parsed.success || !base.success || !edited.success || oldFile?.success === false || newFile?.success === false) {
      throw new AppError("INVALID_REQUEST");
    }
    const p = parsed.data;
    const editedBytes = new Uint8Array(await edited.data.arrayBuffer());
    const baseBytes = new Uint8Array(await base.data.arrayBuffer());
    // Check the real format first (still WebP, not animated) before decoding pixels.
    await webpSize(baseBytes);
    await webpSize(editedBytes);
    const baseRgb = await decodeRgb(baseBytes);
    const editedRgb = await decodeRgb(editedBytes);
    if (baseRgb.width !== p.width || baseRgb.height !== p.height) {
      throw new AppError("INVALID_REQUEST", "Declared size does not match the base image.");
    }
    const mask = async (f: typeof oldFile) => (f?.success ? pngToMask(new Uint8Array(await f.data.arrayBuffer()), p.width, p.height) : null);
    const [oldMask, newMask] = [await mask(oldFile), await mask(newFile)];
    const generated = { width: p.generatedWidth, height: p.generatedHeight };
    const sameSize = editedRgb.width === p.width && editedRgb.height === p.height;
    let outcome;
    if (sameSize) {
      outcome = compositeRgb(baseRgb, editedRgb, oldMask, newMask, p.bikeBox[2] - p.bikeBox[0], p.intent, generated, config.features.composite);
    } else {
      // An edited image at its own size is only valid when composition is skipped anyway.
      const skip = compositeSkipReason(config.features.composite, p.intent, generated, baseRgb);
      if (!skip) throw new AppError("INVALID_REQUEST", "Resize the edited image to the base size before compositing.");
      outcome = { image: editedRgb, composed: false, aligned: false, drift: null, reason: skip };
    }
    // A full-image fallback returns the submitted edited image unchanged (no second lossy encode).
    const image = outcome.composed ? await encodeRgbBounded(outcome.image) : null;
    const wire = image
      ? { mime: "image/webp" as const, dataUrl: toDataUrl("image/webp", image.bytes), width: image.width, height: image.height, hash: image.hash }
      : { mime: "image/webp" as const, dataUrl: toDataUrl("image/webp", editedBytes), width: editedRgb.width, height: editedRgb.height,
          hash: createHash("sha256").update(editedBytes).digest("hex") };
    const reason = outcome.reason;
    return jsonResponse(CompositeResponse.parse({ image: wire, composed: outcome.composed, aligned: outcome.aligned,
      drift: outcome.drift === null ? null : Math.min(1, outcome.drift), reason }));
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
