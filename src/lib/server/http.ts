// Route helpers shared by every handler (SPEC.md 5): request IDs, origin
// check, byte-bounded body reading, and safe JSON error responses.
import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { ENVELOPE_LIMIT_BYTES, Id } from "../contracts";
import { AppError, ERRORS, SESSION_RELOAD_MESSAGE } from "../errors";
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
 * POSTs must come from the app's own origin (APP_ORIGIN) and carry a valid signed
 * session cookie (SPEC 5, 13). Outside a deployment any localhost/127.0.0.1 port is
 * accepted too, so `next dev -p <port>` works. Never derive the allowed origin from
 * the Host header: a DNS-rebinding page controls both Host and Origin.
 * A missing, forged or expired cookie gives 403 "Reload the page to continue."; the
 * client does not retry automatically. Deployed without VISITOR_HASH_SECRET no
 * cookie can be valid, so every POST is refused.
 */
export function assertSameOrigin(req: Request, config: ServerConfig, deployed: boolean): void {
  const origin = req.headers.get("origin");
  if (!origin) throw new AppError("FORBIDDEN");
  if (origin !== config.appOrigin && (deployed || !LOCAL_ORIGIN.test(origin))) throw new AppError("FORBIDDEN");
  // Without a secret no cookie can ever be valid, so a reload cannot help: plain refusal.
  if (!visitorSecret()) throw new AppError("FORBIDDEN");
  if (!readSession(req)) throw new AppError("FORBIDDEN", SESSION_RELOAD_MESSAGE);
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

// ---------------------------------------------------------------- session
// A signed random session cookie identifies a visitor without accounts (SPEC 13).
// Value: v1.<id>.<issuedAtSeconds>.<signature>. The signature is an HMAC with the
// label "session", so a signature cannot be reused for the "visitor", "ip" or
// "fp" HMACs that paid.ts derives from the same secret.

export const SESSION_COOKIE = "db_session";
export const SESSION_MAX_AGE_S = 48 * 3600;
const SESSION_FORMAT = /^v1\.([A-Za-z0-9_-]{22})\.(\d{1,12})\.([A-Za-z0-9_-]{43})$/;
/** A clock a little ahead of ours is tolerated; further ahead is forged or broken. */
const SESSION_FUTURE_SKEW_S = 60;
/** A valid cookie older than this is re-signed with the same id (see ensureSession). */
const SESSION_RENEW_AFTER_S = 24 * 3600;

type SessionEnv = Partial<Record<string, string | undefined>>;

// The per-process development key must be the same for src/proxy.ts and every
// route bundle in one Node process. Next compiles each entry separately, so a
// module-level variable would exist once per bundle. globalThis is shared by
// all of them, hence this named property.
const DEV_KEY_NAME = "__dreambikeDevSessionKey";

function isDeployed(env: SessionEnv): boolean {
  return env.NODE_ENV === "production" || Boolean(env.VERCEL_ENV);
}

/**
 * Secret for session cookies and visitor/IP hashes. The configured
 * VISITOR_HASH_SECRET (at least 32 bytes) when present. Without it a random
 * per-process key outside deployments (cookies then die with the process, which
 * is fine for development and mock mode). Deployed without a secret: null, so
 * POSTs are refused and health reports it.
 */
export function visitorSecret(env: SessionEnv = process.env): Buffer | null {
  const configured = env.VISITOR_HASH_SECRET ?? "";
  if (Buffer.byteLength(configured) >= 32) return Buffer.from(configured, "utf8");
  if (isDeployed(env)) return null;
  const holder = globalThis as unknown as Record<string, Buffer | undefined>;
  holder[DEV_KEY_NAME] ??= randomBytes(32);
  return holder[DEV_KEY_NAME]!;
}

/** HMAC-SHA256 with a purpose label, as base64url. Labels keep the derived values apart. */
export function labeledHmac(secret: Buffer, label: string, data: string): string {
  return createHmac("sha256", secret).update(`${label}\n${data}`).digest("base64url");
}

export type Session = { id: string; issuedAtMs: number };

function sign(secret: Buffer, id: string, issuedAtS: number): string {
  return labeledHmac(secret, "session", `${id}.${issuedAtS}`);
}

/** A fresh session and its cookie value; null when no secret is available. */
export function issueSession(env: SessionEnv = process.env, nowMs: number = Date.now()):
  { session: Session; value: string } | null {
  const secret = visitorSecret(env);
  if (!secret) return null;
  const id = randomBytes(16).toString("base64url");
  const issuedAtS = Math.floor(nowMs / 1000);
  return {
    session: { id, issuedAtMs: issuedAtS * 1000 },
    value: `v1.${id}.${issuedAtS}.${sign(secret, id, issuedAtS)}`,
  };
}

/** Strict parse and verify; any deviation (format, signature, age) gives null. */
export function parseSession(value: string | null | undefined, env: SessionEnv = process.env,
  nowMs: number = Date.now()): Session | null {
  if (!value) return null;
  const match = SESSION_FORMAT.exec(value);
  if (!match) return null;
  const secret = visitorSecret(env);
  if (!secret) return null;
  const [, id, issued, signature] = match as unknown as [string, string, string, string];
  const issuedAtS = Number(issued);
  const nowS = Math.floor(nowMs / 1000);
  if (issuedAtS > nowS + SESSION_FUTURE_SKEW_S || nowS - issuedAtS >= SESSION_MAX_AGE_S) return null;
  const expected = Buffer.from(sign(secret, id, issuedAtS));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return { id, issuedAtMs: issuedAtS * 1000 };
}

/** The session cookie value when exactly one such cookie is present. */
export function sessionCookieValue(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const found: string[] = [];
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === SESSION_COOKIE) found.push(part.slice(eq + 1).trim());
  }
  return found.length === 1 ? found[0]! : null;
}

