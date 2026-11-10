import { describe, expect, it } from "vitest";
import { canTransition, transition, InvalidTransitionError, canEdit } from "@/lib/operations/state-machine";
import { OperationJournal, DuplicateSubmissionError } from "@/lib/operations/journal";
import { reconcileSignature, type SignatureStatus } from "@/lib/operations/reconcile";
import { EscrowLedger, EscrowError, type EscrowTerms } from "@/lib/operations/two-phase";

describe("operation state machine", () => {
  it("follows the documented happy path", () => {
    const path = ["editing", "quoting", "review", "awaitingApproval", "preparing", "submitting", "confirming", "completed"] as const;
    for (let i = 1; i < path.length; i += 1) expect(transition(path[i - 1]!, path[i]!)).toBe(path[i]);
  });
  it("refuses shortcuts and retries while funds may be in flight", () => {
    expect(() => transition("editing", "submitting")).toThrow(InvalidTransitionError);
    expect(canTransition("submitting", "editing")).toBe(false);
    expect(canTransition("pendingRecovery", "quoting")).toBe(false);
    expect(canTransition("confirming", "review")).toBe(false);
    expect(canEdit("submitting")).toBe(false);
    expect(canEdit("pendingRecovery")).toBe(false);
  });
  it("a rejected signature returns to a recoverable review state", () => {
    expect(canTransition("preparing", "rejected")).toBe(true);
    expect(canTransition("rejected", "awaitingApproval")).toBe(true);
    expect(canTransition("rejected", "review")).toBe(true);
  });
  it("has distinct terminal and recovery states", () => {
    for (const s of ["staleQuote", "unsupported", "rejected", "retryableFailure", "pendingRecovery", "refunded", "cancelled"] as const) {
      expect(canTransition(s, s === "pendingRecovery" ? "pendingRecovery" : "editing") || canTransition(s, "review") || canTransition(s, "quoting")).toBe(true);
    }
  });
});

function chain(initial: { found: boolean; height: bigint; landedAt?: number }) {
  let calls = 0;
  let height = initial.height;
  return {
    advance(blocks: bigint) {
      height += blocks;
    },
    deps: {
      getSignatureStatus: async (): Promise<SignatureStatus> => {
        calls += 1;
        if (initial.landedAt !== undefined && calls >= initial.landedAt) return { found: true, err: null, confirmationStatus: "confirmed", slot: 100n };
        return initial.found ? { found: true, err: null, confirmationStatus: "confirmed", slot: 100n } : { found: false };
      },
      getBlockHeight: async () => height,
    },
  };
}

