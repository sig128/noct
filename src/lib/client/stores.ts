"use client";

import { useSyncExternalStore } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { WalletAccount } from "@wallet-standard/base";
import type { Network } from "@/lib/operations/intent";
import type { Phase } from "@/lib/operations/state-machine";
import type { PrivacyClass } from "@/lib/privacy/model";
import type { TokenInfo } from "@/lib/tokens/types";
import type { WalletOption } from "@/lib/wallet/standard";
import type { PrivacySession, PrivateBalance, PrivateHistoryRow } from "@/lib/adapters/privacy/spr";
import type { UnlockMethod } from "@/lib/adapters/privacy/unlock";
import { OperationJournal } from "@/lib/operations/journal";
import { ReservationBook } from "@/lib/balances/ledger";

// ---------------------------------------------------------------------------
// Settings: non-secret preferences, the only thing persisted to localStorage.
// ---------------------------------------------------------------------------

export interface Settings {
  maskBalances: boolean;
  lockAfterMinutes: number;
  /** null = let the venue estimate slippage. */
  slippageBps: number | null;
  setMaskBalances(v: boolean): void;
  setLockAfterMinutes(v: number): void;
  setSlippageBps(v: number | null): void;
}

type PersistedSettings = Pick<Settings, "maskBalances" | "lockAfterMinutes" | "slippageBps">;

/** Keeps only today's preferences from anything stored earlier (older versions also stored a network and a demo switch). */
export function sanitizeStoredSettings(stored: unknown): Partial<PersistedSettings> {
  const s = (stored ?? {}) as Record<string, unknown>;
  const out: Partial<PersistedSettings> = {};
  if (typeof s.maskBalances === "boolean") out.maskBalances = s.maskBalances;
  if (typeof s.lockAfterMinutes === "number" && Number.isFinite(s.lockAfterMinutes) && s.lockAfterMinutes >= 0) out.lockAfterMinutes = s.lockAfterMinutes;
  if (s.slippageBps === null || (typeof s.slippageBps === "number" && Number.isInteger(s.slippageBps) && s.slippageBps > 0 && s.slippageBps <= 5_000)) out.slippageBps = s.slippageBps as number | null;
  return out;
}

export const useSettings = create<Settings>()(
  persist(
    (set) => ({
      maskBalances: false,
      lockAfterMinutes: 10,
      slippageBps: null,
      setMaskBalances: (maskBalances) => set({ maskBalances }),
      setLockAfterMinutes: (lockAfterMinutes) => set({ lockAfterMinutes }),
      setSlippageBps: (slippageBps) => set({ slippageBps }),
    }),
    {
      name: "noct.settings.v1",
      version: 2,
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      partialize: (s): PersistedSettings => ({ maskBalances: s.maskBalances, lockAfterMinutes: s.lockAfterMinutes, slippageBps: s.slippageBps }),
      migrate: (stored) => sanitizeStoredSettings(stored) as Settings,
      merge: (stored, current) => ({ ...current, ...sanitizeStoredSettings(stored) }),
    },
  ),
);

/**
 * True once persisted settings are loaded. Quote and balance reads wait for it
 * so they run once with the stored slippage and masking, not first with defaults.
 */
export function useSettingsReady(): boolean {
  return useSyncExternalStore(
    (cb) => useSettings.persist.onFinishHydration(cb),
    () => useSettings.persist.hasHydrated(),
    () => false,
  );
}

// ---------------------------------------------------------------------------
// Wallet connection (public data only).
// ---------------------------------------------------------------------------

export interface WalletState {
  option: WalletOption | null;
  account: WalletAccount | null;
  address: string | null;
  status: "disconnected" | "connecting" | "connected";
  error: string | null;
  pickerOpen: boolean;
  /** Incremented whenever the wallet, account or network changes; in-flight work compares it. */
  epoch: number;
  set(partial: Partial<Omit<WalletState, "set" | "bump">>): void;
  bump(): void;
}

export const useWallet = create<WalletState>()((set) => ({
  option: null,
  account: null,
  address: null,
  status: "disconnected",
  error: null,
  pickerOpen: false,
  epoch: 0,
  set: (partial) => set(partial),
  bump: () => set((s) => ({ epoch: s.epoch + 1 })),
}));

