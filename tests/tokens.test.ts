import { describe, expect, it } from "vitest";
import { annotateIdentity, rankTokens, skeletonTicker } from "@/lib/tokens/identity";
import { assessTokenRisk } from "@/lib/tokens/risk";
import { iconCandidates, isAllowedIconUrl, normalizeIconUrl, proxiedIconUrl, sanitizeName, sanitizeSymbol, sanitizeText } from "@/lib/tokens/sanitize";
import { NATIVE_SOL_MINT, type TokenInfo } from "@/lib/tokens/types";

const base: TokenInfo = {
  mint: NATIVE_SOL_MINT,
  symbol: "SOL",
  name: "Wrapped SOL",
  decimals: 9,
  icon: null,
  tokenProgram: "spl",
  tokenProgramId: null,
  verified: true,
  tags: [],
  organicScore: 90,
  organicScoreLabel: "high",
  audit: { isSus: false, mintAuthorityDisabled: true, freezeAuthorityDisabled: true, topHoldersPercentage: 18, devBalancePercentage: 0 },
  mintAuthority: null,
  freezeAuthority: null,
  usdPrice: "81.80094410",
  priceBlockId: null,
  liquidityUsd: 50_000_000,
  holderCount: 1_000_000,
  launchpad: null,
  createdAt: "2021-01-01T00:00:00Z",
  updatedAt: "2026-11-10T12:00:00Z",
  source: "jupiter",
};
function tok(p: Partial<TokenInfo>): TokenInfo {
  return { ...base, ...p };
}

