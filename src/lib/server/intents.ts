import "server-only";
import { z } from "zod";
import { parseWith, upstreamJson, UpstreamError } from "./http";
import { serverEnv } from "./env";
import { sanitizeText } from "@/lib/tokens/sanitize";

/** NEAR Intents' 1Click API (docs.near-intents.org). */
const BASE = "https://1click.chaindefuser.com/v0";
/** SOL on Solana, as NEAR Intents names it (GET /v0/tokens). */
export const SOL_ASSET = "nep141:sol.omft.near";
/** Slippage NOCT accepts on a wallet funding route, in basis points. */
export const FUNDING_SLIPPAGE_BPS = 100;

function headers(): Record<string, string> {
  const key = serverEnv().NEAR_INTENTS_API_KEY;
  return key ? { "x-api-key": key } : {};
}

function upstreamMessage(data: unknown, fallback: string): string {
  const message = (data as { message?: unknown } | null)?.message;
  return typeof message === "string" ? sanitizeText(message, 200) || fallback : fallback;
}

const intStr = z.string().regex(/^\d{1,40}$/);

const quoteSchema = z.object({
  correlationId: z.string().max(200),
  timestamp: z.string().max(64),
  signature: z.string().max(1_000),
  quote: z.object({
    depositAddress: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/).optional(),
    depositMemo: z.string().max(200).optional(),
    amountIn: intStr,
    minAmountIn: intStr.optional(),
    amountOut: intStr,
    minAmountOut: intStr,
    deadline: z.string().max(64).optional(),
    timeWhenInactive: z.string().max(64).optional(),
    timeEstimate: z.number().nonnegative(),
    withdrawFee: intStr.optional(),
    refundFee: intStr.optional(),
  }),
});

export type FundingQuote = z.infer<typeof quoteSchema>;

/**
 * A quote that moves SOL from `refundTo`'s chain to `recipient` on Solana
 * through NEAR Intents' confidential route: the deposit and the payout are
 * public Solana transfers, but the trail between them runs on NEAR's private
 * shard. `dry` quotes create no deposit address.
 */
export async function quoteSolFunding(input: { recipient: string; refundTo: string; amount: bigint; dry: boolean; confidential?: boolean }): Promise<FundingQuote> {
  const body = {
    dry: input.dry,
    swapType: "EXACT_INPUT",
    slippageTolerance: FUNDING_SLIPPAGE_BPS,
    originAsset: SOL_ASSET,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: SOL_ASSET,
    amount: input.amount.toString(),
    refundTo: input.refundTo,
    refundType: "ORIGIN_CHAIN",
    recipient: input.recipient,
    recipientType: "DESTINATION_CHAIN",
    deadline: new Date(Date.now() + 30 * 60_000).toISOString(),
    confidentiality: input.confidential === false ? "public" : "advanced",
  };
  const { status, data } = await upstreamJson(`${BASE}/quote`, { service: "near-intents", method: "POST", body, headers: headers(), timeoutMs: 20_000 });
  // A refusal of NOCT's credentials is NOCT's problem, not the person's: report it as an upstream failure.
  if (status === 401 || status === 403) throw new UpstreamError("status", "near-intents", `NEAR Intents refused the request (${status}): ${upstreamMessage(data, "no reason given")}`, 502);
  if (status !== 200 && status !== 201) throw new UpstreamError("status", "near-intents", upstreamMessage(data, `NEAR Intents returned ${status}`), status);
  const parsed = parseWith(quoteSchema, data, "near-intents");
  if (!input.dry && !parsed.quote.depositAddress) throw new UpstreamError("invalid_schema", "near-intents", "NEAR Intents returned no deposit address");
  return parsed;
}

const statusSchema = z.object({
  status: z.enum(["PENDING_DEPOSIT", "KNOWN_DEPOSIT_TX", "PROCESSING", "SUCCESS", "INCOMPLETE_DEPOSIT", "REFUNDED", "FAILED"]),
  updatedAt: z.string().max(64).optional(),
  swapDetails: z
    .object({
      amountIn: intStr.optional().nullable(),
      amountOut: intStr.optional().nullable(),
      originChainTxHashes: z.array(z.object({ hash: z.string().max(200) }).passthrough()).optional(),
      destinationChainTxHashes: z.array(z.object({ hash: z.string().max(200) }).passthrough()).optional(),
      refundedAmount: intStr.optional().nullable(),
    })
    .passthrough()
    .optional(),
});

export type FundingStatus = z.infer<typeof statusSchema>;

export async function fundingStatus(depositAddress: string): Promise<FundingStatus> {
  const url = `${BASE}/status?${new URLSearchParams({ depositAddress }).toString()}`;
  const { status, data } = await upstreamJson(url, { service: "near-intents-status", headers: headers(), timeoutMs: 10_000, retries: 1 });
  if (status !== 200) throw new UpstreamError("status", "near-intents-status", upstreamMessage(data, `NEAR Intents returned ${status}`), status);
  return parseWith(statusSchema, data, "near-intents-status");
}

/** Tells NEAR Intents which transaction paid a deposit address, which speeds processing up. */
export async function submitDeposit(depositAddress: string, txHash: string): Promise<void> {
  const { status, data } = await upstreamJson(`${BASE}/deposit/submit`, { service: "near-intents-submit", method: "POST", body: { depositAddress, txHash }, headers: headers(), timeoutMs: 10_000 });
  if (status !== 200 && status !== 201) throw new UpstreamError("status", "near-intents-submit", upstreamMessage(data, `NEAR Intents returned ${status}`), status);
}
