// Product fetcher and /api/product-image, fully offline: injected resolver and transport, synthetic HTML only,
// reserved example hosts. No real shop page or host appears here.
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/product-image/route";
import { ErrorResponse, ProductImageResponse } from "@/lib/contracts";
import {
  checkShopUrl, extractImageUrls, sniffImage, extractJsonLdOffers, FetchError, fetchImage, fetchPage, humanReason, isPublicAddress, linkStateOf, pinnedLookup,
  toAppError, visibleText, type PinnedRequest, type Resolver, type Transport, type TransportResponse,
} from "@/lib/server/fetch-product";
import { FREE_FETCH_PER_MINUTE, resetQuotaLimitersForTests } from "@/lib/server/paid";
import { withSession } from "./support/session";

// The route test swaps fetchImage; the fetcher tests below get the real one through this wrapper.
const imageOverride: { fn: null | (() => Promise<unknown>) } = { fn: null };
vi.mock("@/lib/server/fetch-product", async (orig) => {
  const real = await orig<typeof import("@/lib/server/fetch-product")>();
  return { ...real, fetchImage: (...args: Parameters<typeof real.fetchImage>) => (imageOverride.fn ? imageOverride.fn() : real.fetchImage(...args)) };
});

const SHOPS = new Set(["shop.example", "www.shop.example"]);
const PUBLIC_V4 = "93.184.216.34";

const resolverFor = (table: Record<string, readonly string[]>, calls: string[] = []): Resolver => async (host) => {
  calls.push(host);
  const list = table[host];
  if (!list) throw new Error("ENOTFOUND");
  return list.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
};

const answer = (status: number, headers: Record<string, string>, body: string | Uint8Array | Uint8Array[] = ""): TransportResponse => {
  const chunks = Array.isArray(body) ? body : [typeof body === "string" ? new TextEncoder().encode(body) : body];
  return {
    status, headers,
    body: (async function* () { for (const c of chunks) yield c; })(),
    destroy: () => undefined,
  };
};
const html = (body: string, extra: Record<string, string> = {}) =>
  answer(200, { "content-type": "text/html; charset=utf-8", ...extra }, body);

/** A transport that records every request and answers from `script(request, callNumber)`. */
function scripted(script: (req: PinnedRequest, n: number) => TransportResponse | Promise<TransportResponse>) {
  const requests: PinnedRequest[] = [];
  const transport: Transport = async (req) => { requests.push(req); return script(req, requests.length); };
  return { transport, requests };
}
const ok = { shop: { "shop.example": [PUBLIC_V4], "www.shop.example": ["93.184.216.35"] } } as const;
const reasonOf = async (work: Promise<unknown>) => {
  try { await work; } catch (e) { if (e instanceof FetchError) return e; throw e; }
  throw new Error("expected a FetchError");
};

describe("checkShopUrl", () => {
  it.each([
    ["http://shop.example/p", "bad_url"],
    ["https://shop.example:8443/p", "bad_url"],
    ["https://user:pw@shop.example/p", "bad_url"],
    ["https://user@shop.example/p", "bad_url"],
    ["not a url", "bad_url"],
    ["https://other.example/p", "blocked_host"],
    ["https://shop.example.evil.example/p", "blocked_host"],
    ["https://shop.example./p", "blocked_host"],
    ["https://127.0.0.1/p", "blocked_host"],
    ["https://2130706433/p", "blocked_host"],
    ["https://[::1]/p", "blocked_host"],
    ["https://localhost/p", "blocked_host"],
  ])("refuses %s", (url, reason) => {
    expect(() => checkShopUrl(url, SHOPS)).toThrowError(expect.objectContaining({ reason }));
  });

  it("accepts an exact host, a default port and any case in the typed URL", () => {
    expect(checkShopUrl("https://shop.example/p?q=1", SHOPS).hostname).toBe("shop.example");
    expect(checkShopUrl("https://SHOP.example:443/p", SHOPS).hostname).toBe("shop.example");
    expect(() => checkShopUrl("https://shop.example/p", null)).toThrow(FetchError);
  });

  it("refuses before any lookup or connection", async () => {
    const lookups: string[] = [];
    const { transport, requests } = scripted(() => html("x"));
    for (const url of ["http://shop.example/", "https://shop.example:8443/", "https://u:p@shop.example/",
      "https://other.example/", "https://127.0.0.1/", "https://localhost/"]) {
      await reasonOf(fetchPage(url, SHOPS, { resolve: resolverFor(ok.shop, lookups), transport }));
    }
    expect(lookups).toEqual([]);
    expect(requests).toEqual([]);
  });
});