// ---------------------------------------------------------------------------
// Swap draft: survives module navigation, never persisted.
// ---------------------------------------------------------------------------

export interface SwapDraft {
  input: TokenInfo | null;
  output: TokenInfo | null;
  amountText: string;
  requestedPrivacy: PrivacyClass;
  phase: Phase;
  reviewOpen: boolean;
  set(partial: Partial<Omit<SwapDraft, "set">>): void;
}

export const useSwapDraft = create<SwapDraft>()((set) => ({
  input: null,
  output: null,
  amountText: "",
  requestedPrivacy: "public",
  phase: "editing",
  reviewOpen: false,
  set: (partial) => set(partial),
}));

/** Send/receive draft, entered from the rail preview or the panel. Never in the URL. */
export interface TransferDraft {
  recipient: string;
  assetMint: string | null;
  amountText: string;
  set(partial: Partial<Omit<TransferDraft, "set">>): void;
}

export const useTransferDraft = create<TransferDraft>()((set) => ({
  recipient: "",
  assetMint: null,
  amountText: "",
  set: (partial) => set(partial),
}));

/** Cross-module hand-offs: a suggestion only; nothing executes until reviewed. */
export interface Handoff {
  earnAsset: string | null;
  borrowVault: number | null;
  set(partial: Partial<Omit<Handoff, "set">>): void;
}

export const useHandoff = create<Handoff>()((set) => ({
  earnAsset: null,
  borrowVault: null,
  set: (partial) => set(partial),
}));

// ---------------------------------------------------------------------------
// Private balance: decrypted state in memory only. Locking drops everything.
// ---------------------------------------------------------------------------

export type PrivateStatus = "locked" | "unlocking" | "syncing" | "ready" | "error";

export interface PrivateState {
  status: PrivateStatus;
  owner: string | null;
  network: Network | null;
  balances: PrivateBalance[];
  history: PrivateHistoryRow[];
  registered: boolean | null;
  lastSyncedAt: number | null;
  /** Which message the wallet signed to unlock (see adapters/privacy/unlock.ts). */
  method: UnlockMethod | null;
  error: string | null;
  set(partial: Partial<Omit<PrivateState, "set" | "lock">>): void;
  lock(reason?: string): void;
}

let activeSession: PrivacySession | null = null;

export function setPrivacySession(session: PrivacySession | null): void {
  if (activeSession && activeSession !== session) activeSession.destroy();
  activeSession = session;
}

export function getPrivacySession(): PrivacySession | null {
  return activeSession;
}

const lockedState = { status: "locked" as const, owner: null, network: null, balances: [], history: [], registered: null, lastSyncedAt: null, method: null };

export const usePrivate = create<PrivateState>()((set) => ({
  ...lockedState,
  error: null,
  set: (partial) => set(partial),
  lock: (reason) => {
    setPrivacySession(null);
    set({ ...lockedState, error: reason ?? null });
  },
}));

// ---------------------------------------------------------------------------
// Operations: journal + reservations, one per tab.
// ---------------------------------------------------------------------------

export const journal = new OperationJournal();
export const reservations = new ReservationBook();

export interface ActivityItem {
  operationId: string;
  kind: "swap" | "earnDeposit" | "earnWithdraw" | "borrow" | "privateDeposit" | "privateTransfer" | "privateWithdrawal" | "privateRegistration";
  title: string;
  /** Amount text, masked in views when balance masking is on. */
  detail: string;
  network: Network;
  privacyClass: PrivacyClass;
  phase: Phase;
  signature: string | null;
  createdAt: number;
  note: string | null;
}

export interface ActivityState {
  items: ActivityItem[];
  upsert(item: ActivityItem): void;
  patch(operationId: string, partial: Partial<ActivityItem>): void;
  clear(): void;
}

export const useActivity = create<ActivityState>()((set) => ({
  items: [],
  upsert: (item) => set((s) => ({ items: [item, ...s.items.filter((i) => i.operationId !== item.operationId)].slice(0, 100) })),
  patch: (operationId, partial) => set((s) => ({ items: s.items.map((i) => (i.operationId === operationId ? { ...i, ...partial } : i)) })),
  clear: () => set({ items: [] }),
}));
