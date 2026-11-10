import { getAddressDecoder } from "@solana/kit";
import { SPL_TOKEN_PROGRAM, TOKEN_2022_PROGRAM } from "./types";

/**
 * Minimal, read-only parser for SPL Token and Token-2022 mint accounts.
 * Layouts follow spl-token / spl-token-2022 (base mint is 82 bytes; Token-2022
 * pads to 165, writes the account type at 165 and TLV extensions from 166).
 */

export const EXTENSION_NAMES: Record<number, string> = {
  1: "TransferFeeConfig",
  3: "MintCloseAuthority",
  4: "ConfidentialTransferMint",
  6: "DefaultAccountState",
  9: "NonTransferable",
  10: "InterestBearingConfig",
  12: "PermanentDelegate",
  14: "TransferHook",
  16: "ConfidentialTransferFeeConfig",
  18: "MetadataPointer",
  19: "TokenMetadata",
  20: "GroupPointer",
  21: "TokenGroup",
  22: "GroupMemberPointer",
  23: "TokenGroupMember",
  24: "ConfidentialMintBurn",
  25: "ScaledUiAmount",
  26: "Pausable",
};

export interface TransferFee {
  epoch: bigint;
  maximumFee: bigint;
  basisPoints: number;
}

export interface MintFacts {
  program: "spl" | "token2022";
  decimals: number;
  supply: bigint;
  mintAuthority: string | null;
  freezeAuthority: string | null;
  extensions: { type: number; name: string }[];
  transferFee: { older: TransferFee; newer: TransferFee } | null;
  transferHookProgram: string | null;
  permanentDelegate: string | null;
  defaultAccountStateFrozen: boolean;
  pausable: boolean;
  nonTransferable: boolean;
}

const addressDecoder = getAddressDecoder();

function readU16(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}
function readU32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}
function readU64(view: DataView, offset: number): bigint {
  return view.getBigUint64(offset, true);
}
function readPubkey(bytes: Uint8Array, offset: number): string {
  return addressDecoder.decode(bytes.subarray(offset, offset + 32));
}
function optionalNonZeroPubkey(bytes: Uint8Array, offset: number): string | null {
  const slice = bytes.subarray(offset, offset + 32);
  return slice.every((b) => b === 0) ? null : readPubkey(bytes, offset);
}

export class MintParseError extends Error {}

export function parseMintAccount(data: Uint8Array, owner: string): MintFacts {
  const program = owner === SPL_TOKEN_PROGRAM ? "spl" : owner === TOKEN_2022_PROGRAM ? "token2022" : null;
  if (!program) throw new MintParseError("Account is not owned by a token program");
  if (data.length < 82) throw new MintParseError("Account data is too short for a mint");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  const mintAuthOption = readU32(view, 0);
  const mintAuthority = mintAuthOption === 1 ? readPubkey(data, 4) : null;
  const supply = readU64(view, 36);
  const decimals = data[44] ?? 0;
  const initialized = data[45] === 1;
  if (!initialized) throw new MintParseError("Mint is not initialised");
  const freezeOption = readU32(view, 46);
  const freezeAuthority = freezeOption === 1 ? readPubkey(data, 50) : null;

  const facts: MintFacts = {
    program,
    decimals,
    supply,
    mintAuthority,
    freezeAuthority,
    extensions: [],
    transferFee: null,
    transferHookProgram: null,
    permanentDelegate: null,
    defaultAccountStateFrozen: false,
    pausable: false,
    nonTransferable: false,
  };

  if (program === "spl" || data.length <= 166) return facts;
  if (data[165] !== 1) throw new MintParseError("Token-2022 account type is not Mint");

  let offset = 166;
  while (offset + 4 <= data.length) {
    const type = readU16(view, offset);
    const length = readU16(view, offset + 2);
    const start = offset + 4;
    if (type === 0) break; // Uninitialized: padding
    if (start + length > data.length) throw new MintParseError("Truncated extension");
    facts.extensions.push({ type, name: EXTENSION_NAMES[type] ?? `Extension ${type}` });
    switch (type) {
      case 1: {
        if (length < 108) throw new MintParseError("Malformed TransferFeeConfig");
        const older: TransferFee = {
          epoch: readU64(view, start + 72),
          maximumFee: readU64(view, start + 80),
          basisPoints: readU16(view, start + 88),
        };
        const newer: TransferFee = {
          epoch: readU64(view, start + 90),
          maximumFee: readU64(view, start + 98),
          basisPoints: readU16(view, start + 106),
        };
        facts.transferFee = { older, newer };
        break;
      }
      case 6:
        facts.defaultAccountStateFrozen = data[start] === 2;
        break;
      case 9:
        facts.nonTransferable = true;
        break;
      case 12:
        facts.permanentDelegate = optionalNonZeroPubkey(data, start);
        break;
      case 14:
        // authority (32) then program id (32)
        facts.transferHookProgram = length >= 64 ? optionalNonZeroPubkey(data, start + 32) : null;
        break;
      case 26:
        facts.pausable = true;
        break;
      default:
        break;
    }
    offset = start + length;
  }
  return facts;
}

