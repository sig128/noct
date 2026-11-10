import { describe, expect, it } from "vitest";
import { checkOperate, checkVaultOracle, computeMetrics, oraclePriceWhole, type VaultParams } from "@/lib/credit/vault-math";
import { assessOracle, conservativeBounds, pythToRatio, parseHermesEntry } from "@/lib/oracle/pyth";
import { toVaultParams } from "@/lib/client/lend";
import {
  accrue,
  addCollateral,
  assertRealFundsAllowed,
  close,
  commitTerms,
  CreditError,
  debtOf,
  declareDefault,
  liquidate,
  originate,
  repay,
  withdrawCollateral,
  RAY,
  type LoanTerms,
  type OracleReading,
} from "@/lib/credit/native-reference";
import { formatRatioSignificant } from "@/lib/decimal";
import { NATIVE_SOL_MINT, USDC_MINT } from "@/lib/tokens/types";

/** Vault 1 (SOL/USDC) fields as returned by lite-api.jup.ag/lend/v1/borrow/vaults on 2026-11-10. */
const liveVault = {
  id: 1,
  address: "nMzVs8GiXMVUENEwkev7JZfDcCENmz18ScheeVRdnb1",
  supplyToken: { address: NATIVE_SOL_MINT, symbol: "WSOL", decimals: 9, price: "106.880327195107" },
  borrowToken: { address: USDC_MINT, symbol: "USDC", decimals: 6, price: "0.999385392889" },
  collateralFactor: "800",
  liquidationThreshold: "850",
  liquidationMaxLimit: "900",
  liquidationPenalty: "100",
  borrowFee: "0",
  supplyRate: "393",
  borrowRate: "654",
  borrowable: "17608002774539",
  withdrawable: "353519396344965",
  minimumBorrowing: "1061434",
  oraclePrice: "107082790830000000",
  oracleTimestamp: 1792587945960,
  oracleSources: [{ source: "CH31Xns5z3M1cTAbKW34jcxPPciazARpijcHj9rxtemt", invert: false, sourceType: { chainlink: {} } }],
};

describe("external market arithmetic (Jupiter Lend vault)", () => {
  const v = toVaultParams(liveVault)!;
  it("reads the oracle as debt base units per collateral base unit × 1e18", () => {
    expect(formatRatioSignificant(oraclePriceWhole(v), 6)).toBe("107.082");
  });
  it("computes capacity, LTV, health and liquidation price with integer math", () => {
    const m = computeMetrics(v, 2_000_000_000n, 100_000_000n); // 2 SOL, 100 USDC
    expect(m.collateralValueInDebt).toBe(214_165_581n); // 214.165581 USDC
    expect(m.maxDebt).toBe(171_332_464n); // 80%
    expect(m.liquidationDebt).toBe(182_040_743n); // 85%
    expect(m.ltvBps).toBe(4_670n);
    expect(formatRatioSignificant(m.health!, 4)).toBe("1.82");
    expect(formatRatioSignificant(m.liquidationPrice!, 5)).toBe("58.823");
    expect(m.annualInterest).toBe(6_540_000n);
  });
  it("blocks risk-increasing actions on a stale oracle but allows repaying and adding collateral", () => {
    const stale = checkVaultOracle(v, { now: v.oracleTimestampMs + 60 * 60_000, maxAgeMs: 15 * 60_000, maxDeviationBps: 300n });
    expect(stale.ok).toBe(false);
    expect(checkOperate(v, { collateral: 2_000_000_000n, debt: 0n, collateralDelta: 0n, debtDelta: 10_000_000n, oracle: stale }).ok).toBe(false);
    expect(checkOperate(v, { collateral: 2_000_000_000n, debt: 50_000_000n, collateralDelta: 0n, debtDelta: -10_000_000n, oracle: stale }).ok).toBe(true);
    expect(checkOperate(v, { collateral: 2_000_000_000n, debt: 50_000_000n, collateralDelta: 1n, debtDelta: 0n, oracle: stale }).ok).toBe(true);
  });
  it("enforces max LTV, minimum borrow and available liquidity", () => {
    const fresh = checkVaultOracle(v, { now: v.oracleTimestampMs + 1_000, maxAgeMs: 15 * 60_000, maxDeviationBps: 300n });
    expect(fresh.ok).toBe(true);
    const tooMuch = checkOperate(v, { collateral: 2_000_000_000n, debt: 0n, collateralDelta: 0n, debtDelta: 171_332_465n, oracle: fresh });
    expect(tooMuch.ok).toBe(false);
    expect(checkOperate(v, { collateral: 2_000_000_000n, debt: 0n, collateralDelta: 0n, debtDelta: 171_332_464n, oracle: fresh }).ok).toBe(true);
    expect(checkOperate(v, { collateral: 2_000_000_000n, debt: 0n, collateralDelta: 0n, debtDelta: 1_000n, oracle: fresh }).ok).toBe(false);
    const dry: VaultParams = { ...v, borrowable: 5_000_000n };
    expect(checkOperate(dry, { collateral: 2_000_000_000n, debt: 0n, collateralDelta: 0n, debtDelta: 10_000_000n, oracle: fresh }).ok).toBe(false);
  });
  it("flags a vault oracle that disagrees with an independent price", () => {
    const check = checkVaultOracle(v, { now: v.oracleTimestampMs, maxAgeMs: 60_000, independent: { price: { num: 100n, den: 1n }, confidenceRatio: { num: 0n, den: 1n } }, maxDeviationBps: 300n });
    expect(check.ok).toBe(false);
    expect(check.deviationBps).toBe(708n);
  });
  it("rejects implausible vault parameters", () => {
    expect(toVaultParams({ ...liveVault, collateralFactor: "900", liquidationThreshold: "850" })).toBeNull();
    expect(toVaultParams({ ...liveVault, oraclePrice: "-1" })).toBeNull();
  });
});