describe("isPublicAddress", () => {
  it.each([
    "0.0.0.0", "10.1.2.3", "100.64.0.1", "127.0.0.1", "169.254.169.254", "172.16.0.1", "172.31.255.255", "192.0.0.1",
    "192.0.2.5", "192.88.99.1", "192.168.1.1", "198.18.0.1", "198.19.255.255", "198.51.100.1", "203.0.113.9",
    "224.0.0.1", "240.0.0.1", "255.255.255.255",
    "::", "::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:10.0.0.1", "64:ff9b::7f00:1", "64:ff9b:1::1", "100::1",
    "2001::1", "2001:db8::1", "2002:7f00:1::", "fc00::1", "fd00::1", "fe80::1", "ff02::1",
    "not-an-address", "", "fe80::1%eth0", "::7f00:1", "::a00:1", "::ffff:0:a00:1", "::ffff:0:7f00:1", "fec0::1",
  ])("refuses %s", (address) => { expect(isPublicAddress(address)).toBe(false); });

  it.each([PUBLIC_V4, "8.8.8.8", "172.32.0.1", "100.63.255.255", "198.20.0.1", "2606:2800:220:1::1", "2001:4860:4860::8888", "::ffff:8.8.8.8"])(
    "allows %s", (address) => { expect(isPublicAddress(address)).toBe(true); });
});