describe("timeout after submission, then reconciliation", () => {
  it("a timeout is not a failure: while the blockhash is valid nothing new may be funded", async () => {
    const j = new OperationJournal();
    j.create("op", "swap");
    for (const p of ["quoting", "review", "awaitingApproval", "preparing", "submitting"] as const) j.move("op", p);
    j.recordSubmission("op", "sigA", 1_000n);
    const c = chain({ found: false, height: 990n });
    const outcome = await reconcileSignature("sigA", 1_000n, c.deps);
    expect(outcome).toEqual({ kind: "pending_valid", blocksRemaining: 10n });
    expect(j.applyReconciliation("op", "sigA", outcome)).toBe("pendingRecovery");
    expect(j.canFundNewTransaction("op")).toBe(false);
    expect(() => j.recordSubmission("op", "sigB", 1_100n)).toThrow(DuplicateSubmissionError);
    // Rebroadcasting the identical signed transaction is idempotent.
    expect(() => j.recordSubmission("op", "sigA", 1_000n)).not.toThrow();
  });

  it("a transaction that landed late is reported as completed, not retried", async () => {
    const j = new OperationJournal();
    j.create("op", "swap");
    for (const p of ["quoting", "review", "awaitingApproval", "preparing", "submitting"] as const) j.move("op", p);
    j.recordSubmission("op", "sigA", 1_000n);
    const c = chain({ found: false, height: 1_200n, landedAt: 2 });
    const outcome = await reconcileSignature("sigA", 1_000n, c.deps);
    // Not found on the first read, past expiry, found on the re-check: landed.
    expect(outcome.kind).toBe("landed_success");
    expect(j.applyReconciliation("op", "sigA", outcome)).toBe("completed");
  });

  it("only a provably expired, absent signature permits a new transaction", async () => {
    const j = new OperationJournal();
    j.create("op", "swap");
    for (const p of ["quoting", "review", "awaitingApproval", "preparing", "submitting"] as const) j.move("op", p);
    j.recordSubmission("op", "sigA", 1_000n);
    const outcome = await reconcileSignature("sigA", 1_000n, chain({ found: false, height: 1_001n }).deps);
    expect(outcome.kind).toBe("expired_not_landed");
    expect(j.applyReconciliation("op", "sigA", outcome)).toBe("retryableFailure");
    expect(j.canFundNewTransaction("op")).toBe(true);
  });

  it("without an expiry height the outcome stays unknown", async () => {
    const outcome = await reconcileSignature("sigA", null, chain({ found: false, height: 1n }).deps);
    expect(outcome.kind).toBe("unknown");
  });

  it("RPC failures during reconciliation never count as 'did not land'", async () => {
    const outcome = await reconcileSignature("sigA", 10n, {
      getSignatureStatus: async () => {
        throw new Error("503");
      },
      getBlockHeight: async () => 11n,
    });
    expect(outcome.kind).toBe("unknown");
  });
});

describe("two-phase escrow reference model", () => {
  const terms = (nonce: string, expiresAt = 1_000): EscrowTerms => ({
    intentDigest: "d1",
    nonce,
    owner: "owner",
    inputAmount: 500n,
    minOutput: 900n,
    destination: "note:owner",
    allowedVenues: ["JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"],
    expiresAt,
  });

  it("locks exactly the approved input once and rejects a replayed nonce", () => {
    const l = new EscrowLedger();
    const id = l.commit(terms("n1"));
    expect(() => l.commit(terms("n1"))).toThrow(EscrowError);
    expect(() => l.lock(id, "owner", 499n)).toThrow(/approved input/);
    l.lock(id, "owner", 500n);
    expect(() => l.lock(id, "owner", 500n)).toThrow(/already funded/);
  });

  it("reverts below the minimum and on unapproved venues; settles only to the approved destination", () => {
    const l = new EscrowLedger();
    const id = l.commit(terms("n2"));
    l.lock(id, "owner", 500n);
    expect(() => l.execute(id, "OtherVenue", 950n, 10)).toThrow(/Venue/);
    expect(() => l.execute(id, "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4", 899n, 10)).toThrow(/minimum/);
    expect(l.get(id).status).toBe("locked");
    l.execute(id, "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4", 950n, 10);
    expect(() => l.settle(id, "note:attacker")).toThrow(/Destination/);
    expect(l.settle(id, "note:owner")).toBe(950n);
    expect(() => l.refund(id, 5_000)).toThrow(EscrowError);
  });

  it("anyone can trigger the refund after expiry, always to the owner, exactly once", () => {
    const l = new EscrowLedger();
    const id = l.commit(terms("n3", 100));
    l.lock(id, "owner", 500n);
    expect(() => l.refund(id, 99)).toThrow(/expiry/);
    expect(l.refund(id, 100)).toEqual({ to: "owner", amount: 500n });
    expect(() => l.refund(id, 200)).toThrow(/Already refunded/);
    expect(() => l.execute(id, "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4", 950n, 50)).toThrow();
  });

  it("only an unfunded escrow can be cancelled, by its owner", () => {
    const l = new EscrowLedger();
    const id = l.commit(terms("n4"));
    expect(() => l.cancel(id, "someone")).toThrow(/owner/);
    l.cancel(id, "owner");
    expect(l.get(id).status).toBe("cancelled");
  });
});
