// Allowlisted, DNS-pinned fetcher for shop pages and product photos (SPEC 8, SPEC 3 PUBLIC_SHOP_DOMAINS).
// Server only. Every hop is checked against the exact-host allowlist, resolved, refused when ANY resolved
// address is not public, and then connected to by the checked address with the original Host and SNI, so a
// DNS rebind between check and connect is impossible. Fetched HTML is untrusted: it only ever becomes inert
// text and a few JSON-LD strings (JSON.parse, never eval). Nothing here logs URLs, hosts or bodies.
import "server-only";
import { promises as dnsPromises } from "node:dns";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";
import { AppError } from "../errors";

// ---------------------------------------------------------------- limits
export const PAGE_LIMIT_BYTES = 1_000_000;
export const IMAGE_LIMIT_BYTES = 2_000_000;
export const FETCH_BUDGET_MS = 5_000;
export const MAX_REDIRECTS = 3;
export const TEXT_CAP_CHARS = 12_000;
const USER_AGENT = "DreamBike-PartCheck/1.0";
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const IMAGE_TYPES = new Set(["image/webp", "image/jpeg", "image/png"]);

// ---------------------------------------------------------------- failures
export type FetchFailureReason =
  | "blocked_host" | "blocked_address" | "bad_url" | "too_many_redirects" | "timeout"
  | "http_status" | "too_large" | "wrong_type" | "encoding" | "network";

/** A typed failure. `host` is the host of the hop that failed (for the visitor's own message), `status` for http_status. */
export class FetchError extends Error {
  constructor(public reason: FetchFailureReason, public host: string | null = null, public status: number | null = null) {
    super(reason); // the message never carries a URL or body
  }
}

/** Hostname text that is safe to show back to the visitor; anything odd becomes a generic phrase. */
function shownHost(host: string | null): string {
  return host && /^[a-z0-9.-]{1,100}$/.test(host) ? host : "that site";
}

/** Short human reason for a failure, naming the host. */
export function humanReason(error: FetchError): string {
  const host = shownHost(error.host);
  switch (error.reason) {
    case "blocked_host": return `${host} is not on this server's list of shops.`;
    case "blocked_address": return `${host} points to an address that cannot be fetched.`;
    case "bad_url": return "Only plain https:// product links are accepted.";
    case "too_many_redirects": return `${host} redirected too many times.`;
    case "timeout": return `${host} took too long to answer.`;
    case "http_status": return `${host} answered with status ${error.status ?? "unknown"}.`;
    case "too_large": return `The file from ${host} is too large.`;
    case "wrong_type": return `${host} did not return a page or photo of the expected type.`;
    case "encoding": return `${host} returned a compressed or unreadable answer.`;
    case "network": return `${host} could not be reached.`;
  }
}

/**
 * Map a failure to the route error: FETCH_BLOCKED (403) for blocked_*, bad_url and redirect refusals;
 * UPSTREAM_TIMEOUT (504) for timeout; UPSTREAM_UNAVAILABLE (502, retryable) for network and 5xx/429;
 * UPSTREAM_REJECTED (502) for 4xx, oversize, wrong type and encoding. Messages never carry a URL.
 */
export function toAppError(error: FetchError): AppError {
  const text = humanReason(error);
  switch (error.reason) {
    case "blocked_host": case "blocked_address": case "bad_url": case "too_many_redirects":
      return new AppError("FETCH_BLOCKED", `${text} Enter the product details and source link manually.`);
    case "timeout": return new AppError("UPSTREAM_TIMEOUT", text);
    case "network": return new AppError("UPSTREAM_UNAVAILABLE", text);
    case "http_status": {
      const code = error.status ?? 0;
      return new AppError(code === 429 || code >= 500 ? "UPSTREAM_UNAVAILABLE" : "UPSTREAM_REJECTED", text);
    }
    default: return new AppError("UPSTREAM_REJECTED", text);
  }
}

