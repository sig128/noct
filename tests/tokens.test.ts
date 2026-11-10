import { describe, expect, it } from "vitest";
import { annotateIdentity, rankTokens, skeletonTicker } from "@/lib/tokens/identity";
import { assessTokenRisk } from "@/lib/tokens/risk";
import { isAllowedIconUrl, sanitizeName, sanitizeSymbol, sanitizeText } from "@/lib/tokens/sanitize";
import { DEMO_TOKENS } from "@/lib/adapters/demo";
import type { TokenInfo } from "@/lib/tokens/types";

const base = DEMO_TOKENS[0]!;
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
