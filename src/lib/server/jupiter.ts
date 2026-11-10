import "server-only";
import { z } from "zod";
import { proxiedIconUrl, DEFAULT_ICON_HOSTS, sanitizeName, sanitizeSymbol, sanitizeText } from "@/lib/tokens/sanitize";
import { SPL_TOKEN_PROGRAM, TOKEN_2022_PROGRAM, type TokenInfo } from "@/lib/tokens/types";
import { mintInformationSchema, orderResponseSchema, executeResponseSchema, priceResponseSchema, tokenSearchResponseSchema } from "@/lib/swap/jupiter-schema";
import { EXCLUDED_ROUTERS } from "@/lib/tx/programs";
import { serverEnv } from "./env";
import { parseWith, upstreamJson, UpstreamError } from "./http";

function base(): string {
  return serverEnv().JUPITER_API_BASE.replace(/\/+$/, "");
}

function headers(): Record<string, string> {
  const key = serverEnv().JUPITER_API_KEY;
  return key ? { "x-api-key": key } : {};
}

export function iconHosts(): readonly string[] {
  const extra = (serverEnv().NOCT_ICON_HOSTS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return [...DEFAULT_ICON_HOSTS, ...extra];
}

export function toTokenInfo(raw: z.infer<typeof mintInformationSchema>): TokenInfo {
  const program = raw.tokenProgram === SPL_TOKEN_PROGRAM ? "spl" : raw.tokenProgram === TOKEN_2022_PROGRAM ? "token2022" : "unknown";
  return {
    mint: raw.id,
    symbol: sanitizeSymbol(raw.symbol),
    name: sanitizeName(raw.name),
    decimals: raw.decimals,
    icon: proxiedIconUrl(raw.icon),
    tokenProgram: program,
    tokenProgramId: raw.tokenProgram ?? null,
    verified: raw.isVerified === true,
    tags: (raw.tags ?? []).map((t) => sanitizeText(t, 32)).filter(Boolean).slice(0, 12),
    organicScore: typeof raw.organicScore === "number" ? raw.organicScore : null,
    organicScoreLabel: raw.organicScoreLabel ?? null,
    audit: raw.audit
      ? {
          isSus: raw.audit.isSus === true,
          mintAuthorityDisabled: raw.audit.mintAuthorityDisabled ?? null,
          freezeAuthorityDisabled: raw.audit.freezeAuthorityDisabled ?? null,
          topHoldersPercentage: raw.audit.topHoldersPercentage ?? null,
          devBalancePercentage: raw.audit.devBalancePercentage ?? null,
        }
      : null,
    mintAuthority: raw.mintAuthority ?? null,
    freezeAuthority: raw.freezeAuthority ?? null,
    usdPrice: typeof raw.usdPrice === "number" && Number.isFinite(raw.usdPrice) && raw.usdPrice > 0 ? raw.usdPrice.toString() : null,
    priceBlockId: raw.priceBlockId ?? null,
    liquidityUsd: raw.liquidity ?? null,
    holderCount: raw.holderCount ?? null,
    launchpad: raw.launchpad ? sanitizeText(raw.launchpad, 40) : null,
    createdAt: raw.createdAt ?? null,
    updatedAt: raw.updatedAt ?? null,
    source: "jupiter",
  };
}

export async function searchTokens(query: string, signal?: AbortSignal): Promise<TokenInfo[]> {
  const url = `${base()}/tokens/v2/search?query=${encodeURIComponent(query)}`;
  const { status, data } = await upstreamJson(url, { service: "jupiter-tokens", headers: headers(), timeoutMs: 6_000, retries: 1, signal });
  if (status !== 200) throw new UpstreamError("status", "jupiter-tokens", `Token search returned ${status}`, status);
  return parseWith(tokenSearchResponseSchema, data, "jupiter-tokens").map(toTokenInfo);
}

export async function fetchPrices(mints: readonly string[]): Promise<Record<string, { usdPrice: string; blockId: number | null }>> {
  if (mints.length === 0) return {};
  const url = `${base()}/price/v3?ids=${mints.slice(0, 50).join(",")}`;
  const { status, data } = await upstreamJson(url, { service: "jupiter-price", headers: headers(), timeoutMs: 5_000, retries: 1 });
  if (status !== 200) throw new UpstreamError("status", "jupiter-price", `Price API returned ${status}`, status);
  const parsed = parseWith(priceResponseSchema, data, "jupiter-price");
  const out: Record<string, { usdPrice: string; blockId: number | null }> = {};
  for (const [mint, entry] of Object.entries(parsed)) {
    if (Number.isFinite(entry.usdPrice) && entry.usdPrice > 0) out[mint] = { usdPrice: entry.usdPrice.toString(), blockId: entry.blockId ?? null };
  }
  return out;
}

export interface OrderParams {
  inputMint: string;
  outputMint: string;
  amount: string;
  taker?: string;
  slippageBps?: number;
}

export async function fetchOrder(params: OrderParams, signal?: AbortSignal) {
  const q = new URLSearchParams({
    inputMint: params.inputMint,
    outputMint: params.outputMint,
    amount: params.amount,
    swapMode: "ExactIn",
    // NOCT cannot verify the settlement programs of these routers.
    excludeRouters: EXCLUDED_ROUTERS.join(","),
    maxSupportedTransactionVersion: "0",
  });
  if (params.taker) q.set("taker", params.taker);
  if (params.slippageBps !== undefined) q.set("slippageBps", String(params.slippageBps));
  const url = `${base()}/swap/v2/order?${q.toString()}`;
  const { status, data } = await upstreamJson(url, { service: "jupiter-swap", headers: headers(), timeoutMs: 8_000, retries: params.taker ? 0 : 1, signal });
  if (status === 400) {
    const message = typeof (data as { error?: unknown })?.error === "string" ? sanitizeText((data as { error: string }).error, 200) : "No route for this pair.";
    throw new UpstreamError("status", "jupiter-swap", message, 400, { noRoute: /route|liquidity|not tradable|no market/i.test(message) });
  }
  if (status !== 200) throw new UpstreamError("status", "jupiter-swap", `Swap API returned ${status}`, status);
  return parseWith(orderResponseSchema, data, "jupiter-swap");
}

export async function executeOrder(body: { signedTransaction: string; requestId: string; lastValidBlockHeight?: string }) {
  const url = `${base()}/swap/v2/execute`;
  // Not retried here: the client reconciles by signature before any resend.
  const { status, data } = await upstreamJson(url, { service: "jupiter-execute", method: "POST", headers: headers(), body, timeoutMs: 30_000, retries: 0 });
  if (status !== 200) {
    const parsed = executeResponseSchema.safeParse(data);
    if (parsed.success) return parsed.data;
    throw new UpstreamError("status", "jupiter-execute", `Execute returned ${status}`, status);
  }
  return parseWith(executeResponseSchema, data, "jupiter-execute");
}

// --------------------------------------------------------------------------
// Jupiter Lend
// --------------------------------------------------------------------------

const intStr = z.string().regex(/^-?\d{1,40}$/);
const addr = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);

