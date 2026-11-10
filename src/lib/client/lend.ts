"use client";

import { formatAmount, formatBps, formatRatioSignificant, mulDivFloor, parseBaseUnits, pow10, type Ratio } from "@/lib/decimal";
import { sanitizeSymbol } from "@/lib/tokens/sanitize";
import type { BorrowIntent, EarnIntent, Network } from "@/lib/operations/intent";
import { PROFILES } from "@/lib/privacy/model";
import { computeMetrics, formatAge, type VaultParams } from "@/lib/credit/vault-math";
import { base64ToBytes, bytesToBase64 } from "@/lib/tx/inspect";
import { BORROW_PROGRAMS, EARN_PROGRAMS, PROGRAMS } from "@/lib/tx/programs";
import { api, ApiError, type EarnMarketRaw, type VaultRaw } from "./api";
import { solanaRpc, waitForConfirmation } from "./rpc";
import type { ReviewRow, SubmitResult, TxSpec } from "./tx-flow";
import { buildUnwrapSolTransaction, buildWrapSolTransaction } from "./wsol";
import { lamportsText } from "./swap-spec";

export interface EarnMarket {
  id: number;
  receiptMint: string;
  receiptSymbol: string;
  assetMint: string;
  assetSymbol: string;
  decimals: number;
  supplyRateBps: bigint;
  rewardsRateBps: bigint;
  totalRateBps: bigint;
  /** Shares per whole underlying token, in share base units (API precision). */
  convertToShares: bigint;
  /** Underlying per whole share, in underlying base units (API precision). */
  convertToAssets: bigint;
  totalAssets: bigint;
  withdrawable: bigint | null;
  updatedAtMs: number | null;
}

export function toEarnMarket(raw: EarnMarketRaw): EarnMarket | null {
  const parse = (v: string | undefined) => (v === undefined ? null : parseBaseUnits(v));
  const supply = parse(raw.supplyRate);
  const rewards = parse(raw.rewardsRate);
  const total = parse(raw.totalRate);
  const toShares = parse(raw.convertToShares);
  const toAssets = parse(raw.convertToAssets);
  const totalAssets = parse(raw.totalAssets);
  if (supply === null || rewards === null || total === null || !toShares || !toAssets || totalAssets === null) return null;
  const ts = raw.liquiditySupplyData?.lastUpdateTimestamp;
  const tsNum = typeof ts === "number" ? ts : ts ? Number(ts) : NaN;
  return {
    id: raw.id,
    receiptMint: raw.address,
    receiptSymbol: sanitizeSymbol(raw.symbol),
    assetMint: raw.assetAddress,
    assetSymbol: raw.asset.symbol === "WSOL" ? "SOL" : sanitizeSymbol(raw.asset.symbol),
    decimals: raw.asset.decimals,
    supplyRateBps: supply,
    rewardsRateBps: rewards,
    totalRateBps: total,
    convertToShares: toShares,
    convertToAssets: toAssets,
    totalAssets,
    withdrawable: raw.liquiditySupplyData?.withdrawable ? parseBaseUnits(raw.liquiditySupplyData.withdrawable) : null,
    // Seconds per the observed payload; reject implausible values.
    updatedAtMs: Number.isFinite(tsNum) && tsNum > 1_600_000_000 && tsNum < 4_000_000_000 ? tsNum * 1000 : null,
  };
}

/** Estimated shares for a deposit, rounded down. Exact shares are set on chain. */
export function previewShares(market: EarnMarket, amount: bigint): bigint {
  return mulDivFloor(amount, market.convertToShares, pow10(market.decimals));
}

/** Underlying value of shares, rounded down. */
export function sharesToAssets(market: EarnMarket, shares: bigint): bigint {
  return mulDivFloor(shares, market.convertToAssets, pow10(market.decimals));
}

export function toVaultParams(raw: VaultRaw): VaultParams | null {
  const n = (v: string) => parseBaseUnits(v);
  const fields = [raw.collateralFactor, raw.liquidationThreshold, raw.liquidationMaxLimit, raw.liquidationPenalty, raw.borrowFee, raw.borrowRate, raw.supplyRate, raw.borrowable, raw.minimumBorrowing, raw.oraclePrice].map(n);
  if (fields.some((f) => f === null)) return null;
  const [cf, lt, lml, pen, fee, br, sr, borrowable, minBorrow, oracle] = fields as bigint[];
  if (cf! <= 0n || cf! >= 1000n || lt! <= cf! || lt! > 1000n) return null;
  return {
    vaultId: raw.id,
    collateralMint: raw.supplyToken.address,
    debtMint: raw.borrowToken.address,
    collateralDecimals: raw.supplyToken.decimals,
    debtDecimals: raw.borrowToken.decimals,
    collateralFactorPermille: cf!,
    liquidationThresholdPermille: lt!,
    liquidationMaxLimitPermille: lml!,
    liquidationPenaltyBps: pen!,
    borrowFeeBps: fee!,
    borrowRateBps: br!,
    supplyRateBps: sr!,
    borrowable: borrowable!,
    minimumBorrowing: minBorrow!,
    oraclePrice: oracle!,
    oracleTimestampMs: raw.oracleTimestamp ?? 0,
  };
}

