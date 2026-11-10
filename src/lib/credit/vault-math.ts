import { mulDivCeil, mulDivFloor, pow10, type Ratio } from "@/lib/decimal";

/**
 * Risk arithmetic for an external collateral/debt market (Jupiter Lend vault).
 * Scales, as documented or observed on 2026-11-10:
 *  - collateralFactor / liquidationThreshold / liquidationMaxLimit: per-mille
 *    (800 = 80%; docs "800 = 80% max LTV"; the SDK divides the threshold by 1e3)
 *  - rates and borrow fee: basis points (Earn docs "1e4 decimals"; live values agree)
 *  - liquidationPenalty: basis points — INFERRED from the Fluid convention, undocumented
 *  - oraclePrice: debt base units per collateral base unit × 1e18 — DERIVED by
 *    cross-checking two live vaults against their token prices
 */

export const ORACLE_SCALE = 10n ** 18n;
export const PERMILLE = 1_000n;

export interface VaultParams {
  vaultId: number;
  collateralMint: string;
  debtMint: string;
  collateralDecimals: number;
  debtDecimals: number;
  collateralFactorPermille: bigint;
  liquidationThresholdPermille: bigint;
  liquidationMaxLimitPermille: bigint;
  liquidationPenaltyBps: bigint;
  borrowFeeBps: bigint;
  borrowRateBps: bigint;
  supplyRateBps: bigint;
  /** Debt base units the market can lend right now. */
  borrowable: bigint;
  minimumBorrowing: bigint;
  oraclePrice: bigint;
  /** Milliseconds since epoch, as reported by the API. */
  oracleTimestampMs: number;
}

export interface PositionMetrics {
  collateralValueInDebt: bigint;
  maxDebt: bigint;
  liquidationDebt: bigint;
  /** Loan-to-value in basis points, rounded up. Null without collateral. */
  ltvBps: bigint | null;
  /** Health = liquidation debt / debt. Null without debt (infinitely healthy). */
  health: Ratio | null;
  /** Collateral price (debt per whole collateral token) at which liquidation starts. */
  liquidationPrice: Ratio | null;
  /** Collateral price drop to liquidation, basis points. */
  dropToLiquidationBps: bigint | null;
  /** Interest over one year at the current rate, debt base units (rounded up). */
  annualInterest: bigint;
}

export function collateralValueInDebt(collateral: bigint, oraclePrice: bigint): bigint {
  return mulDivFloor(collateral, oraclePrice, ORACLE_SCALE);
}

export function computeMetrics(vault: VaultParams, collateral: bigint, debt: bigint): PositionMetrics {
  const value = collateralValueInDebt(collateral, vault.oraclePrice);
  const maxDebt = mulDivFloor(value, vault.collateralFactorPermille, PERMILLE);
  const liquidationDebt = mulDivFloor(value, vault.liquidationThresholdPermille, PERMILLE);
  const ltvBps = value > 0n ? mulDivCeil(debt, 10_000n, value) : null;
  const health = debt > 0n ? { num: liquidationDebt, den: debt } : null;

  let liquidationPrice: Ratio | null = null;
  let dropToLiquidationBps: bigint | null = null;
  if (debt > 0n && collateral > 0n) {
    // Oracle (1e18, base/base) at which debt == collateral × p × LT.
    const liqOracle = mulDivCeil(debt * PERMILLE, ORACLE_SCALE, collateral * vault.liquidationThresholdPermille);
    // Whole-token price: p_base × 10^colDec / 10^debtDec, as a ratio over 1e18.
    liquidationPrice = {
      num: liqOracle * pow10(vault.collateralDecimals),
      den: ORACLE_SCALE * pow10(vault.debtDecimals),
    };
    dropToLiquidationBps = vault.oraclePrice > liqOracle ? mulDivFloor(vault.oraclePrice - liqOracle, 10_000n, vault.oraclePrice) : 0n;
  }
  const annualInterest = mulDivCeil(debt, vault.borrowRateBps, 10_000n);
  return { collateralValueInDebt: value, maxDebt, liquidationDebt, ltvBps, health, liquidationPrice, dropToLiquidationBps, annualInterest };
}

