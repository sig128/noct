/**
 * The lifecycle every financial operation follows. Transitions not listed
 * here are bugs and throw, so a UI cannot, for example, jump from `editing`
 * to `submitting` or retry while a submission's outcome is unknown.
 */
export type Phase =
  | "editing"
  | "quoting"
  | "review"
  | "staleQuote"
  | "unsupported"
  | "awaitingApproval"
  | "preparing"
  | "submitting"
  | "confirming"
  | "completed"
  | "rejected"
  | "retryableFailure"
  | "pendingRecovery"
  | "refunded"
  | "cancelled";

export const TRANSITIONS: Readonly<Record<Phase, readonly Phase[]>> = {
  editing: ["editing", "quoting", "unsupported", "cancelled"],
  quoting: ["quoting", "review", "editing", "unsupported", "retryableFailure"],
  review: ["quoting", "staleQuote", "awaitingApproval", "editing", "unsupported"],
  staleQuote: ["quoting", "editing"],
  unsupported: ["editing", "quoting"],
  awaitingApproval: ["preparing", "review", "staleQuote", "editing", "cancelled"],
  preparing: ["submitting", "rejected", "review", "staleQuote", "retryableFailure", "cancelled"],
  rejected: ["review", "awaitingApproval", "editing"],
  submitting: ["confirming", "pendingRecovery", "retryableFailure"],
  confirming: ["completed", "pendingRecovery", "retryableFailure"],
  pendingRecovery: ["pendingRecovery", "completed", "retryableFailure", "refunded"],
  retryableFailure: ["editing", "quoting", "review"],
  completed: ["editing"],
  refunded: ["editing"],
  cancelled: ["editing"],
};

/** Phases in which funds may be in flight: nothing may be rebuilt or resubmitted. */
export const IN_FLIGHT: ReadonlySet<Phase> = new Set(["submitting", "confirming", "pendingRecovery"]);

/** Phases after which the user may safely edit the operation again. */
export const TERMINAL: ReadonlySet<Phase> = new Set(["completed", "refunded", "cancelled"]);

export class InvalidTransitionError extends Error {
  constructor(readonly from: Phase, readonly to: Phase) {
    super(`Invalid operation transition ${from} → ${to}`);
  }
}

export function canTransition(from: Phase, to: Phase): boolean {
  return TRANSITIONS[from].includes(to);
}

export function transition(from: Phase, to: Phase): Phase {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
  return to;
}

/** Editing inputs is only allowed when nothing is in flight. */
export function canEdit(phase: Phase): boolean {
  return !IN_FLIGHT.has(phase) && phase !== "preparing";
}