/** The fee schedule in force for `epoch`. */
export function activeTransferFee(facts: MintFacts, epoch: bigint): TransferFee | null {
  if (!facts.transferFee) return null;
  return epoch >= facts.transferFee.newer.epoch ? facts.transferFee.newer : facts.transferFee.older;
}

/** Fee withheld by Token-2022 when `amount` is transferred: min(ceil(amount·bps/10⁴), max). */
export function transferFeeFor(amount: bigint, fee: TransferFee | null): bigint {
  if (!fee || fee.basisPoints === 0 || amount === 0n) return 0n;
  const raw = (amount * BigInt(fee.basisPoints) + 9_999n) / 10_000n;
  return raw > fee.maximumFee ? fee.maximumFee : raw;
}

export type Restriction = {
  code:
    | "non_transferable"
    | "transfer_hook"
    | "permanent_delegate"
    | "pausable"
    | "default_frozen"
    | "transfer_fee"
    | "interest_bearing"
    | "scaled_ui"
    | "confidential_extension";
  severity: "block" | "warn" | "info";
  message: string;
};

export function extensionRestrictions(facts: MintFacts): Restriction[] {
  const out: Restriction[] = [];
  if (facts.nonTransferable) {
    out.push({ code: "non_transferable", severity: "block", message: "This token cannot be transferred, so it cannot be swapped or moved." });
  }
  if (facts.permanentDelegate) {
    out.push({
      code: "permanent_delegate",
      severity: "warn",
      message: "A permanent delegate can move or burn this token from any account. NOCT does not accept it for private holding or collateral.",
    });
  }
  if (facts.transferHookProgram) {
    out.push({
      code: "transfer_hook",
      severity: "warn",
      message: `Every transfer runs a hook program (${facts.transferHookProgram.slice(0, 4)}…), which can block or alter transfers.`,
    });
  }
  if (facts.pausable) {
    out.push({ code: "pausable", severity: "warn", message: "The issuer can pause all transfers of this token." });
  }
  if (facts.defaultAccountStateFrozen) {
    out.push({ code: "default_frozen", severity: "warn", message: "New token accounts start frozen; receiving may require issuer approval." });
  }
  if (facts.transferFee && (facts.transferFee.newer.basisPoints > 0 || facts.transferFee.older.basisPoints > 0)) {
    const bps = Math.max(facts.transferFee.newer.basisPoints, facts.transferFee.older.basisPoints);
    out.push({ code: "transfer_fee", severity: "warn", message: `Transfers withhold a fee of up to ${(bps / 100).toFixed(2)}%.` });
  }
  if (facts.extensions.some((e) => e.type === 10)) {
    out.push({ code: "interest_bearing", severity: "info", message: "Interest-bearing display amount; base units do not change over time." });
  }
  if (facts.extensions.some((e) => e.type === 25)) {
    out.push({ code: "scaled_ui", severity: "info", message: "Displayed amounts are scaled by an issuer multiplier." });
  }
  if (facts.extensions.some((e) => e.type === 4 || e.type === 16 || e.type === 24)) {
    out.push({ code: "confidential_extension", severity: "info", message: "Uses Token-2022 confidential extensions, which NOCT does not use." });
  }
  return out;
}
