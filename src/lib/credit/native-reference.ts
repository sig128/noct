import { sha256 } from "@noble/hashes/sha2.js";
import { mulDivCeil, mulDivFloor, pow10, type Ratio } from "@/lib/decimal";

/**
 * NATIVE CONFIDENTIAL CREDIT — REFERENCE MODEL ONLY.
 *
 * This file specifies, in executable form, the state transitions a native
 * confidential credit system must enforce: committed terms, interest with
 * defined rounding, locked collateral, lender funding, repayment, collateral
 * changes, maturity/default, liquidation that does not need the borrower, and
 * bounded monitor authority. It has no circuits, no on-chain program and no
 * cryptographic privacy. It must never hold or move real funds.
 */
export const NATIVE_CREDIT_STATUS = {
  productionReady: false,
  missing: [
    "Zero-knowledge circuits proving each transition against committed terms",
    "An on-chain settlement program that verifies those proofs and locks collateral",
    "Independent availability of the liquidation witness without the borrower",
    "Oracle integration with on-chain staleness and confidence enforcement",
    "Liquidation monitoring infrastructure with bounded authority",
    "Independent security audits of circuits and program",
  ],
} as const;

export const RAY = 10n ** 27n;
export const SECONDS_PER_YEAR = 31_536_000n;

export interface LoanTerms {
  loanId: string;
  collateralMint: string;
  debtMint: string;
  collateralDecimals: number;
  debtDecimals: number;
  principal: bigint;
  aprBps: bigint;
  originatedAt: bigint;
  maturityAt: bigint;
  maxLtvBps: bigint;
  liquidationThresholdBps: bigint;
  liquidationPenaltyBps: bigint;
  closeFactorBps: bigint;
  borrower: string;
  lender: string;
  /** Holds the liquidation witness; may liquidate or default, nothing else. */
  monitor: string;
}

export interface Opening {
  terms: LoanTerms;
  blinding: Uint8Array;
}

export type LoanStatus = "active" | "repaid" | "liquidated" | "defaulted" | "closed";

export interface LoanState {
  status: LoanStatus;
  termsCommitment: string;
  collateral: bigint;
  /** Debt in RAY-scaled shares; debt = ceil(scaledDebt × index / RAY). */
  scaledDebt: bigint;
  index: bigint;
  lastAccrual: bigint;
  /** Increments on every transition; transitions must name the version they extend. */
  version: bigint;
}

export interface OracleReading {
  /** Whole debt tokens per whole collateral token. */
  price: Ratio;
  /** Absolute confidence interval in the same units. */
  confidence: Ratio;
  publishTime: bigint;
}

export interface OraclePolicy {
  maxAgeSeconds: bigint;
  /** Confidence must be at most this share of the price (bps). */
  maxConfidenceBps: bigint;
}

