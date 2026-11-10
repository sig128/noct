/**
 * DEMO MODE DATA. Everything here is fabricated for presentation, is labelled
 * "Demo" wherever it renders, and cannot reach a wallet or the network. Live
 * code paths never import this module's values.
 */
import { mulDivFloor, parseDecimalRatio, pow10 } from "@/lib/decimal";
import type { JupiterOrderResponse } from "@/lib/swap/jupiter-schema";
import { NATIVE_SOL_MINT, USDC_MINT, type TokenInfo } from "@/lib/tokens/types";
import type { EarnMarketRaw, VaultRaw } from "@/lib/client/api";

const now = "2026-11-10T12:00:00Z";

function token(p: Partial<TokenInfo> & Pick<TokenInfo, "mint" | "symbol" | "name" | "decimals">): TokenInfo {
  return {
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
    usdPrice: null,
    priceBlockId: null,
    liquidityUsd: 50_000_000,
    holderCount: 1_000_000,
    launchpad: null,
    createdAt: "2021-01-01T00:00:00Z",
    updatedAt: now,
    source: "demo",
    ...p,
  };
}

export const DEMO_TOKENS: TokenInfo[] = [
  token({ mint: NATIVE_SOL_MINT, symbol: "SOL", name: "Wrapped SOL", decimals: 9, usdPrice: "81.80094410" }),
  token({ mint: USDC_MINT, symbol: "USDC", name: "USD Coin", decimals: 6, usdPrice: "0.99965775", freezeAuthority: "BJE5MMbqXjVwjAF7oxwPYXnTXDyspzZyt4vwenNw5ruG", audit: { isSus: false, mintAuthorityDisabled: false, freezeAuthorityDisabled: false, topHoldersPercentage: 30, devBalancePercentage: 0 }, mintAuthority: "BJE5MMbqXjVwjAF7oxwPYXnTXDyspzZyt4vwenNw5ruG" }),
  token({ mint: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", symbol: "JUP", name: "Jupiter", decimals: 6, usdPrice: "0.3127" }),
  token({ mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", symbol: "BONK", name: "Bonk", decimals: 5, usdPrice: "0.00001083" }),
  token({ mint: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm", symbol: "WIF", name: "dogwifhat", decimals: 6, usdPrice: "0.4218" }),
  token({
    mint: "DemoMoth1111111111111111111111111111111111",
    symbol: "MOTH",
    name: "Moth by Lamplight",
    decimals: 6,
    verified: false,
    organicScore: 41,
    organicScoreLabel: "medium",
    usdPrice: "0.000412",
    liquidityUsd: 61_200,
    holderCount: 3_412,
    launchpad: "pump.fun",
    createdAt: "2026-11-02T08:00:00Z",
    audit: { isSus: false, mintAuthorityDisabled: true, freezeAuthorityDisabled: true, topHoldersPercentage: 38, devBalancePercentage: 2.4 },
  }),
  token({
    mint: "DemoBonkFake1111111111111111111111111111111",
    symbol: "BONK",
    name: "Bonk",
    decimals: 6,
    verified: false,
    organicScore: 3,
    organicScoreLabel: "low",
    usdPrice: "0.0000002",
    liquidityUsd: 1_900,
    holderCount: 88,
    createdAt: "2026-11-10T03:00:00Z",
    audit: { isSus: true, mintAuthorityDisabled: false, freezeAuthorityDisabled: false, topHoldersPercentage: 96, devBalancePercentage: 71 },
    mintAuthority: "DemoAuth1111111111111111111111111111111111",
    freezeAuthority: "DemoAuth1111111111111111111111111111111111",
  }),
  token({
    mint: "DemoLong1111111111111111111111111111111111",
    symbol: "NIGHTSHIFTLONG",
    name: "The Extraordinarily Long Named Community Token of the Midnight Shift",
    decimals: 12,
    verified: false,
    organicScore: 22,
    organicScoreLabel: "low",
    usdPrice: null,
    liquidityUsd: 8_400,
    holderCount: 410,
    tokenProgram: "token2022",
    createdAt: "2026-10-01T00:00:00Z",
  }),
];

export const DEMO_DEFAULT_MINTS = DEMO_TOKENS.slice(0, 5).map((t) => t.mint);

export function demoSearch(query: string): TokenInfo[] {
  const q = query.trim().toLowerCase();
  if (!q) return DEMO_TOKENS.slice(0, 6);
  return DEMO_TOKENS.filter((t) => t.mint.toLowerCase() === q || t.symbol.toLowerCase().includes(q) || t.name.toLowerCase().includes(q));
}

export function demoToken(mint: string): TokenInfo | undefined {
  return DEMO_TOKENS.find((t) => t.mint === mint);
}

/** Deterministic fake quote from demo prices: 0.20% impact, 0.10% fee, 0.5% slippage. */
export function demoQuote(inputMint: string, outputMint: string, amount: bigint): JupiterOrderResponse | null {
  const a = demoToken(inputMint);
  const b = demoToken(outputMint);
  if (!a?.usdPrice || !b?.usdPrice) return null;
  const pa = parseDecimalRatio(a.usdPrice)!;
  const pb = parseDecimalRatio(b.usdPrice)!;
  const gross = (amount * pa.num * pb.den * pow10(b.decimals)) / (pa.den * pb.num * pow10(a.decimals));
  const out = mulDivFloor(gross, 9_970n, 10_000n);
  const min = mulDivFloor(out, 9_950n, 10_000n);
  return {
    mode: "ultra",
    inputMint,
    outputMint,
    inAmount: amount.toString(),
    outAmount: out.toString(),
    otherAmountThreshold: min.toString(),
    swapMode: "ExactIn",
    slippageBps: 50,
    priceImpact: -0.2,
    routePlan: [
      { swapInfo: { ammKey: "DemoPoo1111111111111111111111111111111111", label: "Demo pool", inputMint, outputMint, inAmount: amount.toString(), outAmount: out.toString() }, bps: 10_000 },
    ],
    feeBps: 10,
    feeMint: outputMint,
    platformFee: null,
    signatureFeeLamports: 5_000,
    prioritizationFeeLamports: 41_000,
    rentFeeLamports: 0,
    router: "metis",
    transactionVersion: 0,
    transaction: null,
    requestId: `demo-${Date.now()}`,
    taker: null,
  };
}

export const DEMO_WALLET = "Demo4dd7ess111111111111111111111111111111";

export const DEMO_PUBLIC_BALANCES: { mint: string; amount: bigint }[] = [
  { mint: NATIVE_SOL_MINT, amount: 12_480_000_000n },
  { mint: USDC_MINT, amount: 1_250_400_000n },
  { mint: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", amount: 845_120_000n },
  { mint: "DemoMoth1111111111111111111111111111111111", amount: 2_400_000_000_000n },
];

export const DEMO_PRIVATE_BALANCES: { mint: string; amount: bigint; notes: number }[] = [
  { mint: USDC_MINT, amount: 640_000_000n, notes: 3 },
  { mint: NATIVE_SOL_MINT, amount: 3_100_000_000n, notes: 2 },
];

export const DEMO_EARN_MARKETS: EarnMarketRaw[] = [
  {
    id: 2,
    address: "DemoJLusdc111111111111111111111111111111111",
    name: "Demo Lend USDC",
    symbol: "jlUSDC",
    decimals: 6,
    assetAddress: USDC_MINT,
    asset: { symbol: "USDC", decimals: 6, price: "0.99965" },
    totalAssets: "476073742453614",
    totalSupply: "445298611794235",
    convertToShares: "935356",
    convertToAssets: "1069111",
    rewardsRate: "25",
    supplyRate: "445",
    totalRate: "470",
    liquiditySupplyData: { withdrawalLimit: "237150750425203", withdrawable: "51507634650231", lastUpdateTimestamp: "1794330838" },
  },
  {
    id: 3,
    address: "DemoJLso11111111111111111111111111111111111",
    name: "Demo Lend SOL",
    symbol: "jlWSOL",
    decimals: 9,
    assetAddress: NATIVE_SOL_MINT,
    asset: { symbol: "WSOL", decimals: 9, price: "81.80" },
    totalAssets: "280387586518452",
    totalSupply: "266968803765014",
    convertToShares: "952141998",
    convertToAssets: "1050263513",
    rewardsRate: "0",
    supplyRate: "364",
    totalRate: "364",
    liquiditySupplyData: { withdrawalLimit: "210294111444230", withdrawable: "70098037148075", lastUpdateTimestamp: "1794330145" },
  },
];

export const DEMO_EARN_POSITIONS = [{ receiptMint: "DemoJLusdc111111111111111111111111111111111", assetMint: USDC_MINT, shares: 280_640_000n }];

export function demoVaults(nowMs: number): VaultRaw[] {
  return [
    {
      id: 1,
      address: "DemoVau1t11111111111111111111111111111111111",
      supplyToken: { address: NATIVE_SOL_MINT, symbol: "SOL", decimals: 9, price: "81.80" },
      borrowToken: { address: USDC_MINT, symbol: "USDC", decimals: 6, price: "0.9996" },
      collateralFactor: "800",
      liquidationThreshold: "850",
      liquidationMaxLimit: "900",
      liquidationPenalty: "100",
      borrowFee: "0",
      supplyRate: "393",
      borrowRate: "654",
      borrowable: "17608002774539",
      withdrawable: "353519396344965",
      minimumBorrowing: "1061434",
      oracle: "DemoQrac1e1111111111111111111111111111111111",
      oraclePrice: "81830000000000000",
      oracleTimestamp: nowMs - 42_000,
      oracleSources: [{ source: "DemoSource11111111111111111111111111111111", invert: false, sourceType: { chainlink: {} } }],
      totalPositions: 10_359,
    },
    {
      id: 2,
      address: "DemoVau1t21111111111111111111111111111111111",
      supplyToken: { address: NATIVE_SOL_MINT, symbol: "SOL", decimals: 9, price: "81.80" },
      borrowToken: { address: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", symbol: "USDT", decimals: 6, price: "0.9989" },
      collateralFactor: "800",
      liquidationThreshold: "850",
      liquidationMaxLimit: "900",
      liquidationPenalty: "100",
      borrowFee: "0",
      supplyRate: "393",
      borrowRate: "499",
      borrowable: "2628506211950",
      withdrawable: "65261992850314",
      minimumBorrowing: "1054194",
      oraclePrice: "81890000000000000",
      oracleTimestamp: nowMs - 2 * 3_600_000,
      oracleSources: [{ source: "DemoSource11111111111111111111111111111111", invert: false, sourceType: { chainlink: {} } }],
      totalPositions: 2_198,
    },
  ];
}

export const DEMO_BORROW_POSITIONS = [{ id: 7012, vaultId: 1, supply: "2000000000", borrow: "61250000", dustBorrow: null, isLiquidated: false }];
