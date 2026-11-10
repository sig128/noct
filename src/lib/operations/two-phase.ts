/**
 * REFERENCE MODEL of a two-phase escrowed settlement (commit → lock → execute
 * → settle, with timeout refund). It specifies the properties a future
 * private-swap escrow must have; no such program is deployed and NOCT never
 * routes funds through this model.
 *
 *  - the approved intent digest and a nonce are committed once (no replay)
 *  - exactly the approved input is locked, once
 *  - execution must use an allowed venue and meet the minimum output, or revert
 *  - output settles only to the approved destination
 *  - after expiry anyone may trigger a refund to the owner; no browser session needed
 */

export type EscrowStatus = "committed" | "locked" | "executed" | "settled" | "refunded" | "cancelled";

export interface EscrowTerms {
  intentDigest: string;
  nonce: string;
  owner: string;
  inputAmount: bigint;
  minOutput: bigint;
  destination: string;
  allowedVenues: readonly string[];
  expiresAt: number;
}

export interface Escrow {
  terms: EscrowTerms;
  status: EscrowStatus;
  locked: bigint;
  output: bigint;
}

export class EscrowError extends Error {
  constructor(readonly code: "replay" | "state" | "amount" | "venue" | "slippage" | "destination" | "unauthorized" | "not_expired", message: string) {
    super(message);
  }
}

export class EscrowLedger {
  readonly #escrows = new Map<string, Escrow>();
  readonly #usedNonces = new Set<string>();

  commit(terms: EscrowTerms): string {
    const key = `${terms.owner}:${terms.nonce}`;
    if (this.#usedNonces.has(key)) throw new EscrowError("replay", "This intent nonce was already committed.");
    this.#usedNonces.add(key);
    const id = `${terms.intentDigest}:${terms.nonce}`;
    this.#escrows.set(id, { terms, status: "committed", locked: 0n, output: 0n });
    return id;
  }

  lock(id: string, caller: string, amount: bigint): void {
    const e = this.#require(id);
    if (caller !== e.terms.owner) throw new EscrowError("unauthorized", "Only the owner funds the escrow.");
    if (e.status !== "committed") throw new EscrowError("state", "Escrow is already funded or closed.");
    if (amount !== e.terms.inputAmount) throw new EscrowError("amount", "Locked amount must equal the approved input.");
    e.locked = amount;
    e.status = "locked";
  }

  /** Venue execution. Below the minimum it reverts and the escrow stays locked. */
  execute(id: string, venue: string, output: bigint, now: number): void {
    const e = this.#require(id);
    if (e.status !== "locked") throw new EscrowError("state", "Escrow is not locked.");
    if (now >= e.terms.expiresAt) throw new EscrowError("state", "Escrow expired; only a refund is possible.");
    if (!e.terms.allowedVenues.includes(venue)) throw new EscrowError("venue", "Venue is not allowed by the approved intent.");
    if (output < e.terms.minOutput) throw new EscrowError("slippage", "Output below the approved minimum; execution reverted.");
    e.output = output;
    e.status = "executed";
  }

  settle(id: string, destination: string): bigint {
    const e = this.#require(id);
    if (e.status !== "executed") throw new EscrowError("state", "Nothing to settle.");
    if (destination !== e.terms.destination) throw new EscrowError("destination", "Destination differs from the approved one.");
    e.status = "settled";
    return e.output;
  }

  /** Permissionless after expiry; always pays the owner. */
  refund(id: string, now: number): { to: string; amount: bigint } {
    const e = this.#require(id);
    if (e.status !== "locked") throw new EscrowError("state", e.status === "refunded" ? "Already refunded." : "Only a locked, unexecuted escrow can be refunded.");
    if (now < e.terms.expiresAt) throw new EscrowError("not_expired", "Refund opens at expiry.");
    e.status = "refunded";
    const amount = e.locked;
    e.locked = 0n;
    return { to: e.terms.owner, amount };
  }

  cancel(id: string, caller: string): void {
    const e = this.#require(id);
    if (caller !== e.terms.owner) throw new EscrowError("unauthorized", "Only the owner cancels.");
    if (e.status !== "committed") throw new EscrowError("state", "Funded escrows are refunded, not cancelled.");
    e.status = "cancelled";
  }

  get(id: string): Readonly<Escrow> {
    return this.#require(id);
  }

  #require(id: string): Escrow {
    const e = this.#escrows.get(id);
    if (!e) throw new EscrowError("state", "Unknown escrow");
    return e;
  }
}
