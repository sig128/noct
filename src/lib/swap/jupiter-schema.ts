import { z } from "zod";

const intString = z.string().regex(/^\d{1,40}$/, "expected an integer string");
const address = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "expected a base58 address");

export const routePlanStepSchema = z.object({
  swapInfo: z.object({
    ammKey: z.string().max(64),
    label: z.string().max(80).optional().default(""),
    inputMint: address,
    outputMint: address,
    inAmount: intString,
    outAmount: intString,
  }),
  percent: z.number().optional(),
  bps: z.number().optional(),
  usdValue: z.number().optional(),
});

/** GET /swap/v2/order — fields per developers.jup.ag/docs/api-reference/swap/order (2026-11-10). */
export const orderResponseSchema = z.object({
  mode: z.string().optional(),
  inputMint: address,
  outputMint: address,
  inAmount: intString,
  outAmount: intString,
  otherAmountThreshold: intString.optional(),
  swapMode: z.string().optional(),
  slippageBps: z.number().int().min(0).max(10_000).optional(),
  priceImpact: z.number().optional(),
  priceImpactPct: z.string().optional(),
  inUsdValue: z.number().optional(),
  outUsdValue: z.number().optional(),
  routePlan: z.array(routePlanStepSchema).max(32).optional().default([]),
  feeBps: z.number().int().min(0).max(10_000).optional().default(0),
  feeMint: address.optional(),
  platformFee: z
    .object({ amount: intString.optional(), feeBps: z.number().optional(), feeMint: address.optional() })
    .nullable()
    .optional(),
  signatureFeeLamports: z.number().int().nonnegative().optional().default(0),
  signatureFeePayer: z.string().nullable().optional(),
  prioritizationFeeLamports: z.number().int().nonnegative().optional().default(0),
  prioritizationFeePayer: z.string().nullable().optional(),
  rentFeeLamports: z.number().int().nonnegative().optional().default(0),
  rentFeePayer: z.string().nullable().optional(),
  router: z.string().max(32).optional().default("unknown"),
  transactionVersion: z.union([z.literal(0), z.literal(1)]).optional(),
  transaction: z.string().max(20_000).nullable().optional(),
  lastValidBlockHeight: z.union([intString, z.number().int()]).optional(),
  gasless: z.boolean().optional(),
  requestId: z.string().max(200).optional(),
  totalTime: z.number().optional(),
  taker: z.string().nullable().optional(),
  quoteId: z.string().optional(),
  maker: z.string().optional(),
  expireAt: z.string().optional(),
  errorCode: z.number().optional(),
  errorMessage: z.string().max(500).optional(),
  error: z.string().max(500).optional(),
});

export type JupiterOrderResponse = z.infer<typeof orderResponseSchema>;

/** POST /swap/v2/execute response. */
export const executeResponseSchema = z.object({
  status: z.enum(["Success", "Failed"]),
  signature: z.string().max(100).optional(),
  code: z.number().int(),
  error: z.string().max(500).optional(),
  totalInputAmount: intString.optional(),
  totalOutputAmount: intString.optional(),
  inputAmountResult: intString.optional(),
  outputAmountResult: intString.optional(),
});

export type JupiterExecuteResponse = z.infer<typeof executeResponseSchema>;

/** Tokens API v2 MintInformation (subset NOCT uses). */
export const mintInformationSchema = z.object({
  id: address,
  name: z.string().max(400).optional().default(""),
  symbol: z.string().max(200).optional().default(""),
  icon: z.string().max(1000).nullable().optional(),
  decimals: z.number().int().min(0).max(24),
  tokenProgram: z.string().max(64).optional(),
  createdAt: z.string().max(64).nullable().optional(),
  mintAuthority: z.string().max(64).nullable().optional(),
  freezeAuthority: z.string().max(64).nullable().optional(),
  launchpad: z.string().max(80).nullable().optional(),
  holderCount: z.number().nullable().optional(),
  usdPrice: z.number().nullable().optional(),
  priceBlockId: z.number().nullable().optional(),
  liquidity: z.number().nullable().optional(),
  mcap: z.number().nullable().optional(),
  audit: z
    .object({
      isSus: z.boolean().nullable().optional(),
      mintAuthorityDisabled: z.boolean().nullable().optional(),
      freezeAuthorityDisabled: z.boolean().nullable().optional(),
      topHoldersPercentage: z.number().nullable().optional(),
      devBalancePercentage: z.number().nullable().optional(),
    })
    .nullable()
    .optional(),
  organicScore: z.number().optional(),
  organicScoreLabel: z.enum(["high", "medium", "low"]).optional(),
  isVerified: z.boolean().nullable().optional(),
  tags: z.array(z.string().max(64)).max(50).nullable().optional(),
  updatedAt: z.string().max(64).optional(),
});

export const tokenSearchResponseSchema = z.array(mintInformationSchema).max(200);

/** Price API v3: object keyed by mint; tokens without a reliable price are omitted. */
export const priceResponseSchema = z.record(
  z.string(),
  z.object({
    usdPrice: z.number(),
    blockId: z.number().nullable().optional(),
    decimals: z.number().int().optional(),
    priceChange24h: z.number().nullable().optional(),
    liquidity: z.number().optional(),
  }),
);
