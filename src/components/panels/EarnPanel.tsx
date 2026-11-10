"use client";

import { useEffect, useMemo, useState } from "react";
import { formatAmount, formatBps, parseUnits, minBig } from "@/lib/decimal";
import { useEarnMarkets, useEarnPositions, usePublicBalances, publicBalanceOf } from "@/lib/client/hooks";
import { NETWORK } from "@/lib/operations/intent";
import { useHandoff, useWallet } from "@/lib/client/stores";
import { earnSpec, previewShares, sharesToAssets, toEarnMarket, type EarnMarket } from "@/lib/client/lend";
import { txFlow } from "@/lib/client/tx-flow";
import { formatAge } from "@/lib/credit/vault-math";
import { maxSpendable } from "@/lib/swap/max";
import { PROFILES, UNAVAILABLE } from "@/lib/privacy/model";
import { NATIVE_SOL_MINT } from "@/lib/tokens/types";
import { ModulePanel } from "@/components/shell/ModulePanel";
import { Row, Segmented, Sensitive } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/Icon";
import { DisclosurePreview } from "@/components/swap/DisclosurePreview";
import { AmountField, AssetCell } from "./common";
import styles from "./panels.module.css";

export function EarnPanel() {
  const q = useEarnMarkets();
  const positions = useEarnPositions();
  const handoff = useHandoff();
  const markets = useMemo(() => (q.data?.markets ?? []).map(toEarnMarket).filter((m): m is EarnMarket => Boolean(m)).sort((a, b) => Number(b.totalAssets > a.totalAssets) - Number(b.totalAssets < a.totalAssets)), [q.data]);
  const [selected, setSelected] = useState<number | null>(null);
  const [fromSwap, setFromSwap] = useState(false);

  useEffect(() => {
    if (handoff.earnAsset && markets.length > 0) {
      const m = markets.find((x) => x.assetMint === handoff.earnAsset);
      if (m) {
        setSelected(m.id);
        setFromSwap(true);
      }
      handoff.set({ earnAsset: null });
    }
  }, [handoff, markets]);

  const market = markets.find((m) => m.id === selected) ?? null;

  return (
    <ModulePanel
      id="earn"
      title="Earn"
      lead="Supply to Jupiter Lend. Positions are public and held by your wallet as receipt tokens; rates are variable."
    >
      {q.isLoading ? (
        <p className={styles.meta}>Loading markets…</p>
      ) : q.isError ? (
        <div className="note note-error">
          <Icon name="warning" size={16} />
          <span>Markets are unavailable: {(q.error as Error).message}</span>
        </div>
      ) : (
        <>
          <section className={styles.section} aria-labelledby="earn-markets">
            <div className={styles.sectionHead}>
              <h2 id="earn-markets" className={styles.h2}>
                Markets
              </h2>
              <span className={styles.meta}>{q.data ? `Fetched ${formatAge(Date.now() - q.data.fetchedAt)} ago` : ""}</span>
            </div>
            <div role="list" style={{ display: "grid", gap: 2 }}>
              {markets.map((m) => (
                <div role="listitem" key={m.id}>
                  <button type="button" className={styles.market} aria-pressed={selected === m.id} onClick={() => setSelected(selected === m.id ? null : m.id)}>
                    <AssetCell mint={m.assetMint} sub={`Receipt ${m.receiptSymbol}`} fallbackSymbol={m.assetSymbol} />
                    <span className={styles.marketRate}>
                      <strong>{formatBps(m.totalRateBps)}</strong>
                      <span>{m.updatedAtMs ? `as of ${formatAge(Date.now() - m.updatedAtMs)} ago` : "time not reported"}</span>
                    </span>
                  </button>
                </div>
              ))}
            </div>
          </section>
          {market ? <MarketDetail market={market} fromSwap={fromSwap} positions={positions.data ?? []} /> : <p className={styles.meta}>Choose a market to see its terms.</p>}
          <section className={styles.section}>
            <div className="note">
              <Icon name="info" size={16} />
              <span>{UNAVAILABLE.privateEarn}</span>
            </div>
          </section>
        </>
      )}
    </ModulePanel>
  );
}