describe("pinned connection", () => {
  it("resolves to private, loopback, metadata and mixed answers: blocked before any connection", async () => {
    for (const bad of [["127.0.0.1"], ["10.0.0.5"], ["169.254.169.254"], ["::1"], ["::ffff:127.0.0.1"], ["fd00::1"],
      ["64:ff9b::7f00:1"], [PUBLIC_V4, "10.0.0.5"], ["10.0.0.5", PUBLIC_V4]]) {
      const { transport, requests } = scripted(() => html("x"));
      const error = await reasonOf(fetchPage("https://shop.example/p", SHOPS, { resolve: resolverFor({ "shop.example": bad }), transport }));
      expect(error.reason, bad.join()).toBe("blocked_address");
      expect(requests).toEqual([]);
    }
  });

  it("hands the checked address to the transport while Host and SNI stay the hostname, also after a redirect", async () => {
    const { transport, requests } = scripted((_req, n) => n === 1
      ? answer(302, { location: "https://www.shop.example/moved?x=1" })
      : html("<p>Hello</p>"));
    const page = await fetchPage("https://shop.example/start", SHOPS, { resolve: resolverFor(ok.shop), transport });
    expect(page.finalUrl).toBe("https://www.shop.example/moved?x=1");
    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({ hostname: "shop.example", servername: "shop.example", address: PUBLIC_V4, family: 4, port: 443, path: "/start" });
    expect(requests[0]!.headers.Host).toBe("shop.example");
    expect(requests[1]).toMatchObject({ hostname: "www.shop.example", servername: "www.shop.example", address: "93.184.216.35", path: "/moved?x=1" });
    expect(requests[1]!.headers.Host).toBe("www.shop.example");
  });

  it("uses an IPv6 family for an IPv6 answer", async () => {
    const { transport, requests } = scripted(() => html("x"));
    await fetchPage("https://shop.example/", SHOPS, { resolve: resolverFor({ "shop.example": ["2606:2800:220:1::1"] }), transport });
    expect(requests[0]).toMatchObject({ address: "2606:2800:220:1::1", family: 6 });
  });

  it("sends only plain headers: no cookie, credentials, referer or compression", async () => {
    const { transport, requests } = scripted(() => html("x"));
    await fetchPage("https://shop.example/", SHOPS, { resolve: resolverFor(ok.shop), transport });
    expect(Object.keys(requests[0]!.headers).sort()).toEqual(["Accept", "Accept-Encoding", "Host", "User-Agent"]);
    expect(requests[0]!.headers["Accept-Encoding"]).toBe("identity");
    expect(requests[0]!.headers["User-Agent"]).toBe("DreamBike-PartCheck/1.0");
  });

  it("answers the pinned lookup in both callback forms", () => {
    const lookup = pinnedLookup("93.184.216.34", 4);
    const all = vi.fn(), single = vi.fn(), legacy = vi.fn();
    lookup("anything.example", { all: true }, all);
    lookup("anything.example", {}, single);
    lookup("anything.example", legacy);
    expect(all).toHaveBeenCalledWith(null, [{ address: "93.184.216.34", family: 4 }]);
    expect(single).toHaveBeenCalledWith(null, "93.184.216.34", 4);
    expect(legacy).toHaveBeenCalledWith(null, "93.184.216.34", 4);
  });

  it("answers with ALL checked public addresses, IPv4 first, and never an unchecked one", () => {
    const lookup = pinnedLookup([
      { address: "2606:4700::1", family: 6 }, { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.1", family: 4 }, { address: "93.184.216.40", family: 4 },
    ]);
    const all = vi.fn(), single = vi.fn(), legacy = vi.fn();
    lookup("h.example", { all: true }, all);
    lookup("h.example", {}, single);
    lookup("h.example", legacy);
    expect(all).toHaveBeenCalledWith(null, [
      { address: "93.184.216.34", family: 4 }, { address: "93.184.216.40", family: 4 }, { address: "2606:4700::1", family: 6 }]);
    expect(single).toHaveBeenCalledWith(null, "93.184.216.34", 4);
    expect(legacy).toHaveBeenCalledWith(null, "93.184.216.34", 4);
    const v6only = vi.fn();
    pinnedLookup([{ address: "2606:4700::1", family: 6 }])("h.example", {}, v6only);
    expect(v6only).toHaveBeenCalledWith(null, "2606:4700::1", 6);
    const none = vi.fn();
    pinnedLookup([{ address: "127.0.0.1", family: 4 }])("h.example", { all: true }, none);
    expect(none.mock.calls[0]![0]).toBeInstanceOf(Error);
  });

  it("hands the transport every checked address, IPv4 first", async () => {
    const { transport, requests } = scripted(() => answer(200, { "content-type": "text/html" }, "<p>x</p>"));
    await fetchPage("https://shop.example/", SHOPS, {
      resolve: resolverFor({ "shop.example": ["2606:4700::1", PUBLIC_V4] }), transport });
    expect(requests[0]!.address).toBe(PUBLIC_V4);
    expect(requests[0]!.addresses).toEqual([{ address: PUBLIC_V4, family: 4 }, { address: "2606:4700::1", family: 6 }]);
  });
});

describe("redirects", () => {
  const redirectTo = (location: string) => answer(301, { location });

  it("refuses a redirect to a private address, a non-allowlisted host and http", async () => {
    for (const [location, reason] of [
      ["https://10.0.0.5/x", "blocked_host"], ["https://other.example/x", "blocked_host"], ["http://shop.example/x", "bad_url"],
    ] as const) {
      const { transport, requests } = scripted(() => redirectTo(location));
      const error = await reasonOf(fetchPage("https://shop.example/", SHOPS, { resolve: resolverFor(ok.shop), transport }));
      expect(error.reason).toBe(reason);
      expect(requests).toHaveLength(1);
    }
  });

  it("refuses an allowlisted host that now resolves to a private address", async () => {
    const { transport, requests } = scripted(() => redirectTo("https://www.shop.example/x"));
    const resolve = resolverFor({ "shop.example": [PUBLIC_V4], "www.shop.example": ["192.168.0.9"] });
    const error = await reasonOf(fetchPage("https://shop.example/", SHOPS, { resolve, transport }));
    expect(error.reason).toBe("blocked_address");
    expect(requests).toHaveLength(1);
  });

  it("resolves a relative Location against the current URL", async () => {
    const { transport, requests } = scripted((_r, n) => (n === 1 ? redirectTo("../other/page?a=b") : html("x")));
    const page = await fetchPage("https://shop.example/dir/sub/start", SHOPS, { resolve: resolverFor(ok.shop), transport });
    expect(page.finalUrl).toBe("https://shop.example/dir/other/page?a=b");
    expect(requests[1]!.path).toBe("/dir/other/page?a=b");
  });

  it("allows three redirects and refuses the fourth", async () => {
    const three = scripted((_r, n) => (n <= 3 ? redirectTo(`/hop${n}`) : html("done")));
    expect((await fetchPage("https://shop.example/", SHOPS, { resolve: resolverFor(ok.shop), transport: three.transport })).text).toBe("done");
    const four = scripted((_r, n) => redirectTo(`/hop${n}`));
    const error = await reasonOf(fetchPage("https://shop.example/", SHOPS, { resolve: resolverFor(ok.shop), transport: four.transport }));
    expect(error.reason).toBe("too_many_redirects");
    expect(four.requests).toHaveLength(4);
  });

  it("refuses a redirect without a Location", async () => {
    const { transport } = scripted(() => answer(302, {}));
    expect((await reasonOf(fetchPage("https://shop.example/", SHOPS, { resolve: resolverFor(ok.shop), transport }))).reason).toBe("http_status");
  });
});

describe("limits and types", () => {
  const run = (response: () => TransportResponse, kind: "page" | "image" = "page") => {
    const { transport } = scripted(response);
    const options = { resolve: resolverFor(ok.shop), transport };
    return kind === "page" ? fetchPage("https://shop.example/", SHOPS, options) : fetchImage("https://shop.example/a.png", SHOPS, options);
  };

  it("aborts a page body over 1 MB and an image over 2 MB, counting raw bytes", async () => {
    let destroyed = false;
    const big = (n: number, type: string) => () => ({
      ...answer(200, { "content-type": type }, [new Uint8Array(n / 2 + 1), new Uint8Array(n / 2 + 1)]),
      destroy: () => { destroyed = true; },
    });
    expect((await reasonOf(run(big(1_000_000, "text/html")))).reason).toBe("too_large");
    expect(destroyed).toBe(true);
    expect((await reasonOf(run(big(2_000_000, "image/png"), "image"))).reason).toBe("too_large");
    // Exactly at the limit is fine.
    expect(((await run(() => answer(200, { "content-type": "text/html" }, new Uint8Array(1_000_000).fill(32)))) as { text: string }).text).toBe("");
  });

  it("refuses a declared oversize Content-Length without reading", async () => {
    expect((await reasonOf(run(() => answer(200, { "content-type": "text/html", "content-length": "1000001" })))).reason).toBe("too_large");
  });

  it("refuses compressed answers and wrong content types", async () => {
    expect((await reasonOf(run(() => html("x", { "content-encoding": "gzip" })))).reason).toBe("encoding");
    expect((await run(() => html("x", { "content-encoding": "identity" }))).status).toBe(200);
    expect((await reasonOf(run(() => answer(200, { "content-type": "application/json" }, "{}")))).reason).toBe("wrong_type");
    expect((await reasonOf(run(() => answer(200, { "content-type": "image/gif" }, "GIF"), "image"))).reason).toBe("wrong_type");
    expect((await reasonOf(run(() => answer(200, { "content-type": "text/html" }, "<p>"), "image"))).reason).toBe("wrong_type");
    const webp = new TextEncoder().encode("RIFF\u0004\u0000\u0000\u0000WEBP");
    const image = await run(() => answer(200, { "content-type": "image/webp" }, webp), "image");
    expect(image).toMatchObject({ mime: "image/webp", status: 200 });
    expect(Array.from((image as { bytes: Uint8Array }).bytes)).toEqual(Array.from(webp));
  });

  it("maps a transport failure to network and an error status to http_status", async () => {
    const failing: Transport = async () => { throw new Error("ECONNRESET"); };
    expect((await reasonOf(fetchPage("https://shop.example/", SHOPS, { resolve: resolverFor(ok.shop), transport: failing }))).reason).toBe("network");
    const gone = await reasonOf(run(() => answer(404, {})));
    expect(gone).toMatchObject({ reason: "http_status", status: 404 });
    expect(await reasonOf(fetchPage("https://shop.example/", SHOPS, { resolve: resolverFor({}), transport: failing }))).toMatchObject({ reason: "network" });
  });

  it("keeps one 5 s style budget across hops and for a hung connection", async () => {
    const slowHop = scripted(async (_r, n) => {
      await new Promise((r) => setTimeout(r, 40));
      return answer(302, { location: `/hop${n}` });
    });
    const error = await reasonOf(fetchPage("https://shop.example/", SHOPS, { resolve: resolverFor(ok.shop), transport: slowHop.transport, budgetMs: 100 }));
    expect(error.reason).toBe("timeout");
    expect(slowHop.requests.length).toBeLessThan(4);
    const hung: Transport = () => new Promise<TransportResponse>(() => undefined);
    expect((await reasonOf(fetchPage("https://shop.example/", SHOPS, { resolve: resolverFor(ok.shop), transport: hung, budgetMs: 30 }))).reason).toBe("timeout");
    const hungDns: Resolver = () => new Promise(() => undefined);
    expect((await reasonOf(fetchPage("https://shop.example/", SHOPS, { resolve: hungDns, transport: hung, budgetMs: 30 }))).reason).toBe("timeout");
  });
});

describe("image bytes must match the declared type", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
  const gif = new TextEncoder().encode("GIF89a\u0001\u0000\u0001\u0000");
  const svg = new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>");
  const fetchAs = async (type: string, body: Uint8Array) => {
    const { transport } = scripted(() => answer(200, { "content-type": type }, body));
    return fetchImage("https://shop.example/a.png", SHOPS, { resolve: resolverFor(ok.shop), transport });
  };

  it("sniffs WebP, JPEG and PNG and nothing else", () => {
    expect(sniffImage(png)).toBe("image/png");
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImage(new TextEncoder().encode("RIFF\u0000\u0000\u0000\u0000WEBPVP8 "))).toBe("image/webp");
    expect(sniffImage(gif)).toBeNull();
    expect(sniffImage(svg)).toBeNull();
    expect(sniffImage(new Uint8Array())).toBeNull();
  });

  it("refuses GIF or SVG bytes labeled image/png, and PNG bytes labeled image/jpeg", async () => {
    expect((await reasonOf(fetchAs("image/png", gif))).reason).toBe("wrong_type");
    expect((await reasonOf(fetchAs("image/png", svg))).reason).toBe("wrong_type");
    expect((await reasonOf(fetchAs("image/jpeg", png))).reason).toBe("wrong_type");
    expect((await fetchAs("image/png", png)).mime).toBe("image/png");
  });
});

