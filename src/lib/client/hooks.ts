"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { solanaRpc } from "./rpc";
import { useSettings, useWallet, useSettingsReady } from "./stores";
import {
  DEMO_BORROW_POSITIONS,
  DEMO_DEFAULT_MINTS,
  DEMO_EARN_MARKETS,
  DEMO_EARN_POSITIONS,
  DEMO_PUBLIC_BALANCES,
  DEMO_TOKENS,
  demoSearch,
  demoVaults,
} from "@/lib/adapters/demo";
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
  const demo = useSettings((s) => s.demoMode);
  return useQuery({
    queryKey: ["capabilities", demo],
    enabled: ready,
    queryFn: ({ signal }) => api.capabilities(signal),
    staleTime: 60_000,
    retry: 1,
  });
}

export function useDefaultTokens() {
  const ready = useSettingsReady();
  const demo = useSettings((s) => s.demoMode);
  return useQuery({
    queryKey: ["tokens:defaults", demo],
    enabled: ready,
    queryFn: async ({ signal }): Promise<TokenInfo[]> => (demo ? DEMO_TOKENS.filter((t) => DEMO_DEFAULT_MINTS.includes(t.mint)) : (await api.tokensByMint(DEFAULT_MINTS, signal)).tokens),
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
  const demo = useSettings((s) => s.demoMode);
  const q = useDebounced(query.trim(), 220);
  const result = useQuery({
    queryKey: ["tokens:search", demo, q],
    queryFn: async ({ signal }) => (demo ? demoSearch(q) : (await api.searchTokens(q, signal)).tokens),
    enabled: ready && q.length > 0,
    staleTime: 30_000,
    retry: 0,
  });
  return { data: result.data, error: result.error, isFetching: result.isFetching, forQuery: q };
}

export function useTokensByMint(mints: readonly string[]) {
  const ready = useSettingsReady();
  const demo = useSettings((s) => s.demoMode);
  const key = [...new Set(mints)].sort();
  return useQuery({
    queryKey: ["tokens:mints", demo, key.join(",")],
    queryFn: async ({ signal }) => (demo ? DEMO_TOKENS.filter((t) => key.includes(t.mint)) : (await api.tokensByMint(key.slice(0, 50), signal)).tokens),
    enabled: ready && key.length > 0,
    staleTime: 5 * 60_000,
  });
}

export function usePrices(mints: readonly (string | null | undefined)[]) {
  const ready = useSettingsReady();
  const demo = useSettings((s) => s.demoMode);
  const key = [...new Set(mints.filter((m): m is string => Boolean(m)))].sort();
  return useQuery({
    queryKey: ["prices", demo, key.join(",")],
    queryFn: async ({ signal }) => {
      if (demo) {
        return Object.fromEntries(DEMO_TOKENS.filter((t) => key.includes(t.mint) && t.usdPrice).map((t) => [t.mint, { usdPrice: t.usdPrice!, blockId: null }]));
      }
      return (await api.prices(key, signal)).prices;
    },
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
  const demo = useSettings((s) => s.demoMode);
  const network = useSettings((s) => s.network);
  const address = useWallet((s) => s.address);
  return useQuery({
    queryKey: ["balances", demo, network, address],
    queryFn: async ({ signal }): Promise<PublicBalances> => {
      if (demo) {
        const sol = DEMO_PUBLIC_BALANCES.find((b) => b.mint === NATIVE_SOL_MINT)!.amount;
        return {
          lamports: sol,
          tokens: DEMO_PUBLIC_BALANCES.filter((b) => b.mint !== NATIVE_SOL_MINT).map((b) => ({
            mint: b.mint,
            amount: b.amount,
            decimals: DEMO_TOKENS.find((t) => t.mint === b.mint)?.decimals ?? 6,
            program: "spl" as const,
            account: `demo-${b.mint.slice(0, 6)}`,
            frozen: false,
          })),
          fetchedAt: Date.now(),
        };
      }
      const [lamports, tokens] = await Promise.all([solanaRpc.getLamports(network, address!, signal), solanaRpc.getTokenHoldings(network, address!, signal)]);
      return { lamports, tokens, fetchedAt: Date.now() };
    },
    enabled: ready && (demo || Boolean(address)),
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
  const demo = useSettings((s) => s.demoMode);
  const network = useSettings((s) => s.network);
  return useQuery({
    queryKey: ["mint", demo, network, mint],
    queryFn: async ({ signal }): Promise<MintFacts | null> => {
      if (demo) {
        const t = DEMO_TOKENS.find((x) => x.mint === mint);
        if (!t) return null;
        const token2022 = t.tokenProgram === "token2022";
        return {
          program: token2022 ? "token2022" : "spl",
          decimals: t.decimals,
          supply: 0n,
          mintAuthority: t.mintAuthority,
          freezeAuthority: t.freezeAuthority,
          extensions: token2022 ? [{ type: 1, name: "TransferFeeConfig" }] : [],
          transferFee: token2022 ? { older: { epoch: 0n, maximumFee: 10n ** 18n, basisPoints: 100 }, newer: { epoch: 0n, maximumFee: 10n ** 18n, basisPoints: 100 } } : null,
          transferHookProgram: null,
          permanentDelegate: null,
          defaultAccountStateFrozen: false,
          pausable: false,
          nonTransferable: false,
        };
      }
      if (!mint || mint === NATIVE_SOL_MINT) return null;
      const account = await solanaRpc.getAccountBytes(network, mint, signal);
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
  const demo = useSettings((s) => s.demoMode);
  const network = useSettings((s) => s.network);
  return useQuery({
    queryKey: ["epoch", demo, network],
    enabled: ready,
    queryFn: async () => (demo ? 800n : solanaRpc.getEpoch(network)),
    staleTime: 10 * 60_000,
  });
}

export function useEarnMarkets() {
  const ready = useSettingsReady();
  const demo = useSettings((s) => s.demoMode);
  const network = useSettings((s) => s.network);
  return useQuery({
    queryKey: ["earn:markets", demo],
    queryFn: async ({ signal }) => (demo ? { markets: DEMO_EARN_MARKETS, fetchedAt: Date.now() } : api.earnMarkets(signal)),
    enabled: ready && (demo || network === "mainnet"),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function useEarnPositions() {
  const ready = useSettingsReady();
  const demo = useSettings((s) => s.demoMode);
  const address = useWallet((s) => s.address);
  const network = useSettings((s) => s.network);
  return useQuery({
    queryKey: ["earn:positions", demo, address],
    queryFn: async ({ signal }) => {
      if (demo) return DEMO_EARN_POSITIONS;
      const { positions } = await api.earnPositions(address!, signal);
      return positions
        .map((p) => {
          const token = (p.token ?? {}) as { address?: string; assetAddress?: string };
          const shares = typeof p.shares === "string" ? BigInt(p.shares) : 0n;
          return { receiptMint: token.address ?? "", assetMint: token.assetAddress ?? "", shares };
        })
        .filter((p) => p.receiptMint && p.shares > 0n);
    },
    enabled: ready && (demo || (Boolean(address) && network === "mainnet")),
    staleTime: 15_000,
    refetchInterval: 45_000,
  });
}

export function useVaults() {
  const ready = useSettingsReady();
  const demo = useSettings((s) => s.demoMode);
  const network = useSettings((s) => s.network);
  return useQuery({
    queryKey: ["borrow:vaults", demo],
    queryFn: async ({ signal }) => (demo ? { vaults: demoVaults(Date.now()), fetchedAt: Date.now() } : api.vaults(signal)),
    enabled: ready && (demo || network === "mainnet"),
    staleTime: 20_000,
    refetchInterval: 45_000,
  });
}

export function useBorrowPositions() {
  const ready = useSettingsReady();
  const demo = useSettings((s) => s.demoMode);
  const address = useWallet((s) => s.address);
  const network = useSettings((s) => s.network);
  return useQuery({
    queryKey: ["borrow:positions", demo, address],
    queryFn: async ({ signal }) => (demo ? DEMO_BORROW_POSITIONS : (await api.borrowPositions(address!, signal)).positions),
    enabled: ready && (demo || (Boolean(address) && network === "mainnet")),
    staleTime: 15_000,
    refetchInterval: 45_000,
  });
}

export function useOraclePrices(mints: readonly string[]) {
  const ready = useSettingsReady();
  const demo = useSettings((s) => s.demoMode);
  const key = [...new Set(mints)].sort();
  return useQuery({
    queryKey: ["oracle", demo, key.join(",")],
    queryFn: async ({ signal }) => (demo ? null : api.oracle(key, signal)),
    enabled: ready && key.length > 0 && !demo,
    staleTime: 5_000,
    refetchInterval: 15_000,
    retry: 0,
  });
}
