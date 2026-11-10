import type { RiskFlag, TokenInfo } from "./types";

/**
 * Collapses characters that render alike (Cyrillic/Greek homoglyphs, digits
 * used as letters, full-width forms) so "UЅDC" and "U5DC" compare equal to
 * "USDC". Used only to detect impersonation, never to rename a token.
 */
const CONFUSABLES: Record<string, string> = {
  а: "A", А: "A", Α: "A", в: "B", В: "B", Β: "B", с: "C", С: "C", Ϲ: "C", е: "E", Е: "E", Ε: "E",
  н: "H", Н: "H", Η: "H", і: "I", І: "I", Ι: "I", ӏ: "I", ј: "J", Ј: "J", к: "K", К: "K", Κ: "K",
  м: "M", М: "M", Μ: "M", о: "O", О: "O", Ο: "O", р: "P", Р: "P", Ρ: "P", ѕ: "S", Ѕ: "S",
  т: "T", Т: "T", Τ: "T", х: "X", Х: "X", Χ: "X", у: "Y", У: "Y", Υ: "Y", ν: "V", Ζ: "Z",
  "0": "O", "1": "I", "3": "E", "4": "A", "5": "S", "7": "T", "8": "B", $: "S", "|": "I",
};

/**
 * Canonical skeleton. A lowercase "l" is ambiguous (it imitates "I" in most
 * sans-serif faces but is also a plain L), so it maps to L here and
 * `skeletonVariants` adds the I reading.
 */
export function skeletonTicker(symbol: string, lowercaseL: "L" | "I" = "L"): string {
  const folded = symbol.normalize("NFKC");
  let out = "";
  for (const ch of folded) {
    const mapped = ch === "l" ? lowercaseL : (CONFUSABLES[ch] ?? ch.toUpperCase());
    if (/[A-Z0-9]/.test(mapped)) out += mapped;
  }
  return out;
}

export function skeletonVariants(symbol: string): string[] {
  const a = skeletonTicker(symbol, "L");
  const b = skeletonTicker(symbol, "I");
  return a === b ? [a] : [a, b];
}

export interface IdentityAnnotation {
  mint: string;
  flags: RiskFlag[];
  /** Verified token this one shares (or imitates) a ticker with. */
  imitates: { mint: string; symbol: string } | null;
}

/**
 * Annotates a result set so duplicate tickers and impersonators are visible.
 * A verified token never receives a collision flag from an unverified one.
 * `reference` lets callers add well-known verified tokens that may not be in
 * the current result page.
 */
export function annotateIdentity(results: readonly TokenInfo[], reference: readonly TokenInfo[] = []): Map<string, IdentityAnnotation> {
  const verifiedBySkeleton = new Map<string, TokenInfo>();
  for (const token of [...reference, ...results]) {
    if (!token.verified) continue;
    const key = skeletonTicker(token.symbol);
    if (key && !verifiedBySkeleton.has(key)) verifiedBySkeleton.set(key, token);
  }
  const bySymbol = new Map<string, TokenInfo[]>();
  for (const token of results) {
    const key = token.symbol.toUpperCase();
    bySymbol.set(key, [...(bySymbol.get(key) ?? []), token]);
  }

  const out = new Map<string, IdentityAnnotation>();
  for (const token of results) {
    const flags: RiskFlag[] = [];
    let imitates: IdentityAnnotation["imitates"] = null;
    const verifiedTwin = skeletonVariants(token.symbol)
      .map((key) => verifiedBySkeleton.get(key))
      .find((t): t is TokenInfo => Boolean(t));
    if (!token.verified && verifiedTwin && verifiedTwin.mint !== token.mint) {
      const exactSame = verifiedTwin.symbol.toUpperCase() === token.symbol.toUpperCase();
      imitates = { mint: verifiedTwin.mint, symbol: verifiedTwin.symbol };
      flags.push(
        exactSame
          ? {
              code: "ticker_collision",
              level: "danger",
              message: `Uses the ticker of verified ${verifiedTwin.symbol} but has a different mint. Compare the mint address before trading.`,
            }
          : {
              code: "lookalike",
              level: "danger",
              message: `Ticker looks like verified ${verifiedTwin.symbol}. Characters differ; this is a different token.`,
            },
      );
    } else if (!token.verified && (bySymbol.get(token.symbol.toUpperCase())?.length ?? 0) > 1) {
      flags.push({
        code: "ticker_collision",
        level: "caution",
        message: "Several tokens use this ticker. Identify it by mint address, not by name.",
      });
    }
    out.set(token.mint, { mint: token.mint, flags, imitates });
  }
  return out;
}

/** Stable ordering: exact mint match first, then verified, then organic score. */
export function rankTokens(results: readonly TokenInfo[], query: string): TokenInfo[] {
  const q = query.trim();
  const qUpper = q.toUpperCase();
  const score = (t: TokenInfo): number => {
    let s = 0;
    if (t.mint === q) s += 10_000;
    if (t.symbol.toUpperCase() === qUpper) s += 400;
    if (t.verified) s += 1_000;
    if (t.audit?.isSus) s -= 2_000;
    s += Math.round(t.organicScore ?? 0);
    return s;
  };
  return [...results].sort((a, b) => score(b) - score(a) || a.symbol.localeCompare(b.symbol) || a.mint.localeCompare(b.mint));
}
