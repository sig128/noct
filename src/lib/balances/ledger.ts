/**
 * One account view across modules. Each asset amount lives in exactly one
 * bucket, so supplied receipt tokens are never counted next to their
 * underlying, and an amount reserved by an in-flight operation is not also
 * shown as spendable.
 */

export type Bucket =
  | "publicAvailable"
  | "privateSpendable"
  | "pendingSettlement"
  | "reserved"
  | "supplied"
  | "collateral"
  | "debt";

export const BUCKET_LABELS: Record<Bucket, string> = {
  publicAvailable: "Public wallet",
  privateSpendable: "Private, spendable",
  pendingSettlement: "Pending settlement",
  reserved: "Reserved by an operation",
  supplied: "Supplied to a market",
  collateral: "Locked as collateral",
  debt: "Debt",
};

export interface LedgerLine {
  mint: string;
  bucket: Bucket;
  amount: bigint;
  source: string;
}

export interface LedgerInput {
  publicTokens: readonly { mint: string; amount: bigint }[];
  privateBalances: readonly { mint: string; amount: bigint }[];
  /** Outbound private amounts submitted but not yet reflected by a sync. */
  pendingOutbound: readonly { mint: string; amount: bigint; source: "public" | "private" }[];
  reservations: readonly Reservation[];
  earnPositions: readonly { receiptMint: string; assetMint: string; underlying: bigint; market: string }[];
  borrowPositions: readonly { collateralMint: string; collateral: bigint; debtMint: string; debt: bigint; market: string }[];
}

export interface Reservation {
  operationId: string;
  mint: string;
  amount: bigint;
  source: "public" | "private";
}

export interface Ledger {
  lines: LedgerLine[];
  /** Spendable after reservations and pending outflows; never negative. */
  spendable(mint: string, source: "public" | "private"): bigint;
  /** Net position per mint: assets minus debt, in base units of that mint. */
  net(mint: string): bigint;
  byBucket(bucket: Bucket): LedgerLine[];
}

export function buildLedger(input: LedgerInput): Ledger {
  const receiptMints = new Set(input.earnPositions.map((p) => p.receiptMint));
  const lines: LedgerLine[] = [];

  for (const t of input.publicTokens) {
    // Receipt tokens are represented by their supplied underlying instead.
    if (receiptMints.has(t.mint) || t.amount === 0n) continue;
    lines.push({ mint: t.mint, bucket: "publicAvailable", amount: t.amount, source: "wallet" });
  }
  for (const b of input.privateBalances) {
    if (b.amount > 0n) lines.push({ mint: b.mint, bucket: "privateSpendable", amount: b.amount, source: "privacy-rings" });
  }
  for (const p of input.pendingOutbound) {
    if (p.amount > 0n) lines.push({ mint: p.mint, bucket: "pendingSettlement", amount: p.amount, source: p.source });
  }
  for (const r of input.reservations) {
    if (r.amount > 0n) lines.push({ mint: r.mint, bucket: "reserved", amount: r.amount, source: r.operationId });
  }
  for (const e of input.earnPositions) {
    if (e.underlying > 0n) lines.push({ mint: e.assetMint, bucket: "supplied", amount: e.underlying, source: e.market });
  }
  for (const b of input.borrowPositions) {
    if (b.collateral > 0n) lines.push({ mint: b.collateralMint, bucket: "collateral", amount: b.collateral, source: b.market });
    if (b.debt > 0n) lines.push({ mint: b.debtMint, bucket: "debt", amount: b.debt, source: b.market });
  }

  const sum = (pred: (l: LedgerLine) => boolean) => lines.filter(pred).reduce((acc, l) => acc + l.amount, 0n);

  return {
    lines,
    spendable(mint, source) {
      const bucket: Bucket = source === "public" ? "publicAvailable" : "privateSpendable";
      const held = sum((l) => l.mint === mint && l.bucket === bucket);
      const reserved = input.reservations.filter((r) => r.mint === mint && r.source === source).reduce((a, r) => a + r.amount, 0n);
      const pending = input.pendingOutbound.filter((p) => p.mint === mint && p.source === source).reduce((a, p) => a + p.amount, 0n);
      const free = held - reserved - pending;
      return free > 0n ? free : 0n;
    },
    net(mint) {
      // Reserved and pending amounts are still the user's until they land, but
      // they are already inside publicAvailable/privateSpendable; skip them.
      const assets = sum((l) => l.mint === mint && (l.bucket === "publicAvailable" || l.bucket === "privateSpendable" || l.bucket === "supplied" || l.bucket === "collateral"));
      const debt = sum((l) => l.mint === mint && l.bucket === "debt");
      return assets - debt;
    },
    byBucket(bucket) {
      return lines.filter((l) => l.bucket === bucket);
    },
  };
}

export class ReservationError extends Error {}

/** Holds funds for in-flight operations so two modules cannot spend them twice. */
export class ReservationBook {
  readonly #reservations = new Map<string, Reservation>();

  reserve(next: Reservation, available: bigint): void {
    if (next.amount <= 0n) throw new ReservationError("Reservation amount must be positive");
    if (this.#reservations.has(next.operationId)) throw new ReservationError("Operation already holds a reservation");
    const already = this.total(next.mint, next.source);
    if (already + next.amount > available) {
      throw new ReservationError("Not enough unreserved balance. Another operation is holding part of it.");
    }
    this.#reservations.set(next.operationId, next);
  }

  release(operationId: string): void {
    this.#reservations.delete(operationId);
  }

  total(mint: string, source: "public" | "private"): bigint {
    let acc = 0n;
    for (const r of this.#reservations.values()) if (r.mint === mint && r.source === source) acc += r.amount;
    return acc;
  }

  list(): Reservation[] {
    return [...this.#reservations.values()];
  }

  clear(): void {
    this.#reservations.clear();
  }
}
