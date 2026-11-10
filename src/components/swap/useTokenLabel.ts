"use client";

import { useTokensByMint } from "@/lib/client/hooks";
import { shortAddress } from "@/lib/tokens/sanitize";
import { NATIVE_SOL_MINT, type TokenInfo } from "@/lib/tokens/types";

export interface TokenLabel {
  symbol: string;
  name: string;
  decimals: number;
  known: boolean;
  token: TokenInfo | null;
}

/** Display facts for a mint from cached public metadata. Unknown mints show a short address. */
export function useTokenLabel(mint: string): TokenLabel {
  const q = useTokensByMint([mint]);
  const token = q.data?.find((t) => t.mint === mint) ?? null;
  if (token) return { symbol: token.symbol, name: token.name, decimals: token.decimals, known: true, token };
  if (mint === NATIVE_SOL_MINT) return { symbol: "SOL", name: "Solana", decimals: 9, known: true, token: null };
  return { symbol: shortAddress(mint), name: "Unknown token", decimals: 0, known: false, token: null };
}
