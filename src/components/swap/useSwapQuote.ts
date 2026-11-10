"use client";

import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/client/api";
import { useDebounced } from "@/lib/client/hooks";
import { useSettings, useSettingsReady } from "@/lib/client/stores";
import { useTxFlow } from "@/lib/client/tx-flow";
import { orderResponseSchema } from "@/lib/swap/jupiter-schema";
import { normalizeOrder, type SwapQuote } from "@/lib/swap/quote";
import type { TokenInfo } from "@/lib/tokens/types";

export type QuoteStatus = "idle" | "loading" | "ready" | "no_route" | "error";

export interface QuoteState {
  status: QuoteStatus;
  quote: SwapQuote | null;
  error: string | null;
  refreshing: boolean;
  refresh(): void;
}

export function useSwapQuote(input: TokenInfo | null, output: TokenInfo | null, amount: bigint | null): QuoteState {
  const slippage = useSettings((s) => s.slippageBps);
  const reviewOpen = useTxFlow((s) => s.open);
  const ready = useSettingsReady();
  const amountKey = amount && amount > 0n ? amount.toString() : "";
  const debounced = useDebounced(amountKey, 280);
  const settled = debounced === amountKey;
  const enabled = ready && Boolean(input && output && debounced && input.mint !== output.mint);

  const q = useQuery({
    queryKey: ["quote", input?.mint, output?.mint, debounced, slippage],
    queryFn: async ({ signal }): Promise<SwapQuote> => {
      const value = BigInt(debounced);
      const res = await api.quote({ inputMint: input!.mint, outputMint: output!.mint, amount: value, slippageBps: slippage }, signal);
      return normalizeOrder(orderResponseSchema.parse(res.order), res.receivedAt);
    },
    enabled,
    staleTime: 0,
    gcTime: 20_000,
    refetchInterval: reviewOpen ? false : 15_000,
    refetchIntervalInBackground: false,
    retry: (count, error) => !(error instanceof ApiError && (error.code === "no_route" || error.status === 400 || error.status === 422)) && count < 1,
  });

  if (!input || !output || !amountKey) return { status: "idle", quote: null, error: null, refreshing: false, refresh: () => {} };
  // Never show a quote for a different amount than the one in the field.
  if (!settled || q.isPending) return { status: "loading", quote: null, error: null, refreshing: false, refresh: () => void q.refetch() };
  if (q.isError) {
    const e = q.error;
    if (e instanceof ApiError && (e.code === "no_route" || e.status === 422)) return { status: "no_route", quote: null, error: e.message, refreshing: q.isFetching, refresh: () => void q.refetch() };
    return { status: "error", quote: null, error: (e as Error).message, refreshing: q.isFetching, refresh: () => void q.refetch() };
  }
  const quote = q.data ?? null;
  if (quote && quote.inAmount !== BigInt(debounced)) return { status: "loading", quote: null, error: null, refreshing: true, refresh: () => void q.refetch() };
  return { status: "ready", quote, error: null, refreshing: q.isFetching, refresh: () => void q.refetch() };
}
