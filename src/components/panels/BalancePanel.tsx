"use client";

import { useMemo, useState } from "react";
import { formatAmount, formatUsd, parseDecimalRatio, parseUnits, valueOf, type Ratio } from "@/lib/decimal";
import { buildLedger, BUCKET_LABELS, type Bucket } from "@/lib/balances/ledger";
import { useBorrowPositions, useEarnMarkets, useEarnPositions, usePrices, usePublicBalances, useTokensByMint, useVaults, publicBalanceOf } from "@/lib/client/hooks";
import { NETWORK } from "@/lib/operations/intent";
import { reservations, usePrivate, useWallet } from "@/lib/client/stores";
import { checkUnlock, resyncPrivate, unlockPrivate } from "@/lib/client/session";
import { sharesToAssets, toEarnMarket, wrapSpec } from "@/lib/client/lend";
import { shieldSpec, withdrawalSpec, registrationSpec } from "@/lib/client/private-specs";
import { txFlow } from "@/lib/client/tx-flow";
import { maxSpendable } from "@/lib/swap/max";
import { NATIVE_SOL_MINT } from "@/lib/tokens/types";
import { isLikelySolanaAddress } from "@/lib/tokens/sanitize";
import { formatAge } from "@/lib/credit/vault-math";
import { ModulePanel } from "@/components/shell/ModulePanel";
import { EmptyState, Segmented, Sensitive } from "@/components/ui/primitives";
import { Icon, Spinner } from "@/components/ui/Icon";
import { AmountField, AssetCell, Select, TokenAmount } from "./common";
import { useTokenLabel } from "@/components/swap/useTokenLabel";
import styles from "./panels.module.css";

const WSOL_ACCOUNT_MARK = "wsol";