export const earnTokenSchema = z.object({
  id: z.number().int(),
  address: addr,
  name: z.string().max(200).optional().default(""),
  symbol: z.string().max(64),
  decimals: z.number().int().min(0).max(24),
  assetAddress: addr,
  asset: z.object({
    address: addr.optional(),
    name: z.string().max(200).optional(),
    symbol: z.string().max(64),
    decimals: z.number().int().min(0).max(24),
    logo_url: z.string().max(600).optional().nullable(),
    price: z.string().max(64).optional().nullable(),
  }),
  totalAssets: intStr,
  totalSupply: intStr,
  convertToShares: intStr,
  convertToAssets: intStr,
  rewardsRate: intStr,
  supplyRate: intStr,
  totalRate: intStr,
  liquiditySupplyData: z
    .object({
      withdrawalLimit: intStr.optional(),
      withdrawable: intStr.optional(),
      lastUpdateTimestamp: z.union([intStr, z.number()]).optional(),
    })
    .partial()
    .optional(),
});

export async function fetchEarnTokens() {
  const { status, data } = await upstreamJson(`${base()}/lend/v1/earn/tokens`, { service: "jupiter-lend", headers: headers(), timeoutMs: 8_000, retries: 1 });
  if (status !== 200) throw new UpstreamError("status", "jupiter-lend", `Earn tokens returned ${status}`, status);
  return parseWith(z.array(earnTokenSchema).max(500), data, "jupiter-lend");
}

export const earnPositionSchema = z
  .object({
    token: z.object({ address: addr, assetAddress: addr.optional() }).partial().passthrough().optional(),
    ownerAddress: addr.optional(),
    shares: intStr.optional(),
    underlyingAssets: intStr.optional(),
    underlyingBalance: intStr.optional(),
  })
  .passthrough();