describe("page text and JSON-LD", () => {
  const page = (body: string | Uint8Array, headers: Record<string, string> = {}) =>
    fetchPage("https://shop.example/", SHOPS, { resolve: resolverFor(ok.shop), transport: scripted(() => answer(200, { "content-type": "text/html", ...headers }, body)).transport });

  it("decodes with the Content-Type charset and falls back to utf-8", async () => {
    const latin1 = new Uint8Array([...new TextEncoder().encode("<p>Preis 5 "), 0xe4, 0x6f, 0x3c, 0x2f, 0x70, 0x3e]); // "ao" with a-umlaut
    const decoded = await page(latin1, { "content-type": "text/html; charset=iso-8859-1" });
    expect(decoded.text).toBe("Preis 5 äo");
    expect((await page("<p>ok</p>", { "content-type": "text/html; charset=nonsense-9" })).text).toBe("ok");
  });

  it("keeps visible text only: script, style, noscript, template and svg content is dropped, tags are inert", async () => {
    const result = await page(`<html><head><style>.a{color:red}</style><script>var secret = "IGNORE PREVIOUS";</script></head>
      <body><!-- hidden note --><h1>Taller &amp; wider bar</h1><noscript>no js</noscript><template><p>tpl</p></template>
      <svg><text>vector</text></svg><p>Price&nbsp;&#8364;&#x31;29,00 &lt;script&gt;alert(1)&lt;/script&gt;</p><script>unterminated`);
    expect(result.text).toBe("Taller & wider bar Price €129,00 <script>alert(1)</script>");
    expect(visibleText("a".repeat(20_000))).toHaveLength(12_000);
  });

  it("parses JSON-LD products and offers, including @graph and arrays", async () => {
    const ld = (v: unknown) => `<script type="application/ld+json">${JSON.stringify(v)}</script>`;
    const result = await page(`<body>${ld({ "@context": "https://schema.org", "@graph": [
      { "@type": "WebSite", name: "Shop" },
      { "@type": "Product", name: "Bar X", brand: { "@type": "Brand", name: "Acme" }, sku: "S-1", mpn: "M-1",
        offers: { "@type": "Offer", price: "129.00", priceCurrency: "EUR" } },
    ] })}${ld([{ "@type": ["Thing", "Product"], name: "Bar Y", offers: [
      { price: 99.5, priceCurrency: "EUR" }, { price: "120", priceCurrency: "USD" }] }])}
      <script type='application/ld+json'>{ not json </script></body>`);
    expect(result.jsonLdOffers).toEqual([
      { name: "Bar X", brand: "Acme", sku: "S-1", mpn: "M-1", price: "129.00", currency: "EUR", kind: "product" },
      { name: "Bar Y", brand: null, sku: null, mpn: null, price: "99.5", currency: "EUR", kind: "product" },
      { name: "Bar Y", brand: null, sku: null, mpn: null, price: "120", currency: "USD", kind: "product" },
    ]);
    expect((await page("<script type=\"application/ld+json\">{broken</script><p>x</p>")).jsonLdOffers).toEqual([]);
  });

  const timed = (work: () => unknown) => {
    const t0 = performance.now();
    work();
    return performance.now() - t0;
  };
  const MB = 1_000_000;
  const BASE = new URL("https://shop.example/");

  it("scans hostile markup in linear time (no ReDoS)", () => {
    expect(timed(() => visibleText("<a".repeat(MB / 2)))).toBeLessThan(1500);
    expect(timed(() => visibleText("<svg>".repeat(MB / 5)))).toBeLessThan(1500);
    expect(timed(() => visibleText("<!--".repeat(MB / 4)))).toBeLessThan(1500);
    expect(timed(() => visibleText("<p ".repeat(MB / 3) + ">"))).toBeLessThan(1500);
    expect(timed(() => extractJsonLdOffers("<script type=application/ld+json".repeat(Math.floor(MB / 32))))).toBeLessThan(1500);
    expect(timed(() => extractJsonLdOffers("<script type=application/ld+json>x</script".repeat(Math.floor(MB / 42))))).toBeLessThan(1500);
    expect(timed(() => extractImageUrls("<meta ".repeat(MB / 6), BASE))).toBeLessThan(1500);
    expect(timed(() => extractImageUrls("<meta " + "a".repeat(MB) + ">", BASE))).toBeLessThan(1500);
  });

  it("keeps the drop semantics: an unclosed dropped element drops the rest, earlier text stays", () => {
    expect(visibleText("before <svg><g>never closed")).toBe("before");
    expect(visibleText("a <b>b</b> <script>x</script> c < d <i")).toBe("a b c < d <i");
    expect(visibleText("x <STYLE>p{}</STYLE > y")).toBe("x y");
  });

  it("treats self-closing svg and template as empty elements that swallow nothing", () => {
    expect(visibleText('<p>one</p><svg class="icon" /><p>two</p><template id="t"/><p>three</p>')).toBe("one two three");
    expect(visibleText("<svg/>kept <template/>too")).toBe("kept too");
    expect(visibleText("<svg><circle/></svg>after")).toBe("after");
  });

  it("returns image URLs from og:image, twitter:image and JSON-LD Product image only", async () => {
    const ld = (v: unknown) => `<script type="application/ld+json">${JSON.stringify(v)}</script>`;
    const result = await page(`<head>
      <meta property="og:image" content="https://cdn.shop.example/a.jpg?x=1&amp;y=2">
      <meta name="og:image" content="/rel/b.png">
      <meta name='twitter:image' content='//cdn.shop.example/c.webp'>
      <meta property="og:image" content="https://cdn.shop.example/a.jpg?x=1&y=2">
      <meta property="og:image" content="http://insecure.example/d.jpg">
      <meta property="og:image" content="javascript:alert(1)">
      <meta property="og:image" content="https://cdn.shop.example/${"z".repeat(2100)}.jpg">
      <meta property="og:title" content="https://cdn.shop.example/not-an-image.jpg">
      <meta content="https://cdn.shop.example/reordered.jpg" property="og:image">
      </head><img src="https://cdn.shop.example/inline.jpg">${ld({ "@type": "Product", name: "P",
      image: ["https://cdn.shop.example/ld1.jpg", { "@type": "ImageObject", url: "/ld2.jpg" }, { contentUrl: "https://cdn.shop.example/ld3.jpg" }] })}
      ${ld({ "@type": "Product", name: "Q", image: "https://cdn.shop.example/ld4.jpg" })}`);
    expect(result.imageUrls).toEqual([
      "https://cdn.shop.example/a.jpg?x=1&y=2", "https://shop.example/rel/b.png", "https://cdn.shop.example/c.webp",
      "https://cdn.shop.example/reordered.jpg", "https://cdn.shop.example/ld1.jpg", "https://shop.example/ld2.jpg",
      "https://cdn.shop.example/ld3.jpg", "https://cdn.shop.example/ld4.jpg",
    ]);
  });

  it("caps image URLs at 10 and resolves against the final URL after redirects", async () => {
    const metas = Array.from({ length: 30 }, (_, i) => `<meta property="og:image" content="/i${i}.jpg">`).join("");
    expect((await page(metas)).imageUrls).toHaveLength(10);
    const { transport } = scripted((_req, n) => n === 1
      ? answer(301, { location: "https://www.shop.example/deep/page" })
      : answer(200, { "content-type": "text/html" }, '<meta property="og:image" content="pic.jpg">'));
    const redirected = await fetchPage("https://shop.example/", SHOPS, { resolve: resolverFor(ok.shop), transport });
    expect(redirected.imageUrls).toEqual(["https://www.shop.example/deep/pic.jpg"]);
  });

  it("labels each offer: product, variant, aggregate_low, list_item (inside @graph)", async () => {
    const ld = (v: unknown) => `<script type="application/ld+json">${JSON.stringify(v)}</script>`;
    const result = await page(ld({ "@context": "https://schema.org", "@graph": [
      { "@type": "BreadcrumbList" },
      { "@type": "Product", name: "Main", offers: { "@type": "Offer", price: "100", priceCurrency: "EUR" },
        hasVariant: [{ "@type": "Product", name: "Var", offers: { price: "110", priceCurrency: "EUR" } }],
        isSimilarTo: { "@type": "Product", name: "Similar", offers: { price: "5", priceCurrency: "EUR" } } },
      { "@type": "ProductGroup", name: "Group", hasVariant: [{ "@type": "Product", name: "GVar", offers: { price: "7", priceCurrency: "EUR" } }] },
      { "@type": "Product", name: "Range", offers: { "@type": "AggregateOffer", lowPrice: "20", highPrice: "90", priceCurrency: "EUR" } },
      { "@type": "ItemList", itemListElement: [{ "@type": "ListItem", item: { "@type": "Product", name: "Listed", offers: { price: "3", priceCurrency: "EUR" } } }] },
    ] }));
    const pick = (name: string) => result.jsonLdOffers.filter((o) => o.name === name).map((o) => [o.kind, o.price]);
    expect(pick("Main")).toEqual([["product", "100"]]);
    expect(pick("Var")).toEqual([["variant", "110"]]);
    expect(pick("GVar")).toEqual([["variant", "7"]]);
    expect(pick("Similar")).toEqual([["list_item", "5"]]);
    expect(pick("Listed")).toEqual([["list_item", "3"]]);
    expect(pick("Range")).toEqual([["aggregate_low", "20"]]);
    expect(result.jsonLdOffers.some((o) => o.price === "90")).toBe(false); // highPrice is never a price
  });

  it("bounds the JSON-LD walk", async () => {
    let deep: unknown = { "@type": "Product", name: "Too deep", offers: { price: "1" } };
    for (let i = 0; i < 20; i++) deep = { "@graph": [deep] };
    expect((await page(`<script type="application/ld+json">${JSON.stringify(deep)}</script>`)).jsonLdOffers).toEqual([]);
    const many = { "@graph": Array.from({ length: 100 }, (_, i) => ({ "@type": "Product", name: `P${i}`, offers: { price: String(i) } })) };
    expect((await page(`<script type="application/ld+json">${JSON.stringify(many)}</script>`)).jsonLdOffers).toHaveLength(20);
  });
});

