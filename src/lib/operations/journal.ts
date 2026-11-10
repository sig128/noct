import { IN_FLIGHT, transition, type Phase } from "./state-machine";
import type { ReconcileOutcome } from "./reconcile";

export interface Submission {
  signature: string;
  lastValidBlockHeight: bigint | null;
  submittedAt: number;
  /** Set once reconciliation has proven this signature can no longer land. */
  provenDead: boolean;
}

export interface OperationRecord {
  operationId: string;
  kind: string;
  phase: Phase;
  createdAt: number;
  updatedAt: number;
  submissions: Submission[];
  /** Non-sensitive status notes. Never amounts, addresses or private terms. */
  notes: string[];
}

export class DuplicateSubmissionError extends Error {
  constructor(readonly operationId: string) {
    super("A previous submission of this operation may still land. Reconcile it before submitting another transaction.");
  }
}

/**
 * In-memory journal (one per tab). It is the single gate that prevents a
 * second transaction from being funded while a first one could still land.
 */
export class OperationJournal {
  readonly #records = new Map<string, OperationRecord>();
  readonly #listeners = new Set<() => void>();

  create(operationId: string, kind: string, now = Date.now()): OperationRecord {
    if (this.#records.has(operationId)) throw new Error(`Operation ${operationId} already exists`);
    const record: OperationRecord = { operationId, kind, phase: "editing", createdAt: now, updatedAt: now, submissions: [], notes: [] };
    this.#records.set(operationId, record);
    this.#emit();
    return record;
  }

  get(operationId: string): OperationRecord | undefined {
    return this.#records.get(operationId);
  }

  all(): OperationRecord[] {
    return [...this.#records.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  move(operationId: string, to: Phase, note?: string, now = Date.now()): OperationRecord {
    const record = this.#require(operationId);
    record.phase = transition(record.phase, to);
    record.updatedAt = now;
    if (note) record.notes.push(note);
    this.#emit();
    return record;
  }

  /** True when every earlier submission is proven unable to land. */
  canFundNewTransaction(operationId: string): boolean {
    const record = this.#require(operationId);
    if (IN_FLIGHT.has(record.phase)) return false;
    return record.submissions.every((s) => s.provenDead);
  }

  recordSubmission(operationId: string, signature: string, lastValidBlockHeight: bigint | null, now = Date.now()): void {
    const record = this.#require(operationId);
    const existing = record.submissions.find((s) => s.signature === signature);
    if (existing) return; // Rebroadcasting identical signed bytes is idempotent.
    if (!record.submissions.every((s) => s.provenDead)) throw new DuplicateSubmissionError(operationId);
    record.submissions.push({ signature, lastValidBlockHeight, submittedAt: now, provenDead: false });
    record.updatedAt = now;
    this.#emit();
  }

  applyReconciliation(operationId: string, signature: string, outcome: ReconcileOutcome): Phase {
    const record = this.#require(operationId);
    const submission = record.submissions.find((s) => s.signature === signature);
    if (!submission) throw new Error("Unknown submission");
    switch (outcome.kind) {
      case "landed_success":
        if (record.phase === "submitting") this.move(operationId, "confirming");
        if (record.phase !== "completed") this.move(operationId, "completed", "Confirmed on chain");
        break;
      case "landed_failed":
        submission.provenDead = true;
        if (record.phase !== "retryableFailure") this.move(operationId, "retryableFailure", "Landed but failed on chain");
        break;
      case "expired_not_landed":
        submission.provenDead = true;
        if (record.phase !== "retryableFailure") this.move(operationId, "retryableFailure", "Expired without landing");
        break;
      case "pending_valid":
      case "unknown":
        if (record.phase !== "pendingRecovery") this.move(operationId, "pendingRecovery");
        break;
    }
    this.#emit();
    return this.#require(operationId).phase;
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Clears finished records (used when locking or switching wallets). */
  clearFinished(): void {
    for (const [id, record] of this.#records) {
      if (!IN_FLIGHT.has(record.phase)) this.#records.delete(id);
    }
    this.#emit();
  }

  #require(operationId: string): OperationRecord {
    const record = this.#records.get(operationId);
    if (!record) throw new Error(`Unknown operation ${operationId}`);
    return record;
  }

  #emit(): void {
    for (const listener of this.#listeners) listener();
  }
}
