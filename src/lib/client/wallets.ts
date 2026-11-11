"use client";

import { create } from "zustand";
import { deriveWallet, isWalletsSignature, MAX_WALLETS, walletsMessage, type DerivedWallet } from "@/lib/wallets/derive";
import { signExactMessage } from "@/lib/wallet/standard";
import { useWallet } from "./stores";

/**
 * NOCT wallets: up to ten extra wallets derived from one signature of the
 * connected wallet (see lib/wallets/derive.ts). The signature and the keys
 * live in this module's memory only, never in React state, storage, URLs or
 * logs, and are wiped when the wallet disconnects or switches account.
 */

export type RunPhase = "idle" | "working" | "done" | "failed";

export interface WalletRun {
  phase: RunPhase;
  message: string | null;
  signature: string | null;
}

export interface WalletsState {
  status: "closed" | "opening" | "open" | "error";
  /** The connected wallet these were derived for. */
  owner: string | null;
  /** Wallet indexes shown, in the order they were added. */
  shown: number[];
  error: string | null;
  /** Progress of the last batch action, per wallet index. */
  runs: Record<number, WalletRun>;
  /** A batch action (buy, sell, send back) is running. */
  busy: string | null;
}

const initial: WalletsState = { status: "closed", owner: null, shown: [], error: null, runs: {}, busy: null };

export const useWallets = create<WalletsState>()(() => ({ ...initial }));

let seed: Uint8Array | null = null;
const derived = new Map<number, DerivedWallet>();

/** The keys of wallet `index`. Throws if the wallets are not open. */
export function walletKey(index: number): DerivedWallet {
  if (!seed) throw new Error("Open your NOCT wallets first.");
  let wallet = derived.get(index);
  if (!wallet) {
    wallet = deriveWallet(seed, index);
    derived.set(index, wallet);
  }
  return wallet;
}

export function walletAddress(index: number): string | null {
  try {
    return walletKey(index).address;
  } catch {
    return null;
  }
}

/** Forgets the signature and every key; the same wallet can open the same wallets again. */
export function closeWallets(): void {
  seed?.fill(0);
  seed = null;
  for (const wallet of derived.values()) wallet.secret.fill(0);
  derived.clear();
  useWallets.setState({ ...initial });
}

/** Adds the next wallet, asking the connected wallet to sign NOCT's wallets text the first time. */
export async function addWallet(): Promise<void> {
  const w = useWallet.getState();
  if (!w.address || !w.account || !w.option) {
    useWallets.setState({ status: "error", error: "Connect a wallet first." });
    return;
  }
  const state = useWallets.getState();
  if (state.status === "opening") return;
  if (!seed || state.owner !== w.address) {
    if (seed) closeWallets();
    useWallets.setState({ status: "opening", error: null });
    try {
      const signature = await signExactMessage(w.option, w.account, walletsMessage(w.address));
      if (!isWalletsSignature(w.address, new Uint8Array(w.account.publicKey), signature)) {
        signature.fill(0);
        throw new Error("The wallet's signature did not verify, so no wallets were opened.");
      }
      if (useWallet.getState().address !== w.address) {
        signature.fill(0);
        useWallets.setState({ ...initial });
        return;
      }
      seed = new Uint8Array(signature);
      signature.fill(0);
      useWallets.setState({ status: "open", owner: w.address, shown: [], error: null });
    } catch (error) {
      useWallets.setState({ status: "error", error: (error as Error).message || "The wallet did not sign, so no wallets were opened." });
      return;
    }
  }
  const { shown } = useWallets.getState();
  const next = Array.from({ length: MAX_WALLETS }, (_, i) => i).find((i) => !shown.includes(i));
  if (next === undefined) return;
  useWallets.setState({ shown: [...shown, next], error: null });
}

/** Hides a wallet. Its funds stay in it; adding a wallet again brings back the lowest hidden one. */
export function removeWallet(index: number): void {
  useWallets.setState((s) => {
    const runs = { ...s.runs };
    delete runs[index];
    return { shown: s.shown.filter((i) => i !== index), runs };
  });
}

export function setRun(index: number, run: Partial<WalletRun>): void {
  useWallets.setState((s) => ({ runs: { ...s.runs, [index]: { phase: "idle", message: null, signature: null, ...s.runs[index], ...run } } }));
}

export function clearRuns(): void {
  useWallets.setState({ runs: {} });
}