describe("link state and error mapping", () => {
  const err = (reason: ConstructorParameters<typeof FetchError>[0], status: number | null = null) => new FetchError(reason, "shop.example", status);

  it("maps one bounded GET to a link state", () => {
    expect(linkStateOf(null)).toBe("reachable");
    expect(linkStateOf(err("http_status", 404))).toBe("unreachable");
    expect(linkStateOf(err("http_status", 410))).toBe("unreachable");
    for (const status of [403, 405, 429, 500, 503]) expect(linkStateOf(err("http_status", status)), String(status)).toBe("unchecked");
    expect(linkStateOf(err("timeout"))).toBe("unchecked");
    expect(linkStateOf(err("network"))).toBe("unchecked");
  });

  it("maps failures to app errors with a host-naming reason", () => {
    for (const reason of ["blocked_host", "blocked_address", "bad_url", "too_many_redirects"] as const) {
      expect(toAppError(err(reason)).code, reason).toBe("FETCH_BLOCKED");
    }
    expect(toAppError(err("timeout")).code).toBe("UPSTREAM_TIMEOUT");
    expect(toAppError(err("network")).code).toBe("UPSTREAM_UNAVAILABLE");
    expect(toAppError(err("http_status", 503)).code).toBe("UPSTREAM_UNAVAILABLE");
    expect(toAppError(err("http_status", 404)).code).toBe("UPSTREAM_REJECTED");
    expect(toAppError(err("too_large")).code).toBe("UPSTREAM_REJECTED");
    expect(humanReason(err("timeout"))).toContain("shop.example");
    expect(humanReason(new FetchError("blocked_host", "bad host\nwith <b>"))).not.toContain("<b>");
  });
});

