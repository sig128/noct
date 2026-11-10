"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { NETWORK } from "@/lib/operations/intent";
import { api } from "./api";
import { solanaRpc } from "./rpc";
import { useWallet, useSettingsReady } from "./stores";
import { parseMintAccount, type MintFacts } from "@/lib/tokens/mint-account";
import { NATIVE_SOL_MINT, USDC_MINT, type TokenInfo } from "@/lib/tokens/types";

export const DEFAULT_MINTS = [
  NATIVE_SOL_MINT,
  USDC_MINT,
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
  "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
  "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm",
  "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn",
];

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const clockListeners = new Set<() => void>();
let clockNow = Date.now();
let clockTimer: ReturnType<typeof setInterval> | null = null;
function subscribeClock(cb: () => void) {
  clockListeners.add(cb);
  if (!clockTimer) {
    clockTimer = setInterval(() => {
      clockNow = Date.now();
      clockListeners.forEach((l) => l());
    }, 1000);
  }
  return () => {
    clockListeners.delete(cb);
    if (clockListeners.size === 0 && clockTimer) {
      clearInterval(clockTimer);
      clockTimer = null;
    }
  };
}

/** Shared one-second clock for "updated 4s ago" labels. Server snapshot is 0. */
export function useNow(): number {
  return useSyncExternalStore(subscribeClock, () => clockNow, () => 0);
}

export function useCapabilities() {
  const ready = useSettingsReady();
  return useQuery({
    queryKey: ["capabilities"],
    enabled: ready,
    queryFn: ({ signal }) => api.capabilities(signal),
    staleTime: 60_000,
    retry: 1,
  });
}

export function useDefaultTokens() {
  const ready = useSettingsReady();
  return useQuery({
    queryKey: ["tokens:defaults"],
    enabled: ready,
    queryFn: async ({ signal }): Promise<TokenInfo[]> => (await api.tokensByMint(DEFAULT_MINTS, signal)).tokens,
    staleTime: 5 * 60_000,
    retry: 1,
  });
}

/**
 * Debounced token search. `forQuery` names the text the current data answers,
 * so callers never show results for an earlier query as if they matched.
 */
export function useTokenSearch(query: string) {
  const ready = useSettingsReady();
  const q = useDebounced(query.trim(), 220);
  const result = useQuery({
    queryKey: ["tokens:search", q],
    queryFn: async ({ signal }) => (await api.searchTokens(q, signal)).tokens,
    enabled: ready && q.length > 0,
    staleTime: 30_000,
    retry: 0,
  });
  return { data: result.data, error: result.error, isFetching: result.isFetching, forQuery: q };
}

export function useTokensByMint(mints: readonly string[]) {
  const ready = useSettingsReady();
  const key = [...new Set(mints)].sort();
  return useQuery({
    queryKey: ["tokens:mints", key.join(",")],
    queryFn: async ({ signal }) => (await api.tokensByMint(key.slice(0, 50), signal)).tokens,
    enabled: ready && key.length > 0,
    staleTime: 5 * 60_000,
  });
}

export function usePrices(mints: readonly (string | null | undefined)[]) {
  const ready = useSettingsReady();
  const key = [...new Set(mints.filter((m): m is string => Boolean(m)))].sort();
  return useQuery({
    queryKey: ["prices", key.join(",")],
    queryFn: async ({ signal }) => (await api.prices(key, signal)).prices,
    enabled: ready && key.length > 0,
    staleTime: 10_000,
    refetchInterval: 20_000,
  });
}

export interface PublicBalances {
  lamports: bigint;
  tokens: { mint: string; amount: bigint; decimals: number; program: "spl" | "token2022"; account: string; frozen: boolean }[];
  fetchedAt: number;
}

export function usePublicBalances() {
  const ready = useSettingsReady();
  const address = useWallet((s) => s.address);
  return useQuery({
    queryKey: ["balances", address],
    queryFn: async ({ signal }): Promise<PublicBalances> => {
      const [lamports, tokens] = await Promise.all([solanaRpc.getLamports(NETWORK, address!, signal), solanaRpc.getTokenHoldings(NETWORK, address!, signal)]);
      return { lamports, tokens, fetchedAt: Date.now() };
    },
    enabled: ready && Boolean(address),
    staleTime: 10_000,
    refetchInterval: 25_000,
  });
}

/** Spendable amount of a mint in the public wallet (SOL = native lamports). */
export function publicBalanceOf(b: PublicBalances | undefined, mint: string): bigint | null {
  if (!b) return null;
  if (mint === NATIVE_SOL_MINT) return b.lamports;
  return b.tokens.filter((t) => t.mint === mint && !t.frozen).reduce((a, t) => a + t.amount, 0n);
}

export function useMintFacts(mint: string | null | undefined) {
  const ready = useSettingsReady();
  return useQuery({
    queryKey: ["mint", mint],
    queryFn: async ({ signal }): Promise<MintFacts | null> => {
      if (!mint || mint === NATIVE_SOL_MINT) return null;
      const account = await solanaRpc.getAccountBytes(NETWORK, mint, signal);
      if (!account) return null;
      return parseMintAccount(account.data, account.owner);
    },
    enabled: ready && Boolean(mint) && mint !== NATIVE_SOL_MINT,
    staleTime: 10 * 60_000,
    retry: 1,
  });
}

export function useEpoch() {
  const ready = useSettingsReady();
  return useQuery({
    queryKey: ["epoch"],
    enabled: ready,
    queryFn: () => solanaRpc.getEpoch(NETWORK),
    staleTime: 10 * 60_000,
  });
}

export function useEarnMarkets() {
  const ready = useSettingsReady();
  return useQuery({
    queryKey: ["earn:markets"],
    queryFn: ({ signal }) => api.earnMarkets(signal),
    enabled: ready,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function useEarnPositions() {
  const ready = useSettingsReady();
  const address = useWallet((s) => s.address);
  return useQuery({
    queryKey: ["earn:positions", address],
    queryFn: async ({ signal }) => {
      const { positions } = await api.earnPositions(address!, signal);
      return positions
        .map((p) => {
          const token = (p.token ?? {}) as { address?: string; assetAddress?: string };
          const shares = typeof p.shares === "string" ? BigInt(p.shares) : 0n;
          return { receiptMint: token.address ?? "", assetMint: token.assetAddress ?? "", shares };
        })
        .filter((p) => p.receiptMint && p.shares > 0n);
    },
    enabled: ready && Boolean(address),
    staleTime: 15_000,
    refetchInterval: 45_000,
  });
}

export function useVaults() {
  const ready = useSettingsReady();
  return useQuery({
    queryKey: ["borrow:vaults"],
    queryFn: ({ signal }) => api.vaults(signal),
    enabled: ready,
    staleTime: 20_000,
    refetchInterval: 45_000,
  });
}

export function useBorrowPositions() {
  const ready = useSettingsReady();
  const address = useWallet((s) => s.address);
  return useQuery({
    queryKey: ["borrow:positions", address],
    queryFn: async ({ signal }) => (await api.borrowPositions(address!, signal)).positions,
    enabled: ready && Boolean(address),
    staleTime: 15_000,
    refetchInterval: 45_000,
  });
}

export function useOraclePrices(mints: readonly string[]) {
  const ready = useSettingsReady();
  const key = [...new Set(mints)].sort();
  return useQuery({
    queryKey: ["oracle", key.join(",")],
    queryFn: ({ signal }) => api.oracle(key, signal),
    enabled: ready && key.length > 0,
    staleTime: 5_000,
    refetchInterval: 15_000,
    retry: 0,
  });
}
