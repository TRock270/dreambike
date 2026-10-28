// POST /api/normalize: authoritative photo normalization (SPEC.md 5). No Meta call.
import { NormalizeRequest } from "@/lib/contracts";
import { AppError, HEIC_MESSAGE } from "@/lib/errors";
import { MAX_BYTES, sniffFormat } from "@/lib/imageFormat";
import { loadConfig } from "@/lib/server/config";
import {
  assertSameOrigin, errorResponse, jsonResponse, parseMultipart, readBodyLimited, requestIdOf,
} from "@/lib/server/http";
import { normalize, toDataUrl } from "@/lib/server/images";

export const runtime = "nodejs";
export const maxDuration = 15;

const DEADLINE_MS = 10_000;
/** One photo of at most 1,250,000 bytes plus multipart overhead. */
const BODY_LIMIT = MAX_BYTES + 50_000;

export async function POST(req: Request): Promise<Response> {
  const requestId = requestIdOf(req);
  try {
    const config = loadConfig();
    assertSameOrigin(req, config, process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL_ENV));
    const form = await parseMultipart(req, await readBodyLimited(req, BODY_LIMIT));
    // Duplicate "photo" parts would collapse in fromEntries; reject them explicitly.
    if (form.getAll("photo").length !== 1) throw new AppError("INVALID_REQUEST");
    const parsed = NormalizeRequest.safeParse(Object.fromEntries(form.entries()));
    if (!parsed.success) throw await formatError(form.get("photo"), parsed.error.issues);
    const bytes = new Uint8Array(await parsed.data.photo.arrayBuffer());
    const result = await withDeadline(normalize(bytes), DEADLINE_MS);
    return jsonResponse({
      image: { mime: "image/webp", dataUrl: toDataUrl("image/webp", result.bytes),
        width: result.width, height: result.height, hash: result.hash },
      warnings: result.warnings,
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

/**
 * A HEIC or other unsupported file fails the declared-MIME check before the
 * signature check; still answer 415 (with the exact HEIC message), not 400.
 */
async function formatError(photo: FormDataEntryValue | null,
  issues: { code: string; path: PropertyKey[] }[]): Promise<AppError> {
  // Extra fields or a non-file photo are request errors, not format errors.
  if (!(photo instanceof File) || issues.some((i) => i.path[0] !== "photo")) return new AppError("INVALID_REQUEST");
  if (issues.some((i) => i.code === "too_big")) return new AppError("TOO_LARGE");
  const head = new Uint8Array(await photo.slice(0, 4096).arrayBuffer());
  if (sniffFormat(head) === "heic" || /^image\/hei[cf]/.test(photo.type) || /\.hei[cf]$/i.test(photo.name)) {
    return new AppError("UNSUPPORTED_FORMAT", HEIC_MESSAGE);
  }
  return new AppError("UNSUPPORTED_FORMAT", "Only JPEG, PNG, and WebP photos are supported.");
}

function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new AppError("INVALID_IMAGE", "Normalizing the photo took too long.")), ms);
    work.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
  });
}
