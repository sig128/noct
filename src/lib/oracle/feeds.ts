import { NATIVE_SOL_MINT, USDC_MINT } from "@/lib/tokens/types";

/**
 * Verified mapping from mint to Pyth price feed id. Ids were read from
 * Hermes /v2/price_feeds on 2026-11-10. A mint without an entry has no
 * independent oracle in NOCT; it is never guessed from the symbol.
 */
export const PYTH_FEEDS: Record<string, { feedId: string; symbol: string }> = {
  [NATIVE_SOL_MINT]: { feedId: "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d", symbol: "Crypto.SOL/USD" },
  [USDC_MINT]: { feedId: "eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a", symbol: "Crypto.USDC/USD" },
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: { feedId: "2b89b9dc8fdf9f34709a5b106b472f0f39bb6ca9ce04b0fd7f2e971688e2e53b", symbol: "Crypto.USDT/USD" },
  JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN: { feedId: "0a0408d619e9380abad35060f9192039ed5042fa6f82301d0e48bb52be830996", symbol: "Crypto.JUP/USD" },
  DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263: { feedId: "72b021217ca3fe68922a19aaf990109cb9d84e9ad004b4d2025ad6f529314419", symbol: "Crypto.BONK/USD" },
  EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm: { feedId: "4ca4beeca86f0d164160323817a4e42b10010a724c2217c6ee41b54cd4cc61fc", symbol: "Crypto.WIF/USD" },
  HzwqbKZw8HxMN6bF2yFZNrht3c2iXXzpKcFu7uBEDKtr: { feedId: "76fa85158bf14ede77087fe3ae472f66213f6ea2f5b411cb2de472794990fa5c", symbol: "Crypto.EURC/USD" },
  J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn: { feedId: "67be9f519b95cf24338801051f9a808eff0a578ccb388db73b7f6fe1de019ffb", symbol: "Crypto.JITOSOL/USD" },
  mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So: { feedId: "c2289a6a43d2ce91c6f55caec370f4acc38a2ed477f58813334c6d03749ff2a4", symbol: "Crypto.MSOL/USD" },
};

export function feedForMint(mint: string): { feedId: string; symbol: string } | null {
  return PYTH_FEEDS[mint] ?? null;
}
