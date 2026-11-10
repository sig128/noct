"use client";

import { useMemo, useState } from "react";
import { formatAmount, formatBps, formatRatioSignificant, parseUnits, ratioDiv, type Ratio } from "@/lib/decimal";
import { useBorrowPositions, useOraclePrices, usePublicBalances, useVaults, publicBalanceOf } from "@/lib/client/hooks";
import { useSettings, useWallet } from "@/lib/client/stores";
import { borrowSpec, healthText, permilleText, symbolOf, toVaultParams, wrapSpec } from "@/lib/client/lend";
import { txFlow } from "@/lib/client/tx-flow";
import { checkOperate, checkVaultOracle, computeMetrics, formatAge, oraclePriceWhole, type VaultParams } from "@/lib/credit/vault-math";
import { NATIVE_CREDIT_STATUS } from "@/lib/credit/native-reference";
import { parseHermesEntry } from "@/lib/oracle/pyth";
import { PROFILES } from "@/lib/privacy/model";
import { NATIVE_SOL_MINT } from "@/lib/tokens/types";
import type { VaultRaw } from "@/lib/client/api";
import { ModulePanel } from "@/components/shell/ModulePanel";
import { EmptyState, Row, Segmented, Sensitive } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/Icon";
import { DisclosurePreview } from "@/components/swap/DisclosurePreview";
import { AmountField, Select } from "./common";
import styles from "./panels.module.css";

const MAX_ORACLE_AGE_MS = 15 * 60_000;

export function BorrowPanel() {
  const [tab, setTab] = useState<"external" | "native">("external");
  const demo = useSettings((s) => s.demoMode);
  return (
    <ModulePanel id="borrow" title="Borrow" lead="Every market is a fixed collateral and debt pair with its own limits. Tradable tokens are not automatically collateral." badge={demo ? <span className="chip chip-warn">Demo markets</span> : null}>
      <div style={{ marginBottom: 16 }}>
        <Segmented
          label="Credit type"
          value={tab}
          onChange={setTab}
          options={[
            { value: "external", label: "Jupiter Lend markets" },
            { value: "native", label: "Confidential credit" },
          ]}
        />
      </div>
      {tab === "external" ? <ExternalBorrow /> : <NativeCreditGate />}
    </ModulePanel>
  );
}

function ExternalBorrow() {
  const demo = useSettings((s) => s.demoMode);
  const network = useSettings((s) => s.network);
  const q = useVaults();
  const raw = q.data?.vaults ?? [];
  const parsed = useMemo(() => raw.map((r) => ({ raw: r, params: toVaultParams(r) })).filter((v): v is { raw: VaultRaw; params: VaultParams } => v.params !== null), [raw]);
  const collaterals = [...new Map(parsed.map((v) => [v.raw.supplyToken.address, symbolOf(v.raw.supplyToken.symbol)])).entries()];
  const [collateral, setCollateral] = useState<string | null>(null);
  const col = collateral ?? collaterals[0]?.[0] ?? null;
  const pairs = parsed.filter((v) => v.raw.supplyToken.address === col);
  const [vaultId, setVaultId] = useState<number | null>(null);
  const chosen = pairs.find((p) => p.params.vaultId === vaultId) ?? pairs[0] ?? null;

  if (!demo && network !== "mainnet") return <EmptyState title="Jupiter Lend runs on mainnet">Switch the network in settings to see markets.</EmptyState>;
  if (q.isLoading) return <p className={styles.meta}>Loading markets…</p>;
  if (q.isError)
    return (
      <div className="note note-error">
        <Icon name="warning" size={16} />
        <span>Markets are unavailable: {(q.error as Error).message}</span>
      </div>
    );
  if (parsed.length === 0) return <EmptyState title="No markets could be read">The market data did not pass NOCT's checks.</EmptyState>;

  return (
    <>
      <section className={styles.section} aria-labelledby="pair-h">
        <h2 id="pair-h" className="vh">
          Choose a market
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <Select
            label="Collateral"
            value={col ?? ""}
            onChange={(v) => {
              setCollateral(v);
              setVaultId(null);
            }}
            options={collaterals.map(([mint, sym]) => ({ value: mint, label: sym }))}
          />
          <Select label="Borrow" value={String(chosen?.params.vaultId ?? "")} onChange={(v) => setVaultId(Number(v))} options={pairs.map((p) => ({ value: String(p.params.vaultId), label: symbolOf(p.raw.borrowToken.symbol) }))} />
        </div>
      </section>
      {chosen ? <VaultDetail key={chosen.params.vaultId} raw={chosen.raw} vault={chosen.params} /> : null}
    </>
  );
}

