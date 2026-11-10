import { getCompiledTransactionMessageDecoder, getTransactionDecoder } from "@solana/kit";
import { PROGRAMS, programLabel } from "./programs";

/**
 * Programs a wallet may add to a transaction on its own after review: its
 * safety assertions (Lighthouse, which only checks state and fails the
 * transaction if a check does not hold) and fee settings (compute budget).
 */
export const WALLET_ADDED_PROGRAMS: readonly string[] = [PROGRAMS.lighthouse, PROGRAMS.computeBudget];

interface Canonical {
  version: "legacy" | 0 | 1;
  feePayer: string;
  signers: string[];
  /** Signers other than the fee payer whose signature slot already holds a signature. */
  presigned: string[];
  lifetime: string;
  feeSettings: string;
  instructions: { program: string; key: string }[];
}

function hex(bytes: ArrayLike<number> | undefined): string {
  return Array.from(bytes ?? [], (b) => b.toString(16).padStart(2, "0")).join("");
}

/** One transaction as comparable parts: lookup-table accounts stay symbolic, so no table has to be fetched. */
function canonical(bytes: Uint8Array): Canonical {
  const decoded = getTransactionDecoder().decode(bytes);
  const message = getCompiledTransactionMessageDecoder().decode(decoded.messageBytes) as ReturnType<ReturnType<typeof getCompiledTransactionMessageDecoder>["decode"]> & {
    lifetimeToken?: string;
    addressTableLookups?: readonly { lookupTableAddress: string; writableIndexes: readonly number[]; readonlyIndexes: readonly number[] }[];
    configMask?: number;
    configValues?: readonly { kind: string; value: number | bigint }[];
  };
  const statics = message.staticAccounts.map(String);
  const lookups = message.addressTableLookups ?? [];
  const loaded = [
    ...lookups.flatMap((l) => l.writableIndexes.map((i) => `table ${String(l.lookupTableAddress)} #${i}`)),
    ...lookups.flatMap((l) => l.readonlyIndexes.map((i) => `table ${String(l.lookupTableAddress)} #${i}`)),
  ];
  const account = (index: number) => statics[index] ?? loaded[index - statics.length] ?? `missing #${index}`;
  const raw =
    message.version === 1
      ? message.instructionHeaders.map((h, i) => ({ program: h.programAccountIndex, accounts: message.instructionPayloads[i]?.instructionAccountIndices ?? [], data: message.instructionPayloads[i]?.instructionData }))
      : message.instructions.map((ix) => ({ program: ix.programAddressIndex, accounts: ix.accountIndices ?? [], data: ix.data }));
  const signers = statics.slice(0, message.header.numSignerAccounts);
  const signatures = decoded.signatures as Record<string, Uint8Array | null>;
  const feePayer = statics[0] ?? "";
  return {
    version: message.version,
    feePayer,
    signers,
    presigned: signers.filter((s) => s !== feePayer && signatures[s]?.some((b) => b !== 0)),
    lifetime: String(message.lifetimeToken ?? ""),
    feeSettings: message.version === 1 ? `${message.configMask ?? 0}:${(message.configValues ?? []).map((v) => String(v.value)).join(",")}` : "",
    instructions: raw.map((ix) => {
      const program = account(ix.program);
      return { program, key: `${program}|${ix.accounts.map(account).join(",")}|${hex(ix.data)}` };
    }),
  };
}

export interface WalletChanges {
  /** True when the only changes are instructions from WALLET_ADDED_PROGRAMS and fee settings. */
  acceptable: boolean;
  /** Programs whose instructions the wallet added, in first-use order. */
  addedPrograms: string[];
  /** What was changed that NOCT does not accept, in plain words. */
  problems: string[];
  /** Whether the wallet changed the fee settings (compute budget or v1 fee fields). */
  feeSettingsChanged: boolean;
}

/**
 * Compares what the wallet signed with what was reviewed. Every reviewed
 * instruction (other than compute budget settings) must still be there,
 * unchanged and in order; the wallet may only add instructions from
 * WALLET_ADDED_PROGRAMS and adjust fee settings. The fee payer, signers,
 * version and blockhash must not change.
 */
export function compareWalletChanges(reviewed: Uint8Array, signed: Uint8Array): WalletChanges {
  let before: Canonical;
  let after: Canonical;
  try {
    before = canonical(reviewed);
    after = canonical(signed);
  } catch {
    return { acceptable: false, addedPrograms: [], problems: ["the signed transaction could not be read"], feeSettingsChanged: false };
  }
  const problems: string[] = [];
  if (after.version !== before.version) problems.push(`it changed the transaction version from ${String(before.version)} to ${String(after.version)}`);
  if (after.feePayer !== before.feePayer) problems.push("it changed who pays the fee");
  const newSigners = after.signers.filter((s) => !before.signers.includes(s));
  if (newSigners.length > 0) problems.push("it added a required signer");
  if (after.lifetime !== before.lifetime) problems.push("it changed the recent blockhash");
  if (before.presigned.length > 0) problems.push("another party had already signed it, and their signature no longer matches");

  const budget = PROGRAMS.computeBudget;
  const reviewedCore = before.instructions.filter((ix) => ix.program !== budget);
  const addedPrograms: string[] = [];
  let next = 0;
  for (const ix of after.instructions) {
    if (ix.program === budget) continue;
    if (next < reviewedCore.length && ix.key === reviewedCore[next]!.key) {
      next += 1;
    } else if (WALLET_ADDED_PROGRAMS.includes(ix.program)) {
      if (!addedPrograms.includes(ix.program)) addedPrograms.push(ix.program);
    } else {
      problems.push(`it added or changed an instruction for ${programLabel(ix.program)}`);
    }
  }
  if (next < reviewedCore.length) problems.push(`it removed or changed an instruction for ${programLabel(reviewedCore[next]!.program)}`);

  const budgetKeys = (c: Canonical) => c.instructions.filter((ix) => ix.program === budget).map((ix) => ix.key).join(";");
  const feeSettingsChanged = after.feeSettings !== before.feeSettings || budgetKeys(after) !== budgetKeys(before);
  return { acceptable: problems.length === 0, addedPrograms, problems: Array.from(new Set(problems)), feeSettingsChanged };
}
