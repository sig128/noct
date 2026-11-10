import { bpsOfCeil, maxBig } from "@/lib/decimal";
import { transferFeeFor, type TransferFee } from "@/lib/tokens/mint-account";

/** Rent-exempt minimum for a 165-byte token account (lamports). */
export const TOKEN_ACCOUNT_RENT_LAMPORTS = 2_039_280n;
/** Base fee per signature (lamports). */
export const SIGNATURE_FEE_LAMPORTS = 5_000n;
/** Reserve kept in the wallet when spending SOL so it stays usable for fees. */
export const DEFAULT_SOL_RESERVE_LAMPORTS = 10_000_000n; // 0.01 SOL

export interface MaxSpendInput {
  /** Balance of the asset being spent, base units. */
  balance: bigint;
  isNativeSol: boolean;
  /** Lamports the transaction itself costs (signature + priority). */
  networkFeeLamports: bigint;
  /** Rent for accounts the transaction may create (e.g. an output token account). */
  rentLamports: bigint;
  /** Extra SOL headroom to keep after the swap. */
  solReserveLamports?: bigint;
  /** Fee charged on the input token by the venue, if it is taken from input (bps). */
  inputFeeBps?: number;
}

export interface MaxSpendResult {
  amount: bigint;
  /** What was held back and why, for display. */
  reserved: { reason: string; amount: bigint }[];
}

/**
 * Largest input that leaves enough to complete the operation. For SOL the
 * network fee, account rent and a reserve are subtracted. For tokens charged
 * an input-side venue fee, the fee is solved for so amount + fee ≤ balance.
 */
export function maxSpendable(input: MaxSpendInput): MaxSpendResult {
  const reserved: MaxSpendResult["reserved"] = [];
  let amount = input.balance;
  if (input.isNativeSol) {
    const reserve = input.solReserveLamports ?? DEFAULT_SOL_RESERVE_LAMPORTS;
    const costs = input.networkFeeLamports + input.rentLamports;
    reserved.push({ reason: "Network fees and account rent", amount: costs });
    reserved.push({ reason: "SOL kept for future fees", amount: reserve });
    amount = maxBig(0n, amount - costs - reserve);
  }
  if (input.inputFeeBps && input.inputFeeBps > 0) {
    // Find largest a with a + ceil(a·bps/1e4) ≤ amount.
    let a = (amount * 10_000n) / (10_000n + BigInt(input.inputFeeBps));
    while (a > 0n && a + bpsOfCeil(a, input.inputFeeBps) > amount) a -= 1n;
    reserved.push({ reason: "Venue fee on the input token", amount: amount - a });
    amount = a;
  }
  return { amount, reserved };
}

/** Amount that arrives after a Token-2022 transfer fee is withheld. */
export function netAfterTransferFee(amount: bigint, fee: TransferFee | null): { net: bigint; withheld: bigint } {
  const withheld = transferFeeFor(amount, fee);
  return { net: amount - withheld, withheld };
}

/** Percentage presets (25/50/100) applied to the spendable maximum, rounded down. */
export function presetAmount(max: bigint, percent: 25 | 50 | 75 | 100): bigint {
  return (max * BigInt(percent)) / 100n;
}
