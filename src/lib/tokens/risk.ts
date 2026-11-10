import type { RiskFlag, TokenInfo } from "./types";

const DAY_MS = 86_400_000;

/**
 * Plain-language risk notes derived from provider data. These are signals,
 * not verdicts: absence of a flag is not evidence that a token is safe.
 */
export function assessTokenRisk(token: TokenInfo, now: number = Date.now()): RiskFlag[] {
  const flags: RiskFlag[] = [];
  if (token.audit?.isSus) {
    flags.push({ code: "suspicious", level: "danger", message: "The token data provider has flagged this token as suspicious." });
  }
  if (!token.verified) {
    flags.push({ code: "unverified", level: "caution", message: "Not verified by the token data provider." });
  }
  if (token.freezeAuthority || token.audit?.freezeAuthorityDisabled === false) {
    flags.push({ code: "freeze_authority", level: "caution", message: "The issuer can freeze token accounts, including yours." });
  }
  if (token.mintAuthority || token.audit?.mintAuthorityDisabled === false) {
    flags.push({ code: "mint_authority", level: "caution", message: "The issuer can mint more supply." });
  }
  if (token.tokenProgram === "token2022") {
    flags.push({ code: "token_2022", level: "info", message: "Token-2022 mint. Extensions are inspected before any transfer." });
  }
  if (token.liquidityUsd !== null && token.liquidityUsd < 25_000) {
    flags.push({ code: "low_liquidity", level: "caution", message: "Thin liquidity. Larger trades move the price." });
  }
  if (token.organicScoreLabel === "low") {
    flags.push({ code: "low_organic_score", level: "caution", message: "Trading activity looks largely non-organic." });
  }
  const top = token.audit?.topHoldersPercentage;
  if (typeof top === "number" && top >= 50) {
    flags.push({ code: "concentrated_holders", level: "caution", message: `Top holders own ${Math.round(top)}% of supply.` });
  }
  if (token.createdAt) {
    const created = Date.parse(token.createdAt);
    if (Number.isFinite(created) && now - created < DAY_MS) {
      flags.push({ code: "new_token", level: "caution", message: "Created less than a day ago." });
    }
  }
  if (token.usdPrice === null) {
    flags.push({ code: "no_price", level: "info", message: "No reliable USD price. Values are shown in token units only." });
  }
  if (token.decimals === 0 || token.decimals > 12) {
    flags.push({ code: "unusual_decimals", level: "info", message: `Uses ${token.decimals} decimals.` });
  }
  return flags;
}

export function worstLevel(flags: readonly RiskFlag[]): "none" | RiskFlag["level"] {
  if (flags.some((f) => f.level === "danger")) return "danger";
  if (flags.some((f) => f.level === "caution")) return "caution";
  if (flags.length > 0) return "info";
  return "none";
}