export function symbolOf(sym: string): string {
  return sym === "WSOL" ? "SOL" : sanitizeSymbol(sym);
}

export function permilleText(v: bigint): string {
  return `${formatRatioSignificant({ num: v, den: 10n }, 4)}%`;
}

export function healthText(h: Ratio | null): string {
  if (!h) return "No debt";
  return formatRatioSignificant(h, 3);
}

async function sendAndConfirm(network: Network, signed: Uint8Array, signature: string | null): Promise<SubmitResult> {
  let sig = signature;
  try {
    sig = await solanaRpc.sendRaw(network, bytesToBase64(signed));
  } catch (error) {
    const message = error instanceof ApiError ? error.message : "The network did not accept the transaction.";
    // Preflight rejections mean it never reached a leader.
    if (error instanceof ApiError && error.code.startsWith("rpc_-320")) return { status: "failed", signature: null, message, retryable: true };
    return { status: "unknown", signature: sig, message };
  }
  const status = await waitForConfirmation(network, sig!, 60_000);
  if (!status) return { status: "unknown", signature: sig, message: "No confirmation yet." };
  if (status.found && status.err) return { status: "failed", signature: sig, message: "The transaction failed on chain.", retryable: true };
  const fee = await solanaRpc.getTransactionFee(network, sig!);
  return { status: "confirmed", signature: sig!, rows: fee !== null ? [{ label: "Network fee", value: lamportsText(fee) }] : [] };
}

function demoResult(): Promise<SubmitResult> {
  return new Promise((r) =>
    setTimeout(() => r({ status: "confirmed", signature: `demo-${Math.random().toString(36).slice(2, 10)}`, rows: [{ label: "Result", value: "Simulated in Demo mode. Nothing was sent.", tone: "warn" }] }), 800),
  );
}

export function earnSpec(p: {
  action: "deposit" | "withdraw";
  market: EarnMarket;
  amount: bigint;
  available: bigint;
  network: Network;
  signer: string;
  demo: boolean;
  onSettled(): void;
}): TxSpec {
  const verb = p.action === "deposit" ? "Supply" : "Withdraw";
  return {
    kind: p.action === "deposit" ? "earnDeposit" : "earnWithdraw",
    title: `${verb} ${p.market.assetSymbol} ${p.action === "deposit" ? "to" : "from"} Jupiter Lend`,
    network: p.network,
    signer: p.signer,
    demo: p.demo,
    disclosure: PROFILES.earnSupply,
    requestedPrivacy: "public",
    activityDetail: `${formatAmount(p.amount, p.market.decimals)} ${p.market.assetSymbol}`,
    primaryLabel: p.demo ? `Simulate ${verb.toLowerCase()}` : `Sign and ${verb.toLowerCase()}`,
    reserve: p.action === "deposit" ? { mint: p.market.assetMint, amount: p.amount, source: "public", available: p.available } : undefined,
    async build({ operationId }) {
      let wire: Uint8Array = new Uint8Array();
      let lastValidBlockHeight: bigint | null = null;
      if (!p.demo) {
        const built = await api.earnTx({ action: p.action, asset: p.market.assetMint, signer: p.signer, amount: p.amount });
        wire = base64ToBytes(built.transaction);
        lastValidBlockHeight = (await solanaRpc.getLatestBlockhash(p.network)).lastValidBlockHeight;
      }
      const shares = previewShares(p.market, p.amount);
      const intent: EarnIntent = {
        kind: p.action === "deposit" ? "earnDeposit" : "earnWithdraw",
        operationId,
        network: p.network,
        adapter: "jupiter-lend-earn",
        protocolVersion: "lend/v1",
        privacyClass: "public",
        requestedPrivacyClass: "public",
        expiresAt: Date.now() + 45_000,
        allowedPrograms: EARN_PROGRAMS,
        signer: p.signer,
        assetMint: p.market.assetMint,
        receiptMint: p.market.receiptMint,
        amount: p.amount,
        shareBound: shares,
      };
      const rows: ReviewRow[] = [
        { label: p.action === "deposit" ? "You supply" : "You withdraw", value: `${formatAmount(p.amount, p.market.decimals)} ${p.market.assetSymbol}`, sensitive: true },
        {
          label: p.action === "deposit" ? "Receipt tokens (estimated)" : "Receipt tokens burned (estimated)",
          value: `≈ ${formatAmount(shares, p.market.decimals)} ${p.market.receiptSymbol}`,
          sensitive: true,
        },
        { label: "Current rate", value: `${formatBps(p.market.totalRateBps)} a year (${formatBps(p.market.supplyRateBps)} supply + ${formatBps(p.market.rewardsRateBps)} rewards), variable` },
        { label: "Rate as of", value: p.market.updatedAtMs ? `${formatAge(Date.now() - p.market.updatedAtMs)} ago` : "Not reported", tone: "muted" },
        { label: "Exchange rate precision", value: "Estimated from the API's rounded rate; the program sets exact shares.", tone: "muted" },
        { label: "Protocol", value: "Jupiter Lend (Earn, beta API)" },
        { label: "Custody", value: PROFILES.earnSupply.custody },
      ];
      return { wire, lastValidBlockHeight, intent, rows, expiresAt: intent.expiresAt };
    },
    policy: () => ({ feePayer: p.signer, allowedPrograms: EARN_PROGRAMS, maxSigners: 1, allowedVersions: [0, "legacy"] }),
    submit: (signed) => (p.demo ? demoResult() : sendAndConfirm(p.network, signed, null)),
    onSettled: p.onSettled,
  };
}