export type LinkState = "reachable" | "unreachable" | "unchecked";

/**
 * Link state from one bounded GET (HEAD is never used): success or any 2xx is reachable; 404 and 410 are
 * unreachable; everything else (403, 405, 429, 5xx, timeout, network, blocked, ...) stays unchecked.
 */
export function linkStateOf(error: FetchError | null): LinkState {
  if (error === null) return "reachable";
  if (error.reason === "http_status" && (error.status === 404 || error.status === 410)) return "unreachable";
  return "unchecked";
}

// ---------------------------------------------------------------- URL and address checks
/**
 * HTTPS only, default port 443 only, no userinfo, no IP-literal host, exact host in the allowlist.
 * Returns the parsed URL; throws FetchError before any lookup or connection.
 */
export function checkShopUrl(input: string | URL, shopDomains: ReadonlySet<string> | null): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new FetchError("bad_url");
  }
  if (url.protocol !== "https:" || url.port !== "" || url.username !== "" || url.password !== "") {
    throw new FetchError("bad_url", url.hostname);
  }
  const host = url.hostname;
  // new URL turns 2130706433 or 0x7f.1 into dotted IPv4, so isIP also catches those spellings.
  if (host.startsWith("[") || isIP(host) !== 0) throw new FetchError("blocked_host", host);
  if (!shopDomains || !shopDomains.has(host)) throw new FetchError("blocked_host", host);
  return url;
}

const blocked = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked.addSubnet(net, prefix, "ipv4");
blocked.addAddress("255.255.255.255", "ipv4");
blocked.addAddress("::", "ipv6");
blocked.addAddress("::1", "ipv6");
for (const [net, prefix] of [
  // ::/96 (IPv4-compatible, deprecated) and ::ffff:0:0:0/96 (SIIT) can embed an IPv4 address too.
  ["::", 96], ["::ffff:0:0:0", 96], ["64:ff9b::", 96], ["64:ff9b:1::", 48], ["100::", 64], ["2001::", 23], ["2001:db8::", 32], ["2002::", 16],
  ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8],
] as const) blocked.addSubnet(net, prefix, "ipv6");