describe("untrusted metadata", () => {
  it("strips bidi overrides and zero-width characters", () => {
    expect(sanitizeText("US‮DC", 20)).toBe("USDC");
    expect(sanitizeText("B​O‍NK", 20)).toBe("BONK");
    expect(sanitizeText("a\u0000b\u0007c", 20)).toBe("abc");
  });
  it("bounds length so names cannot break layout", () => {
    expect(Array.from(sanitizeName("x".repeat(500))).length).toBe(64);
    expect(sanitizeSymbol("")).toBe("UNKNOWN");
  });
  it("keeps HTML as inert text", () => {
    expect(sanitizeText("<img src=x onerror=alert(1)>", 64)).toBe("<img src=x onerror=alert(1)>");
  });
  it("only allows https icons from allowlisted hosts", () => {
    expect(isAllowedIconUrl("https://raw.githubusercontent.com/a/b.png")).not.toBeNull();
    expect(isAllowedIconUrl("https://sub.arweave.net/x")).not.toBeNull();
    expect(isAllowedIconUrl("http://raw.githubusercontent.com/a/b.png")).toBeNull();
    expect(isAllowedIconUrl("https://evil.example/x.png")).toBeNull();
    expect(isAllowedIconUrl("https://user:pw@arweave.net/x")).toBeNull();
    expect(isAllowedIconUrl("https://arweave.net.evil.example/x")).toBeNull();
    expect(isAllowedIconUrl("javascript:alert(1)")).toBeNull();
  });
  it("accepts icons from any public https host, through the same-origin proxy", () => {
    expect(proxiedIconUrl("https://cdn.example.org/coin.png")).toBe("/api/token-icon?u=https%3A%2F%2Fcdn.example.org%2Fcoin.png");
    // The metadata's own spelling is kept (image caches key on it); ipfs:// becomes a gateway URL.
    const cid = "bafkreibk3covs5ltyqxa272uodhculbr6kea6betidfwy3ajsav2vjzyum";
    expect(proxiedIconUrl(` https://${cid}.ipfs.nftstorage.link `)).toBe(`/api/token-icon?u=${encodeURIComponent(`https://${cid}.ipfs.nftstorage.link`)}`);
    expect(proxiedIconUrl(`ipfs://${cid}`)).toBe(`/api/token-icon?u=${encodeURIComponent(`https://ipfs.io/ipfs/${cid}`)}`);
    for (const bad of ["http://cdn.example.org/a.png", "https://user:pw@cdn.example.org/a.png", "https://cdn.example.org:8443/a.png", "https://127.0.0.1/a.png", "https://2130706433/a.png", "https://[::1]/a.png", "https://localhost/a.png", "https://printer.local/a.png", "https://intranet/a.png", "data:image/png;base64,AAAA", `https://cdn.example.org/${"a".repeat(600)}`]) {
      expect(normalizeIconUrl(bad), bad).toBeNull();
    }
  });
  it("tries IPFS icons on other public gateways after the one the metadata names", () => {
    const v1 = "bafkreibk3covs5ltyqxa272uodhculbr6kea6betidfwy3ajsav2vjzyum";
    const v0 = "QmT5NvUtoM5nWFfrQdVrFtvGfKFmG7AHE8P34isapyhCxX";
    const sub = normalizeIconUrl(`https://${v1}.ipfs.nftstorage.link/`)!;
    expect(sub.toString()).toBe(`https://${v1}.ipfs.nftstorage.link/`);
    expect(iconCandidates(sub).map(String)).toEqual([`https://${v1}.ipfs.nftstorage.link/`, `https://ipfs.io/ipfs/${v1}`, `https://dweb.link/ipfs/${v1}`, `https://w3s.link/ipfs/${v1}`]);
    const path = normalizeIconUrl(`https://ipfs.io/ipfs/${v0}/logo.png`)!;
    expect(iconCandidates(path).map(String)).toEqual([`https://ipfs.io/ipfs/${v0}/logo.png`, `https://dweb.link/ipfs/${v0}/logo.png`, `https://w3s.link/ipfs/${v0}/logo.png`]);
    expect(normalizeIconUrl(`ipfs://${v0}`)?.toString()).toBe(`https://ipfs.io/ipfs/${v0}`);
    expect(normalizeIconUrl(`ipfs://ipfs/${v1}/a.png`)?.toString()).toBe(`https://ipfs.io/ipfs/${v1}/a.png`);
    expect(normalizeIconUrl("ipfs://not-a-cid")).toBeNull();
    expect(iconCandidates(new URL("https://cdn.example.org/a.png")).map(String)).toEqual(["https://cdn.example.org/a.png"]);
  });
});

describe("ticker collisions and impersonation", () => {
  const verified = tok({ mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", symbol: "BONK", verified: true });
  it("flags an unverified token reusing a verified ticker", () => {
    const fake = tok({ mint: "DemoBonkFake1111111111111111111111111111111", symbol: "BONK", verified: false });
    const ann = annotateIdentity([verified, fake]);
    expect(ann.get(fake.mint)!.flags[0]!.code).toBe("ticker_collision");
    expect(ann.get(fake.mint)!.imitates!.mint).toBe(verified.mint);
    expect(ann.get(verified.mint)!.flags).toHaveLength(0);
  });
  it("detects Cyrillic, digit and lowercase-l lookalikes", () => {
    expect(skeletonTicker("ВОNК")).toBe("BONK");
    expect(skeletonTicker("B0NK")).toBe("BONK");
    const wif = tok({ mint: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm", symbol: "WIF", verified: true });
    const lookalike = tok({ mint: "Demo1ook11111111111111111111111111111111111", symbol: "WlF", verified: false });
    const ann = annotateIdentity([lookalike], [wif]);
    expect(ann.get(lookalike.mint)!.flags[0]!.code).toBe("lookalike");
  });
  it("ranks exact mint matches first, then verified", () => {
    const fake = tok({ mint: "DemoBonkFake1111111111111111111111111111111", symbol: "BONK", verified: false, organicScore: 99 });
    expect(rankTokens([fake, verified], "bonk")[0]!.mint).toBe(verified.mint);
    expect(rankTokens([verified, fake], fake.mint)[0]!.mint).toBe(fake.mint);
  });
});

describe("risk notes", () => {
  it("flags authorities, thin liquidity, concentration, freshness and missing prices", () => {
    const now = Date.parse("2026-11-10T12:00:00Z");
    const t = tok({
      verified: false,
      freezeAuthority: "DemoAuth1111111111111111111111111111111111",
      mintAuthority: "DemoAuth1111111111111111111111111111111111",
      liquidityUsd: 1_000,
      createdAt: "2026-11-10T03:00:00Z",
      usdPrice: null,
      audit: { isSus: true, mintAuthorityDisabled: false, freezeAuthorityDisabled: false, topHoldersPercentage: 96, devBalancePercentage: 71 },
    });
    const codes = assessTokenRisk(t, now).map((f) => f.code);
    expect(codes).toEqual(expect.arrayContaining(["suspicious", "unverified", "freeze_authority", "mint_authority", "low_liquidity", "concentrated_holders", "new_token", "no_price"]));
  });
});