export async function fetchEarnPositions(user: string) {
  const { status, data } = await upstreamJson(`${base()}/lend/v1/earn/positions?users=${user}`, { service: "jupiter-lend", headers: headers(), timeoutMs: 8_000, retries: 1 });
  if (status !== 200) throw new UpstreamError("status", "jupiter-lend", `Earn positions returned ${status}`, status);
  return parseWith(z.array(earnPositionSchema).max(200), data, "jupiter-lend");
}

export async function buildEarnTransaction(action: "deposit" | "withdraw", body: { asset: string; signer: string; amount: string }) {
  const { status, data } = await upstreamJson(`${base()}/lend/v1/earn/${action}`, { service: "jupiter-lend", method: "POST", headers: headers(), body, timeoutMs: 10_000 });
  if (status !== 200) throw new UpstreamError("status", "jupiter-lend", `Earn ${action} returned ${status}`, status);
  return parseWith(z.object({ transaction: z.string().min(16).max(20_000) }).passthrough(), data, "jupiter-lend");
}

const tokenSchema = z.object({
  address: addr,
  symbol: z.string().max(64),
  uiSymbol: z.string().max(64).optional(),
  name: z.string().max(200).optional(),
  decimals: z.number().int().min(0).max(24),
  logoUrl: z.string().max(600).optional().nullable(),
  price: z.string().max(64).optional().nullable(),
});

export const vaultSchema = z.object({
  id: z.number().int(),
  address: addr,
  supplyToken: tokenSchema,
  borrowToken: tokenSchema,
  collateralFactor: intStr,
  liquidationThreshold: intStr,
  liquidationMaxLimit: intStr,
  liquidationPenalty: intStr,
  borrowFee: intStr.optional().default("0"),
  supplyRate: intStr.optional().default("0"),
  borrowRate: intStr.optional().default("0"),
  borrowable: intStr.optional().default("0"),
  withdrawable: intStr.optional().default("0"),
  minimumBorrowing: intStr.optional().default("0"),
  oracle: z.string().max(64).optional(),
  oraclePrice: intStr,
  oracleTimestamp: z.number().int().optional(),
  oracleSources: z
    .array(z.object({ source: z.string().max(64), invert: z.boolean().optional(), sourceType: z.record(z.string(), z.unknown()).optional() }).passthrough())
    .max(8)
    .optional()
    .default([]),
  totalPositions: z.number().int().optional(),
});

export async function fetchVaults() {
  const { status, data } = await upstreamJson(`${base()}/lend/v1/borrow/vaults`, { service: "jupiter-lend", headers: headers(), timeoutMs: 10_000, retries: 1, maxBytes: 6_000_000 });
  if (status !== 200) throw new UpstreamError("status", "jupiter-lend", `Vaults returned ${status}`, status);
  return parseWith(z.array(vaultSchema).max(500), data, "jupiter-lend");
}

export const borrowPositionSchema = z
  .object({
    id: z.number().int(),
    vaultId: z.number().int(),
    supply: intStr,
    borrow: intStr,
    dustBorrow: intStr.optional(),
    isLiquidated: z.boolean().optional(),
    isSupplyPosition: z.boolean().optional(),
  })
  .passthrough();

export async function fetchBorrowPositions(user: string) {
  const { status, data } = await upstreamJson(`${base()}/lend/v1/borrow/positions?users=${user}`, { service: "jupiter-lend", headers: headers(), timeoutMs: 10_000, retries: 1, maxBytes: 6_000_000 });
  if (status !== 200) throw new UpstreamError("status", "jupiter-lend", `Borrow positions returned ${status}`, status);
  return parseWith(z.array(borrowPositionSchema).max(500), data, "jupiter-lend");
}

export async function buildOperateTransaction(body: { vaultId: number; positionId: number; signer: string; colAmount: string; debtAmount: string }) {
  const { status, data } = await upstreamJson(`${base()}/lend/v1/borrow/operate`, { service: "jupiter-lend", method: "POST", headers: headers(), body, timeoutMs: 10_000 });
  if (status !== 200) throw new UpstreamError("status", "jupiter-lend", `Operate returned ${status}`, status);
  return parseWith(z.object({ nftId: z.number().int().optional(), transaction: z.string().min(16).max(20_000) }).passthrough(), data, "jupiter-lend");
}