/** Eight 16-bit groups of a valid IPv6 text address (handles `::` and a dotted IPv4 tail), or null. */
function v6Groups(address: string): number[] | null {
  let text = address;
  const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (dotted) {
    const o = dotted.slice(1).map(Number);
    if (o.some((x) => x > 255)) return null;
    text = text.slice(0, dotted.index) + `${((o[0]! << 8) | o[1]!).toString(16)}:${((o[2]! << 8) | o[3]!).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string): number[] | null => {
    if (part === "") return [];
    const out = part.split(":").map((g) => (/^[0-9a-f]{1,4}$/i.test(g) ? parseInt(g, 16) : NaN));
    return out.some(Number.isNaN) ? null : out;
  };
  const head = parse(halves[0]!);
  const tail = halves.length === 2 ? parse(halves[1]!) : [];
  if (!head || !tail) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const fill = 8 - head.length - tail.length;
  return fill < 1 ? null : [...head, ...new Array<number>(fill).fill(0), ...tail];
}

/**
 * True only for a globally routable unicast address. Anything that is not a valid IP text (including
 * zone ids) is refused. IPv4-mapped IPv6 (::ffff:a.b.c.d) is unwrapped and the IPv4 address checked.
 */
export function isPublicAddress(address: string): boolean {
  const kind = isIP(address);
  if (kind === 4) return !blocked.check(address, "ipv4");
  if (kind !== 6) return false;
  const g = v6Groups(address);
  if (!g) return false;
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) {
    return !blocked.check(`${g[6]! >> 8}.${g[6]! & 255}.${g[7]! >> 8}.${g[7]! & 255}`, "ipv4");
  }
  return !blocked.check(g.map((x) => x.toString(16)).join(":"), "ipv6");
}

// ---------------------------------------------------------------- transport
export type Resolved = { address: string; family: number };
export type PinnedAddress = { address: string; family: 4 | 6 };
export type Resolver = (host: string) => Promise<Resolved[]>;
export type PinnedRequest = {
  /** Original host: used for the Host header and the TLS SNI name; certificate checks stay on. */
  hostname: string; servername: string;
  /** The preferred already checked address (first IPv4 if any); `addresses` holds every checked one. */
  address: string; family: 4 | 6;
  /** Every checked public address, IPv4 first. The connection may only use these. */
  addresses: PinnedAddress[];
  port: 443; path: string; headers: Record<string, string>; signal: AbortSignal;
};
export type TransportResponse = {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: AsyncIterable<Uint8Array>;
  destroy: () => void;
};
export type Transport = (req: PinnedRequest) => Promise<TransportResponse>;
export type FetchOptions = { resolve?: Resolver; transport?: Transport; budgetMs?: number };

type LookupResult = string | { address: string; family: number }[];
type LookupCallback = (error: Error | null, address: LookupResult, family?: number) => void;

/** Public addresses only, IPv4 first (serverless egress is often IPv4-only), original order otherwise. */
export function orderCheckedAddresses(list: readonly Resolved[]): PinnedAddress[] {
  const checked = list.filter((a) => isPublicAddress(a.address))
    .map((a) => ({ address: a.address, family: (isIP(a.address) === 6 ? 6 : 4) as 4 | 6 }));
  return [...checked.filter((a) => a.family === 4), ...checked.filter((a) => a.family === 6)];
}

/**
 * A `lookup` for https.request that only ever answers with checked public addresses, in whichever form the
 * caller asks for: {all:true} gets every checked address (IPv4 first), otherwise the first IPv4 if any, else
 * the first address, with its family. Accepts one address and family, or the full checked list.
 */
export function pinnedLookup(address: string | readonly Resolved[], family?: 4 | 6) {
  const list = orderCheckedAddresses(typeof address === "string" ? [{ address, family: family ?? 4 }] : address);
  return (_host: string, options: unknown, callback?: LookupCallback): void => {
    const cb = (typeof options === "function" ? options : callback) as LookupCallback;
    const all = typeof options === "object" && options !== null && (options as { all?: boolean }).all === true;
    if (list.length === 0) { cb(new Error("no checked address"), all ? [] : ""); return; }
    if (all) cb(null, list.map((a) => ({ address: a.address, family: a.family })));
    else cb(null, list[0]!.address, list[0]!.family);
  };
}

const defaultResolve: Resolver = async (host) => dnsPromises.lookup(host, { all: true, verbatim: true });

const defaultTransport: Transport = (req) => new Promise<TransportResponse>((resolve, reject) => {
  const outgoing = httpsRequest({
    method: "GET", hostname: req.hostname, servername: req.servername, port: req.port, path: req.path,
    headers: req.headers, agent: false, signal: req.signal,
    // The cast bridges Node's overloaded lookup typing; pinnedLookup answers both call forms.
    lookup: pinnedLookup(req.addresses) as unknown as typeof import("node:dns").lookup,
  }, (res) => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: res, destroy: () => res.destroy() }));
  outgoing.on("error", reject);
  outgoing.end();
});

// ---------------------------------------------------------------- core fetch
type Raw = { finalUrl: URL; status: number; contentType: string; charset: string | null; bytes: Uint8Array };

function headerText(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

async function fetchLimited(rawUrl: string, shopDomains: ReadonlySet<string> | null, kind: "page" | "image",
  options: FetchOptions): Promise<Raw> {
  const resolve = options.resolve ?? defaultResolve;
  const transport = options.transport ?? defaultTransport;
  const limit = kind === "page" ? PAGE_LIMIT_BYTES : IMAGE_LIMIT_BYTES;
  const accept = kind === "page" ? "text/html,application/xhtml+xml" : "image/webp,image/jpeg,image/png";

  // One 5 s budget covers every hop: lookup, connect, headers and body.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.budgetMs ?? FETCH_BUDGET_MS);
  const expired = new Promise<never>((_, reject) => {
    controller.signal.addEventListener("abort", () => reject(new FetchError("timeout")), { once: true });
  });
  expired.catch(() => undefined); // a timeout nobody is racing must not become an unhandled rejection
  const within = <T>(work: Promise<T>): Promise<T> => Promise.race([work, expired]);

  try {
    let current = checkShopUrl(rawUrl, shopDomains); // refused before any lookup or connection
    for (let hop = 0; ; hop++) {
      const host = current.hostname;
      let addresses: Resolved[];
      try {
        addresses = await within(resolve(host));
      } catch (error) {
        throw error instanceof FetchError ? error : new FetchError("network", host);
      }
      if (addresses.length === 0) throw new FetchError("network", host);
      // Refuse if ANY answer is non-public: a host mixing public and private answers is a rebind trick.
      if (!addresses.every((a) => isPublicAddress(a.address))) throw new FetchError("blocked_address", host);
      const pinnedList = orderCheckedAddresses(addresses);
      const pinned = pinnedList[0]!;

      let response: TransportResponse;
      try {
        response = await within(transport({
          hostname: host, servername: host, address: pinned.address, family: pinned.family, addresses: pinnedList,
          port: 443, path: `${current.pathname}${current.search}`, signal: controller.signal,
          headers: { Host: host, "User-Agent": USER_AGENT, Accept: accept, "Accept-Encoding": "identity" },
        }));
      } catch (error) {
        if (error instanceof FetchError) throw error;
        throw new FetchError(controller.signal.aborted ? "timeout" : "network", host);
      }

      try {
        if (REDIRECT_STATUSES.has(response.status)) {
          const location = headerText(response.headers.location);
          if (location === "") throw new FetchError("http_status", host, response.status);
          if (hop >= MAX_REDIRECTS) throw new FetchError("too_many_redirects", host);
          let next: URL;
          try {
            next = new URL(location, current);
          } catch {
            throw new FetchError("bad_url", host);
          }
          current = checkShopUrl(next, shopDomains); // allowlist again; the loop re-resolves and re-pins
          continue;
        }
        if (response.status < 200 || response.status > 299) throw new FetchError("http_status", host, response.status);
        const encoding = headerText(response.headers["content-encoding"]).trim().toLowerCase();
        if (encoding !== "" && encoding !== "identity") throw new FetchError("encoding", host);
        const declared = Number(headerText(response.headers["content-length"]));
        if (Number.isFinite(declared) && declared > limit) throw new FetchError("too_large", host);

        const typeText = headerText(response.headers["content-type"]);
        const contentType = typeText.split(";")[0]!.trim().toLowerCase();
        const okType = kind === "page" ? contentType === "text/html" || contentType === "application/xhtml+xml"
          : IMAGE_TYPES.has(contentType);
        if (!okType) throw new FetchError("wrong_type", host);
        const charset = /;\s*charset\s*=\s*"?([^";\s]+)"?/i.exec(typeText)?.[1] ?? null;

        // Count raw bytes as they arrive and stop at the limit (identity encoding, so raw = decoded).
        const iterator = response.body[Symbol.asyncIterator]();
        const chunks: Uint8Array[] = [];
        let total = 0;
        try {
          for (;;) {
            const step = await within(iterator.next());
            if (step.done) break;
            total += step.value.byteLength;
            if (total > limit) throw new FetchError("too_large", host);
            chunks.push(step.value);
          }
        } catch (error) {
          if (error instanceof FetchError) throw error;
          throw new FetchError(controller.signal.aborted ? "timeout" : "network", host);
        }
        const bytes = new Uint8Array(total);
        let offset = 0;
        for (const c of chunks) { bytes.set(c, offset); offset += c.byteLength; }
        return { finalUrl: current, status: response.status, contentType, charset, bytes };
      } finally {
        response.destroy();
      }
    }
  } finally {
    clearTimeout(timer);
    controller.abort(); // closes any connection still open after a failure
  }
}

// ---------------------------------------------------------------- page text and JSON-LD
export type JsonLdOfferKind = "product" | "variant" | "aggregate_low" | "list_item";
export type JsonLdOffer = {
  name: string | null; brand: string | null; sku: string | null; mpn: string | null;
  /** Raw price text exactly as the page states it; never converted here. */
  price: string | null; currency: string | null;
  /**
   * product: Offer on the page's top-level Product. variant: Offer of a hasVariant member. aggregate_low: an
   * AggregateOffer's lowPrice (highPrice is never a price). list_item: reached through an ItemList or a
   * related/similar product (wins over aggregate_low).
   */
  kind: JsonLdOfferKind;
};
export type FetchedPage = {
  finalUrl: string; status: number; text: string; jsonLdOffers: JsonLdOffer[];
  /** At most 10 distinct https image URLs (og:image, twitter:image, JSON-LD Product image), data only. */
  imageUrls: string[];
};
export type FetchedImage = { finalUrl: string; status: number; mime: "image/webp" | "image/jpeg" | "image/png"; bytes: Uint8Array };

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", euro: "€", pound: "£", copy: "©", reg: "®",
  ndash: "–", mdash: "—", shy: "", hellip: "…", deg: "°", times: "×",
};

function decodeEntities(text: string): string {
  return text.replace(/&(?:#(\d{1,7})|#x([0-9a-f]{1,6})|([a-z]{2,8}));/gi, (whole, dec: string, hex: string, name: string) => {
    if (name) return NAMED_ENTITIES[name.toLowerCase()] ?? whole;
    try {
      return String.fromCodePoint(dec ? Number(dec) : parseInt(hex, 16));
    } catch {
      return " ";
    }
  });
}

// The scanners below are single forward passes built on indexOf and sticky/global regexes whose lastIndex only
// moves forward, so a page of a million unclosed openers costs one pass, never one pass per opener.
const DROPPED_TAGS = new Set(["script", "style", "noscript", "template", "svg"]);
const DROPPED_CLOSERS = new Map([...DROPPED_TAGS].map((name) => [name, new RegExp(`</${name}\\s*>`, "gi")]));
const TAG_NAME = /(\/?)([a-zA-Z][a-zA-Z0-9]*)/y;

/** Visible text only: no script, style, noscript, template or svg content, no tags, entities decoded, capped. */
export function visibleText(html: string): string {
  const pieces: string[] = [];
  // Once a search for ">" fails from some index, no later ">" exists either; remember it.
  let noGtFrom = Infinity;
  const gtFrom = (from: number): number => {
    if (from >= noGtFrom) return -1;
    const at = html.indexOf(">", from);
    if (at < 0) noGtFrom = from;
    return at;
  };
  let pos = 0;
  while (pos < html.length) {
    const lt = html.indexOf("<", pos);
    if (lt < 0) { pieces.push(html.slice(pos)); break; }
    pieces.push(html.slice(pos, lt));
    if (html.startsWith("<!--", lt)) {
      pieces.push(" ");
      const end = html.indexOf("-->", lt + 4);
      if (end < 0) break; // unterminated comment drops the rest
      pos = end + 3;
      continue;
    }
    const next = html[lt + 1] ?? "";
    if (!/[a-zA-Z!?/]/.test(next)) { pieces.push("<"); pos = lt + 1; continue; }
    TAG_NAME.lastIndex = lt + 1;
    const named = TAG_NAME.exec(html);
    const dropName = named && named[1] === "" && DROPPED_TAGS.has(named[2]!.toLowerCase()) ? named[2]!.toLowerCase() : null;
    const gt = gtFrom(lt + 1);
    if (dropName) {
      pieces.push(" ");
      if (gt < 0) break; // unclosed opening tag of a dropped element: drop the rest
      if (html[gt - 1] === "/") { pos = gt + 1; continue; } // self-closing: an empty element, swallows nothing
      const closer = DROPPED_CLOSERS.get(dropName)!;
      closer.lastIndex = gt + 1;
      const close = closer.exec(html);
      if (!close) break; // unclosed dropped element: drop the rest and stop
      pos = close.index + close[0].length;
      continue;
    }
    if (gt < 0) { pieces.push(html.slice(lt)); break; } // no ">" anywhere later: the rest is plain text
    pieces.push(" ");
    pos = gt + 1;
  }
  return decodeEntities(pieces.join("")).replace(/\s+/g, " ").trim().slice(0, TEXT_CAP_CHARS);
}

const MAX_LD_BLOCKS = 10;
const MAX_LD_NODES = 500;
const MAX_LD_DEPTH = 6;
const MAX_LD_OFFERS = 20;
const MAX_IMAGE_URLS = 10;
const MAX_IMAGE_URL_CHARS = 2048;
const MAX_META_TAGS = 300;
const MAX_META_TAG_CHARS = 4_000;
const LD_TYPE = /\btype\s*=\s*["']?application\/ld\+json/i;

/** The bodies of up to 10 JSON-LD script blocks, found in one forward pass. */
function ldBlocks(html: string): string[] {
  const blocks: string[] = [];
  const opener = /<script\b/gi;
  const closer = /<\/script\s*>/gi;
  let pos = 0;
  while (blocks.length < MAX_LD_BLOCKS) {
    opener.lastIndex = pos;
    const open = opener.exec(html);
    if (!open) break;
    const gt = html.indexOf(">", open.index + 7);
    if (gt < 0) break;
    closer.lastIndex = gt + 1;
    const close = closer.exec(html);
    if (!close) break; // unclosed script: nothing after it counts
    if (LD_TYPE.test(html.slice(open.index, gt))) blocks.push(html.slice(gt + 1, close.index));
    pos = close.index + close[0].length;
  }
  return blocks;
}

function ldText(value: unknown): string | null {
  if (typeof value === "string") return value.trim().slice(0, 200) || null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function ldName(value: unknown): string | null {
  if (Array.isArray(value)) return ldName(value[0]);
  if (value && typeof value === "object") return ldText((value as Record<string, unknown>).name);
  return ldText(value);
}

function hasType(node: Record<string, unknown>, wanted: string): boolean {
  const type = node["@type"];
  return Array.isArray(type) ? type.includes(wanted) : type === wanted;
}

function isProduct(node: Record<string, unknown>): boolean {
  return hasType(node, "Product");
}

function offersOf(value: unknown, out: Record<string, unknown>[], depth = 0): void {
  if (depth > 3 || out.length >= MAX_LD_OFFERS) return;
  if (Array.isArray(value)) { for (const v of value.slice(0, MAX_LD_OFFERS)) offersOf(v, out, depth + 1); return; }
  if (value && typeof value === "object") {
    const node = value as Record<string, unknown>;
    out.push(node);
    if (node.offers !== undefined) offersOf(node.offers, out, depth + 1);
  }
}

function ldImages(value: unknown, out: string[], depth = 0): void {
  if (depth > 2 || out.length >= MAX_IMAGE_URLS * 2) return;
  if (typeof value === "string") { out.push(value); return; }
  if (Array.isArray(value)) { for (const v of value.slice(0, MAX_IMAGE_URLS)) ldImages(v, out, depth + 1); return; }
  if (value && typeof value === "object") {
    const node = value as Record<string, unknown>;
    for (const key of ["url", "contentUrl"]) if (typeof node[key] === "string") out.push(node[key] as string);
  }
}

type LdContext = "product" | "variant" | "list_item";

/**
 * JSON-LD offers (with their kind) and raw Product image strings from the page's JSON-LD blocks. Parsed with
 * JSON.parse only. Image strings come from top-level Products only and are not yet resolved or filtered.
 */
export function extractJsonLd(html: string): { offers: JsonLdOffer[]; imageUrls: string[] } {
  const found: JsonLdOffer[] = [];
  const images: string[] = [];
  let visited = 0;
  const walk = (value: unknown, depth: number, ctx: LdContext): void => {
    if (depth > MAX_LD_DEPTH || visited >= MAX_LD_NODES || found.length >= MAX_LD_OFFERS) return;
    visited++;
    if (Array.isArray(value)) { for (const v of value) walk(v, depth + 1, ctx); return; }
    if (!value || typeof value !== "object") return;
    const node = value as Record<string, unknown>;
    if (isProduct(node)) {
      const base = { name: ldText(node.name), brand: ldName(node.brand), sku: ldText(node.sku), mpn: ldText(node.mpn) };
      if (ctx === "product" && node.image !== undefined) ldImages(node.image, images);
      const offers: Record<string, unknown>[] = [];
      offersOf(node.offers, offers);
      // AggregateOffer nests real offers; a bare wrapper with no price of its own adds nothing.
      const priced = offers.filter((o) => o.price !== undefined || o.lowPrice !== undefined || o.priceSpecification !== undefined);
      if (priced.length === 0) found.push({ ...base, price: null, currency: null, kind: ctx });
      for (const o of priced) {
        const spec = o.priceSpecification && typeof o.priceSpecification === "object"
          ? o.priceSpecification as Record<string, unknown> : {};
        const aggregate = hasType(o, "AggregateOffer") || (o.lowPrice !== undefined && o.price === undefined);
        const kind: JsonLdOfferKind = ctx === "list_item" ? "list_item" : aggregate ? "aggregate_low" : ctx;
        found.push({
          ...base,
          price: aggregate ? (ldText(o.lowPrice) ?? ldText(spec.price)) : (ldText(o.price) ?? ldText(spec.price)),
          currency: ldText(o.priceCurrency) ?? ldText(spec.priceCurrency),
          kind,
        });
      }
    }
    // Same context through @graph and mainEntity; variants, list entries and related products change it.
    const through: [string, LdContext][] = [["@graph", ctx], ["mainEntity", ctx], ["hasVariant", ctx === "list_item" ? ctx : "variant"],
      ["itemListElement", "list_item"], ["item", "list_item"], ["isSimilarTo", "list_item"], ["isRelatedTo", "list_item"],
      ["isAccessoryOrSparePartFor", "list_item"]];
    for (const [key, childCtx] of through) {
      if (node[key] !== undefined) walk(node[key], depth + 1, childCtx);
    }
  };
  for (const block of ldBlocks(html)) {
    try {
      walk(JSON.parse(block), 0, "product");
    } catch {
      // Malformed JSON-LD is ignored; the visible text still carries the page.
    }
  }
  return { offers: found.slice(0, MAX_LD_OFFERS), imageUrls: images };
}

/** Product name, brand, sku, mpn, offer price, currency and kind from JSON-LD blocks. Parsed with JSON.parse only. */
export function extractJsonLdOffers(html: string): JsonLdOffer[] {
  return extractJsonLd(html).offers;
}

const META_ATTR = /([^\s"'<>/=]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;

/** content of og:image and twitter:image meta tags, raw and in page order. */
function metaImageCandidates(html: string): string[] {
  const out: string[] = [];
  const opener = /<meta\b/gi;
  let pos = 0;
  for (let n = 0; n < MAX_META_TAGS; n++) {
    opener.lastIndex = pos;
    const open = opener.exec(html);
    if (!open) break;
    const start = open.index + 5;
    const gt = html.indexOf(">", start);
    if (gt < 0) break;
    pos = gt + 1;
    const attrs = new Map<string, string>();
    const tag = html.slice(start, Math.min(gt, start + MAX_META_TAG_CHARS)); // bounded: attribute parsing stays linear
    META_ATTR.lastIndex = 0;
    for (let m = META_ATTR.exec(tag); m; m = META_ATTR.exec(tag)) {
      const key = m[1]!.toLowerCase();
      if (!attrs.has(key)) attrs.set(key, decodeEntities(m[2] ?? m[3] ?? m[4] ?? ""));
    }
    const label = (attrs.get("property") ?? attrs.get("name") ?? "").trim().toLowerCase();
    const content = attrs.get("content");
    if ((label === "og:image" || label === "twitter:image") && content) out.push(content);
  }
  return out;
}

/** Resolve against the page URL, keep https only, drop anything over 2048 chars, dedupe, at most 10. */
function cleanImageUrls(candidates: readonly string[], base: URL): string[] {
  const seen = new Set<string>();
  for (const raw of candidates) {
    const text = raw.trim();
    if (text === "" || text.length > MAX_IMAGE_URL_CHARS) continue;
    let url: URL;
    try {
      url = new URL(text, base);
    } catch {
      continue;
    }
    if (url.protocol !== "https:" || url.href.length > MAX_IMAGE_URL_CHARS) continue;
    seen.add(url.href);
    if (seen.size >= MAX_IMAGE_URLS) break;
  }
  return [...seen];
}

/** Image URLs a page names: og:image, twitter:image and JSON-LD Product image, resolved against `base`. Data only. */
export function extractImageUrls(html: string, base: URL): string[] {
  return cleanImageUrls([...metaImageCandidates(html), ...extractJsonLd(html).imageUrls], base);
}

function decodeBody(bytes: Uint8Array, charset: string | null): string {
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(charset ?? "utf-8");
  } catch {
    decoder = new TextDecoder("utf-8"); // unknown label
  }
  return decoder.decode(bytes);
}

// ---------------------------------------------------------------- public entry points
/** One bounded GET of an allowlisted listing page. Throws FetchError. */
export async function fetchPage(url: string, shopDomains: ReadonlySet<string> | null, options: FetchOptions = {}): Promise<FetchedPage> {
  const raw = await fetchLimited(url, shopDomains, "page", options);
  const html = decodeBody(raw.bytes, raw.charset);
  const ld = extractJsonLd(html);
  return {
    finalUrl: raw.finalUrl.href, status: raw.status, text: visibleText(html), jsonLdOffers: ld.offers,
    imageUrls: cleanImageUrls([...metaImageCandidates(html), ...ld.imageUrls], raw.finalUrl),
  };
}

/** The image type the first bytes show (WebP, JPEG or PNG), or null for anything else. */
export function sniffImage(bytes: Uint8Array): "image/webp" | "image/jpeg" | "image/png" | null {
  const at = (i: number, ...b: number[]) => b.every((v, k) => bytes[i + k] === v);
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "image/webp";
  if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  return null;
}

/** One bounded GET of an allowlisted product photo (WebP, JPEG or PNG, at most 2 MB). Throws FetchError. */
export async function fetchImage(url: string, shopDomains: ReadonlySet<string> | null, options: FetchOptions = {}): Promise<FetchedImage> {
  const raw = await fetchLimited(url, shopDomains, "image", options);
  // The declared type must match the bytes, so the image decoder never sees SVG, TIFF or GIF under a PNG label.
  if (sniffImage(raw.bytes) !== raw.contentType) throw new FetchError("wrong_type", raw.finalUrl.hostname);
  return { finalUrl: raw.finalUrl.href, status: raw.status, mime: raw.contentType as FetchedImage["mime"], bytes: raw.bytes };
}