export function BalancePanel() {
  const address = useWallet((s) => s.address);
  const priv = usePrivate();
  const balances = usePublicBalances();
  const earnPositions = useEarnPositions();
  const earnMarkets = useEarnMarkets();
  const borrowPositions = useBorrowPositions();
  const vaults = useVaults();

  const markets = useMemo(() => (earnMarkets.data?.markets ?? []).map(toEarnMarket).filter((m): m is NonNullable<typeof m> => Boolean(m)), [earnMarkets.data]);

  const ledger = useMemo(() => {
    const publicTokens = [
      ...(balances.data ? [{ mint: NATIVE_SOL_MINT, amount: balances.data.lamports }] : []),
      ...(balances.data?.tokens ?? []).map((t) => ({ mint: t.mint === NATIVE_SOL_MINT ? `${NATIVE_SOL_MINT}:${WSOL_ACCOUNT_MARK}` : t.mint, amount: t.amount })),
    ];
    const earn = (earnPositions.data ?? []).map((p) => {
      const m = markets.find((x) => x.receiptMint === p.receiptMint);
      return { receiptMint: p.receiptMint, assetMint: m?.assetMint ?? p.assetMint, underlying: m ? sharesToAssets(m, p.shares) : 0n, market: "Jupiter Lend Earn" };
    });
    const borrow = (borrowPositions.data ?? []).map((p) => {
      const v = (vaults.data?.vaults ?? []).find((x) => x.id === p.vaultId);
      return {
        collateralMint: v?.supplyToken.address ?? "",
        collateral: BigInt(p.supply),
        debtMint: v?.borrowToken.address ?? "",
        debt: BigInt(p.dustBorrow ?? p.borrow),
        market: `Jupiter Lend vault ${p.vaultId}`,
      };
    });
    return buildLedger({
      publicTokens,
      privateBalances: priv.status === "ready" ? priv.balances : [],
      pendingOutbound: [],
      reservations: reservations.list(),
      earnPositions: earn,
      borrowPositions: borrow.filter((b) => b.collateralMint),
    });
  }, [balances.data, earnPositions.data, markets, borrowPositions.data, vaults.data, priv.status, priv.balances]);

  const allMints = [...new Set(ledger.lines.map((l) => l.mint.split(":")[0]!))];
  const prices = usePrices(allMints);
  useTokensByMint(allMints.slice(0, 50));

  return (
    <ModulePanel
      id="balance"
      title="Balance"
      lead="One account across every tool. Each amount appears in exactly one place, so supplied and collateral funds are not counted twice."
    >
      {!address ? (
        <EmptyState
          title="Connect a wallet to see balances"
          action={
            <button type="button" className="btn" onClick={() => useWallet.getState().set({ pickerOpen: true })}>
              Connect wallet
            </button>
          }
        >
          Public balances are read from the chain. A private balance needs one extra wallet signature to unlock.
        </EmptyState>
      ) : (
        <>
          <section className={styles.section} aria-labelledby="totals">
            <div className={styles.sectionHead}>
              <h2 id="totals" className={styles.h2}>
                Totals
              </h2>
              <span className={styles.meta}>USD only where a reliable price exists</span>
            </div>
            <BucketTotals ledger={ledger} prices={prices.data ?? {}} />
          </section>
          <PrivateSection />
          <section className={styles.section} aria-labelledby="public-h">
            <div className={styles.sectionHead}>
              <h2 id="public-h" className={styles.h2}>
                Public wallet
              </h2>
              <span className={styles.meta}>{balances.isFetching ? "Updating…" : balances.data ? `Read ${formatAge(Date.now() - balances.data.fetchedAt)} ago` : ""}</span>
            </div>
            {balances.isError ? (
              <div className="note note-error">
                <Icon name="warning" size={16} />
                <span>Balances could not be read: {(balances.error as Error).message}</span>
              </div>
            ) : balances.isLoading ? (
              <p className={styles.meta}>Reading balances…</p>
            ) : (
              <HoldingsTable lines={ledger.byBucket("publicAvailable")} prices={prices.data ?? {}} />
            )}
            {(balances.data?.tokens ?? []).some((t) => t.mint === NATIVE_SOL_MINT && t.amount > 0n) ? (
              <div style={{ marginTop: 10 }}>
                <button
                  type="button"
                  className="btn"
                  onClick={() => void txFlow.start(wrapSpec({ action: "unwrap", lamports: 0n, network: NETWORK, signer: address, onSettled: () => void balances.refetch() }))}
                >
                  Unwrap wSOL to SOL
                </button>
              </div>
            ) : null}
          </section>
          {ledger.byBucket("supplied").length + ledger.byBucket("collateral").length + ledger.byBucket("debt").length > 0 ? (
            <section className={styles.section} aria-labelledby="markets-h">
              <div className={styles.sectionHead}>
                <h2 id="markets-h" className={styles.h2}>
                  In markets
                </h2>
                <span className={styles.meta}>Public positions</span>
              </div>
              <HoldingsTable lines={[...ledger.byBucket("supplied"), ...ledger.byBucket("collateral"), ...ledger.byBucket("debt")]} prices={prices.data ?? {}} showBucket />
            </section>
          ) : null}
        </>
      )}
    </ModulePanel>
  );
}

function priceRatio(prices: Record<string, { usdPrice: string }>, mint: string): Ratio | null {
  const p = prices[mint.split(":")[0]!]?.usdPrice;
  return p ? parseDecimalRatio(p) : null;
}

