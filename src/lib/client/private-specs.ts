"use client";

import { formatAmount } from "@/lib/decimal";
import type { Network, PrivateIntent } from "@/lib/operations/intent";
import { PROFILES, type PrivacyClass } from "@/lib/privacy/model";
import { PRIVACY_PROGRAMS } from "@/lib/tx/programs";
import { NATIVE_SOL_MINT } from "@/lib/tokens/types";
import { describePrivacyError, type PrivacySession } from "@/lib/adapters/privacy/spr";
import { getPrivacySession, usePrivate } from "./stores";
import type { ReviewRow, SubmitResult, TxSpec } from "./tx-flow";

interface Common {
  network: Network;
  signer: string;
  demo: boolean;
  assetMint: string;
  symbol: string;
  decimals: number;
  amount: bigint;
  token2022: boolean;
  onSettled?(): void;
}

function session(): PrivacySession {
  const s = getPrivacySession();
  if (!s) throw new Error("Unlock your private balance first.");
  return s;
}

function refreshStore(): void {
  const s = getPrivacySession();
  if (!s) return;
  try {
    usePrivate.getState().set({ balances: s.balances(), history: s.history(), lastSyncedAt: Date.now() });
  } catch {
    // locked meanwhile
  }
}

function demoApply(kind: "deposit" | "transfer" | "withdrawal", mint: string, amount: bigint): void {
  const st = usePrivate.getState();
  const balances = st.balances.map((b) => ({ ...b }));
  const row = balances.find((b) => b.mint === mint);
  if (kind === "deposit") {
    if (row) row.amount += amount;
    else balances.push({ mint, amount, notes: 1 });
  } else if (row) {
    row.amount = row.amount > amount ? row.amount - amount : 0n;
  }
  st.set({
    balances: balances.filter((b) => b.amount > 0n),
    history: [
      {
        id: `demo-${Date.now()}`,
        kind: kind === "deposit" ? "deposit" : kind === "transfer" ? "privateTransfer" : "publicWithdrawal",
        direction: kind === "deposit" ? "inbound" : "outbound",
        asset: mint,
        amount,
      },
      ...st.history,
    ],
    lastSyncedAt: Date.now(),
  });
}

async function submitPrivate(signed: Uint8Array, demo: boolean, kind: "deposit" | "transfer" | "withdrawal" | "registration", mint: string, amount: bigint): Promise<SubmitResult> {
  if (demo) {
    await new Promise((r) => setTimeout(r, 900));
    if (kind !== "registration") demoApply(kind, mint, amount);
    else usePrivate.getState().set({ registered: true });
    return { status: "confirmed", signature: `demo-${Math.random().toString(36).slice(2, 10)}`, rows: [{ label: "Result", value: "Simulated in Demo mode. Nothing was sent.", tone: "warn" }] };
  }
  const s = session();
  const signature = await s.signatureOf(signed).catch(() => null);
  try {
    const { signature: sig, slot } = await s.submit(signed);
    refreshStore();
    if (kind === "registration") usePrivate.getState().set({ registered: true });
    return { status: "confirmed", signature: sig, rows: [{ label: "Landed in slot", value: slot.toString(), tone: "muted" }] };
  } catch (error) {
    const e = describePrivacyError(error);
    return { status: "unknown", signature, message: e.message };
  }
}

function intent(kind: PrivateIntent["kind"], c: Common, operationId: string, recipient: string, privacyClass: PrivacyClass, requested: PrivacyClass): PrivateIntent {
  return {
    kind,
    operationId,
    network: c.network,
    adapter: "helius-privacy-rings-default",
    protocolVersion: "@heliuslabs/spr@0.9.0-alpha",
    privacyClass,
    requestedPrivacyClass: requested,
    expiresAt: Date.now() + 60_000,
    allowedPrograms: PRIVACY_PROGRAMS,
    signer: c.signer,
    assetMint: c.assetMint,
    amount: c.amount,
    recipient,
  };
}

