import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const WEBP = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0, 0]);
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

type Handler = (url: URL, init?: RequestInit) => Response | Promise<Response>;

async function getIcon(source: string, handler: Handler) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: URL | string, init?: RequestInit) => {
      const url = new URL(String(input));
      calls.push(url.toString());
      return handler(url, init);
    }),
  );
  const { GET } = await import("@/app/api/token-icon/route");
  const res = await GET(new NextRequest(`http://localhost:3100/api/token-icon?u=${encodeURIComponent(source)}`, { headers: { "x-forwarded-for": `10.0.0.${Math.floor(Math.random() * 250)}` } }));
  return { res, calls };
}

afterEach(() => vi.unstubAllGlobals());

describe("token icon proxy", () => {
  it("serves an icon from any public host through the image service, as a small raster", async () => {
    const { res, calls } = await getIcon("https://cdn.example.org/coin.svg", (url) => (url.hostname === "wsrv.nl" ? new Response(WEBP, { status: 200 }) : new Response(null, { status: 500 })));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    expect(res.headers.get("cache-control")).toMatch(/s-maxage/);
    const service = new URL(calls[0]!);
    expect(service.hostname).toBe("wsrv.nl");
    expect(service.searchParams.get("url")).toBe("https://cdn.example.org/coin.svg");
    expect(service.searchParams.get("output")).toBe("webp");
  });

  it("falls back to an allowlisted host when the service fails, following redirects within the allowlist", async () => {
    const { res, calls } = await getIcon("https://arweave.net/abc", (url) => {
      if (url.hostname === "wsrv.nl") return new Response("error", { status: 502 });
      if (url.hostname === "arweave.net") return new Response(null, { status: 302, headers: { location: "https://xyz.arweave.net/abc" } });
      return new Response(PNG, { status: 200 });
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(calls.map((c) => new URL(c).hostname)).toEqual(["wsrv.nl", "arweave.net", "xyz.arweave.net"]);
  });

  it("never follows a redirect off the allowlist, and never serves SVG or other non-raster bytes", async () => {
    const offList = await getIcon("https://arweave.net/abc", (url) =>
      url.hostname === "wsrv.nl" ? new Response(null, { status: 500 }) : new Response(null, { status: 302, headers: { location: "https://evil.example/x.png" } }),
    );
    expect(offList.res.status).toBe(404);
    expect(offList.calls.some((c) => c.includes("evil.example") && !c.includes("wsrv.nl"))).toBe(false);

    const svg = await getIcon("https://raw.githubusercontent.com/a/logo.svg", () => new Response(SVG, { status: 200, headers: { "content-type": "image/svg+xml" } }));
    expect(svg.res.status).toBe(404);
  });

  it("does not fetch a host outside the allowlist directly when the service is down", async () => {
    const { res, calls } = await getIcon("https://cdn.example.org/coin.png", () => new Response(null, { status: 503 }));
    expect(res.status).toBe(404);
    expect(calls.every((c) => new URL(c).hostname === "wsrv.nl")).toBe(true);
  });

  it("tries another IPFS gateway when the one the metadata names fails", async () => {
    const cid = "bafkreibk3covs5ltyqxa272uodhculbr6kea6betidfwy3ajsav2vjzyum";
    const { res, calls } = await getIcon(`https://${cid}.ipfs.nftstorage.link/`, (url) => {
      const asked = url.searchParams.get("url") ?? "";
      return url.hostname === "wsrv.nl" && asked.startsWith("https://ipfs.io/") ? new Response(WEBP, { status: 200 }) : new Response(null, { status: 404 });
    });
    expect(res.status).toBe(200);
    expect(calls.map((c) => new URL(c).searchParams.get("url"))).toEqual([`https://${cid}.ipfs.nftstorage.link/`, `https://ipfs.io/ipfs/${cid}`]);
  });

  it("starts the next gateway while a slow one is still running, and stops the slow one once an icon arrives", async () => {
    const cid = "bafkreibk3covs5ltyqxa272uodhculbr6kea6betidfwy3ajsav2vjzyum";
    let stopped = false;
    const startedAt = Date.now();
    const { res, calls } = await getIcon(`https://${cid}.ipfs.nftstorage.link/`, (url, init) => {
      if ((url.searchParams.get("url") ?? "").includes("nftstorage.link")) {
        return new Promise<Response>((_, reject) =>
          init?.signal?.addEventListener("abort", () => {
            stopped = true;
            reject(new DOMException("aborted", "AbortError"));
          }),
        );
      }
      return new Response(WEBP, { status: 200 });
    });
    expect(res.status).toBe(200);
    expect(Date.now() - startedAt).toBeLessThan(3_000);
    expect(calls).toHaveLength(2);
    expect(stopped).toBe(true);
  });

  it("refuses unsafe sources before any request", async () => {
    for (const bad of ["http://cdn.example.org/a.png", "https://127.0.0.1/a.png", "https://localhost/a.png"]) {
      const { res, calls } = await getIcon(bad, () => new Response(PNG));
      expect(res.status).toBe(404);
      expect(calls).toHaveLength(0);
    }
  });
});
