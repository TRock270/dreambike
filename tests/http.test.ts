// Session cookie helpers (SPEC 13, T13): signing, strict parsing, expiry, dev key.
import { describe, expect, it } from "vitest";
import {
  SESSION_COOKIE, SESSION_MAX_AGE_S, ensureSession, issueSession, labeledHmac, parseSession, readSession,
  sessionCookieValue, sessionSetCookie, visitorSecret,
} from "@/lib/server/http";

const SECRET = "s".repeat(32);
const env = (e: Record<string, string>) => e as NodeJS.ProcessEnv;
const live = env({ NODE_ENV: "production", VERCEL_ENV: "production", VISITOR_HASH_SECRET: SECRET });
const dev = env({ NODE_ENV: "development" });
const NOW = Date.UTC(2026, 9, 29, 12, 0, 0);

function issued(e = live, now = NOW) {
  const result = issueSession(e, now);
  if (!result) throw new Error("no session");
  return result;
}

describe("session cookie", () => {
  it("round-trips a signed random id with its issue time", () => {
    const { session, value } = issued();
    expect(value).toMatch(/^v1\.[A-Za-z0-9_-]{22}\.\d+\.[A-Za-z0-9_-]{43}$/);
    expect(parseSession(value, live, NOW + 1000)).toEqual(session);
    expect(issued().session.id).not.toBe(session.id);
  });

  it("rejects a forged signature, a changed id or time, and a wrong secret", () => {
    const { value } = issued();
    const [v, id, iat, sig] = value.split(".") as [string, string, string, string];
    const flipped = sig.slice(0, -1) + (sig.endsWith("A") ? "B" : "A");
    expect(parseSession(`${v}.${id}.${iat}.${flipped}`, live, NOW)).toBeNull();
    expect(parseSession(`${v}.${id}.${Number(iat) + 1}.${sig}`, live, NOW)).toBeNull();
    const otherId = issued().session.id;
    expect(parseSession(`${v}.${otherId}.${iat}.${sig}`, live, NOW)).toBeNull();
    expect(parseSession(value, env({ ...live, VISITOR_HASH_SECRET: "t".repeat(32) }), NOW)).toBeNull();
  });

  it("rejects a signature made with another label", () => {
    const { value } = issued();
    const [v, id, iat] = value.split(".") as [string, string, string];
    const wrong = labeledHmac(Buffer.from(SECRET), "visitor", `${id}.${iat}`);
    expect(parseSession(`${v}.${id}.${iat}.${wrong}`, live, NOW)).toBeNull();
    expect(labeledHmac(Buffer.from(SECRET), "session", "x")).not.toBe(labeledHmac(Buffer.from(SECRET), "ip", "x"));
  });

  it("expires after 48 hours and rejects a future issue time", () => {
    const { value } = issued();
    expect(parseSession(value, live, NOW + (SESSION_MAX_AGE_S - 1) * 1000)).not.toBeNull();
    expect(parseSession(value, live, NOW + SESSION_MAX_AGE_S * 1000)).toBeNull();
    expect(parseSession(value, live, NOW - 61_000)).toBeNull(); // issued in the future
    expect(parseSession(value, live, NOW - 30_000)).not.toBeNull(); // small clock skew is fine
  });

  it("rejects malformed values", () => {
    const { value } = issued();
    const bad = ["", "garbage", `${value}.extra`, `x${value}`, ` ${value}`, `${value} `, value.replace("v1.", "v2."),
      value.toUpperCase(), value.replace(/\.\d+\./, ".-5."), value.replace(/\.\d+\./, ".1e9."), "v1...."];
    for (const b of bad) expect(parseSession(b, live, NOW), b).toBeNull();
    expect(parseSession(null, live, NOW)).toBeNull();
    expect(parseSession(undefined, live, NOW)).toBeNull();
  });

  it("deployed without a (long enough) secret cannot issue or accept sessions", () => {
    const noSecret = env({ NODE_ENV: "production", VERCEL_ENV: "production" });
    expect(visitorSecret(noSecret)).toBeNull();
    expect(visitorSecret(env({ ...noSecret, VISITOR_HASH_SECRET: "short" }))).toBeNull();
    expect(issueSession(noSecret, NOW)).toBeNull();
    const { value } = issued();
    expect(parseSession(value, noSecret, NOW)).toBeNull();
    expect(ensureSession(new Request("https://x.test/"), "https://x.test", noSecret, NOW)).toEqual({ session: null, setCookie: null });
    // A preview deployment counts as deployed even if NODE_ENV says otherwise.
    expect(visitorSecret(env({ NODE_ENV: "development", VERCEL_ENV: "preview" }))).toBeNull();
  });

  it("outside deployments uses one per-process key across calls (and bundles)", () => {
    const a = issueSession(dev, NOW)!;
    expect(parseSession(a.value, dev, NOW)).toEqual(a.session);
    expect(visitorSecret(dev)).toBe(visitorSecret(dev)); // same Buffer object, kept on globalThis
    const holder = globalThis as unknown as Record<string, unknown>;
    expect(Buffer.isBuffer(holder.__dreambikeDevSessionKey)).toBe(true);
    // A configured secret wins over the per-process key.
    expect(parseSession(a.value, env({ ...dev, VISITOR_HASH_SECRET: SECRET }), NOW)).toBeNull();
  });

  it("reads exactly one cookie of that name from the Cookie header", () => {
    const { value } = issued();
    const header = (h: string) => new Request("https://x.test/", { headers: { cookie: h } });
    expect(sessionCookieValue(`a=1; ${SESSION_COOKIE}=${value}; b=2`)).toBe(value);
    expect(readSession(header(`${SESSION_COOKIE}=${value}`), live, NOW)).not.toBeNull();
    expect(sessionCookieValue(`${SESSION_COOKIE}=${value}; ${SESSION_COOKIE}=${value}`)).toBeNull();
    expect(sessionCookieValue(`x${SESSION_COOKIE}=${value}`)).toBeNull();
    expect(sessionCookieValue(null)).toBeNull();
    expect(readSession(new Request("https://x.test/"), live, NOW)).toBeNull();
  });

  it("builds a HttpOnly, SameSite=Lax cookie that is Secure only for an https origin", () => {
    const secure = sessionSetCookie("v", "https://dreambike.example");
    expect(secure).toBe(`${SESSION_COOKIE}=v; Path=/; Max-Age=172800; HttpOnly; SameSite=Lax; Secure`);
    const local = sessionSetCookie("v", "http://localhost:3000");
    expect(local).toBe(`${SESSION_COOKIE}=v; Path=/; Max-Age=172800; HttpOnly; SameSite=Lax`);
  });

  it("ensureSession keeps a valid cookie and replaces a missing or invalid one", () => {
    const { value, session } = issued();
    const withCookie = new Request("https://x.test/", { headers: { cookie: `${SESSION_COOKIE}=${value}` } });
    expect(ensureSession(withCookie, "https://x.test", live, NOW)).toEqual({ session, setCookie: null });
    const bad = new Request("https://x.test/", { headers: { cookie: `${SESSION_COOKIE}=nope` } });
    const fresh = ensureSession(bad, "https://x.test", live, NOW);
    expect(fresh.session).not.toBeNull();
    expect(fresh.setCookie).toContain(`${SESSION_COOKIE}=v1.`);
    expect(fresh.setCookie).toContain("Secure");
    const expired = ensureSession(withCookie, "https://x.test", live, NOW + SESSION_MAX_AGE_S * 1000);
    expect(expired.session!.id).not.toBe(session.id);
    expect(expired.setCookie).not.toBeNull();
  });

  it("ensureSession renews a cookie older than 24 h with the same id and a fresh issue time", () => {
    const DAY = 24 * 3600 * 1000;
    const { value, session } = issued();
    const at = (ms: number) => ensureSession(
      new Request("https://x.test/", { headers: { cookie: `${SESSION_COOKIE}=${value}` } }), "https://x.test", live, NOW + ms);
    // Exactly 24 h and younger: untouched, never rewritten.
    expect(at(DAY)).toEqual({ session, setCookie: null });
    expect(at(1000).setCookie).toBeNull();
    // Older than 24 h but still valid (under 48 h): same id, new time, parses afterwards.
    const later = NOW + DAY + 1000;
    const renewed = at(DAY + 1000);
    expect(renewed.session).toEqual({ id: session.id, issuedAtMs: later - (later % 1000) });
    expect(renewed.setCookie).toContain("Secure");
    const newValue = /db_session=([^;]+)/.exec(renewed.setCookie!)![1]!;
    expect(newValue).not.toBe(value);
    expect(parseSession(newValue, live, later)).toEqual(renewed.session);
    // A renewed cookie is young again for another 24 h.
    expect(ensureSession(new Request("https://x.test/", { headers: { cookie: `${SESSION_COOKIE}=${newValue}` } }),
      "https://x.test", live, later + DAY - 1000).setCookie).toBeNull();
    // Without a secret nothing is rewritten.
    expect(ensureSession(new Request("https://x.test/", { headers: { cookie: `${SESSION_COOKIE}=${value}` } }),
      "https://x.test", env({ NODE_ENV: "production" }), NOW + DAY + 1000)).toEqual({ session: null, setCookie: null });
    // Expired (48 h) is a new id, not a renewal.
    expect(at(SESSION_MAX_AGE_S * 1000).session!.id).not.toBe(session.id);
  });
});
