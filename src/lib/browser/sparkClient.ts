// Client calls for POST /api/identify and POST /api/instruction.
import { ErrorResponse, IdentifyResponse, InstructionResponse } from "../contracts";
import type { BikeData, InstructionData, PhotoRef, SlotId } from "../types";
import { PreflightError } from "./preflight";

async function post(url: string, form: FormData, signal?: AbortSignal): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", body: form, signal, headers: { "X-Request-Id": crypto.randomUUID() } });
  } catch {
    throw new PreflightError("UPSTREAM_UNAVAILABLE", "The app server could not be reached.");
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = ErrorResponse.safeParse(body);
    if (err.success) throw new PreflightError(err.data.error.code, err.data.error.message);
    throw new PreflightError(res.status >= 500 ? "UPSTREAM_UNAVAILABLE" : "INVALID_REQUEST", "The request failed.");
  }
  return body;
}

export async function requestIdentify(photo: PhotoRef, signal?: AbortSignal): Promise<BikeData> {
  const form = new FormData();
  form.append("payload", JSON.stringify({ width: photo.width, height: photo.height }));
  form.append("image", photo.blob, "base.webp");
  const parsed = IdentifyResponse.safeParse(await post("/api/identify", form, signal));
  if (!parsed.success) throw new PreflightError("SCHEMA_INVALID", "The identification answer had an unexpected shape.");
  return parsed.data.bike;
}

export type InstructionRequest = {
  slot: SlotId; box: [number, number, number, number]; bike: BikeData; mode: "text" | "paint" | "reference";
  /** In reference mode this is the mechanic's description of what the reference photo shows. */
  text: string; width: number; height: number;
  /** True when the part is not on the bike yet; only valid in text mode. */
  absent?: boolean;
};

/**
 * `reference` is the normalized reference photo. It is sent only in reference mode (SPEC 5: exactly one
 * reference there, none elsewhere), so a leftover blob can never ride along with a text or paint request.
 */
export async function requestInstruction(input: InstructionRequest, signal?: AbortSignal, reference?: Blob | null): Promise<InstructionData> {
  const form = new FormData();
  form.append("payload", JSON.stringify(input));
  if (input.mode === "reference") {
    if (!reference) throw new PreflightError("INVALID_REQUEST", "Add a reference photo first.");
    form.append("reference", reference, "reference.webp");
  }
  const parsed = InstructionResponse.safeParse(await post("/api/instruction", form, signal));
  if (!parsed.success) throw new PreflightError("SCHEMA_INVALID", "The instruction answer had an unexpected shape.");
  return parsed.data.instruction;
}
