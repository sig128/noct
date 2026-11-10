"use client";

import { DEMO_PRIVATE_BALANCES, DEMO_WALLET } from "@/lib/adapters/demo";
import { USDC_MINT } from "@/lib/tokens/types";
import { api } from "./api";
import { getPrivacySession, journal, reservations, setPrivacySession, useActivity, usePrivate, useSettings, useWallet } from "./stores";
import { connectWallet, disconnectWallet, onAccountsChanged, signExactMessage, type WalletOption } from "@/lib/wallet/standard";
import { useTxFlow, txFlow } from "./tx-flow";

let offAccountListener: (() => void) | null = null;

/** Clears protected views and anything tied to the previous wallet, account or network. */
export function invalidateSession(reason: string): void {
  useWallet.getState().bump();
  usePrivate.getState().lock(reason);
  const flow = useTxFlow.getState();
  if (flow.open && !["submitting", "confirming", "pendingRecovery", "preparing"].includes(flow.phase)) txFlow.cancel(reason);
  journal.clearFinished();
  reservations.clear();
}

export async function connect(option: WalletOption): Promise<void> {
  const { network } = useSettings.getState();
  const w = useWallet.getState();
  w.set({ status: "connecting", error: null });
  try {
    const account = await connectWallet(option, network);
    offAccountListener?.();
    offAccountListener = onAccountsChanged(option, (accounts) => {
      const current = useWallet.getState();
      const next = accounts.find((a) => a.address === current.address) ?? accounts[0];
      if (!next) {
        invalidateSession("Your wallet disconnected.");
        useWallet.getState().set({ option: null, account: null, address: null, status: "disconnected" });
      } else if (next.address !== current.address) {
        invalidateSession("Your wallet switched accounts. Unlock again for the new account.");
        useWallet.getState().set({ account: next, address: next.address });
      }
    });
    if (w.address && w.address !== account.address) invalidateSession("A different wallet account connected.");
    useWallet.getState().set({ option, account, address: account.address, status: "connected", pickerOpen: false });
  } catch (error) {
    useWallet.getState().set({ status: "disconnected", error: (error as Error).message });
  }
}

export async function disconnect(): Promise<void> {
  const { option } = useWallet.getState();
  offAccountListener?.();
  offAccountListener = null;
  if (option) await disconnectWallet(option);
  invalidateSession("Wallet disconnected.");
  useActivity.getState().clear();
  useWallet.getState().set({ option: null, account: null, address: null, status: "disconnected" });
}

export interface UnlockCheck {
  ok: boolean;
  reason: string | null;
}

/** Why the private balance cannot be unlocked right now, if anything. */
export async function checkUnlock(): Promise<UnlockCheck> {
  const { demoMode, network } = useSettings.getState();
  if (demoMode) return { ok: true, reason: null };
  const w = useWallet.getState();
  if (!w.option || !w.account) return { ok: false, reason: "Connect a wallet first." };
  if (!w.option.canSignMessage) return { ok: false, reason: `${w.option.name} cannot sign messages, which deriving a private balance needs.` };
  if (!w.option.signsV1) return { ok: false, reason: `${w.option.name} does not report support for version-1 transactions, which Privacy Rings uses.` };
  try {
    const caps = await api.capabilities();
    const net = caps.privacy[network];
    if (!net.enabled) return { ok: false, reason: net.reason ?? "Private balances are not available on this network." };
  } catch {
    return { ok: false, reason: "NOCT's server could not report its configuration." };
  }
  return { ok: true, reason: null };
}

export async function unlockPrivate(): Promise<void> {
  const { demoMode, network } = useSettings.getState();
  const store = usePrivate.getState();
  if (demoMode) {
    store.set({
      status: "ready",
      demo: true,
      owner: DEMO_WALLET,
      network,
      balances: DEMO_PRIVATE_BALANCES.map((b) => ({ ...b })),
      history: [
        { id: "demo-h1", kind: "privateTransfer", direction: "inbound", asset: USDC_MINT, amount: 240_000_000n },
        { id: "demo-h2", kind: "deposit", direction: "inbound", asset: USDC_MINT, amount: 400_000_000n },
      ],
      registered: true,
      lastSyncedAt: Date.now(),
      error: null,
    });
    return;
  }
  const check = await checkUnlock();
  if (!check.ok) {
    store.set({ status: "error", error: check.reason });
    return;
  }
  const w = useWallet.getState();
  const epoch = w.epoch;
  store.set({ status: "unlocking", error: null });
  try {
    const { openPrivacySession } = await import("@/lib/adapters/privacy/spr");
    const session = await openPrivacySession({
      network,
      origin: window.location.origin,
      owner: w.address!,
      ownerPublicKey: new Uint8Array(w.account!.publicKey),
      signDerivationMessage: (message) => signExactMessage(w.option!, w.account!, message),
    });
    if (useWallet.getState().epoch !== epoch) {
      session.destroy();
      return;
    }
    setPrivacySession(session);
    usePrivate.getState().set({ status: "syncing", owner: w.address, network, demo: false });
    await session.sync();
    const registration = await session.buildRegistration();
    if (useWallet.getState().epoch !== epoch || getPrivacySession() !== session) return;
    usePrivate.getState().set({ status: "ready", balances: session.balances(), history: session.history(), registered: registration === null, lastSyncedAt: Date.now() });
  } catch (error) {
    setPrivacySession(null);
    usePrivate.getState().set({ status: "error", error: (error as Error).message || "The private balance could not be unlocked." });
  }
}

export async function resyncPrivate(): Promise<void> {
  const session = getPrivacySession();
  const store = usePrivate.getState();
  if (store.demo) {
    store.set({ lastSyncedAt: Date.now() });
    return;
  }
  if (!session) return;
  store.set({ status: "syncing" });
  try {
    await session.sync();
    usePrivate.getState().set({ status: "ready", balances: session.balances(), history: session.history(), lastSyncedAt: Date.now() });
  } catch (error) {
    usePrivate.getState().set({ status: "ready", error: (error as Error).message });
  }
}