describe("oracle staleness and confidence", () => {
  const entry = { id: "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d", price: { price: "8180094410", conf: "4090047", expo: -8, publish_time: 1_000 } };
  it("converts fixed-point prices exactly", () => {
    expect(pythToRatio("8180094410", -8)).toEqual({ num: 8180094410n, den: 100_000_000n });
    expect(pythToRatio("-1", -8)).toBeNull();
  });
  it("rejects stale and wide-confidence prices", () => {
    const p = parseHermesEntry(entry)!;
    expect(assessOracle(p, 1_030).usable).toBe(true);
    expect(assessOracle(p, 1_061)).toMatchObject({ usable: false });
    const wide = parseHermesEntry({ ...entry, price: { ...entry.price, conf: "200000000" } })!;
    expect(assessOracle(wide, 1_000)).toMatchObject({ usable: false });
  });
  it("values collateral at the low bound and debt at the high bound", () => {
    const p = parseHermesEntry(entry)!;
    const { low, high } = conservativeBounds(p);
    expect(low.num * high.den < high.num * low.den).toBe(true);
  });
});

describe("native confidential credit reference model", () => {
  const blinding = new Uint8Array(32).fill(7);
  const terms: LoanTerms = {
    loanId: "loan-1",
    collateralMint: NATIVE_SOL_MINT,
    debtMint: USDC_MINT,
    collateralDecimals: 9,
    debtDecimals: 6,
    principal: 100_000_000n, // 100 USDC
    aprBps: 1_000n, // 10%
    originatedAt: 0n,
    maturityAt: 31_536_000n,
    maxLtvBps: 7_000n,
    liquidationThresholdBps: 8_000n,
    liquidationPenaltyBps: 500n,
    closeFactorBps: 5_000n,
    borrower: "borrower",
    lender: "lender",
    monitor: "monitor",
  };
  const opening = { terms, blinding };
  const policy = { maxAgeSeconds: 60n, maxConfidenceBps: 100n };
  const price = (p: bigint, t: bigint): OracleReading => ({ price: { num: p, den: 1n }, confidence: { num: p, den: 1000n }, publishTime: t });
  const loan = () => originate({ opening, collateral: 2_000_000_000n, lenderFunding: 100_000_000n, oracle: price(100n, 0n), policy, now: 0n });

  it("commits terms and rejects tampered openings", () => {
    const s = loan();
    expect(s.termsCommitment).toBe(commitTerms(terms, blinding));
    expect(() => repay(s, { terms: { ...terms, aprBps: 1n }, blinding }, { amount: 1n, now: 1n, expectedVersion: s.version })).toThrow(CreditError);
    expect(() => repay(s, { terms, blinding: new Uint8Array(32).fill(8) }, { amount: 1n, now: 1n, expectedVersion: s.version })).toThrow(/committed/);
  });

  it("requires lender funding equal to the committed principal and a healthy start", () => {
    expect(() => originate({ opening, collateral: 2_000_000_000n, lenderFunding: 99_000_000n, oracle: price(100n, 0n), policy, now: 0n })).toThrow(/funding/);
    expect(() => originate({ opening, collateral: 1_000_000_000n, lenderFunding: 100_000_000n, oracle: price(100n, 0n), policy, now: 0n })).toThrow(/loan-to-value/);
  });

  it("accrues interest rounding up for the lender", () => {
    const s = accrue(loan(), terms, 31_536_000n);
    expect(debtOf(s)).toBe(110_000_000n);
    const tiny = accrue(loan(), terms, 1n);
    expect(tiny.index).toBeGreaterThan(RAY);
    expect(debtOf(tiny)).toBe(100_000_001n); // 0.32 base units of interest, rounded up
  });

  it("partial repayment never over-credits; full repayment clears exactly", () => {
    const s0 = accrue(loan(), terms, 31_536_000n);
    const { state: s1, applied } = repay(s0, opening, { amount: 10_000_001n, now: 31_536_000n, expectedVersion: s0.version });
    expect(applied).toBe(10_000_001n);
    expect(debtOf(s1)).toBeGreaterThanOrEqual(110_000_000n - 10_000_001n);
    const { state: s2, applied: rest } = repay(s1, opening, { amount: 10n ** 12n, now: 31_536_000n, expectedVersion: s1.version });
    expect(rest).toBe(debtOf(s1));
    expect(s2.status).toBe("repaid");
    expect(close(s2, opening, { actor: "borrower", expectedVersion: s2.version }).status).toBe("closed");
  });

  it("replaying an old transition fails", () => {
    const s0 = loan();
    const s1 = addCollateral(s0, opening, { amount: 1n, actor: "borrower", expectedVersion: s0.version });
    expect(() => addCollateral(s1, opening, { amount: 1n, actor: "borrower", expectedVersion: s0.version })).toThrow(/current loan state/);
  });

  it("liquidates an unhealthy loan with the borrower offline, within the close factor", () => {
    const s0 = loan(); // 2 SOL at $100 backing 100 USDC
    const crash = price(60n, 100n); // 2 SOL now worth 120 → 100/120 = 83% > 80%
    const { state, seizedCollateral } = liquidate(s0, opening, { actor: "monitor", repayAmount: 50_000_000n, oracle: crash, policy, now: 100n, expectedVersion: s0.version });
    expect(seizedCollateral).toBe(875_000_000n); // 50 × 1.05 / 60 SOL
    expect(state.collateral).toBe(1_125_000_000n);
    expect(() => liquidate(s0, opening, { actor: "monitor", repayAmount: 60_000_000n, oracle: crash, policy, now: 100n, expectedVersion: s0.version })).toThrow(/close factor/);
  });

  it("refuses to liquidate a healthy loan or on a stale or uncertain price", () => {
    const s0 = loan();
    expect(() => liquidate(s0, opening, { actor: "monitor", repayAmount: 1n, oracle: price(100n, 10n), policy, now: 10n, expectedVersion: s0.version })).toThrow(/above its liquidation threshold/);
    expect(() => liquidate(s0, opening, { actor: "monitor", repayAmount: 1n, oracle: price(60n, 0n), policy, now: 1_000n, expectedVersion: s0.version })).toThrow(/stale/);
    const noisy: OracleReading = { price: { num: 60n, den: 1n }, confidence: { num: 6n, den: 1n }, publishTime: 100n };
    expect(() => liquidate(s0, opening, { actor: "monitor", repayAmount: 1n, oracle: noisy, policy, now: 100n, expectedVersion: s0.version })).toThrow(/confidence/);
  });

  it("monitor authority is bounded: it cannot withdraw collateral", () => {
    const s0 = loan();
    expect(() => withdrawCollateral(s0, opening, { amount: 1n, actor: "monitor", oracle: price(100n, 0n), policy, now: 0n, expectedVersion: s0.version })).toThrow(/Only the borrower/);
    expect(() => addCollateral(s0, opening, { amount: 1n, actor: "monitor", expectedVersion: s0.version })).toThrow(/Only the borrower/);
  });

  it("collateral withdrawal keeps the loan within max LTV", () => {
    const s0 = loan();
    expect(() => withdrawCollateral(s0, opening, { amount: 700_000_000n, actor: "borrower", oracle: price(100n, 0n), policy, now: 0n, expectedVersion: s0.version })).toThrow(/maximum loan-to-value/);
    expect(withdrawCollateral(s0, opening, { amount: 500_000_000n, actor: "borrower", oracle: price(100n, 0n), policy, now: 0n, expectedVersion: s0.version }).collateral).toBe(1_500_000_000n);
  });

  it("default can be declared only after maturity", () => {
    const s0 = loan();
    expect(() => declareDefault(s0, opening, { actor: "lender", now: 100n, expectedVersion: s0.version })).toThrow(/matured/);
    expect(declareDefault(s0, opening, { actor: "lender", now: 31_536_001n, expectedVersion: s0.version }).status).toBe("defaulted");
  });

  it("is gated off for real funds, even with a reference verifier", () => {
    expect(() => assertRealFundsAllowed({ kind: "reference" })).toThrow(/not enabled/);
    expect(() => assertRealFundsAllowed({ kind: "zk" })).toThrow(/not enabled/);
  });
});
