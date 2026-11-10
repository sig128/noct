import { parseBaseUnits } from "@/lib/decimal";
import type { SwapIntent, Network } from "@/lib/operations/intent";
import { ROUTER_PROGRAMS } from "@/lib/tx/programs";
import type { JupiterOrderResponse } from "./jupiter-schema";

export interface RouteLeg {
  label: string;
  ammKey: string;
  inputMint: string;
  outputMint: string;
  inAmount: bigint;
  outAmount: bigint;
  bps: number | null;
}

export interface SwapQuote {
  inputMint: string;
  outputMint: string;
  inAmount: bigint;
  outAmount: bigint;
  /** Minimum output the transaction enforces (after slippage, platform fee excluded). */
  minOut: bigint;
  slippageBps: number;
  priceImpactPct: number | null;
  router: string;
  mode: string | null;
  route: RouteLeg[];
  feeBps: number;
  feeMint: string | null;
  platformFeeAmount: bigint | null;
  signatureFeeLamports: bigint;
  prioritizationFeeLamports: bigint;
  rentFeeLamports: bigint;
  gasless: boolean;
  requestId: string | null;
  /** Base64 transaction when a taker was supplied. */
  transaction: string | null;
  transactionVersion: 0 | 1 | null;
  lastValidBlockHeight: bigint | null;
  /** RFQ quotes carry an explicit expiry. */
  expireAt: number | null;
  receivedAt: number;
  errorCode: number | null;
  errorMessage: string | null;
  /** Accounts other than the taker that sign at execution (RFQ maker, gasless sponsor). */
  coSigners: string[];
}

export class QuoteNormalizeError extends Error {}

export function normalizeOrder(order: JupiterOrderResponse, receivedAt = Date.now()): SwapQuote {
  const inAmount = parseBaseUnits(order.inAmount);
  const outAmount = parseBaseUnits(order.outAmount);
  if (inAmount === null || outAmount === null) throw new QuoteNormalizeError("Quote amounts are not integers");
  const minOut = order.otherAmountThreshold !== undefined ? parseBaseUnits(order.otherAmountThreshold) : null;
  if (minOut === null) throw new QuoteNormalizeError("Quote has no minimum output");
  if (minOut > outAmount) throw new QuoteNormalizeError("Quote minimum exceeds its expected output");
  const lvbh = order.lastValidBlockHeight !== undefined ? parseBaseUnits(String(order.lastValidBlockHeight)) : null;
  const expire = order.expireAt ? Date.parse(order.expireAt) : NaN;
  return {
    inputMint: order.inputMint,
    outputMint: order.outputMint,
    inAmount,
    outAmount,
    minOut,
    slippageBps: order.slippageBps ?? 0,
    priceImpactPct: typeof order.priceImpact === "number" && Number.isFinite(order.priceImpact) ? order.priceImpact : null,
    router: order.router,
    mode: order.mode ?? null,
    route: order.routePlan.map((step) => ({
      label: step.swapInfo.label || "Unlabelled pool",
      ammKey: step.swapInfo.ammKey,
      inputMint: step.swapInfo.inputMint,
      outputMint: step.swapInfo.outputMint,
      inAmount: BigInt(step.swapInfo.inAmount),
      outAmount: BigInt(step.swapInfo.outAmount),
      bps: typeof step.bps === "number" ? step.bps : null,
    })),
    feeBps: order.feeBps,
    feeMint: order.feeMint ?? order.platformFee?.feeMint ?? null,
    platformFeeAmount: order.platformFee?.amount ? BigInt(order.platformFee.amount) : null,
    signatureFeeLamports: BigInt(order.signatureFeeLamports),
    prioritizationFeeLamports: BigInt(order.prioritizationFeeLamports),
    rentFeeLamports: BigInt(order.rentFeeLamports),
    gasless: Boolean(order.gasless),
    requestId: order.requestId ?? null,
    transaction: order.transaction ? order.transaction : null,
    transactionVersion: order.transactionVersion ?? null,
    lastValidBlockHeight: lvbh,
    expireAt: Number.isFinite(expire) ? expire : null,
    receivedAt,
    errorCode: order.errorCode ?? null,
    errorMessage: order.errorMessage ?? order.error ?? null,
    coSigners: [order.maker, order.signatureFeePayer, order.prioritizationFeePayer].filter(
      (s, i, all): s is string => typeof s === "string" && s.length > 0 && s !== order.taker && all.indexOf(s) === i,
    ),
  };
}

/** A public quote is treated as stale after this long; review requires a fresh one. */
export const QUOTE_TTL_MS = 30_000;
/** An assembled order must be approved and signed within this window. */
export const ORDER_TTL_MS = 25_000;

