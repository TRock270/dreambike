// POST /api/product-image: fetch one shop product photo from an allowlisted host (SPEC 5, 8, 9).
// Order: origin, request id, body (8 KB), JSON + Zod, then the gates. No Meta call, no Redis, no spend.
// The photo exists only in memory and in the response: never on disk, public/, fixtures, caches or logs.
// Rights: a shop photo is always "external_runtime" (strict rights, owner decision 2026-10-30).
//
// Mock mode (MOCK=1) never fetches. It returns a locally generated, visibly labeled placeholder image
// (the same for every URL), so the UI can try the reference flow offline; it is not FEATURE_DISABLED.
import sharp from "sharp";
import { ProductImageRequest, ProductImageResponse } from "@/lib/contracts";
import { AppError } from "@/lib/errors";
import { MOCK_LABEL } from "@/lib/mocks";
import { loadConfig } from "@/lib/server/config";
import { checkShopUrl, fetchImage, FetchError, toAppError } from "@/lib/server/fetch-product";
import { assertSameOrigin, errorResponse, jsonResponse, readBodyLimited, requestIdOf, requireRequestId } from "@/lib/server/http";
import { normalize, toDataUrl } from "@/lib/server/images";
import { freeFetchDenied } from "@/lib/server/paid";

export const runtime = "nodejs";
export const maxDuration = 15;

const DEADLINE_MS = 10_000;
const BODY_LIMIT = 8_000;

/** A labeled gray-blue placeholder (named and rgb() colors only; hex colors live in tokens.css). */
async function mockPlaceholder(): Promise<Uint8Array> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480">`
    + `<rect width="640" height="480" fill="rgb(211,227,245)"/>`
    + `<text x="320" y="230" font-size="28" text-anchor="middle" fill="black">${MOCK_LABEL.replace(/—/g, "-")}</text>`
    + `<text x="320" y="272" font-size="22" text-anchor="middle" fill="black">Placeholder product photo</text></svg>`;
  return new Uint8Array(await sharp(Buffer.from(svg)).png().toBuffer());
}

function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new AppError("UPSTREAM_TIMEOUT", "Preparing the product photo took too long.")), ms);
    work.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
  });
}

export async function POST(req: Request): Promise<Response> {
  const startedAt = Date.now();
  const requestId = requestIdOf(req);
  try {
    const config = loadConfig();
    const deployed = process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL_ENV);
    assertSameOrigin(req, config, deployed);
    requireRequestId(req);
    const bytes = await readBodyLimited(req, BODY_LIMIT);
    let json: unknown;
    try {
      json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      throw new AppError("INVALID_REQUEST");
    }
    const parsed = ProductImageRequest.safeParse(json);
    if (!parsed.success) throw new AppError("INVALID_REQUEST");

    if (config.mode === "mock") {
      const photo = await normalize(await mockPlaceholder());
      return jsonResponse(ProductImageResponse.parse({
        image: { mime: "image/webp", dataUrl: toDataUrl("image/webp", photo.bytes), width: photo.width, height: photo.height, hash: photo.hash },
        rights: "external_runtime",
      }));
    }
    if (config.mode !== "live") throw new AppError("LIVE_DISABLED");
    if (config.shopDomains === null) {
      throw new AppError("FEATURE_DISABLED", "Fetching product photos is switched off on this server. Add the photo by hand.");
    }
    // Product photos are only used as reference photos, so they follow the same switch as the UI (page.tsx).
    if (!config.features.reference) {
      throw new AppError("FEATURE_DISABLED", "Reference photos are switched off on this server. Describe the part instead.");
    }
    let url: URL;
    try {
      url = checkShopUrl(parsed.data.url, config.shopDomains);
    } catch (error) {
      throw error instanceof FetchError ? toAppError(error) : error;
    }
    const wait = freeFetchDenied(req, config);
    if (wait !== null) {
      throw new AppError("RATE_LIMITED", `Too many product lookups from your network. ${wait > 60 ? "Try again later." : "Try again in a minute."}`, wait);
    }

    let fetched;
    try {
      fetched = await fetchImage(url.href, config.shopDomains);
    } catch (error) {
      throw error instanceof FetchError ? toAppError(error) : error;
    }
    let photo;
    try {
      photo = await withDeadline(normalize(fetched.bytes), Math.max(1_000, DEADLINE_MS - (Date.now() - startedAt)));
    } catch (error) {
      if (error instanceof AppError && error.code === "INVALID_IMAGE") {
        throw new AppError("INVALID_IMAGE", "The product photo is too small or could not be read. Add a photo by hand.");
      }
      throw error;
    }
    return jsonResponse(ProductImageResponse.parse({
      image: { mime: "image/webp", dataUrl: toDataUrl("image/webp", photo.bytes), width: photo.width, height: photo.height, hash: photo.hash },
      rights: "external_runtime",
    }));
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
