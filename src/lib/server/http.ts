// Route helpers shared by every handler (SPEC.md 5): request IDs, origin
// check, byte-bounded body reading, and safe JSON error responses.
import "server-only";
import { ENVELOPE_LIMIT_BYTES, Id } from "../contracts";
import { AppError, ERRORS } from "../errors";
import type { ServerConfig } from "./config";

const NO_STORE = { "Cache-Control": "no-store" };

export function requestIdOf(req: Request): string {
  const header = req.headers.get("x-request-id");
  return header && Id.safeParse(header).success ? header : crypto.randomUUID();
}

export function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

/** Safe error JSON: stable code and message, never a stack or upstream text. */
export function errorResponse(error: unknown, requestId: string): Response {
  if (!(error instanceof AppError)) {
    // Log only the error class and request ID: never messages, bodies, or env values.
    console.error(`[${requestId}] unexpected ${error instanceof Error ? error.name : typeof error}`);
  }
  const app = error instanceof AppError ? error : new AppError("INVALID_REQUEST");
  const info = ERRORS[app.code];
  return jsonResponse({
    error: { code: app.code, message: app.message.slice(0, 200), retryable: info.retryable,
      requestId, retryAfterSeconds: app.retryAfterSeconds },
  }, info.status);
}

const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1):\d{1,5}$/;

/**
 * POSTs must come from the app's own origin (APP_ORIGIN). Outside a deployment
 * any localhost/127.0.0.1 port is accepted too, so `next dev -p <port>` works.
 * Never derive the allowed origin from the Host header: a DNS-rebinding page
 * controls both Host and Origin. (The signed session cookie arrives in T13.)
 */
export function assertSameOrigin(req: Request, config: ServerConfig, deployed: boolean): void {
  const origin = req.headers.get("origin");
  if (!origin) throw new AppError("FORBIDDEN");
  if (origin === config.appOrigin) return;
  if (!deployed && LOCAL_ORIGIN.test(origin)) return;
  throw new AppError("FORBIDDEN");
}

/** Read the body while counting bytes; stop as soon as the limit is passed. */
export async function readBodyLimited(req: Request, limit = ENVELOPE_LIMIT_BYTES): Promise<Uint8Array<ArrayBuffer>> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > limit) throw new AppError("TOO_LARGE");
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new AppError("TOO_LARGE");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) { out.set(c, offset); offset += c.byteLength; }
  return out;
}

/** Parse multipart bytes we already bounded, keeping the original headers. */
export async function parseMultipart(req: Request, body: Uint8Array<ArrayBuffer>): Promise<FormData> {
  try {
    return await new Request(req.url, { method: "POST", headers: req.headers, body }).formData();
  } catch {
    throw new AppError("INVALID_REQUEST");
  }
}

/**
 * Multipart with one JSON "payload" part and named file parts (SPEC 5). Every
 * part must be expected and present exactly once; unexpected parts fail.
 */
export function payloadAndFiles(form: FormData, required: readonly string[], optional: readonly string[] = []):
  { payload: unknown; files: Record<string, File> } {
  const allowed = new Set(["payload", ...required, ...optional]);
  for (const key of form.keys()) if (!allowed.has(key)) throw new AppError("INVALID_REQUEST");
  for (const key of allowed) if (form.getAll(key).length > 1) throw new AppError("INVALID_REQUEST");
  const raw = form.get("payload");
  let payload: unknown;
  try {
    payload = typeof raw === "string" ? JSON.parse(raw) : undefined;
  } catch {
    throw new AppError("INVALID_REQUEST");
  }
  if (payload === undefined) throw new AppError("INVALID_REQUEST");
  const files: Record<string, File> = {};
  for (const name of [...required, ...optional]) {
    const value = form.get(name);
    if (value === null) {
      if (required.includes(name)) throw new AppError("INVALID_REQUEST");
      continue;
    }
    if (!(value instanceof File)) throw new AppError("INVALID_REQUEST");
    files[name] = value;
  }
  return { payload, files };
}

/** X-Request-Id is required on Meta handlers and must be a UUID. */
export function requireRequestId(req: Request): string {
  const header = req.headers.get("x-request-id");
  if (!header || !Id.safeParse(header).success) throw new AppError("INVALID_REQUEST", "X-Request-Id must be a UUID.");
  return header;
}
