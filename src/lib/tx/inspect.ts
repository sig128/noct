import { getBase64Decoder, getBase64Encoder, getCompiledTransactionMessageDecoder, getTransactionDecoder } from "@solana/kit";

export interface InspectedTransaction {
  version: "legacy" | 0 | 1;
  feePayer: string;
  /** Accounts that must sign, in order. */
  requiredSigners: string[];
  /** Signers whose signature slot already holds a non-zero signature. */
  presignedBy: string[];
  /** Distinct top-level programs, in first-use order. */
  programs: string[];
  /** Instructions whose program index points outside the static accounts. */
  programsViaLookup: number;
  usesLookupTables: boolean;
  instructionCount: number;
  sizeBytes: number;
}

export class TransactionDecodeError extends Error {}

export function base64ToBytes(b64: string): Uint8Array {
  return new Uint8Array(getBase64Encoder().encode(b64));
}

export function bytesToBase64(bytes: Uint8Array): string {
  return getBase64Decoder().decode(bytes);
}

export function inspectTransactionBytes(bytes: Uint8Array): InspectedTransaction {
  let decoded;
  let message;
  try {
    decoded = getTransactionDecoder().decode(bytes);
    message = getCompiledTransactionMessageDecoder().decode(decoded.messageBytes);
  } catch (error) {
    throw new TransactionDecodeError(`Transaction could not be decoded: ${(error as Error).message}`);
  }
  const statics = message.staticAccounts.map(String);
  const numSigners = message.header.numSignerAccounts;
  const requiredSigners = statics.slice(0, numSigners);
  const signatureMap = decoded.signatures as Record<string, Uint8Array | null>;
  const presignedBy = requiredSigners.filter((signer) => {
    const sig = signatureMap[signer];
    return Boolean(sig && sig.some((b) => b !== 0));
  });

  const programIndices: number[] =
    message.version === 1
      ? message.instructionHeaders.map((h) => h.programAccountIndex)
      : message.instructions.map((ix) => ix.programAddressIndex);

  const programs: string[] = [];
  let programsViaLookup = 0;
  for (const index of programIndices) {
    const id = statics[index];
    if (id === undefined) {
      programsViaLookup += 1;
      continue;
    }
    if (!programs.includes(id)) programs.push(id);
  }

  const usesLookupTables = message.version === 0 && (message.addressTableLookups?.length ?? 0) > 0;
  const feePayer = statics[0];
  if (!feePayer) throw new TransactionDecodeError("Transaction has no fee payer");
  return {
    version: message.version,
    feePayer,
    requiredSigners,
    presignedBy,
    programs,
    programsViaLookup,
    usesLookupTables,
    instructionCount: programIndices.length,
    sizeBytes: bytes.length,
  };
}

export function inspectTransactionBase64(b64: string): InspectedTransaction {
  return inspectTransactionBytes(base64ToBytes(b64));
}

export interface TransactionPolicy {
  /** The wallet that must pay fees (and therefore sign). */
  feePayer: string;
  allowedPrograms: readonly string[];
  /** Signers other than the fee payer that may be required (e.g. an RFQ maker). */
  allowedCoSigners?: readonly string[];
  allowedVersions?: readonly ("legacy" | 0 | 1)[];
  /** Upper bound on required signatures. */
  maxSigners?: number;
}

export interface PolicyCheck {
  ok: boolean;
  violations: string[];
  unknownPrograms: string[];
}

/** Refuses transactions that invoke unexpected programs or shift fees to the user unexpectedly. */
export function checkTransactionPolicy(tx: InspectedTransaction, policy: TransactionPolicy): PolicyCheck {
  const violations: string[] = [];
  if (policy.allowedVersions && !policy.allowedVersions.includes(tx.version)) {
    violations.push(`Unexpected transaction version ${String(tx.version)}.`);
  }
  if (!tx.requiredSigners.includes(policy.feePayer)) {
    violations.push("Your wallet is not a required signer of this transaction.");
  }
  if (tx.feePayer !== policy.feePayer) {
    // A sponsor may pay; that is fine only when it is not the user and is expected.
    if (!(policy.allowedCoSigners ?? []).includes(tx.feePayer)) violations.push("An unexpected account pays this transaction's fees.");
  }
  const extraSigners = tx.requiredSigners.filter((s) => s !== policy.feePayer && !(policy.allowedCoSigners ?? []).includes(s));
  const unsignedExtras = extraSigners.filter((s) => !tx.presignedBy.includes(s));
  if (unsignedExtras.length > 0) violations.push("The transaction requires signatures from accounts other than your wallet.");
  if (policy.maxSigners !== undefined && tx.requiredSigners.length > policy.maxSigners) {
    violations.push(`Requires ${tx.requiredSigners.length} signatures; at most ${policy.maxSigners} expected.`);
  }
  if (tx.programsViaLookup > 0) violations.push("A program is referenced through a lookup table and cannot be verified.");
  const unknownPrograms = tx.programs.filter((p) => !policy.allowedPrograms.includes(p));
  if (unknownPrograms.length > 0) violations.push(`Invokes ${unknownPrograms.length} program(s) outside the allowed set.`);
  return { ok: violations.length === 0, violations, unknownPrograms };
}

/** The first signature of a signed transaction is its id on chain. */
export function transactionSignatureBytes(bytes: Uint8Array): Uint8Array {
  const decoded = getTransactionDecoder().decode(bytes);
  const message = getCompiledTransactionMessageDecoder().decode(decoded.messageBytes);
  const feePayer = String(message.staticAccounts[0]);
  const sig = (decoded.signatures as Record<string, Uint8Array | null>)[feePayer];
  if (!sig || sig.every((b) => b === 0)) throw new TransactionDecodeError("Transaction is not signed by its fee payer");
  return new Uint8Array(sig);
}
