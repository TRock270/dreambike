// Calls POST /api/normalize and turns the WireImage data URL into a Blob right
// away, so large base64 strings do not linger in app state (SPEC.md 5).
import { ErrorResponse, NormalizeResponse } from "../contracts";
import type { NormalizedPhoto } from "../types";
import { PreflightError } from "./preflight";

export async function uploadForNormalize(photo: Blob): Promise<NormalizedPhoto> {
  const form = new FormData();
  form.append("photo", photo, photo.type === "image/jpeg" ? "photo.jpg" : "photo.webp");
  let res: Response;
  try {
    res = await fetch("/api/normalize", {
      method: "POST", body: form, headers: { "X-Request-Id": crypto.randomUUID() },
    });
  } catch {
    throw new PreflightError("UPSTREAM_UNAVAILABLE", "The app server could not be reached. Try again.");
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = ErrorResponse.safeParse(body);
    if (err.success) throw new PreflightError(err.data.error.code, err.data.error.message);
    // A non-JSON 5xx (for example a gateway timeout) is worth retrying with the same file.
    throw new PreflightError(res.status >= 500 ? "UPSTREAM_UNAVAILABLE" : "INVALID_REQUEST",
      "The photo could not be prepared.");
  }
  const parsed = NormalizeResponse.safeParse(body);
  if (!parsed.success) throw new PreflightError("SCHEMA_INVALID", "The server answer had an unexpected shape.");
  const { image, warnings } = parsed.data;
  const blob = await (await fetch(image.dataUrl)).blob();
  return { blob, width: image.width, height: image.height, hash: image.hash, warnings };
}