export function readSession(req: Request, env: SessionEnv = process.env, nowMs: number = Date.now()): Session | null {
  return parseSession(sessionCookieValue(req.headers.get("cookie")), env, nowMs);
}

/** Set-Cookie header text. Secure only when the app origin is https (plain http works on localhost). */
export function sessionSetCookie(value: string, appOrigin: string): string {
  const secure = appOrigin.startsWith("https://") ? "; Secure" : "";
  return `${SESSION_COOKIE}=${value}; Path=/; Max-Age=${SESSION_MAX_AGE_S}; HttpOnly; SameSite=Lax${secure}`;
}

/**
 * Keep a valid session or issue a new one. setCookie is null when the request
 * already carried a young valid cookie (or no secret exists, which is a refusal
 * state). A valid cookie older than 24 h (still valid up to 48 h) is re-signed
 * with the SAME id and a fresh issue time, so a long session does not expire
 * mid-edit and the visitor bucket never changes. An invalid or expired cookie
 * gets a new id.
 */
export function ensureSession(req: Request, appOrigin: string, env: SessionEnv = process.env,
  nowMs: number = Date.now()): { session: Session | null; setCookie: string | null } {
  const existing = readSession(req, env, nowMs);
  if (existing) {
    const ageS = Math.floor(nowMs / 1000) - existing.issuedAtMs / 1000;
    const secret = visitorSecret(env);
    if (ageS <= SESSION_RENEW_AFTER_S || !secret) return { session: existing, setCookie: null };
    const issuedAtS = Math.floor(nowMs / 1000);
    const value = `v1.${existing.id}.${issuedAtS}.${sign(secret, existing.id, issuedAtS)}`;
    return {
      session: { id: existing.id, issuedAtMs: issuedAtS * 1000 },
      setCookie: sessionSetCookie(value, appOrigin),
    };
  }
  const issued = issueSession(env, nowMs);
  if (!issued) return { session: null, setCookie: null };
  return { session: issued.session, setCookie: sessionSetCookie(issued.value, appOrigin) };
}
