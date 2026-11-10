"use client";

import { formatAmount, formatBps, formatRatioSignificant, reduce, pow10 } from "@/lib/decimal";
import type { Network } from "@/lib/operations/intent";
import { PROFILES } from "@/lib/privacy/model";
import { orderResponseSchema } from "@/lib/swap/jupiter-schema";
import { buildSwapIntent, executeErrorMessage, networkCostLamports, normalizeOrder, orderErrorMessage, ORDER_TTL_MS, type SwapQuote } from "@/lib/swap/quote";
import type { TokenInfo } from "@/lib/tokens/types";
import { base64ToBytes, bytesToBase64 } from "@/lib/tx/inspect";
import { ROUTER_PROGRAMS } from "@/lib/tx/programs";
import { demoQuote } from "@/lib/adapters/demo";
import { api, ApiError } from "./api";
import { solanaRpc } from "./rpc";
import type { ReviewRow, TxSpec } from "./tx-flow";

export function rateText(q: Pick<SwapQuote, "inAmount" | "outAmount">, input: TokenInfo, output: TokenInfo): string {
  if (q.inAmount === 0n) return "";
  const r = reduce({ num: q.outAmount * pow10(input.decimals), den: q.inAmount * pow10(output.decimals) });
  return `1 ${input.symbol} ≈ ${formatRatioSignificant(r, 6)} ${output.symbol}`;
}

export function routeText(q: SwapQuote): string {
  if (q.router === "jupiterz") return "Market maker quote (JupiterZ RFQ)";
  if (q.route.length === 0) return "Direct";
  return q.route
    .map((leg) => `${leg.label}${leg.bps !== null && leg.bps < 10_000 ? ` ${Math.round(leg.bps / 100)}%` : ""}`)
    .join(" → ");
}

export function lamportsText(lamports: bigint): string {
  return `${formatAmount(lamports, 9, { smallSignificant: 3 })} SOL`;
}

export interface SwapSpecInput {
  input: TokenInfo;
  output: TokenInfo;
  amount: bigint;
  slippageBps: number | null;
  network: Network;
  signer: string;
  demo: boolean;
  inputBalance: bigint;
  /** Net amount after a Token-2022 transfer fee on the output, when known. */
  outputTransferFeeBps: number | null;
  onSettled(): void;
}