function VaultDetail({ raw, vault }: { raw: VaultRaw; vault: VaultParams }) {
  const demo = useSettings((s) => s.demoMode);
  const network = useSettings((s) => s.network);
  const address = useWallet((s) => s.address);
  const balances = usePublicBalances();
  const positionsQ = useBorrowPositions();
  const oracle = useOraclePrices([vault.collateralMint, vault.debtMint]);
  const colSym = symbolOf(raw.supplyToken.symbol);
  const debtSym = symbolOf(raw.borrowToken.symbol);
  const positions = (positionsQ.data ?? []).filter((p) => p.vaultId === vault.vaultId && !p.isLiquidated);
  const [positionId, setPositionId] = useState<number>(positions[0]?.id ?? 0);
  const position = positions.find((p) => p.id === positionId) ?? null;
  const currentCol = position ? BigInt(position.supply) : 0n;
  const currentDebt = position ? BigInt(position.dustBorrow ?? position.borrow) : 0n;
  const [mode, setMode] = useState<"open" | "repay" | "add" | "withdraw">(position ? "repay" : "open");
  const [colText, setColText] = useState("");
  const [debtText, setDebtText] = useState("");

  // Independent cross-check from Pyth when configured; never required for risk-reducing actions.
  const independent = useMemo(() => {
    const a = oracle.data?.prices?.[vault.collateralMint];
    const b = oracle.data?.prices?.[vault.debtMint];
    if (!a || !b) return null;
    const pa = parseHermesEntry({ id: a.feedId, price: a.price });
    const pb = parseHermesEntry({ id: b.feedId, price: b.price });
    if (!pa || !pb) return null;
    const ratio = ratioDiv(pa.price, pb.price);
    return ratio ? { price: ratio, confidenceRatio: { num: 0n, den: 1n } as Ratio } : null;
  }, [oracle.data, vault.collateralMint, vault.debtMint]);
  const oracleCheck = checkVaultOracle(vault, { now: Date.now(), maxAgeMs: MAX_ORACLE_AGE_MS, independent, maxDeviationBps: 300n });

  const colParsed = colText ? parseUnits(colText, vault.collateralDecimals) : null;
  const debtParsed = debtText ? parseUnits(debtText, vault.debtDecimals) : null;
  const colAmount = colParsed?.ok ? colParsed.value : 0n;
  const debtAmount = debtParsed?.ok ? debtParsed.value : 0n;
  const repayAll = mode === "repay" && position !== null && debtAmount >= currentDebt && currentDebt > 0n;
  const collateralDelta = mode === "open" || mode === "add" ? colAmount : mode === "withdraw" ? -colAmount : 0n;
  const debtDelta = mode === "open" ? debtAmount : mode === "repay" ? -(repayAll ? currentDebt : debtAmount) : 0n;
  const check = checkOperate(vault, { collateral: currentCol, debt: currentDebt, collateralDelta, debtDelta, oracle: oracleCheck });
  const before = computeMetrics(vault, currentCol, currentDebt);
  const after = check.after ?? before;

  const colMint = vault.collateralMint;
  const wsolHeld = (balances.data?.tokens ?? []).filter((t) => t.mint === NATIVE_SOL_MINT).reduce((a, t) => a + t.amount, 0n);
  const colBalance = colMint === NATIVE_SOL_MINT ? wsolHeld : (publicBalanceOf(balances.data, colMint) ?? 0n);
  const debtBalance = publicBalanceOf(balances.data, vault.debtMint) ?? 0n;
  const needsWrap = !demo && colMint === NATIVE_SOL_MINT && collateralDelta > 0n && wsolHeld < collateralDelta;
  const insufficientCol = !demo && collateralDelta > 0n && colMint !== NATIVE_SOL_MINT && collateralDelta > colBalance;
  const insufficientDebt = !demo && debtDelta < 0n && -debtDelta > debtBalance;
  const nothing = collateralDelta === 0n && debtDelta === 0n;

  const healthTone = (h: Ratio | null) => (!h ? "good" : h.num * 100n < h.den * 110n ? "danger" : h.num * 100n < h.den * 130n ? "warn" : "good");
  let action = "Review";
  let disabled = false;
  if (!address) {
    action = demo ? "Use demo wallet" : "Connect wallet";
  } else if (nothing) {
    action = "Enter an amount";
    disabled = true;
  } else if (!check.ok) {
    action = check.reason;
    disabled = true;
  } else if (needsWrap) {
    action = "Wrap SOL first";
    disabled = true;
  } else if (insufficientCol) {
    action = `Insufficient ${colSym}`;
    disabled = true;
  } else if (insufficientDebt) {
    action = `Insufficient ${debtSym} to repay`;
    disabled = true;
  }

  return (
    <>
      <section className={styles.section} aria-labelledby="vault-h">
        <div className={styles.sectionHead}>
          <h2 id="vault-h" className={styles.h2}>
            {colSym} collateral, {debtSym} debt
          </h2>
          <span className="chip">Vault {vault.vaultId}</span>
        </div>
        <dl className={styles.facts}>
          <Row label="Max loan-to-value">{permilleText(vault.collateralFactorPermille)}</Row>
          <Row label="Liquidation threshold">{permilleText(vault.liquidationThresholdPermille)}</Row>
          <Row label="Full liquidation at">{permilleText(vault.liquidationMaxLimitPermille)}</Row>
          <Row label="Liquidation penalty" tone="muted">
            {formatBps(vault.liquidationPenaltyBps)} (scale inferred, undocumented)
          </Row>
          <Row label="Borrow rate">{formatBps(vault.borrowRateBps)} a year, variable</Row>
          <Row label="Available to borrow">
            {formatAmount(vault.borrowable, vault.debtDecimals)} {debtSym}
          </Row>
          <Row label="Minimum borrow">
            {formatAmount(vault.minimumBorrowing, vault.debtDecimals)} {debtSym}
          </Row>
          <Row label="Oracle price">
            {formatRatioSignificant(oraclePriceWhole(vault), 6)} {debtSym} per {colSym}
          </Row>
          <Row label="Oracle updated" tone={oracleCheck.ok ? "default" : "warn"}>
            {vault.oracleTimestampMs ? `${formatAge(oracleCheck.ageMs)} ago` : "Not reported"} ({raw.oracleSources.map((s) => Object.keys(s.sourceType ?? {})[0] ?? "source").join(", ") || "unknown source"})
          </Row>
          <Row label="Independent check" tone="muted">
            {oracleCheck.deviationBps !== null ? `Pyth differs by ${(Number(oracleCheck.deviationBps) / 100).toFixed(2)}%` : oracle.isError ? "Pyth unavailable on this deployment" : demo ? "Not in demo" : "No mapped Pyth feed"}
          </Row>
        </dl>
        {!oracleCheck.ok ? (
          <div className="note note-warn" style={{ marginTop: 12 }}>
            <Icon name="warning" size={16} />
            <span>{oracleCheck.reason} Borrowing more and withdrawing collateral are blocked until it refreshes; repaying and adding collateral stay available.</span>
          </div>
        ) : null}
      </section>

      <section className={styles.section} aria-labelledby="position-h">
        <div className={styles.sectionHead}>
          <h2 id="position-h" className={styles.h2}>
            Position
          </h2>
          {positions.length > 0 ? (
            <select className={styles.select} aria-label="Position" value={String(positionId)} onChange={(e) => setPositionId(Number(e.target.value))}>
              {positions.map((p) => (
                <option key={p.id} value={String(p.id)}>
                  #{p.id}
                </option>
              ))}
              <option value="0">New position</option>
            </select>
          ) : null}
        </div>
        <dl className={styles.metrics}>
          <Metric label="Collateral" value={<Sensitive>{`${formatAmount(currentCol, vault.collateralDecimals)} ${colSym}`}</Sensitive>} />
          <Metric label="Debt, with interest" value={<Sensitive>{`${formatAmount(currentDebt, vault.debtDecimals)} ${debtSym}`}</Sensitive>} />
          <Metric label="Health" value={healthText(before.health)} tone={healthTone(before.health)} />
          <Metric label="Borrowing capacity" value={<Sensitive>{`${formatAmount(before.maxDebt, vault.debtDecimals)} ${debtSym}`}</Sensitive>} />
        </dl>
        <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
          <Segmented
            label="Action"
            value={mode}
            onChange={(v) => {
              setMode(v);
              setColText("");
              setDebtText("");
            }}
            options={[
              { value: "open", label: position ? "Borrow more" : "Borrow" },
              { value: "repay", label: "Repay", disabled: !position || currentDebt === 0n },
              { value: "add", label: "Add collateral", disabled: !position },
              { value: "withdraw", label: "Withdraw", disabled: !position },
            ]}
          />
          {mode === "open" || mode === "add" || mode === "withdraw" ? (
            <AmountField
              label={mode === "withdraw" ? `Withdraw ${colSym}` : `${colSym} collateral to add`}
              value={colText}
              onChange={setColText}
              decimals={vault.collateralDecimals}
              symbol={colSym}
              max={mode === "withdraw" ? currentCol : colBalance}
              hint={colMint === NATIVE_SOL_MINT && mode !== "withdraw" ? "This vault takes wrapped SOL; NOCT can wrap it for you in a separate transaction." : undefined}
            />
          ) : null}
          {mode === "open" || mode === "repay" ? (
            <AmountField
              label={mode === "repay" ? `Repay ${debtSym}` : `${debtSym} to borrow`}
              value={debtText}
              onChange={setDebtText}
              decimals={vault.debtDecimals}
              symbol={debtSym}
              max={mode === "repay" ? currentDebt : null}
              maxLabel="All"
              hint={repayAll ? "Repays everything, including interest dust, using the protocol's full-repay marker." : undefined}
            />
          ) : null}
          {!nothing ? (
            <dl className={styles.metrics} aria-label="After this change">
              <Metric label="Loan-to-value after" value={after.ltvBps !== null ? formatBps(after.ltvBps) : "—"} tone={after.ltvBps !== null && after.ltvBps * 10n > vault.collateralFactorPermille * 100n ? "danger" : undefined} />
              <Metric label="Health after" value={healthText(after.health)} tone={healthTone(after.health)} />
              <Metric label="Liquidation price" value={after.liquidationPrice ? `${formatRatioSignificant(after.liquidationPrice, 5)} ${debtSym}` : "None"} />
              <Metric label="Price drop to liquidation" value={after.dropToLiquidationBps !== null ? formatBps(after.dropToLiquidationBps) : "—"} tone={after.dropToLiquidationBps !== null && after.dropToLiquidationBps < 1500n ? "warn" : undefined} />
              <Metric label="Interest over a year" value={<Sensitive>{`${formatAmount(after.annualInterest, vault.debtDecimals)} ${debtSym}`}</Sensitive>} />
              <Metric label="Rate basis" value="Current variable rate" />
            </dl>
          ) : null}
          {needsWrap ? (
            <div className="note note-warn">
              <Icon name="info" size={16} />
              <span>
                You hold {formatAmount(wsolHeld, 9)} wrapped SOL; this needs {formatAmount(collateralDelta, 9)}.{" "}
                <button
                  type="button"
                  className="link"
                  style={{ background: "none", border: 0, padding: 0, color: "inherit", font: "inherit" }}
                  onClick={() => void txFlow.start(wrapSpec({ action: "wrap", lamports: collateralDelta - wsolHeld + 10_000n, network, signer: address!, demo, onSettled: () => void balances.refetch() }))}
                >
                  Review wrapping SOL
                </button>
              </span>
            </div>
          ) : null}
          <DisclosurePreview profile={PROFILES.externalBorrow} detail=" Your address, collateral, debt and health are visible on chain to anyone, including liquidators." />
          <button
            type="button"
            className="btn btn-primary btn-block"
            disabled={disabled}
            onClick={() => {
              if (!address) {
                useWallet.getState().set({ pickerOpen: true });
                return;
              }
              void txFlow.start(
                borrowSpec({
                  vault,
                  collateralSymbol: colSym,
                  debtSymbol: debtSym,
                  positionId: position?.id ?? 0,
                  collateral: currentCol,
                  debt: currentDebt,
                  collateralDelta,
                  debtDelta: repayAll ? 0n : debtDelta,
                  repayAll,
                  network,
                  signer: address,
                  demo,
                  available: collateralDelta > 0n ? colBalance : debtBalance,
                  onSettled: () => {
                    void positionsQ.refetch();
                    void balances.refetch();
                  },
                }),
              );
            }}
          >
            {action}
          </button>
        </div>
      </section>
    </>
  );
}