export function quoteAgeMs(quote: SwapQuote, now = Date.now()): number {
  return Math.max(0, now - quote.receivedAt);
}

export function isQuoteStale(quote: SwapQuote, now = Date.now(), ttl = QUOTE_TTL_MS): boolean {
  if (quote.expireAt !== null && now >= quote.expireAt) return true;
  return quoteAgeMs(quote, now) >= ttl;
}

export function networkCostLamports(quote: SwapQuote, taker: string | null): bigint {
  // Jupiter may sponsor fees (gasless); only count what the taker pays.
  return quote.gasless && taker ? 0n : quote.signatureFeeLamports + quote.prioritizationFeeLamports;
}

/** Order-of-magnitude human message for /order error codes (router-specific). */
export function orderErrorMessage(router: string, code: number | null, fallback: string | null): string {
  if (code === null) return fallback ?? "The swap could not be built.";
  if (router === "jupiterz") {
    if (code === 1) return "Insufficient balance for this swap.";
    if (code === 2) return "A token account is missing for this swap.";
    if (code === 3) return "The market maker quote could not be built into a transaction.";
  } else {
    if (code === 1) return "Insufficient balance of the token you pay.";
    if (code === 2) return "Not enough SOL to pay network fees.";
    if (code === 3) return "Below the minimum size for a gasless swap.";
  }
  return fallback ?? `The swap could not be built (code ${code}).`;
}

export function executeErrorMessage(code: number, fallback?: string): string {
  if (code === -1) return "The order expired at Jupiter before it was submitted. Get a new quote.";
  if (code === -2) return "Jupiter rejected the signed transaction as invalid.";
  if (code === -3) return "Jupiter rejected the transaction message bytes.";
  if (code === -1005 || code === -2003) return "The quote expired before the transaction landed. Nothing was swapped.";
  if (code <= -1000 && code > -2000) return "The transaction failed to land. Check the result before retrying.";
  if (code <= -2000) return "The market maker rejected or failed to fill the swap.";
  return fallback ?? `Execution failed (code ${code}).`;
}

export interface IntentContext {
  operationId: string;
  network: Network;
  signer: string;
  inputDecimals: number;
  outputDecimals: number;
  expiresAt: number;
}

/** Freezes the reviewed, assembled order into the intent the user approves. */
export function buildSwapIntent(quote: SwapQuote, ctx: IntentContext): SwapIntent {
  const allowedRouters = Object.keys(ROUTER_PROGRAMS);
  return {
    kind: "swap",
    operationId: ctx.operationId,
    network: ctx.network,
    adapter: "jupiter-swap-v2-order",
    protocolVersion: "swap/v2",
    privacyClass: "public",
    requestedPrivacyClass: "public",
    expiresAt: ctx.expiresAt,
    allowedPrograms: ROUTER_PROGRAMS[quote.router] ?? [],
    signer: ctx.signer,
    inputMint: quote.inputMint,
    outputMint: quote.outputMint,
    inputDecimals: ctx.inputDecimals,
    outputDecimals: ctx.outputDecimals,
    maxInput: quote.inAmount,
    expectedOutput: quote.outAmount,
    minNetOutput: quote.minOut,
    slippageBps: quote.slippageBps,
    router: quote.router,
    allowedRouters,
    feeBps: quote.feeBps,
    feeMint: quote.feeMint,
    networkFeeLamports: networkCostLamports(quote, ctx.signer),
    rentLamports: quote.rentFeeLamports,
    recipient: ctx.signer,
  };
}

export interface OrderCheck {
  ok: boolean;
  problems: string[];
}

/**
 * Verifies an assembled order still satisfies an approved intent: same pair,
 * exact input, minimum at least as high, fees no higher, allowed router.
 */
export function verifyOrderMatchesIntent(order: SwapQuote, intent: SwapIntent): OrderCheck {
  const problems: string[] = [];
  if (order.inputMint !== intent.inputMint || order.outputMint !== intent.outputMint) problems.push("The token pair changed.");
  if (order.inAmount !== intent.maxInput) problems.push("The amount you pay changed.");
  if (order.minOut < intent.minNetOutput) problems.push("The minimum you receive dropped.");
  if (order.feeBps > intent.feeBps) problems.push("The provider fee increased.");
  if (!intent.allowedRouters.includes(order.router)) problems.push(`Router ${order.router} is not allowed.`);
  if (networkCostLamports(order, intent.signer) > intent.networkFeeLamports) problems.push("The network fee increased.");
  if (order.rentFeeLamports > intent.rentLamports) problems.push("Account rent increased.");
  if (!order.transaction) problems.push("No transaction was returned.");
  return { ok: problems.length === 0, problems };
}
