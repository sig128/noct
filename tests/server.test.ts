import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { redactUrl } from "@/lib/server/http";
import { logLine } from "@/lib/server/log";
import { toTokenInfo } from "@/lib/server/jupiter";
import { mintInformationSchema } from "@/lib/swap/jupiter-schema";

afterEach(() => vi.restoreAllMocks());

describe("secret and private data never reach logs", () => {
  it("redacts API keys in URLs", () => {
    expect(redactUrl("https://mainnet.helius-rpc.com/?api-key=SECRET123")).toBe("https://mainnet.helius-rpc.com/?api-key=REDACTED");
    expect(redactUrl("https://x.io/a?token=t&ok=1")).toBe("https://x.io/a?token=REDACTED&ok=1");
  });
  it("drops amount, address, mint, signature and key fields from log lines", () => {
    const line = JSON.parse(logLine("event", { status: 200, amount: "123", walletAddress: "abc", mint: "m", signature: "s", apiKey: "k", seedPhrase: "x", ms: 12 }));
    expect(line).toMatchObject({ event: "event", status: 200, ms: 12 });
    for (const k of ["amount", "walletAddress", "mint", "signature", "apiKey", "seedPhrase"]) expect(line).not.toHaveProperty(k);
  });
});

describe("token metadata mapping", () => {
  it("sanitises names, proxies icons from public https hosts and keeps the exact mint", () => {
    const raw = mintInformationSchema.parse({
      id: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
      name: "Bonk‮​",
      symbol: "BONK",
      icon: "https://evil.example/pixel.png",
      decimals: 5,
      tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      isVerified: true,
      usdPrice: 0.00001083,
      organicScore: 98,
      organicScoreLabel: "high",
      tags: ["verified"],
    });
    const t = toTokenInfo(raw);
    expect(t.name).toBe("Bonk");
    // Any public https host is served, through the image proxy; unsafe URLs are dropped.
    expect(t.icon).toBe("/api/token-icon?u=https%3A%2F%2Fevil.example%2Fpixel.png");
    expect(toTokenInfo({ ...raw, icon: "http://evil.example/pixel.png" }).icon).toBeNull();
    expect(t.mint).toBe("DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263");
    expect(t.usdPrice).toBe("0.00001083");
    expect(t.tokenProgram).toBe("spl");
    const proxied = toTokenInfo({ ...raw, icon: "https://raw.githubusercontent.com/x/bonk.png" });
    expect(proxied.icon).toBe("/api/token-icon?u=https%3A%2F%2Fraw.githubusercontent.com%2Fx%2Fbonk.png");
  });
  it("rejects responses with impossible decimals", () => {
    expect(mintInformationSchema.safeParse({ id: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", decimals: 99 }).success).toBe(false);
  });
});

describe("request guards", () => {
  const req = (method: string, headers: Record<string, string>) => new NextRequest("http://localhost:3100/api/spr/mainnet/prover/prove", { method, headers, body: method === "POST" ? "x" : undefined });

  it("accepts the prover's encrypted octet-stream bodies only where allowed", async () => {
    const { sameOriginGuard } = await import("@/lib/server/guard");
    const same = { origin: "http://localhost:3100", host: "localhost:3100", "sec-fetch-site": "same-origin", "content-type": "application/octet-stream" };
    expect(sameOriginGuard(req("POST", same))?.status).toBe(415);
    expect(sameOriginGuard(req("POST", same), { contentTypes: ["application/json", "application/octet-stream"] })).toBeNull();
  });

  it("refuses cross-origin writes and cross-site relay reads", async () => {
    const { crossSiteReadGuard, sameOriginGuard } = await import("@/lib/server/guard");
    const cross = { origin: "https://evil.example", host: "localhost:3100", "sec-fetch-site": "cross-site", "content-type": "application/json" };
    expect(sameOriginGuard(req("POST", cross))?.status).toBe(403);
    expect(crossSiteReadGuard(req("GET", { "sec-fetch-site": "cross-site" }))?.status).toBe(403);
    expect(crossSiteReadGuard(req("GET", { "sec-fetch-site": "same-origin" }))).toBeNull();
    // Non-browser clients send no fetch metadata; rate limits bound them instead.
    expect(crossSiteReadGuard(req("GET", {}))).toBeNull();
  });
});

describe("server configuration", () => {
  it("treats empty assignments as unset so .env.example can be copied verbatim", async () => {
    vi.resetModules();
    const saved = { ...process.env };
    try {
      Object.assign(process.env, { JUPITER_API_BASE: "", SPR_MAINNET_ENABLED: "", PYTH_HERMES_BASE: " " });
      const { serverEnv } = await import("@/lib/server/env");
      const env = serverEnv();
      expect(env.JUPITER_API_BASE).toBe("https://api.jup.ag");
      expect(env.SPR_MAINNET_ENABLED).toBe("false");
      expect(env.PYTH_HERMES_BASE).toBe("https://pyth.dourolabs.app/hermes");
    } finally {
      process.env = saved;
    }
  });
});

describe("mainnet only", () => {
  const sameOrigin = { origin: "http://localhost:3100", host: "localhost:3100", "sec-fetch-site": "same-origin", "content-type": "application/json" };

  it("the RPC relay refuses any other network", async () => {
    const { POST } = await import("@/app/api/rpc/[network]/route");
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getSlot" });
    const res = await POST(new NextRequest("http://localhost:3100/api/rpc/devnet", { method: "POST", headers: sameOrigin, body }), { params: Promise.resolve({ network: "devnet" }) });
    expect(res.status).toBe(400);
  });

  it("the Privacy Rings relay refuses any other network", async () => {
    const { GET } = await import("@/app/api/spr/[network]/[...path]/route");
    const res = await GET(new NextRequest("http://localhost:3100/api/spr/devnet/policy", { headers: { "sec-fetch-site": "same-origin" } }), { params: Promise.resolve({ network: "devnet", path: ["policy"] }) });
    expect(res.status).toBe(400);
  });

  it("uses Helius mainnet RPC when only a Helius key is set", async () => {
    vi.resetModules();
    const saved = { ...process.env };
    try {
      delete process.env.SOLANA_RPC_URL_MAINNET;
      process.env.HELIUS_API_KEY = "test-key-123";
      const { rpcUrl, rpcIsDefaultPublic } = await import("@/lib/server/env");
      expect(rpcUrl()).toBe("https://mainnet.helius-rpc.com/?api-key=test-key-123");
      expect(rpcIsDefaultPublic()).toBe(false);
    } finally {
      process.env = saved;
    }
  });

  it("drops the old network and demo settings when loading stored preferences", async () => {
    const { sanitizeStoredSettings } = await import("@/lib/client/stores");
    expect(sanitizeStoredSettings({ demoMode: true, network: "devnet", maskBalances: true, lockAfterMinutes: 5, slippageBps: 50 })).toEqual({ maskBalances: true, lockAfterMinutes: 5, slippageBps: 50 });
    expect(sanitizeStoredSettings({ lockAfterMinutes: -1, slippageBps: 9_999, maskBalances: "yes" })).toEqual({});
    expect(sanitizeStoredSettings(null)).toEqual({});
  });
});
