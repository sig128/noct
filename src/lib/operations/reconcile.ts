/**
 * A timeout after submission does not mean the transaction failed. Before any
 * retry NOCT asks the chain what happened to the exact signature it sent.
 * Only a signature that is provably expired and absent permits building a new
 * transaction; anything else waits, rebroadcasts the same signed bytes, or
 * reports the landed outcome.
 */

export type SignatureStatus =
  | { found: false }
  | { found: true; err: unknown | null; confirmationStatus: "processed" | "confirmed" | "finalized" | null; slot: bigint };

export interface ReconcileDeps {
  getSignatureStatus(signature: string): Promise<SignatureStatus>;
  getBlockHeight(): Promise<bigint>;
}

export type ReconcileOutcome =
  | { kind: "landed_success"; slot: bigint; confirmationStatus: string | null }
  | { kind: "landed_failed"; slot: bigint; err: unknown }
  | { kind: "pending_valid"; blocksRemaining: bigint }
  | { kind: "expired_not_landed" }
  | { kind: "unknown"; reason: string };

export async function reconcileSignature(
  signature: string,
  lastValidBlockHeight: bigint | null,
  deps: ReconcileDeps,
): Promise<ReconcileOutcome> {
  let status: SignatureStatus;
  try {
    status = await deps.getSignatureStatus(signature);
  } catch (error) {
    return { kind: "unknown", reason: `Status lookup failed: ${(error as Error).message}` };
  }
  if (status.found) {
    return status.err
      ? { kind: "landed_failed", slot: status.slot, err: status.err }
      : { kind: "landed_success", slot: status.slot, confirmationStatus: status.confirmationStatus };
  }
  if (lastValidBlockHeight === null) {
    return { kind: "unknown", reason: "No expiry height recorded; cannot prove the transaction will not land." };
  }
  let height: bigint;
  try {
    height = await deps.getBlockHeight();
  } catch (error) {
    return { kind: "unknown", reason: `Block height lookup failed: ${(error as Error).message}` };
  }
  if (height <= lastValidBlockHeight) return { kind: "pending_valid", blocksRemaining: lastValidBlockHeight - height };
  // Past the expiry height: the network rejects it from now on. Re-check once
  // to close the race where it landed between the two reads.
  try {
    const recheck = await deps.getSignatureStatus(signature);
    if (recheck.found) {
      return recheck.err
        ? { kind: "landed_failed", slot: recheck.slot, err: recheck.err }
        : { kind: "landed_success", slot: recheck.slot, confirmationStatus: recheck.confirmationStatus };
    }
  } catch (error) {
    return { kind: "unknown", reason: `Status re-check failed: ${(error as Error).message}` };
  }
  return { kind: "expired_not_landed" };
}