function MarketDetail({ market, fromSwap, positions }: { market: EarnMarket; fromSwap: boolean; positions: { receiptMint: string; shares: bigint }[] }) {
  const address = useWallet((s) => s.address);
  const balances = usePublicBalances();
  const [mode, setMode] = useState<"deposit" | "withdraw">("deposit");
  const [text, setText] = useState("");
  const position = positions.find((p) => p.receiptMint === market.receiptMint);
  const underlying = position ? sharesToAssets(market, position.shares) : 0n;
  const bal = address ? (publicBalanceOf(balances.data, market.assetMint) ?? 0n) : 0n;
  const depositMax = market.assetMint === NATIVE_SOL_MINT ? maxSpendable({ balance: bal, isNativeSol: true, networkFeeLamports: 10_000n, rentLamports: 2_039_280n }).amount : bal;
  const withdrawMax = market.withdrawable !== null ? minBig(underlying, market.withdrawable) : underlying;
  const parsed = text ? parseUnits(text, market.decimals) : null;
  const amount = parsed?.ok ? parsed.value : null;
  const limit = mode === "deposit" ? depositMax : withdrawMax;
  const over = amount !== null && amount > limit;
  const liquidityLimited = mode === "withdraw" && market.withdrawable !== null && underlying > market.withdrawable;

  return (
    <section className={styles.section} aria-labelledby="earn-detail">
      <div className={styles.sectionHead}>
        <h2 id="earn-detail" className={styles.h2}>
          {market.assetSymbol} market
        </h2>
        <span className="chip">Public position</span>
      </div>
      {fromSwap ? (
        <div className="note note-accent" style={{ marginBottom: 12 }}>
          <Icon name="info" size={16} />
          <span>Selected after your swap. Nothing is supplied until you review and sign.</span>
        </div>
      ) : null}
      <dl className={styles.facts}>
        <Row label="Total rate">{formatBps(market.totalRateBps)} a year, variable</Row>
        <Row label="Made of">
          {formatBps(market.supplyRateBps)} lending + {formatBps(market.rewardsRateBps)} rewards
        </Row>
        <Row label="Yield source">Interest paid by Jupiter Lend borrowers, plus protocol rewards</Row>
        <Row label="Receipt token">{market.receiptSymbol}</Row>
        <Row label="Withdrawable now" tone="muted">
          {market.withdrawable !== null ? `${formatAmount(market.withdrawable, market.decimals)} ${market.assetSymbol} across the market` : "Not reported"}
        </Row>
        <Row label="Data as of" tone="muted">
          {market.updatedAtMs ? `${formatAge(Date.now() - market.updatedAtMs)} ago` : "Not reported"}
        </Row>
        <Row label="Fees">No deposit or withdrawal fee is reported by the API; network fees apply</Row>
        <Row label="Depends on">Jupiter Lend liquidity layer and programs (upgradeable)</Row>
        {position ? (
          <Row label="Your position" tone="accent">
            <Sensitive>
              {formatAmount(underlying, market.decimals)} {market.assetSymbol}
            </Sensitive>
          </Row>
        ) : null}
      </dl>
      <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
        {!address ? (
          <button type="button" className="btn" onClick={() => useWallet.getState().set({ pickerOpen: true })}>
            Connect wallet to supply
          </button>
        ) : (
          <>
            <Segmented
              label="Action"
              value={mode}
              onChange={(v) => {
                setMode(v);
                setText("");
              }}
              options={[
                { value: "deposit", label: "Supply" },
                { value: "withdraw", label: "Withdraw", disabled: !position },
              ]}
            />
            <AmountField
              label={mode === "deposit" ? `Supply from your wallet` : "Withdraw"}
              value={text}
              onChange={setText}
              decimals={market.decimals}
              symbol={market.assetSymbol}
              max={limit}
              invalid={over}
              hint={
                mode === "deposit"
                  ? amount
                    ? `About ${formatAmount(previewShares(market, amount), market.decimals)} ${market.receiptSymbol}; the program sets the exact amount.`
                    : undefined
                  : liquidityLimited
                    ? "Only part of your position can leave right now; the market's withdrawal limit expands over time."
                    : undefined
              }
            />
            <DisclosurePreview profile={PROFILES.earnSupply} detail=" Your address, the asset and the amount are visible on chain." />
            <button
              type="button"
              className="btn btn-primary btn-block"
              disabled={!amount || over}
              onClick={() =>
                amount &&
                void txFlow.start(
                  earnSpec({
                    action: mode,
                    market,
                    amount,
                    available: depositMax,
                    network: NETWORK,
                    signer: address,
                    onSettled: () => void balances.refetch(),
                  }),
                )
              }
            >
              {!amount ? "Enter an amount" : over ? (mode === "deposit" ? `Insufficient ${market.assetSymbol}` : "More than can be withdrawn now") : mode === "deposit" ? "Review supply" : "Review withdrawal"}
            </button>
          </>
        )}
      </div>
    </section>
  );
}
