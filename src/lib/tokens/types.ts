export const NATIVE_SOL_MINT = "So11111111111111111111111111111111111111112";
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const SPL_TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

export type TokenProgramKind = "spl" | "token2022" | "unknown";

export interface TokenAudit {
  isSus: boolean;
  mintAuthorityDisabled: boolean | null;
  freezeAuthorityDisabled: boolean | null;
  topHoldersPercentage: number | null;
  devBalancePercentage: number | null;
}

/**
 * Public token identity and market facts. Every string here originated from an
 * untrusted provider and has been sanitised; it is rendered as text only.
 */
export interface TokenInfo {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  /** Proxied icon URL (same-origin) or null when the source host is not allowlisted. */
  icon: string | null;
  tokenProgram: TokenProgramKind;
  tokenProgramId: string | null;
  verified: boolean;
  tags: string[];
  organicScore: number | null;
  organicScoreLabel: "high" | "medium" | "low" | null;
  audit: TokenAudit | null;
  mintAuthority: string | null;
  freezeAuthority: string | null;
  /** Decimal string; null when the provider omitted a reliable price. */
  usdPrice: string | null;
  priceBlockId: number | null;
  liquidityUsd: number | null;
  holderCount: number | null;
  launchpad: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  /** Earn APY reported in token search (Jupiter Lend), informational only. */
  source: "jupiter" | "demo";
}

export type RiskLevel = "info" | "caution" | "danger";

export interface RiskFlag {
  code:
    | "unverified"
    | "suspicious"
    | "freeze_authority"
    | "mint_authority"
    | "token_2022"
    | "low_liquidity"
    | "low_organic_score"
    | "concentrated_holders"
    | "new_token"
    | "no_price"
    | "ticker_collision"
    | "lookalike"
    | "unusual_decimals";
  level: RiskLevel;
  message: string;
}