function BucketTotals({ ledger, prices }: { ledger: ReturnType<typeof buildLedger>; prices: Record<string, { usdPrice: string }> }) {
  const decimalsQ = useTokensByMint([...new Set(ledger.lines.map((l) => l.mint.split(":")[0]!))].slice(0, 50));
  const dec = (mint: string) => (mint.startsWith(NATIVE_SOL_MINT) ? 9 : (decimalsQ.data?.find((t) => t.mint === mint)?.decimals ?? null));
  // Spendable funds first, committed funds second; transient buckets only when they hold something.
  const buckets: { bucket: Bucket; label: string; kind?: string; primary?: boolean }[] = [
    { bucket: "publicAvailable", label: "Public wallet", primary: true },
    { bucket: "privateSpendable", label: "Private, spendable", kind: "private", primary: true },
    { bucket: "supplied", label: "Supplied" },
    { bucket: "collateral", label: "Collateral" },
    { bucket: "debt", label: "Debt", kind: "debt" },
    ...(ledger.byBucket("pendingSettlement").length > 0 ? [{ bucket: "pendingSettlement" as const, label: "Pending settlement", kind: "pending" }] : []),
    ...(ledger.byBucket("reserved").length > 0 ? [{ bucket: "reserved" as const, label: "Reserved", kind: "pending" }] : []),
  ];
  return (
    <dl className={styles.buckets}>
      {buckets.map(({ bucket, label, kind, primary }) => {
        const lines = ledger.byBucket(bucket);
        let total: Ratio = { num: 0n, den: 1n };
        let unpriced = 0;
        for (const l of lines) {
          const p = priceRatio(prices, l.mint);
          const d = dec(l.mint.split(":")[0]!);
          if (!p || d === null) {
            unpriced += 1;
            continue;
          }
          const v = valueOf(l.amount, d, p);
          total = { num: total.num * v.den + v.num * total.den, den: total.den * v.den };
        }
        return (
          <div key={bucket} className={styles.bucket} data-kind={kind} data-primary={primary ? "true" : undefined} title={BUCKET_LABELS[bucket]}>
            <dt>{label}</dt>
            <dd>
              <Sensitive>{lines.length === 0 ? "—" : `${bucket === "debt" ? "−" : ""}${formatUsd(total)}`}</Sensitive>
            </dd>
            {unpriced > 0 ? <dd style={{ fontSize: "var(--fs-micro)", color: "var(--text-3)", fontWeight: 400 }}>+{unpriced} unpriced</dd> : null}
          </div>
        );
      })}
    </dl>
  );
}

function HoldingsTable({ lines, prices, showBucket }: { lines: ReturnType<ReturnType<typeof buildLedger>["byBucket"]>; prices: Record<string, { usdPrice: string }>; showBucket?: boolean }) {
  if (lines.length === 0) return <p className={styles.meta}>Nothing here.</p>;
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th scope="col">Asset</th>
          <th scope="col">Amount</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l) => (
          <HoldingRow key={`${l.bucket}-${l.mint}-${l.source}`} mint={l.mint} amount={l.amount} sub={showBucket ? `${BUCKET_LABELS[l.bucket]}, ${l.source}` : l.mint.endsWith(`:${WSOL_ACCOUNT_MARK}`) ? "Wrapped SOL (token account)" : undefined} prices={prices} debt={l.bucket === "debt"} />
        ))}
      </tbody>
    </table>
  );
}

function HoldingRow({ mint, amount, sub, prices, debt }: { mint: string; amount: bigint; sub?: string; prices: Record<string, { usdPrice: string }>; debt?: boolean }) {
  const base = mint.split(":")[0]!;
  const label = useTokenLabel(base);
  const p = priceRatio(prices, base);
  return (
    <tr>
      <td>
        <AssetCell mint={base} sub={sub} />
      </td>
      <td className={styles.amountCell}>
        <Sensitive>
          {debt ? "−" : ""}
          {formatAmount(amount, label.decimals)} {label.symbol}
        </Sensitive>
        <small>
          <Sensitive>{p ? formatUsd(valueOf(amount, label.decimals, p)) : "No reliable price"}</Sensitive>
        </small>
      </td>
    </tr>
  );
}