export class CreditError extends Error {
  constructor(
    readonly code:
      | "tampered_terms"
      | "replay"
      | "unauthorized"
      | "not_active"
      | "stale_oracle"
      | "uncertain_oracle"
      | "unhealthy"
      | "healthy"
      | "too_much"
      | "not_matured"
      | "funding_mismatch"
      | "production_gate",
    message: string,
  ) {
    super(message);
  }
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function encodeTerms(t: LoanTerms): string {
  return [
    t.loanId, t.collateralMint, t.debtMint, t.collateralDecimals, t.debtDecimals, t.principal, t.aprBps, t.originatedAt,
    t.maturityAt, t.maxLtvBps, t.liquidationThresholdBps, t.liquidationPenaltyBps, t.closeFactorBps, t.borrower, t.lender, t.monitor,
  ]
    .map(String)
    .join("|");
}

/** Hash commitment to terms (standard construction: H(domain ‖ terms ‖ blinding)). */
export function commitTerms(terms: LoanTerms, blinding: Uint8Array): string {
  if (blinding.length < 32) throw new CreditError("tampered_terms", "Blinding must be at least 32 bytes");
  const encoded = new TextEncoder().encode(`noct/credit-terms/v1|${encodeTerms(terms)}|`);
  const data = new Uint8Array(encoded.length + blinding.length);
  data.set(encoded);
  data.set(blinding, encoded.length);
  return hex(sha256(data));
}

function checkOpening(state: LoanState, opening: Opening): LoanTerms {
  if (commitTerms(opening.terms, opening.blinding) !== state.termsCommitment) {
    throw new CreditError("tampered_terms", "Terms do not open the committed loan.");
  }
  return opening.terms;
}

function checkVersion(state: LoanState, expected: bigint): void {
  if (state.version !== expected) throw new CreditError("replay", "Transition does not extend the current loan state.");
}

function checkOracle(oracle: OracleReading, policy: OraclePolicy, now: bigint): void {
  if (now - oracle.publishTime > policy.maxAgeSeconds) throw new CreditError("stale_oracle", "Oracle price is stale.");
  // confidence / price ≤ maxConfidenceBps / 1e4
  if (oracle.confidence.num * oracle.price.den * 10_000n > policy.maxConfidenceBps * oracle.price.num * oracle.confidence.den) {
    throw new CreditError("uncertain_oracle", "Oracle confidence interval is too wide.");
  }
}

/** Debt-token base units owed now (rounded up in the lender's favour). */
export function debtOf(state: LoanState): bigint {
  return mulDivCeil(state.scaledDebt, state.index, RAY);
}

/** Linear per-accrual interest on the index; rounding favours the lender. */
export function accrue(state: LoanState, terms: LoanTerms, now: bigint): LoanState {
  if (now <= state.lastAccrual || state.status !== "active") return state;
  const dt = now - state.lastAccrual;
  const growth = mulDivCeil(state.index, terms.aprBps * dt, 10_000n * SECONDS_PER_YEAR);
  return { ...state, index: state.index + growth, lastAccrual: now };
}

/** Value of collateral in debt base units at a whole-token price, rounded down. */
function collateralValue(collateral: bigint, terms: LoanTerms, price: Ratio): bigint {
  return mulDivFloor(collateral * price.num, pow10(terms.debtDecimals), price.den * pow10(terms.collateralDecimals));
}

function conservativePrice(oracle: OracleReading): Ratio {
  // price − confidence, never below zero
  const num = oracle.price.num * oracle.confidence.den - oracle.confidence.num * oracle.price.den;
  return num > 0n ? { num, den: oracle.price.den * oracle.confidence.den } : { num: 0n, den: 1n };
}

export function originate(input: {
  opening: Opening;
  collateral: bigint;
  lenderFunding: bigint;
  oracle: OracleReading;
  policy: OraclePolicy;
  now: bigint;
}): LoanState {
  const { terms } = input.opening;
  if (input.lenderFunding !== terms.principal) throw new CreditError("funding_mismatch", "Lender funding must equal the committed principal.");
  checkOracle(input.oracle, input.policy, input.now);
  const value = collateralValue(input.collateral, terms, conservativePrice(input.oracle));
  if (terms.principal * 10_000n > value * terms.maxLtvBps) throw new CreditError("unhealthy", "Principal exceeds the maximum loan-to-value.");
  return {
    status: "active",
    termsCommitment: commitTerms(terms, input.opening.blinding),
    collateral: input.collateral,
    scaledDebt: mulDivCeil(terms.principal, RAY, RAY),
    index: RAY,
    lastAccrual: input.now,
    version: 1n,
  };
}

export function repay(state: LoanState, opening: Opening, input: { amount: bigint; now: bigint; expectedVersion: bigint }): { state: LoanState; applied: bigint } {
  const terms = checkOpening(state, opening);
  checkVersion(state, input.expectedVersion);
  if (state.status !== "active") throw new CreditError("not_active", "Loan is not active.");
  const accrued = accrue(state, terms, input.now);
  const owed = debtOf(accrued);
  const applied = input.amount >= owed ? owed : input.amount;
  // Shares burned round down, so a partial repayment never over-credits the borrower.
  const burned = applied === owed ? accrued.scaledDebt : mulDivFloor(applied, RAY, accrued.index);
  const scaledDebt = accrued.scaledDebt - burned;
  return {
    state: { ...accrued, scaledDebt, status: scaledDebt === 0n ? "repaid" : "active", version: state.version + 1n },
    applied,
  };
}

export function addCollateral(state: LoanState, opening: Opening, input: { amount: bigint; actor: string; expectedVersion: bigint }): LoanState {
  const terms = checkOpening(state, opening);
  checkVersion(state, input.expectedVersion);
  if (input.actor !== terms.borrower) throw new CreditError("unauthorized", "Only the borrower adds collateral.");
  if (state.status !== "active") throw new CreditError("not_active", "Loan is not active.");
  return { ...state, collateral: state.collateral + input.amount, version: state.version + 1n };
}

export function withdrawCollateral(
  state: LoanState,
  opening: Opening,
  input: { amount: bigint; actor: string; oracle: OracleReading; policy: OraclePolicy; now: bigint; expectedVersion: bigint },
): LoanState {
  const terms = checkOpening(state, opening);
  checkVersion(state, input.expectedVersion);
  if (input.actor !== terms.borrower) throw new CreditError("unauthorized", "Only the borrower withdraws collateral.");
  if (input.amount > state.collateral) throw new CreditError("too_much", "More than the locked collateral.");
  const accrued = accrue(state, terms, input.now);
  const owed = debtOf(accrued);
  const remaining = state.collateral - input.amount;
  if (owed > 0n) {
    checkOracle(input.oracle, input.policy, input.now);
    const value = collateralValue(remaining, terms, conservativePrice(input.oracle));
    if (owed * 10_000n > value * terms.maxLtvBps) throw new CreditError("unhealthy", "Withdrawal would exceed the maximum loan-to-value.");
  }
  return { ...accrued, collateral: remaining, version: state.version + 1n };
}

/**
 * Liquidation needs no borrower action or signature. The monitor's authority
 * is limited to this path and `declareDefault`; it receives only the
 * collateral the formula assigns.
 */
export function liquidate(
  state: LoanState,
  opening: Opening,
  input: { actor: string; repayAmount: bigint; oracle: OracleReading; policy: OraclePolicy; now: bigint; expectedVersion: bigint },
): { state: LoanState; seizedCollateral: bigint } {
  const terms = checkOpening(state, opening);
  checkVersion(state, input.expectedVersion);
  if (input.actor !== terms.monitor && input.actor !== terms.lender) throw new CreditError("unauthorized", "Only the monitor or lender liquidates.");
  if (state.status !== "active") throw new CreditError("not_active", "Loan is not active.");
  checkOracle(input.oracle, input.policy, input.now);
  const accrued = accrue(state, terms, input.now);
  const owed = debtOf(accrued);
  // Eligibility uses the mid price; a wide confidence band was already rejected.
  const value = collateralValue(accrued.collateral, terms, input.oracle.price);
  if (owed * 10_000n <= value * terms.liquidationThresholdBps) throw new CreditError("healthy", "Position is above its liquidation threshold.");
  const maxRepay = mulDivCeil(owed, terms.closeFactorBps, 10_000n);
  if (input.repayAmount > maxRepay) throw new CreditError("too_much", "Repay amount exceeds the close factor.");
  // Seized = repay × (1 + penalty) / price, in collateral base units, rounded down.
  const seizeNum = input.repayAmount * (10_000n + terms.liquidationPenaltyBps) * input.oracle.price.den * pow10(terms.collateralDecimals);
  const seizeDen = 10_000n * input.oracle.price.num * pow10(terms.debtDecimals);
  let seized = seizeNum / seizeDen;
  if (seized > accrued.collateral) seized = accrued.collateral;
  const after = repay({ ...accrued, version: state.version }, opening, { amount: input.repayAmount, now: input.now, expectedVersion: state.version }).state;
  const collateral = accrued.collateral - seized;
  return {
    state: { ...after, collateral, status: after.scaledDebt === 0n ? "liquidated" : "active", version: state.version + 1n },
    seizedCollateral: seized,
  };
}

export function declareDefault(state: LoanState, opening: Opening, input: { actor: string; now: bigint; expectedVersion: bigint }): LoanState {
  const terms = checkOpening(state, opening);
  checkVersion(state, input.expectedVersion);
  if (input.actor !== terms.monitor && input.actor !== terms.lender) throw new CreditError("unauthorized", "Only the monitor or lender declares default.");
  if (input.now <= terms.maturityAt) throw new CreditError("not_matured", "Loan has not matured.");
  const accrued = accrue(state, terms, input.now);
  if (debtOf(accrued) === 0n) throw new CreditError("not_active", "Nothing is owed.");
  return { ...accrued, status: "defaulted", version: state.version + 1n };
}

export function close(state: LoanState, opening: Opening, input: { actor: string; expectedVersion: bigint }): LoanState {
  const terms = checkOpening(state, opening);
  checkVersion(state, input.expectedVersion);
  if (input.actor !== terms.borrower) throw new CreditError("unauthorized", "Only the borrower closes the loan.");
  if (state.scaledDebt !== 0n) throw new CreditError("not_active", "Debt must be repaid before closing.");
  return { ...state, status: "closed", collateral: 0n, version: state.version + 1n };
}

export interface TransitionVerifier {
  kind: "reference" | "zk";
}

/** Real funds require a production verifier AND a production-ready system. */
export function assertRealFundsAllowed(verifier: TransitionVerifier): void {
  if (verifier.kind !== "zk" || !NATIVE_CREDIT_STATUS.productionReady) {
    throw new CreditError("production_gate", "Native confidential credit is not enabled for real funds.");
  }
}