const policy = (signer: string) => () => ({ feePayer: signer, allowedPrograms: PRIVACY_PROGRAMS, maxSigners: 2, allowedVersions: [1, 0] as (0 | 1)[] });

const assetParam = (mint: string) => (mint === NATIVE_SOL_MINT ? null : mint);

export function shieldSpec(c: Common & { tokenAccount?: string; available: bigint }): TxSpec {
  const amountText = `${formatAmount(c.amount, c.decimals)} ${c.symbol}`;
  return {
    kind: "privateDeposit",
    title: `Deposit ${c.symbol} to your private balance`,
    network: c.network,
    signer: c.signer,
    demo: c.demo,
    disclosure: PROFILES.privateDeposit,
    requestedPrivacy: "public",
    activityDetail: amountText,
    primaryLabel: c.demo ? "Simulate deposit" : "Sign and deposit",
    reserve: { mint: c.assetMint, amount: c.amount, source: "public", available: c.available },
    async build({ operationId }) {
      const wire = c.demo
        ? new Uint8Array()
        : await session().buildDeposit({ asset: assetParam(c.assetMint), amount: c.amount, ...(c.tokenAccount ? { tokenAccount: c.tokenAccount } : {}), token2022: c.token2022 });
      const rows: ReviewRow[] = [
        { label: "You deposit", value: amountText, sensitive: true },
        { label: "From", value: "Your public wallet", tone: "muted" },
        { label: "Visible on chain", value: "This deposit: your address, the token and the amount." },
        { label: "Afterwards", value: "Transfers from the private balance hide token and amount; addresses stay visible.", tone: "private" },
      ];
      return { wire, lastValidBlockHeight: null, intent: intent("privateDeposit", c, operationId, c.signer, "public", "public"), rows, expiresAt: Date.now() + 60_000 };
    },
    policy: policy(c.signer),
    submit: (signed) => submitPrivate(signed, c.demo, "deposit", c.assetMint, c.amount),
    onSettled: c.onSettled,
  };
}

export function privateTransferSpec(c: Common & { recipient: string }): TxSpec {
  const amountText = `${formatAmount(c.amount, c.decimals)} ${c.symbol}`;
  return {
    kind: "privateTransfer",
    title: `Send ${c.symbol} privately`,
    network: c.network,
    signer: c.signer,
    demo: c.demo,
    disclosure: PROFILES.privateTransfer,
    requestedPrivacy: "confidential_transfer",
    activityDetail: amountText,
    primaryLabel: c.demo ? "Simulate send" : "Sign and send",
    async build({ operationId }) {
      const wire = c.demo
        ? new Uint8Array()
        : await session().buildTransfer({
            recipient: c.recipient,
            asset: assetParam(c.assetMint),
            amount: c.amount,
            expect: { kind: "transfer", asset: c.assetMint, amount: c.amount },
          });
      const rows: ReviewRow[] = [
        { label: "You send", value: amountText, sensitive: true, tone: "private" },
        { label: "To", value: c.recipient, wrap: true },
        { label: "Hidden on chain", value: "Token and amount" },
        { label: "Visible on chain", value: "Your address and the recipient's address" },
        { label: "Proof", value: "Generated by Helius's attested prover enclave", tone: "muted" },
      ];
      return { wire, lastValidBlockHeight: null, intent: intent("privateTransfer", c, operationId, c.recipient, "confidential_transfer", "confidential_transfer"), rows, expiresAt: Date.now() + 60_000 };
    },
    policy: policy(c.signer),
    simulate: true,
    submit: (signed) => submitPrivate(signed, c.demo, "transfer", c.assetMint, c.amount),
    // An unregistered recipient cannot receive privately; offer the public route explicitly.
    alternative: (code) =>
      code === "WALLET_RECIPIENT_NOT_REGISTERED"
        ? { label: "Review a public withdrawal instead", spec: () => withdrawalSpec({ ...c, requestedPrivacy: "confidential_transfer" }) }
        : null,
    onSettled: c.onSettled,
  };
}