export const MIN_I128 = "-170141183460469231731687303715884105728";

export function borrowSpec(p: {
  vault: VaultParams;
  collateralSymbol: string;
  debtSymbol: string;
  positionId: number;
  collateral: bigint;
  debt: bigint;
  collateralDelta: bigint;
  debtDelta: bigint;
  /** Repay the full debt with the protocol's sentinel to avoid interest dust. */
  repayAll?: boolean;
  network: Network;
  signer: string;
  demo: boolean;
  available: bigint;
  onSettled(): void;
}): TxSpec {
  const describe = () => {
    const parts: string[] = [];
    if (p.collateralDelta > 0n) parts.push(`add ${formatAmount(p.collateralDelta, p.vault.collateralDecimals)} ${p.collateralSymbol}`);
    if (p.collateralDelta < 0n) parts.push(`withdraw ${formatAmount(-p.collateralDelta, p.vault.collateralDecimals)} ${p.collateralSymbol}`);
    if (p.debtDelta > 0n) parts.push(`borrow ${formatAmount(p.debtDelta, p.vault.debtDecimals)} ${p.debtSymbol}`);
    if (p.debtDelta < 0n || p.repayAll) parts.push(p.repayAll ? "repay all debt" : `repay ${formatAmount(-p.debtDelta, p.vault.debtDecimals)} ${p.debtSymbol}`);
    return parts.join(", ");
  };
  const after = computeMetrics(p.vault, p.collateral + p.collateralDelta, p.repayAll ? 0n : p.debt + p.debtDelta);
  return {
    kind: "borrow",
    title: `${p.collateralSymbol}/${p.debtSymbol}: ${describe()}`,
    network: p.network,
    signer: p.signer,
    demo: p.demo,
    disclosure: PROFILES.externalBorrow,
    requestedPrivacy: "public",
    activityDetail: describe(),
    primaryLabel: p.demo ? "Simulate" : "Sign and submit",
    reserve:
      p.collateralDelta > 0n
        ? { mint: p.vault.collateralMint, amount: p.collateralDelta, source: "public", available: p.available }
        : p.debtDelta < 0n
          ? { mint: p.vault.debtMint, amount: -p.debtDelta, source: "public", available: p.available }
          : undefined,
    async build({ operationId }) {
      let wire: Uint8Array = new Uint8Array();
      let lastValidBlockHeight: bigint | null = null;
      const colAmount = p.collateralDelta.toString();
      const debtAmount = p.repayAll ? MIN_I128 : p.debtDelta.toString();
      if (!p.demo) {
        const built = await api.operate({ vaultId: p.vault.vaultId, positionId: p.positionId, signer: p.signer, colAmount, debtAmount });
        wire = base64ToBytes(built.transaction);
        lastValidBlockHeight = (await solanaRpc.getLatestBlockhash(p.network)).lastValidBlockHeight;
      }
      const intent: BorrowIntent = {
        kind: "borrowOperate",
        operationId,
        network: p.network,
        adapter: "jupiter-lend-borrow",
        protocolVersion: "lend/v1",
        privacyClass: "public",
        requestedPrivacyClass: "public",
        expiresAt: Date.now() + 45_000,
        allowedPrograms: BORROW_PROGRAMS,
        signer: p.signer,
        vaultId: p.vault.vaultId,
        positionId: p.positionId,
        collateralMint: p.vault.collateralMint,
        debtMint: p.vault.debtMint,
        collateralDelta: p.collateralDelta,
        debtDelta: p.repayAll ? -p.debt : p.debtDelta,
      };
      const rows: ReviewRow[] = [
        { label: "Change", value: describe(), sensitive: true },
        { label: "Collateral after", value: `${formatAmount(p.collateral + p.collateralDelta, p.vault.collateralDecimals)} ${p.collateralSymbol}`, sensitive: true },
        { label: "Debt after", value: p.repayAll ? `0 ${p.debtSymbol}` : `${formatAmount(p.debt + p.debtDelta, p.vault.debtDecimals)} ${p.debtSymbol}`, sensitive: true },
        { label: "Health after", value: healthText(after.health), tone: after.health && after.health.num * 100n < after.health.den * 115n ? "warn" : "default" },
        { label: "Liquidation price", value: after.liquidationPrice ? `${formatRatioSignificant(after.liquidationPrice, 5)} ${p.debtSymbol} per ${p.collateralSymbol}` : "None" },
        { label: "Borrow rate", value: `${formatBps(p.vault.borrowRateBps)} a year, variable` },
        { label: "Liquidation penalty", value: `${formatBps(p.vault.liquidationPenaltyBps)} (scale inferred)`, tone: "muted" },
        { label: "Position", value: p.positionId === 0 ? "New position NFT" : `Position #${p.positionId}` },
        { label: "Protocol", value: "Jupiter Lend vaults (Borrow, beta API)" },
      ];
      return { wire, lastValidBlockHeight, intent, rows, expiresAt: intent.expiresAt };
    },
    policy: () => ({ feePayer: p.signer, allowedPrograms: BORROW_PROGRAMS, maxSigners: 1, allowedVersions: [0, "legacy"] }),
    submit: (signed) => (p.demo ? demoResult() : sendAndConfirm(p.network, signed, null)),
    onSettled: p.onSettled,
  };
}