// ------------------------------------------------------------------ /api/product-image
const ORIGIN = "http://localhost:3000";
const LIVE_ENV: Record<string, string> = {
  NODE_ENV: "test", VERCEL_ENV: "", MOCK: "0", LIVE_API_ENABLED: "true", MODEL_API_KEY: "k",
  UPSTASH_REDIS_REST_URL: "https://redis.invalid", UPSTASH_REDIS_REST_TOKEN: "t", PRICING_VERIFIED_AT: "2026-10-28",
  VISITOR_HASH_SECRET: "s".repeat(32), BUDGET_TICKET: "T3", PUBLIC_SHOP_DOMAINS: "shop.example www.shop.example",
};
const post = (body: unknown, headers: Record<string, string> = {}, raw?: string) =>
  POST(new Request(`${ORIGIN}/api/product-image`, { method: "POST", body: raw ?? JSON.stringify(body),
    headers: withSession({ Origin: ORIGIN, "X-Request-Id": crypto.randomUUID(), ...headers }) }));
const good = { url: "https://shop.example/p/1.jpg", rightsConfirmed: true };
/** A JSON body of exactly `size` bytes (ASCII padding in an extra field). */
const bodyOfBytes = (size: number) => {
  const base = JSON.stringify({ ...good, pad: "" });
  return JSON.stringify({ ...good, pad: "x".repeat(size - base.length) });
};
const errorOf = async (res: Response) => [res.status, ErrorResponse.parse(await res.json()).error.code] as const;