export function swapSpec(p: SwapSpecInput): TxSpec {
  return {
    kind: "swap",
    title: `Swap ${p.input.symbol} for ${p.output.symbol}`,
    network: p.network,
    signer: p.signer,
    demo: p.demo,
    disclosure: PROFILES.publicSwap,
    requestedPrivacy: "public",
    activityDetail: `${formatAmount(p.amount, p.input.decimals)} ${p.input.symbol} → ${p.output.symbol}`,
    primaryLabel: p.demo ? "Simulate swap" : "Sign and swap",
    simulate: true,
    reserve: { mint: p.input.mint, amount: p.amount, source: "public", available: p.inputBalance },
    async build({ signal, operationId }) {
      let raw;
      if (p.demo) {
        raw = { order: demoQuote(p.input.mint, p.output.mint, p.amount), receivedAt: Date.now() };
        if (!raw.order) throw new Error("No demo route for this pair.");
      } else {
        raw = await api.order({ inputMint: p.input.mint, outputMint: p.output.mint, amount: p.amount, taker: p.signer, slippageBps: p.slippageBps }, signal);
      }
      const order = normalizeOrder(orderResponseSchema.parse(raw.order), raw.receivedAt);
      if (!p.demo && !order.transaction) throw new Error(orderErrorMessage(order.router, order.errorCode, order.errorMessage));
      if (order.inAmount !== p.amount || order.inputMint !== p.input.mint || order.outputMint !== p.output.mint) {
        throw new Error("The order returned does not match the requested swap.");
      }
      const expiresAt = Math.min(order.expireAt ?? Number.POSITIVE_INFINITY, Date.now() + ORDER_TTL_MS);
      const intent = buildSwapIntent(order, { operationId, network: p.network, signer: p.signer, inputDecimals: p.input.decimals, outputDecimals: p.output.decimals, expiresAt });
      const fee = networkCostLamports(order, p.signer);
      const rows: ReviewRow[] = [
        { label: "You pay", value: `${formatAmount(order.inAmount, p.input.decimals, { maxFraction: p.input.decimals })} ${p.input.symbol}`, sensitive: true },
        { label: "You receive (estimated)", value: `${formatAmount(order.outAmount, p.output.decimals)} ${p.output.symbol}`, sensitive: true },
        {
          label: "Minimum received",
          value: `${formatAmount(order.minOut, p.output.decimals)} ${p.output.symbol}`,
          tone: "accent",
          sensitive: true,
        },
        { label: "Rate", value: rateText(order, p.input, p.output) },
        { label: "Price impact", value: order.priceImpactPct === null ? "Not reported" : `${Math.abs(order.priceImpactPct).toFixed(2)}%`, tone: (order.priceImpactPct ?? 0) <= -1 ? "warn" : "default" },
        { label: "Slippage limit", value: order.slippageBps ? formatBps(order.slippageBps) : "Set by Jupiter" },
        { label: "Provider fee", value: order.feeBps ? `${formatBps(order.feeBps)} (Jupiter)` : "None" },
        { label: "Network fee", value: order.gasless ? "Paid by Jupiter (gasless)" : lamportsText(fee) },
        ...(order.rentFeeLamports > 0n ? [{ label: "Account rent", value: lamportsText(order.rentFeeLamports) } as ReviewRow] : []),
        ...(p.outputTransferFeeBps ? [{ label: "Token transfer fee", value: `Up to ${formatBps(p.outputTransferFeeBps)} withheld by the ${p.output.symbol} mint`, tone: "warn" } as ReviewRow] : []),
        { label: "Route", value: routeText(order) },
        { label: `${p.input.symbol} mint`, value: p.input.mint, wrap: true, tone: "muted" },
        { label: `${p.output.symbol} mint`, value: p.output.mint, wrap: true, tone: "muted" },
      ];
      return {
        wire: order.transaction ? base64ToBytes(order.transaction) : new Uint8Array(),
        lastValidBlockHeight: order.lastValidBlockHeight,
        intent,
        rows,
        expiresAt,
        meta: { requestId: order.requestId ?? "", router: order.router, coSigners: order.coSigners.join(",") },
      };
    },
    policy(built) {
      const router = built.meta?.router ?? "";
      return {
        feePayer: p.signer,
        allowedPrograms: ROUTER_PROGRAMS[router] ?? [],
        allowedVersions: [0, "legacy"],
        maxSigners: 3,
        // RFQ makers and gasless sponsors sign at execution; nobody else may.
        allowedCoSigners: (built.meta?.coSigners ?? "").split(",").filter(Boolean),
      };
    },
    async submit(signed, built) {
      if (p.demo) {
        await new Promise((r) => setTimeout(r, 900));
        const demoIntent = built.intent.kind === "swap" ? built.intent : null;
        return {
          status: "confirmed",
          signature: `demo-${built.intent.operationId.slice(0, 8)}`,
          rows: [{ label: "Result", value: "Simulated in Demo mode. No transaction was created or sent.", tone: "warn" }],
          outputs: demoIntent ? { received: demoIntent.expectedOutput.toString(), minimum: demoIntent.minNetOutput.toString() } : undefined,
        };
      }
      let response;
      try {
        response = await api.execute({
          signedTransaction: bytesToBase64(signed),
          requestId: built.meta?.requestId ?? "",
          router: built.meta?.router ?? "",
          taker: p.signer,
          lastValidBlockHeight: built.lastValidBlockHeight,
        });
      } catch (error) {
        const message = error instanceof ApiError ? error.message : "No response from Jupiter.";
        return { status: "unknown", signature: null, message: `${message} Checking the chain before anything else.` };
      }
      const r = response.result;
      if (r.status === "Success" && r.signature) {
        const fee = await solanaRpc.getTransactionFee(p.network, r.signature);
        const rows: ReviewRow[] = [
          { label: "Paid", value: `${formatAmount(BigInt(r.inputAmountResult ?? r.totalInputAmount ?? "0"), p.input.decimals)} ${p.input.symbol}`, sensitive: true },
          { label: "Received", value: `${formatAmount(BigInt(r.outputAmountResult ?? r.totalOutputAmount ?? "0"), p.output.decimals)} ${p.output.symbol}`, sensitive: true, tone: "accent" },
          { label: "Network fee", value: fee === null ? "Not yet indexed" : lamportsText(fee) },
          { label: "Privacy", value: PROFILES.publicSwap.summary },
        ];
        const received = r.outputAmountResult ?? r.totalOutputAmount;
        const minimum = built.intent.kind === "swap" ? built.intent.minNetOutput.toString() : undefined;
        return { status: "confirmed", signature: r.signature, rows, outputs: { ...(received ? { received } : {}), ...(minimum ? { minimum } : {}) } };
      }
      const message = executeErrorMessage(r.code, r.error);
      // -1..-3: refused before broadcast. Anything else: it may have been broadcast.
      if (r.code >= -3 && r.code <= -1) return { status: "failed", signature: null, message, retryable: true };
      return { status: "failed", signature: r.signature ?? null, message, retryable: true };
    },
    onSettled: p.onSettled,
  };
}
