// Next 16 proxy (formerly middleware): hands every visitor a signed session cookie
// on page navigation (SPEC 13). It reissues only when the cookie is missing, invalid
// or expired; a valid id is never rotated, because a new id per reload would give
// the visitor a fresh allowance bucket. No Redis, no config loading, so a broken
// environment can never stop a page from rendering.
import { NextResponse } from "next/server";
import { ensureSession } from "@/lib/server/http";

export function proxy(request: Request): NextResponse {
  const response = NextResponse.next();
  if (request.method !== "GET" && request.method !== "HEAD") return response;
  const appOrigin = process.env.APP_ORIGIN || "http://localhost:3000";
  const { setCookie } = ensureSession(request, appOrigin);
  if (setCookie) response.headers.append("Set-Cookie", setCookie);
  return response;
}

export const config = {
  // Pages only: skip Next internals, API routes (/api/budget issues its own cookie),
  // the static demo, fonts, and any file with an extension (icons, images, manifests).
  matcher: ["/((?!_next|api|demo|fonts|.*\\..*).*)"],
};
