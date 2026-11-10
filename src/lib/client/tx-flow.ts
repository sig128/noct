"use client";

import { create } from "zustand";
import type { Network, OperationIntent } from "@/lib/operations/intent";
import { approveIntent, assertApprovalValid, ApprovalError, newOperationId } from "@/lib/operations/intent";
import type { Phase } from "@/lib/operations/state-machine";
import { reconcileSignature } from "@/lib/operations/reconcile";
import { assertNoSilentDowngrade, PrivacyDowngradeError, type DisclosureProfile, type PrivacyClass } from "@/lib/privacy/model";
import { checkTransactionPolicy, inspectTransactionBytes, bytesToBase64, type InspectedTransaction, type TransactionPolicy } from "@/lib/tx/inspect";
import { getTransactionDecoder } from "@solana/kit";
import { signTransaction, WalletActionError } from "@/lib/wallet/standard";
import { journal, reservations, useActivity, useWallet, type ActivityItem } from "./stores";
import { solanaRpc } from "./rpc";

export interface ReviewRow {
  label: string;
  value: string;
  tone?: "default" | "muted" | "warn" | "private" | "accent";
  /** Long values (addresses) that may wrap. */
  wrap?: boolean;
  /** Treat as a protected amount (masked when balance masking is on). */
  sensitive?: boolean;
}

export interface BuiltTx {
  /** Unsigned wire transaction; empty in demo mode. */
  wire: Uint8Array;
  lastValidBlockHeight: bigint | null;
  intent: OperationIntent;
  rows: ReviewRow[];
  expiresAt: number;
  /** Extra context for submit (e.g. Jupiter requestId and router). */
  meta?: Record<string, string>;
}

export type SubmitResult =
  | { status: "confirmed"; signature: string; rows?: ReviewRow[] }
  | { status: "failed"; signature: string | null; message: string; retryable: boolean }
  | { status: "unknown"; signature: string | null; message: string };

export interface TxSpec {
  kind: ActivityItem["kind"];
  title: string;
  network: Network;
  signer: string;
  demo: boolean;
  disclosure: DisclosureProfile;
  requestedPrivacy: PrivacyClass;
  /** Shown when the prepared operation is weaker than requested; must be accepted explicitly. */
  downgradeNotice?: string;
  activityDetail: string;
  primaryLabel: string;
  build(ctx: { signal: AbortSignal; operationId: string }): Promise<BuiltTx>;
  policy?(built: BuiltTx): TransactionPolicy | null;
  simulate?: boolean;
  submit(signed: Uint8Array, built: BuiltTx): Promise<SubmitResult>;
  /** Funds to hold while in flight. */
  reserve?: { mint: string; amount: bigint; source: "public" | "private"; available: bigint };
  /** An explicit alternative to offer when the build fails with a known code. */
  alternative?(code: string): { label: string; spec(): TxSpec } | null;
  onSettled?(): void;
}

export interface TxFlowState {
  open: boolean;
  spec: TxSpec | null;
  operationId: string | null;
  phase: Phase;
  built: BuiltTx | null;
  inspection: InspectedTransaction | null;
  violations: string[];
  simulation: { ok: boolean; message: string; units: number | null } | null;
  downgradeAccepted: boolean;
  error: string | null;
  errorCode: string | null;
  note: string | null;
  signature: string | null;
  receipt: ReviewRow[] | null;
  walletEpoch: number;
}

const initial: Omit<TxFlowState, "walletEpoch"> = {
  open: false,
  spec: null,
  operationId: null,
  phase: "editing",
  built: null,
  inspection: null,
  violations: [],
  simulation: null,
  downgradeAccepted: false,
  error: null,
  errorCode: null,
  note: null,
  signature: null,
  receipt: null,
};

export const useTxFlow = create<TxFlowState>()(() => ({ ...initial, walletEpoch: 0 }));

const set = (p: Partial<TxFlowState>) => useTxFlow.setState(p);
const get = () => useTxFlow.getState();

let buildController: AbortController | null = null;

function move(to: Phase, note?: string) {
  const id = get().operationId;
  if (id) journal.move(id, to, note);
  set({ phase: to });
  if (id) useActivity.getState().patch(id, { phase: to, ...(note ? { note } : {}) });
}