/** Public withdrawal. When the user asked for a private transfer, the downgrade must be accepted explicitly. */
export function withdrawalSpec(c: Common & { recipient: string; requestedPrivacy: PrivacyClass; title?: string; notice?: string }): TxSpec {
  const amountText = `${formatAmount(c.amount, c.decimals)} ${c.symbol}`;
  const downgraded = c.requestedPrivacy !== "public";
  return {
    kind: "privateWithdrawal",
    title: c.title ?? (downgraded ? `Send ${c.symbol} as a public withdrawal` : `Withdraw ${c.symbol} to a public address`),
    network: c.network,
    signer: c.signer,
    demo: c.demo,
    disclosure: PROFILES.privateWithdrawal,
    requestedPrivacy: c.requestedPrivacy,
    downgradeNotice: downgraded
      ? (c.notice ?? "The recipient has no private address, so this becomes a public withdrawal: the token, amount and recipient will be visible on chain.")
      : undefined,
    activityDetail: amountText,
    primaryLabel: c.demo ? "Simulate withdrawal" : "Sign and withdraw",
    async build({ operationId }) {
      const wire = c.demo
        ? new Uint8Array()
        : await session().buildWithdrawal({
            recipient: c.recipient,
            asset: assetParam(c.assetMint),
            amount: c.amount,
            token2022: c.token2022,
            expect: { kind: "withdrawal", asset: c.assetMint, amount: c.amount, recipient: c.recipient },
          });
      const rows: ReviewRow[] = [
        { label: "You withdraw", value: amountText, sensitive: true },
        { label: "To public address", value: c.recipient, wrap: true },
        { label: "Visible on chain", value: "Token, amount and recipient", tone: "warn" },
      ];
      return { wire, lastValidBlockHeight: null, intent: intent("privateWithdrawal", c, operationId, c.recipient, "public", c.requestedPrivacy), rows, expiresAt: Date.now() + 60_000 };
    },
    policy: policy(c.signer),
    submit: (signed) => submitPrivate(signed, c.demo, "withdrawal", c.assetMint, c.amount),
    onSettled: c.onSettled,
  };
}

export function registrationSpec(c: { network: Network; signer: string; demo: boolean; onSettled?(): void }): TxSpec {
  return {
    kind: "privateRegistration",
    title: "Register your private address",
    network: c.network,
    signer: c.signer,
    demo: c.demo,
    disclosure: { ...PROFILES.privateDeposit, id: "registration", summary: "Public registration of your viewing key.", asset: "not_applicable", amount: "not_applicable" },
    requestedPrivacy: "public",
    activityDetail: "Address registry",
    primaryLabel: c.demo ? "Simulate" : "Sign and register",
    async build({ operationId }) {
      let wire: Uint8Array = new Uint8Array();
      if (!c.demo) {
        const built = await session().buildRegistration();
        if (!built) {
          usePrivate.getState().set({ registered: true });
          throw new Error("This wallet is already registered with these keys.");
        }
        wire = new Uint8Array(built);
      }
      return {
        wire,
        lastValidBlockHeight: null,
        expiresAt: Date.now() + 60_000,
        intent: intent("privateRegistration", { ...c, assetMint: NATIVE_SOL_MINT, symbol: "SOL", decimals: 9, amount: 0n, token2022: false }, operationId, c.signer, "public", "public"),
        rows: [
          { label: "What it does", value: "Publishes the link between your Solana address and your private address, so others can send to you privately." },
          { label: "Visible on chain", value: "That this address uses Privacy Rings" },
          { label: "Cost", value: "Account rent and a network fee" },
        ],
      };
    },
    policy: policy(c.signer),
    submit: (signed) => submitPrivate(signed, c.demo, "registration", NATIVE_SOL_MINT, 0n),
    onSettled: c.onSettled,
  };
}