function Metric({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "warn" | "danger" | "good" }) {
  return (
    <div className={styles.metric} data-tone={tone}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function NativeCreditGate() {
  return (
    <div className={styles.gate} role="region" aria-labelledby="native-h">
      <h3 id="native-h">Not available</h3>
      <p className={styles.lead} style={{ margin: 0 }}>
        Confidential loans would keep terms, collateral and debt encrypted while still letting a lender liquidate an unhealthy loan. NOCT has a local reference model of those rules and tests for them, but nothing that can hold funds.
      </p>
      <div>
        <p style={{ margin: "0 0 6px", fontSize: "var(--fs-small)", fontWeight: 560 }}>Missing before any real funds</p>
        <ul>
          {NATIVE_CREDIT_STATUS.missing.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      </div>
      <div>
        <p style={{ margin: "0 0 6px", fontSize: "var(--fs-small)", fontWeight: 560 }}>What the reference model already enforces</p>
        <ul>
          <li>Terms bound by commitment; tampered terms are rejected.</li>
          <li>Debt rounds up for the lender; repayments never over-credit.</li>
          <li>Liquidation works with the borrower offline; the monitor can liquidate or declare default and nothing else.</li>
          <li>Stale or uncertain oracle prices stop borrowing, withdrawals and liquidations.</li>
          <li>Every transition must extend the current state, so replays fail.</li>
        </ul>
      </div>
      <p className={styles.hint}>A lender only sees what the borrower chooses to share. Pricing credit with no risk information is not something a proof can fix, and a valid proof does not remove price gaps, bad debt or oracle risk.</p>
    </div>
  );
}