function signatureOf(signed: Uint8Array, feePayer: string): string | null {
  try {
    const decoded = getTransactionDecoder().decode(signed);
    const sig = (decoded.signatures as Record<string, Uint8Array | null>)[feePayer];
    if (!sig || sig.every((b) => b === 0)) return null;
    // base58 encode via kit
    return base58(sig);
  } catch {
    return null;
  }
}

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let out = "";
  while (n > 0n) {
    out = ALPHABET[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = `1${out}`;
  }
  return out;
}

function inFlight(phase: Phase) {
  return phase === "preparing" || phase === "submitting" || phase === "confirming" || phase === "pendingRecovery";
}

export const txFlow = {
  async start(spec: TxSpec): Promise<void> {
    const current = get();
    if (current.open && inFlight(current.phase)) {
      set({ note: "Another operation is still in flight. Wait for it to settle." });
      return;
    }
    buildController?.abort();
    buildController = new AbortController();
    const operationId = newOperationId();
    journal.create(operationId, spec.kind);
    journal.move(operationId, "quoting");
    set({ ...initial, open: true, spec, operationId, phase: "quoting", walletEpoch: useWallet.getState().epoch });
    useActivity.getState().upsert({
      operationId,
      kind: spec.kind,
      title: spec.title,
      detail: spec.activityDetail,
      network: spec.network,
      privacyClass: spec.disclosure.privacyClass,
      phase: "quoting",
      signature: null,
      createdAt: Date.now(),
      demo: spec.demo,
      note: null,
    });
    await txFlow.build();
  },

  async build(): Promise<void> {
    const { spec, operationId } = get();
    if (!spec || !operationId) return;
    const controller = buildController ?? new AbortController();
    try {
      const built = await spec.build({ signal: controller.signal, operationId });
      if (controller.signal.aborted || get().operationId !== operationId) return;
      let inspection: InspectedTransaction | null = null;
      let violations: string[] = [];
      let simulation: TxFlowState["simulation"] = null;
      if (!spec.demo) {
        inspection = inspectTransactionBytes(built.wire);
        const policy = spec.policy?.(built);
        if (policy) violations = checkTransactionPolicy(inspection, policy).violations;
        if (spec.simulate !== false && violations.length === 0) {
          try {
            const sim = await solanaRpc.simulate(spec.network, bytesToBase64(built.wire));
            simulation = sim.err
              ? { ok: false, message: simulationMessage(sim.err, sim.logs), units: sim.unitsConsumed }
              : { ok: true, message: "Simulation passed against current chain state.", units: sim.unitsConsumed };
          } catch {
            simulation = { ok: false, message: "Simulation could not run. NOCT will not ask you to sign an unsimulated transaction.", units: null };
          }
        }
      }
      journal.move(operationId, "review");
      set({ built, inspection, violations, simulation, phase: "review" });
      move("awaitingApproval");
    } catch (error) {
      if (controller.signal.aborted) return;
      journal.move(operationId, "retryableFailure", "Build failed");
      set({ phase: "retryableFailure", error: (error as Error).message || "The transaction could not be prepared.", errorCode: (error as { code?: string }).code ?? null });
      useActivity.getState().patch(operationId, { phase: "retryableFailure", note: "Not submitted" });
    }
  },

  setDowngradeAccepted(v: boolean) {
    set({ downgradeAccepted: v });
  },

  canApprove(): { ok: boolean; reason: string | null } {
    const s = get();
    if (!s.spec || !s.built) return { ok: false, reason: "Preparing…" };
    if (s.phase !== "awaitingApproval" && s.phase !== "rejected") return { ok: false, reason: null };
    if (s.violations.length > 0) return { ok: false, reason: "Blocked: the transaction failed NOCT's safety checks." };
    if (s.simulation && !s.simulation.ok) return { ok: false, reason: "Blocked: the transaction fails in simulation." };
    if (s.spec.downgradeNotice && !s.downgradeAccepted) return { ok: false, reason: "Confirm the privacy change to continue." };
    return { ok: true, reason: null };
  },

  async approve(): Promise<void> {
    const s = get();
    const { spec, built, operationId } = s;
    if (!spec || !built || !operationId) return;
    if (!txFlow.canApprove().ok) return;
    const wallet = useWallet.getState();
    if (!spec.demo && (wallet.epoch !== s.walletEpoch || wallet.address !== spec.signer)) {
      txFlow.cancel("The wallet or network changed. Nothing was signed.");
      return;
    }
    try {
      const approval = await approveIntent(built.intent);
      await assertApprovalValid(built.intent, approval);
      assertNoSilentDowngrade(spec.requestedPrivacy, built.intent.privacyClass, s.downgradeAccepted ? built.intent.privacyClass : null);
    } catch (error) {
      if (error instanceof ApprovalError && error.code === "expired") {
        move("staleQuote", "Expired before approval");
        set({ error: "These terms expired. Refresh to get current ones." });
        return;
      }
      set({ error: error instanceof PrivacyDowngradeError ? error.message : (error as Error).message });
      return;
    }

    if (get().phase === "rejected") move("awaitingApproval");

    if (spec.reserve) {
      try {
        reservations.reserve({ operationId, mint: spec.reserve.mint, amount: spec.reserve.amount, source: spec.reserve.source }, spec.reserve.available);
      } catch (error) {
        set({ error: (error as Error).message });
        return;
      }
    }

    move("preparing");
    let signed: Uint8Array;
    if (spec.demo) {
      signed = new Uint8Array();
    } else {
      if (!wallet.option || !wallet.account) {
        reservations.release(operationId);
        move("rejected");
        set({ error: "Connect your wallet to sign." });
        return;
      }
      try {
        signed = await signTransaction(wallet.option, wallet.account, built.wire, spec.network);
      } catch (error) {
        reservations.release(operationId);
        move("rejected", "Signature declined");
        set({ error: error instanceof WalletActionError ? error.message : "The wallet could not sign." });
        return;
      }
      // The wallet may not alter what was reviewed unless the result still passes policy.
      const before = getTransactionDecoder().decode(built.wire).messageBytes;
      const after = getTransactionDecoder().decode(signed).messageBytes;
      const same = before.length === after.length && before.every((b, i) => b === after[i]);
      if (!same) {
        const policy = spec.policy?.(built);
        const recheck = policy ? checkTransactionPolicy(inspectTransactionBytes(signed), policy) : { ok: false, violations: ["No policy"] };
        if (!recheck.ok) {
          reservations.release(operationId);
          move("rejected", "Wallet modified the transaction");
          set({ error: "Your wallet changed the transaction after review in a way NOCT cannot verify. Nothing was sent." });
          return;
        }
        set({ note: "Your wallet adjusted the transaction; NOCT re-checked it against the same rules." });
      }
    }

    const signature = spec.demo ? null : signatureOf(signed, s.inspection?.feePayer ?? spec.signer);
    move("submitting");
    if (signature) {
      journal.recordSubmission(operationId, signature, built.lastValidBlockHeight);
      set({ signature });
      useActivity.getState().patch(operationId, { signature });
    }

    let result: SubmitResult;
    try {
      result = await spec.submit(signed, built);
    } catch (error) {
      result = { status: "unknown", signature, message: (error as Error).message || "No response from the network." };
    }
    await txFlow.settle(result);
  },

  async settle(result: SubmitResult): Promise<void> {
    const { spec, operationId, built } = get();
    if (!spec || !operationId || !built) return;
    const signature = result.signature ?? get().signature;
    if (signature && signature !== get().signature) {
      set({ signature });
      useActivity.getState().patch(operationId, { signature });
      try {
        journal.recordSubmission(operationId, signature, built.lastValidBlockHeight);
      } catch {
        // already recorded
      }
    }
    if (result.status === "confirmed") {
      move("confirming");
      move("completed", "Confirmed");
      set({ receipt: result.rows ?? null, error: null });
      reservations.release(operationId);
      spec.onSettled?.();
      return;
    }
    if (result.status === "failed" && !signature) {
      // Rejected before it could land (e.g. invalid or expired at the relay).
      move("retryableFailure", "Not landed");
      set({ error: result.message });
      reservations.release(operationId);
      spec.onSettled?.();
      return;
    }
    move("pendingRecovery", result.status === "failed" ? "Checking the chain" : "Outcome unknown");
    set({ error: null, note: result.message });
    await txFlow.reconcile();
  },

  async reconcile(attempts = 30): Promise<void> {
    const { spec, operationId, built, signature } = get();
    if (!spec || !operationId || !built) return;
    if (!signature) {
      set({ note: "The submission's signature is unknown, so NOCT cannot check it. Do not retry; check your wallet's history." });
      return;
    }
    for (let i = 0; i < attempts; i += 1) {
      if (get().operationId !== operationId) return;
      const outcome = await reconcileSignature(signature, built.lastValidBlockHeight, {
        getSignatureStatus: (sig) => solanaRpc.getSignatureStatus(spec.network, sig),
        getBlockHeight: () => solanaRpc.getBlockHeight(spec.network),
      });
      if (outcome.kind === "landed_success") {
        journal.applyReconciliation(operationId, signature, outcome);
        set({ phase: "completed", note: "Confirmed on chain after reconciliation.", receipt: get().receipt ?? null });
        useActivity.getState().patch(operationId, { phase: "completed", note: "Confirmed" });
        reservations.release(operationId);
        spec.onSettled?.();
        return;
      }
      if (outcome.kind === "landed_failed" || outcome.kind === "expired_not_landed") {
        journal.applyReconciliation(operationId, signature, outcome);
        const message = outcome.kind === "landed_failed" ? "The transaction landed but failed on chain. Your funds did not move, apart from the network fee." : "The transaction expired without landing. Nothing moved. You can try again with fresh terms.";
        set({ phase: "retryableFailure", error: message, note: null });
        useActivity.getState().patch(operationId, { phase: "retryableFailure", note: outcome.kind === "landed_failed" ? "Failed on chain" : "Expired" });
        reservations.release(operationId);
        spec.onSettled?.();
        return;
      }
      set({ note: outcome.kind === "pending_valid" ? `Waiting for the network: still valid for ${outcome.blocksRemaining} blocks. Do not resubmit.` : outcome.reason });
      await new Promise((r) => setTimeout(r, 3_000));
    }
    set({ note: "Still unconfirmed. NOCT keeps this operation open; check again before trying anything new." });
  },

  /** Abandons the current terms (never in flight) and builds fresh ones under a new operation id. */
  async refresh(): Promise<void> {
    const { phase, spec } = get();
    if (!spec || inFlight(phase)) return;
    txFlow.cancel(undefined, { silent: true });
    await txFlow.start(spec);
  },

  cancel(note?: string, opts: { silent?: boolean } = {}): void {
    const { phase, operationId } = get();
    if (inFlight(phase)) {
      set({ note: "This operation is in flight and cannot be cancelled. It will settle on its own." });
      return;
    }
    buildController?.abort();
    if (operationId) {
      reservations.release(operationId);
      const rec = journal.get(operationId);
      if (rec) {
        const toEditing: Phase[] = ["quoting", "review", "staleQuote", "rejected", "retryableFailure", "unsupported"];
        if (toEditing.includes(rec.phase)) journal.move(operationId, "editing", note);
        else if (rec.phase === "awaitingApproval") journal.move(operationId, "cancelled", note);
        if (rec.phase !== "completed") {
          const item = useActivity.getState().items.find((i) => i.operationId === operationId);
          if (item && item.phase !== "completed" && item.phase !== "retryableFailure") {
            if (opts.silent) useActivity.setState((st) => ({ items: st.items.filter((i) => i.operationId !== operationId) }));
            else useActivity.getState().patch(operationId, { phase: "cancelled", note: note ?? "Cancelled before signing" });
          }
        }
      }
    }
    set({ ...initial, walletEpoch: useWallet.getState().epoch, note: note ?? null });
  },

  close(): void {
    const { phase } = get();
    if (inFlight(phase)) {
      // Keep tracking in the background; just hide the dialog.
      set({ open: false });
      return;
    }
    txFlow.cancel();
  },
};

function simulationMessage(err: unknown, logs: string[]): string {
  const text = JSON.stringify(err);
  if (/InsufficientFunds|insufficient funds|0x1\b/i.test(text + logs.join(" "))) return "Simulation failed: insufficient funds for this transaction.";
  if (/SlippageToleranceExceeded|0x1771/i.test(text + logs.join(" "))) return "Simulation failed: price moved beyond the slippage limit.";
  if (/BlockhashNotFound/i.test(text)) return "Simulation failed: the transaction's blockhash expired. Refresh.";
  return "Simulation failed. NOCT will not ask you to sign it.";
}