describe("POST /api/product-image", () => {
  let metaSpy: ReturnType<typeof vi.spyOn>;
  let photo: Uint8Array;
  beforeEach(async () => {
    resetQuotaLimitersForTests();
    imageOverride.fn = null;
    for (const [k, v] of Object.entries(LIVE_ENV)) vi.stubEnv(k, v);
    metaSpy = vi.spyOn(globalThis, "fetch");
    photo = new Uint8Array(await sharp({ create: { width: 400, height: 300, channels: 3, background: { r: 10, g: 80, b: 160 } } }).png().toBuffer());
  });
  afterEach(() => { imageOverride.fn = null; vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  const injectPhoto = () => {
    const fn = vi.fn(async () => ({ finalUrl: "https://shop.example/p/1.jpg", status: 200, mime: "image/png", bytes: photo }));
    imageOverride.fn = fn;
    return fn;
  };

  it("refuses a foreign origin (403) and an oversize body (413) before anything else", async () => {
    const fn = injectPhoto();
    vi.stubEnv("PUBLIC_SHOP_DOMAINS", "");
    expect((await errorOf(await post(good, { Origin: "https://evil.example" }))).slice(0, 1)).toEqual([403]);
    expect(await errorOf(await post(null, {}, bodyOfBytes(8_001)))).toEqual([413, "TOO_LARGE"]);
    expect(fn).not.toHaveBeenCalled();
  });

  it("does not refuse a body of exactly 8,000 bytes as TOO_LARGE", async () => {
    injectPhoto();
    const raw = bodyOfBytes(8_000);
    expect(new TextEncoder().encode(raw).byteLength).toBe(8_000);
    expect((await post(null, {}, raw)).status).not.toBe(413);
  });

  it("rejects invalid bodies", async () => {
    expect((await errorOf(await post(null, {}, "not json")))[0]).toBe(400);
    expect((await errorOf(await post({ url: good.url, rightsConfirmed: false })))[0]).toBe(400);
    expect((await errorOf(await post({ url: "http://shop.example/a.jpg", rightsConfirmed: true })))[0]).toBe(400);
  });

  it("is LIVE_DISABLED when not live and FEATURE_DISABLED without a valid allowlist", async () => {
    const fn = injectPhoto();
    vi.stubEnv("LIVE_API_ENABLED", "false");
    expect(await errorOf(await post(good))).toEqual([503, "LIVE_DISABLED"]);
    vi.stubEnv("LIVE_API_ENABLED", "true");
    vi.stubEnv("PUBLIC_SHOP_DOMAINS", "");
    const res = await post(good);
    expect(await errorOf(res.clone())).toEqual([503, "FEATURE_DISABLED"]);
    expect(JSON.stringify(await res.json())).toContain("by hand");
    vi.stubEnv("PUBLIC_SHOP_DOMAINS", "shop.example, Bad.Example");
    expect(await errorOf(await post(good))).toEqual([503, "FEATURE_DISABLED"]);
    vi.stubEnv("PUBLIC_SHOP_DOMAINS", LIVE_ENV.PUBLIC_SHOP_DOMAINS);
    vi.stubEnv("REFERENCE_MODE_ENABLED", "false");
    const off = await post(good);
    expect(await errorOf(off.clone())).toEqual([503, "FEATURE_DISABLED"]);
    expect(JSON.stringify(await off.json())).toContain("Reference photos are switched off");
    expect(fn).not.toHaveBeenCalled();
  });

  it("refuses a blocked URL with zero transport calls and without using up the free-fetch allowance", async () => {
    const fn = injectPhoto();
    for (let i = 0; i < FREE_FETCH_PER_MINUTE + 2; i++) {
      expect(await errorOf(await post({ ...good, url: "https://other.example/a.jpg" }))).toEqual([403, "FETCH_BLOCKED"]);
    }
    expect(fn).not.toHaveBeenCalled();
    expect((await post(good)).status).toBe(200);
  });

  it("returns the normalized photo with external_runtime rights; no Meta or Redis call", async () => {
    const fn = injectPhoto();
    const res = await post(good);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = ProductImageResponse.parse(await res.json());
    expect(body.rights).toBe("external_runtime");
    expect(body.image).toMatchObject({ mime: "image/webp", width: 400, height: 300 });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(metaSpy).not.toHaveBeenCalled();
  });

  it("rates limit after the per-minute allowance", async () => {
    injectPhoto();
    for (let i = 0; i < FREE_FETCH_PER_MINUTE; i++) expect((await post(good)).status).toBe(200);
    const res = await post(good);
    expect(res.status).toBe(429);
    const error = ErrorResponse.parse(await res.json()).error;
    expect(error.code).toBe("RATE_LIMITED");
    expect(error.retryAfterSeconds).toBeGreaterThan(0);
    expect(metaSpy).not.toHaveBeenCalled();
  });

  it("maps a fetch failure and a too-small photo to safe errors", async () => {
    imageOverride.fn = async () => { throw new FetchError("timeout", "shop.example"); };
    expect(await errorOf(await post(good))).toEqual([504, "UPSTREAM_TIMEOUT"]);
    const tiny = new Uint8Array(await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png().toBuffer());
    imageOverride.fn = async () => ({ finalUrl: good.url, status: 200, mime: "image/png", bytes: tiny });
    const res = await post(good);
    expect(await errorOf(res.clone())).toEqual([400, "INVALID_IMAGE"]);
    expect(JSON.stringify(await res.json())).toContain("product photo");
  });

  it("mock mode returns a labeled placeholder and never fetches", async () => {
    const fn = injectPhoto();
    vi.stubEnv("MOCK", "1");
    vi.stubEnv("PUBLIC_SHOP_DOMAINS", "");
    const res = await post(good);
    expect(res.status).toBe(200);
    const body = ProductImageResponse.parse(await res.json());
    expect(body.rights).toBe("external_runtime");
    expect(body.image.width).toBeGreaterThanOrEqual(256);
    expect(fn).not.toHaveBeenCalled();
    expect(metaSpy).not.toHaveBeenCalled();
  });
});
