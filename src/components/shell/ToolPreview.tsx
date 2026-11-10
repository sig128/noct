"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatAmount, formatBps } from "@/lib/decimal";
import type { ModuleId } from "@/lib/client/modules";
import { useActivity, usePrivate, useSettings, useSwapDraft, useTransferDraft, useWallet } from "@/lib/client/stores";
import { useEarnMarkets, useVaults } from "@/lib/client/hooks";
import { toEarnMarket, symbolOf } from "@/lib/client/lend";
import { checkUnlock, unlockPrivate } from "@/lib/client/session";
import { isLikelySolanaAddress } from "@/lib/tokens/sanitize";
import { formatAge } from "@/lib/credit/vault-math";
import { Sensitive } from "@/components/ui/primitives";
import { useTokenLabel } from "@/components/swap/useTokenLabel";
import styles from "./shell.module.css";

export function ToolPreviewContent({ id, onOpen }: { id: ModuleId; onOpen(): void }) {
  switch (id) {
    case "swap":
      return <SwapPreview onOpen={onOpen} />;
    case "balance":
      return <BalancePreview onOpen={onOpen} />;
    case "send":
      return <SendPreview />;
    case "earn":
      return <EarnPreview onOpen={onOpen} />;
    case "borrow":
      return <BorrowPreview onOpen={onOpen} />;
    case "activity":
      return <ActivityPreview onOpen={onOpen} />;
    case "settings":
      return <SettingsPreview onOpen={onOpen} />;
  }
}

function Open({ onOpen, label = "Open" }: { onOpen(): void; label?: string }) {
  return (
    <button type="button" className="btn" onClick={onOpen}>
      {label}
    </button>
  );
}

function SwapPreview({ onOpen }: { onOpen(): void }) {
  const { input, output, amountText } = useSwapDraft();
  return (
    <>
      <p className={styles.previewTitle}>Swap</p>
      <p className={styles.previewText}>Any Solana token with a Jupiter route, found by name, ticker or mint.</p>
      <div className={styles.previewBody}>
        {input && output ? (
          <p className={styles.previewText}>
            Draft: <span className="num" style={{ color: "var(--text)" }}>{amountText || "0"} {input.symbol}</span> for {output.symbol}
          </p>
        ) : null}
        <div className={styles.previewActions}>
          <Open onOpen={onOpen} label="Go to swap" />
        </div>
      </div>
    </>
  );
}

function BalancePreview({ onOpen }: { onOpen(): void }) {
  const status = usePrivate((s) => s.status);
  const balances = usePrivate((s) => s.balances);
  const address = useWallet((s) => s.address);
  const [reason, setReason] = useState<string | null>(null);
  return (
    <>
      <p className={styles.previewTitle}>Balance</p>
      {status === "ready" ? (
        <ul className={styles.previewList} aria-label="Private balances">
          {balances.length === 0 ? (
            <li>
              <span>No private balance yet</span>
              <span />
            </li>
          ) : (
            balances.slice(0, 4).map((b) => <BalanceLine key={b.mint} mint={b.mint} amount={b.amount} />)
          )}
        </ul>
      ) : (
        <p className={styles.previewText}>{status === "unlocking" || status === "syncing" ? "Unlocking…" : "Your private balance is locked. Unlocking needs one wallet signature."}</p>
      )}
      {reason ? <p className={styles.previewText} style={{ color: "var(--warn)", marginTop: 8 }}>{reason}</p> : null}
      <div className={styles.previewBody}>
        <div className={styles.previewActions}>
          {status !== "ready" ? (
            <button
              type="button"
              className="btn"
              disabled={!address || status === "unlocking" || status === "syncing"}
              title={!address ? "Connect a wallet first" : undefined}
              onClick={async () => {
                const check = await checkUnlock();
                if (!check.ok) setReason(check.reason);
                else void unlockPrivate();
              }}
            >
              {address ? "Unlock" : "Connect first"}
            </button>
          ) : null}
          <Open onOpen={onOpen} />
        </div>
      </div>
    </>
  );
}

function BalanceLine({ mint, amount }: { mint: string; amount: bigint }) {
  const label = useTokenLabel(mint);
  return (
    <li>
      <span>{label.symbol}</span>
      <span className="num">
        <Sensitive>{formatAmount(amount, label.decimals)}</Sensitive>
      </span>
    </li>
  );
}

function SendPreview() {
  const router = useRouter();
  const recipient = useTransferDraft((s) => s.recipient);
  const [value, setValue] = useState(recipient);
  const valid = isLikelySolanaAddress(value.trim());
  return (
    <>
      <p className={styles.previewTitle}>Send and receive</p>
      <form
        className={styles.previewBody}
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          useTransferDraft.getState().set({ recipient: value.trim() });
          router.push("/send");
        }}
      >
        <label className="vh" htmlFor="preview-recipient">
          Recipient address
        </label>
        <input
          id="preview-recipient"
          className="text-input num"
          placeholder="Recipient's Solana address"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={value.length > 0 && !valid}
        />
        <div className={styles.previewActions}>
          <button type="submit" className="btn" disabled={!valid}>
            {valid || value.length === 0 ? "Continue" : "Not a Solana address"}
          </button>
        </div>
      </form>
    </>
  );
}