/** Current oracle price of one whole collateral token in whole debt tokens. */
export function oraclePriceWhole(vault: VaultParams): Ratio {
  return { num: vault.oraclePrice * pow10(vault.collateralDecimals), den: ORACLE_SCALE * pow10(vault.debtDecimals) };
}

export interface OracleCheckInput {
  now: number;
  maxAgeMs: number;
  /** Independent price of collateral in debt units (e.g. Pyth USD/USD), with confidence. */
  independent?: { price: Ratio; confidenceRatio: Ratio } | null;
  maxDeviationBps: bigint;
}

export type OracleCheck =
  | { ok: true; ageMs: number; deviationBps: bigint | null }
  | { ok: false; reason: string; ageMs: number; deviationBps: bigint | null };

/** Conservative freshness and cross-source sanity check before any risk-increasing action. */
export function checkVaultOracle(vault: VaultParams, input: OracleCheckInput): OracleCheck {
  const ageMs = Math.max(0, input.now - vault.oracleTimestampMs);
  let deviationBps: bigint | null = null;
  if (input.independent) {
    const v = oraclePriceWhole(vault);
    const i = input.independent.price;
    // |v - i| / i in bps
    const diffNum = v.num * i.den > i.num * v.den ? v.num * i.den - i.num * v.den : i.num * v.den - v.num * i.den;
    deviationBps = i.num === 0n ? null : (diffNum * 10_000n) / (i.num * v.den);
  }
  if (!Number.isFinite(vault.oracleTimestampMs) || vault.oracleTimestampMs <= 0) {
    return { ok: false, reason: "The market reports no oracle timestamp.", ageMs, deviationBps };
  }
  if (ageMs > input.maxAgeMs) {
    return { ok: false, reason: `The market's oracle was last updated ${formatAge(ageMs)} ago.`, ageMs, deviationBps };
  }
  if (deviationBps !== null && deviationBps > input.maxDeviationBps) {
    return { ok: false, reason: `The market's oracle differs from an independent price by ${(Number(deviationBps) / 100).toFixed(2)}%.`, ageMs, deviationBps };
  }
  return { ok: true, ageMs, deviationBps };
}

export function formatAge(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 90) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h`;
  const days = Math.round(h / 24);
  if (days < 60) return `${days} days`;
  const months = Math.round(days / 30.44);
  if (months < 24) return `${months} months`;
  return `${Math.floor(months / 12)} years`;
}

export type OperateCheck = { ok: true; after: PositionMetrics } | { ok: false; reason: string; after: PositionMetrics | null };

export interface OperateInput {
  collateral: bigint;
  debt: bigint;
  collateralDelta: bigint;
  debtDelta: bigint;
  oracle: OracleCheck;
}

/**
 * Validates a position change. Risk-reducing actions (repay, add collateral)
 * are always allowed; risk-increasing ones need a healthy, fresh market.
 */
export function checkOperate(vault: VaultParams, input: OperateInput): OperateCheck {
  const nextCollateral = input.collateral + input.collateralDelta;
  const nextDebt = input.debt + input.debtDelta;
  if (nextCollateral < 0n) return { ok: false, reason: "Cannot withdraw more collateral than the position holds.", after: null };
  if (nextDebt < 0n) return { ok: false, reason: "Cannot repay more than the debt.", after: null };
  const after = computeMetrics(vault, nextCollateral, nextDebt);
  const increasesRisk = input.debtDelta > 0n || input.collateralDelta < 0n;
  if (!increasesRisk) return { ok: true, after };
  if (!input.oracle.ok) return { ok: false, reason: `${input.oracle.reason} NOCT blocks borrowing and collateral withdrawal until it refreshes.`, after };
  if (input.debtDelta > 0n && input.debtDelta > vault.borrowable) return { ok: false, reason: "The market does not have that much available to borrow.", after };
  if (nextDebt > 0n && nextDebt < vault.minimumBorrowing) return { ok: false, reason: "Below the market's minimum borrow size.", after };
  if (nextDebt > after.maxDebt) return { ok: false, reason: "Exceeds the maximum loan-to-value for this market.", after };
  return { ok: true, after };
}