export function wrapSpec(p: { action: "wrap" | "unwrap"; lamports: bigint; network: Network; signer: string; demo: boolean; onSettled(): void }): TxSpec {
  const programs = [PROGRAMS.system, PROGRAMS.token, PROGRAMS.associatedToken];
  return {
    kind: "earnDeposit",
    title: p.action === "wrap" ? "Wrap SOL" : "Unwrap SOL",
    network: p.network,
    signer: p.signer,
    demo: p.demo,
    disclosure: { ...PROFILES.publicSwap, id: "wrap", summary: "Public wallet transaction.", metadataExposure: ["NOCT's server relays the transaction to the RPC and sees its timing"], dependencies: ["Solana RPC"], evidence: [] },
    requestedPrivacy: "public",
    activityDetail: p.action === "wrap" ? `${formatAmount(p.lamports, 9)} SOL` : "All wrapped SOL",
    primaryLabel: p.demo ? "Simulate" : "Sign",
    async build({ operationId }) {
      let wire: Uint8Array = new Uint8Array();
      let lastValidBlockHeight: bigint | null = null;
      if (!p.demo) {
        const bh = await solanaRpc.getLatestBlockhash(p.network);
        lastValidBlockHeight = bh.lastValidBlockHeight;
        wire = p.action === "wrap" ? await buildWrapSolTransaction({ owner: p.signer, lamports: p.lamports, ...bh }) : await buildUnwrapSolTransaction({ owner: p.signer, ...bh });
      }
      return {
        wire,
        lastValidBlockHeight,
        expiresAt: Date.now() + 45_000,
        intent: {
          kind: "earnDeposit",
          operationId,
          network: p.network,
          adapter: "noct-wsol",
          protocolVersion: "1",
          privacyClass: "public",
          requestedPrivacyClass: "public",
          expiresAt: Date.now() + 45_000,
          allowedPrograms: programs,
          signer: p.signer,
          assetMint: "So11111111111111111111111111111111111111112",
          receiptMint: "So11111111111111111111111111111111111111112",
          amount: p.lamports,
          shareBound: p.lamports,
        },
        rows: [
          { label: "Action", value: p.action === "wrap" ? `Wrap ${formatAmount(p.lamports, 9)} SOL into wSOL` : "Close the wSOL account and return all of it as SOL", sensitive: true },
          { label: "Why", value: p.action === "wrap" ? "Jupiter Lend vaults take wrapped SOL as collateral." : "Borrowed or withdrawn SOL arrives wrapped." },
        ],
      };
    },
    policy: () => ({ feePayer: p.signer, allowedPrograms: programs, maxSigners: 1, allowedVersions: [0] }),
    submit: (signed) => (p.demo ? demoResult() : sendAndConfirm(p.network, signed, null)),
    onSettled: p.onSettled,
  };
}
