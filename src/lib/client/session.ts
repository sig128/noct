"use client";

import { NETWORK } from "@/lib/operations/intent";
import { api } from "./api";
import { getPrivacySession, journal, reservations, setPrivacySession, useActivity, usePrivate, useWallet } from "./stores";
import { connectWallet, disconnectWallet, onAccountsChanged, signExactMessage, type WalletOption } from "@/lib/wallet/standard";
import type { UnlockMethod } from "@/lib/adapters/privacy/unlock";
import { closeWallets } from "./wallets";
import type { PrivacySession } from "@/lib/adapters/privacy/spr";
import { useTxFlow, txFlow } from "./tx-flow";

let offAccountListener: (() => void) | null = null;

/** Clears protected views and anything tied to the previous wallet or account. */
export function invalidateSession(reason: string): void {
  useWallet.getState().bump();
  usePrivate.getState().lock(reason);
  // NOCT wallets belong to the wallet that signed for them.
  closeWallets();
  const flow = useTxFlow.getState();
  if (flow.open && !["submitting", "confirming", "pendingRecovery", "preparing"].includes(flow.phase)) txFlow.cancel(reason);
  journal.clearFinished();
  reservations.clear();
}

export async function connect(option: WalletOption): Promise<void> {
  const w = useWallet.getState();
  w.set({ status: "connecting", error: null });
  try {
    const account = await connectWallet(option, NETWORK);
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
      } else if (next !== current.account) {
        // Same account in a new object: keep the wallet's current one for signing.
        useWallet.getState().set({ account: next });
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
  const w = useWallet.getState();
  if (!w.option || !w.account) return { ok: false, reason: "Connect a wallet first." };
  if (!w.option.canSignMessage) return { ok: false, reason: `${w.option.name} cannot sign messages, which deriving a private balance needs.` };
  if (!w.option.signsV1) return { ok: false, reason: `${w.option.name} does not report support for version-1 transactions, which Privacy Rings uses.` };
  try {
    const caps = await api.capabilities();
    if (!caps.privacy.enabled) return { ok: false, reason: caps.privacy.reason ?? "Private balances are not available on this deployment." };
  } catch {
    return { ok: false, reason: "NOCT's server could not report its configuration." };
  }
  return { ok: true, reason: null };
}

/**
 * Unlocks with Privacy Rings' standard derivation message, or with NOCT's
 * unlock text when the wallet refuses that message (Phantom) or the standard
 * keys do not match this wallet's registration. See adapters/privacy/unlock.ts.
 */
export async function unlockPrivate(): Promise<void> {
  const store = usePrivate.getState();
  const check = await checkUnlock();
  if (!check.ok) {
    store.set({ status: "error", error: check.reason });
    return;
  }
  const w = useWallet.getState();
  const epoch = w.epoch;
  const stale = () => useWallet.getState().epoch !== epoch;
  store.set({ status: "unlocking", error: null });

  let method: UnlockMethod = "standard";
  let firstError: unknown = null;
  try {
    const [{ openPrivacySession }, { nextUnlockMethod }] = await Promise.all([import("@/lib/adapters/privacy/spr"), import("@/lib/adapters/privacy/unlock")]);
    /** Derives keys one way, then reads the balance and checks the keys against the wallet's registration. */
    const open = async (how: UnlockMethod): Promise<{ session: PrivacySession; registration: Uint8Array | null } | null> => {
      usePrivate.getState().set({ status: "unlocking" });
      const session = await openPrivacySession({
        network: NETWORK,
        origin: window.location.origin,
        owner: w.address!,
        ownerPublicKey: new Uint8Array(w.account!.publicKey),
        method: how,
        signDerivationMessage: (message) => signExactMessage(w.option!, w.account!, message),
      });
      if (stale()) {
        session.destroy();
        return null;
      }
      setPrivacySession(session);
      usePrivate.getState().set({ status: "syncing", owner: w.address, network: NETWORK });
      try {
        await session.sync();
        return { session, registration: await session.buildRegistration() };
      } catch (error) {
        if (getPrivacySession() === session) setPrivacySession(null);
        throw error;
      }
    };

    let opened: Awaited<ReturnType<typeof open>>;
    try {
      opened = await open(method);
    } catch (error) {
      const next = nextUnlockMethod(method, error);
      if (!next || stale()) throw error;
      firstError = error;
      method = next;
      opened = await open(method);
    }
    if (!opened || stale() || getPrivacySession() !== opened.session) return;
    const { session, registration } = opened;
    usePrivate.getState().set({ status: "ready", method, balances: session.balances(), history: session.history(), registered: registration === null, lastSyncedAt: Date.now() });
  } catch (error) {
    setPrivacySession(null);
    usePrivate.getState().set({ status: "error", error: unlockError(error, method, firstError, w.option?.name ?? "This wallet") });
  }
}

/** The message to show when unlocking fails. */
export function unlockError(error: unknown, method: UnlockMethod, firstError: unknown, walletName: string): string {
  const mismatch = (error as { code?: unknown } | null)?.code === "WALLET_USER_RECORD_KEYS_MISMATCH";
  const refusedStandard = (firstError as { code?: unknown } | null)?.code === "refused_format" || (firstError as { code?: unknown } | null)?.code === "altered_message";
  if (method === "noct" && mismatch && refusedStandard) {
    return `This wallet's private balance was set up with Privacy Rings' standard message, which ${walletName} won't sign. Open it with a wallet app that signs that message, using the same account.`;
  }
  return (error as Error | null)?.message || "The private balance could not be unlocked.";
}

export async function resyncPrivate(): Promise<void> {
  const session = getPrivacySession();
  const store = usePrivate.getState();
  if (!session) return;
  store.set({ status: "syncing" });
  try {
    await session.sync();
    usePrivate.getState().set({ status: "ready", balances: session.balances(), history: session.history(), lastSyncedAt: Date.now() });
  } catch (error) {
    usePrivate.getState().set({ status: "ready", error: (error as Error).message });
  }
}