function EarnPreview({ onOpen }: { onOpen(): void }) {
  const network = useSettings((s) => s.network);
  const demo = useSettings((s) => s.demoMode);
  const q = useEarnMarkets();
  const markets = (q.data?.markets ?? []).map(toEarnMarket).filter((m): m is NonNullable<typeof m> => Boolean(m));
  const top = [...markets].sort((a, b) => Number(b.totalRateBps - a.totalRateBps)).slice(0, 3);
  return (
    <>
      <p className={styles.previewTitle}>Earn</p>
      {!demo && network !== "mainnet" ? (
        <p className={styles.previewText}>Jupiter Lend markets exist on mainnet only.</p>
      ) : q.isLoading ? (
        <p className={styles.previewText}>Loading markets…</p>
      ) : q.isError ? (
        <p className={styles.previewText}>Markets are unavailable right now.</p>
      ) : (
        <ul className={styles.previewList}>
          {top.map((m) => (
            <li key={m.id}>
              <span>{m.assetSymbol}</span>
              <span className="num">{formatBps(m.totalRateBps)}</span>
            </li>
          ))}
        </ul>
      )}
      <p className={styles.previewText} style={{ marginTop: 8 }}>
        Variable rates{top[0]?.updatedAtMs ? `, as of ${formatAge(Date.now() - top[0].updatedAtMs)} ago` : ""}. Positions are public.
      </p>
      <div className={styles.previewBody}>
        <div className={styles.previewActions}>
          <Open onOpen={onOpen} label="See markets" />
        </div>
      </div>
    </>
  );
}

function BorrowPreview({ onOpen }: { onOpen(): void }) {
  const q = useVaults();
  const vaults = q.data?.vaults ?? [];
  const pairs = vaults.slice(0, 4).map((v) => `${symbolOf(v.supplyToken.symbol)} / ${symbolOf(v.borrowToken.symbol)}`);
  return (
    <>
      <p className={styles.previewTitle}>Borrow</p>
      <p className={styles.previewText}>Collateral and debt pairs from Jupiter Lend vaults, as public positions.</p>
      {q.isLoading ? null : pairs.length > 0 ? (
        <ul className={styles.previewList} style={{ marginTop: 8 }}>
          {pairs.map((p) => (
            <li key={p}>
              <span>{p}</span>
              <span>Public</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.previewText} style={{ marginTop: 8 }}>
          {q.isError ? "Markets are unavailable right now." : "No markets on this network."}
        </p>
      )}
      <p className={styles.previewText} style={{ marginTop: 8 }}>
        Confidential credit: not available.
      </p>
      <div className={styles.previewBody}>
        <div className={styles.previewActions}>
          <Open onOpen={onOpen} />
        </div>
      </div>
    </>
  );
}

function ActivityPreview({ onOpen }: { onOpen(): void }) {
  const items = useActivity((s) => s.items).slice(0, 3);
  return (
    <>
      <p className={styles.previewTitle}>Activity</p>
      {items.length === 0 ? (
        <p className={styles.previewText}>Nothing in this session yet.</p>
      ) : (
        <ul className={styles.previewList}>
          {items.map((i) => (
            <li key={i.operationId}>
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{i.title}</span>
              <span>{i.phase === "completed" ? "Done" : i.phase === "pendingRecovery" ? "Checking" : i.phase === "retryableFailure" ? "Failed" : i.phase === "cancelled" ? "Cancelled" : "Open"}</span>
            </li>
          ))}
        </ul>
      )}
      <div className={styles.previewBody}>
        <div className={styles.previewActions}>
          <Open onOpen={onOpen} />
        </div>
      </div>
    </>
  );
}

function SettingsPreview({ onOpen }: { onOpen(): void }) {
  const mask = useSettings((s) => s.maskBalances);
  const status = usePrivate((s) => s.status);
  return (
    <>
      <p className={styles.previewTitle}>Settings and security</p>
      <div className={styles.previewBody}>
        <div className={styles.previewActions}>
          <button type="button" className="btn" onClick={() => useSettings.getState().setMaskBalances(!mask)}>
            {mask ? "Show amounts" : "Hide amounts"}
          </button>
          <button type="button" className="btn" disabled={status === "locked"} onClick={() => usePrivate.getState().lock("Locked.")}>
            Lock now
          </button>
        </div>
        <div className={styles.previewActions}>
          <Open onOpen={onOpen} label="All settings" />
        </div>
      </div>
    </>
  );
}