function PrivateSection() {
  const priv = usePrivate();
  const address = useWallet((s) => s.address)!;
  const balances = usePublicBalances();
  const [mode, setMode] = useState<"deposit" | "withdraw">("deposit");
  const [reason, setReason] = useState<string | null>(null);
  const [understood, setUnderstood] = useState(false);

  if (priv.status !== "ready") {
    const busy = priv.status === "unlocking" || priv.status === "syncing";
    return (
      <section className={styles.section} aria-labelledby="private-h">
        <div className={styles.sectionHead}>
          <h2 id="private-h" className={styles.h2}>
            Private balance
          </h2>
          <span className="chip chip-private">
            <Icon name="lock" size={12} /> Locked
          </span>
        </div>
        <p className={styles.lead}>
          Held in Solana Privacy Rings' Default Ring. Transfers hide the token and amount; addresses stay visible. Deposits and withdrawals are public.
        </p>
        <div className="note note-private" style={{ marginBottom: 12 }}>
          <Icon name="shield" size={16} />
          <span>
            Before you unlock: your wallet signs one fixed message, and your private keys are derived from that signature in this tab only. NOCT never stores or sends them.
            To recover on another device, connect the same wallet and unlock again; the balance is rebuilt from the chain. Never sign this message on another site: whoever has the signature can see your private balance.
          </span>
        </div>
        <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: "var(--fs-small)", color: "var(--text-2)", marginBottom: 12 }}>
          <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} style={{ marginTop: 3, accentColor: "var(--private)" }} />
          <span>I understand how recovery works and that the derived keys stay in this tab.</span>
        </label>
        {priv.error || reason ? (
          <div className="note note-warn" role="alert" style={{ marginBottom: 12 }}>
            <Icon name="warning" size={16} />
            <span>{reason ?? priv.error}</span>
          </div>
        ) : null}
        <button
          type="button"
          className="btn"
          disabled={!understood || busy}
          onClick={async () => {
            setReason(null);
            const check = await checkUnlock();
            if (!check.ok) setReason(check.reason);
            else await unlockPrivate();
          }}
        >
          {busy ? <Spinner size={15} /> : <Icon name="unlock" size={16} />}
          {priv.status === "unlocking" ? "Waiting for signature…" : priv.status === "syncing" ? "Reading your notes…" : "Unlock private balance"}
        </button>
      </section>
    );
  }

  const publicMints = [NATIVE_SOL_MINT, ...(balances.data?.tokens ?? []).filter((t) => t.amount > 0n && t.mint !== NATIVE_SOL_MINT).map((t) => t.mint)];
  return (
    <section className={styles.section} aria-labelledby="private-h">
      <div className={styles.sectionHead}>
        <h2 id="private-h" className={styles.h2}>
          Private balance
        </h2>
        <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
          <span className={styles.meta}>{priv.lastSyncedAt ? `Synced ${formatAge(Date.now() - priv.lastSyncedAt)} ago` : ""}</span>
          <button type="button" className="icon-btn" aria-label="Sync private balance" onClick={() => void resyncPrivate()}>
            <Icon name="refresh" size={16} />
          </button>
          <button type="button" className="icon-btn" aria-label="Lock private balance" onClick={() => priv.lock("Locked.")}>
            <Icon name="lock" size={16} />
          </button>
        </span>
      </div>
      {priv.balances.length === 0 ? (
        <p className={styles.meta}>No private balance yet. Deposit from your public wallet below.</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Asset</th>
              <th scope="col">Spendable</th>
            </tr>
          </thead>
          <tbody>
            {priv.balances.map((b) => (
              <tr key={b.mint}>
                <td>
                  <AssetCell mint={b.mint} sub={`${b.notes} note${b.notes === 1 ? "" : "s"}`} />
                </td>
                <td className={styles.amountCell} style={{ color: "var(--private)" }}>
                  <TokenAmount mint={b.mint} amount={b.amount} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {priv.registered === false ? (
        <div className="note" style={{ marginTop: 12 }}>
          <Icon name="info" size={16} />
          <span>
            Not registered: others cannot send to you privately yet.{" "}
            <button type="button" className="link" style={{ background: "none", border: 0, padding: 0, color: "inherit", font: "inherit" }} onClick={() => void txFlow.start(registrationSpec({ network: NETWORK, signer: address }))}>
              Review registration
            </button>
          </span>
        </div>
      ) : null}
      <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
        <Segmented
          label="Move funds"
          value={mode}
          onChange={setMode}
          options={[
            { value: "deposit", label: "Deposit from wallet" },
            { value: "withdraw", label: "Withdraw to address" },
          ]}
        />
        {mode === "deposit" ? <DepositForm mints={publicMints} /> : <WithdrawForm />}
      </div>
    </section>
  );
}

function DepositForm({ mints }: { mints: string[] }) {
  const address = useWallet((s) => s.address)!;
  const balances = usePublicBalances();
  const [mint, setMint] = useState(mints[0] ?? NATIVE_SOL_MINT);
  const [text, setText] = useState("");
  const label = useTokenLabel(mint);
  const tokens = useTokensByMint(mints);
  const bal = publicBalanceOf(balances.data, mint) ?? 0n;
  const max = mint === NATIVE_SOL_MINT ? maxSpendable({ balance: bal, isNativeSol: true, networkFeeLamports: 10_000n, rentLamports: 2_039_280n }).amount : bal;
  const parsed = text ? parseUnits(text, label.decimals) : null;
  const amount = parsed?.ok ? parsed.value : null;
  const holding = balances.data?.tokens.find((t) => t.mint === mint);
  const over = amount !== null && amount > max;
  return (
    <form
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault();
        if (!amount || over) return;
        void txFlow.start(
          shieldSpec({
            network: NETWORK,
            signer: address,
            assetMint: mint,
            symbol: label.symbol,
            decimals: label.decimals,
            amount,
            token2022: holding?.program === "token2022",
            ...(holding && mint !== NATIVE_SOL_MINT ? { tokenAccount: holding.account } : {}),
            available: max,
            onSettled: () => void balances.refetch(),
          }),
        );
      }}
    >
      <Select
        label="Token"
        value={mint}
        onChange={(v) => {
          setMint(v);
          setText("");
        }}
        options={mints.map((m) => ({ value: m, label: m === NATIVE_SOL_MINT ? "SOL" : (tokens.data?.find((t) => t.mint === m)?.symbol ?? `${m.slice(0, 4)}…${m.slice(-4)}`) }))}
      />
      <AmountField label="Amount" value={text} onChange={setText} decimals={label.decimals} symbol={label.symbol} max={max} invalid={over} hint={over ? "More than you can deposit." : "The deposit is public: your address, the token and the amount are visible."} />
      <button type="submit" className="btn btn-primary" disabled={!amount || over}>
        {!amount ? "Enter an amount" : over ? "Insufficient balance" : `Review deposit`}
      </button>
    </form>
  );
}

function WithdrawForm() {
  const priv = usePrivate();
  const address = useWallet((s) => s.address)!;
  const [mint, setMint] = useState(priv.balances[0]?.mint ?? NATIVE_SOL_MINT);
  const [text, setText] = useState("");
  const [recipient, setRecipient] = useState(address);
  const label = useTokenLabel(mint);
  const tokens = useTokensByMint(priv.balances.map((b) => b.mint));
  const bal = priv.balances.find((b) => b.mint === mint)?.amount ?? 0n;
  const parsed = text ? parseUnits(text, label.decimals) : null;
  const amount = parsed?.ok ? parsed.value : null;
  const validRecipient = isLikelySolanaAddress(recipient.trim());
  if (priv.balances.length === 0) return <p className={styles.meta}>Nothing to withdraw.</p>;
  return (
    <form
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault();
        if (!amount || amount > bal || !validRecipient) return;
        void txFlow.start(
          withdrawalSpec({ network: NETWORK, signer: address, assetMint: mint, symbol: label.symbol, decimals: label.decimals, amount, token2022: label.token?.tokenProgram === "token2022", recipient: recipient.trim(), requestedPrivacy: "public" }),
        );
      }}
    >
      <Select label="Token" value={mint} onChange={setMint} options={priv.balances.map((b) => ({ value: b.mint, label: tokens.data?.find((t) => t.mint === b.mint)?.symbol ?? (b.mint === NATIVE_SOL_MINT ? "SOL" : b.mint.slice(0, 6)) }))} />
      <AmountField label="Amount" value={text} onChange={setText} decimals={label.decimals} symbol={label.symbol} max={bal} invalid={amount !== null && amount > bal} />
      <div>
        <label className={styles.fieldLabel} htmlFor="wd-recipient">
          To public address
        </label>
        <input id="wd-recipient" className="text-input num" value={recipient} onChange={(e) => setRecipient(e.target.value)} autoComplete="off" spellCheck={false} aria-invalid={!validRecipient} />
      </div>
      <div className="note note-warn">
        <Icon name="warning" size={16} />
        <span>Public withdrawal: the token, amount and recipient become visible on chain.</span>
      </div>
      <button type="submit" className="btn btn-primary" disabled={!amount || amount > bal || !validRecipient}>
        {!amount ? "Enter an amount" : amount > bal ? "More than your private balance" : !validRecipient ? "Enter a valid address" : "Review withdrawal"}
      </button>
    </form>
  );
}
