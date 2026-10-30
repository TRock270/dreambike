// Route tests need a valid signed session cookie on every POST (SPEC 13).
// Call these after the test's environment is stubbed: the cookie is signed with
// whatever VISITOR_HASH_SECRET (or per-process dev key) is active right now.
import { SESSION_COOKIE, issueSession } from "@/lib/server/http";

/** A fresh `db_session=...` cookie header value for the current environment. */
export function sessionCookie(nowMs: number = Date.now()): string {
  const issued = issueSession(process.env, nowMs);
  if (!issued) throw new Error("no session secret in this test environment");
  return `${SESSION_COOKIE}=${issued.value}`;
}

/** Headers plus a valid session cookie. */
export function withSession(headers: Record<string, string> = {}): Record<string, string> {
  return { ...headers, Cookie: sessionCookie() };
}
