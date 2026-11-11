"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Icon, Spinner } from "@/components/ui/Icon";
import { CopyButton, Sensitive } from "@/components/ui/primitives";
import { NETWORK } from "@/lib/operations/intent";
import { formatAmount, parseUnits } from "@/lib/decimal";
import { NATIVE_SOL_MINT } from "@/lib/tokens/types";
import { shortAddress } from "@/lib/tokens/sanitize";
import { MAX_WALLETS } from "@/lib/wallets/derive";
import { solanaRpc } from "@/lib/client/rpc";
import { usePrivate, useSettings, useSwapDraft, useWallet } from "@/lib/client/stores";
import { addWallet, closeWallets, removeWallet, useWallets, walletAddress } from "@/lib/client/wallets";
import { buyWithWallets, sellAllWithWallets, sendSolBack, WALLET_RESERVE_LAMPORTS } from "@/lib/client/wallet-trades";
import { sequence } from "@/lib/client/sequence";
import { withdrawalSpec } from "@/lib/client/private-specs";
import styles from "./wallets.module.css";

interface WalletBalance {
  index: number;
  address: string;
  lamports: bigint;
  token: bigint;
}

/**
 * Up to ten NOCT wallets that buy and sell together. They are derived from
 * one signature of the connected wallet, funded from the private balance,
 * and sign their own trades in this tab.
 */
export function WalletsPanel() {
  const { status, shown, error, runs, busy } = useWallets();
  const owner = useWallet((s) => s.address);
  const output = useSwapDraft((s) => s.output);
  const slippage = useSettings((s) => s.slippageBps);
  const privateStatus = usePrivate((s) => s.status);
  const privateSol = usePrivate((s) => s.balances.find((b) => b.mint === NATIVE_SOL_MINT)?.amount ?? 0n);
  const [perWalletText, setPerWalletText] = useState("0.05");

  const wallets = useMemo(() => shown.map((index) => ({ index, address: walletAddress(index) })).filter((w): w is { index: number; address: string } => w.address !== null), [shown]);
  const token = output && output.mint !== NATIVE_SOL_MINT ? output : null;

  const balances = useQuery({
    queryKey: ["noct-wallets", wallets.map((w) => w.address).join(","), token?.mint ?? ""],
    enabled: wallets.length > 0,
    refetchInterval: 20_000,
    queryFn: async ({ signal }): Promise<WalletBalance[]> =>
      Promise.all(
        wallets.map(async (w) => {
          const [lamports, holdings] = await Promise.all([solanaRpc.getLamports(NETWORK, w.address, signal), token ? solanaRpc.getTokenHoldings(NETWORK, w.address, signal) : Promise.resolve([])]);
          return { ...w, lamports, token: holdings.filter((h) => h.mint === token?.mint).reduce((sum, h) => sum + h.amount, 0n) };
        }),
      ),
  });
  const balanceOf = (index: number) => balances.data?.find((b) => b.index === index) ?? null;

  if (status === "closed" && shown.length === 0 && !error) return null;

  const parsed = parseUnits(perWalletText, 9);
  const perWallet = parsed.ok ? parsed.value : null;
  const fundEach = perWallet !== null ? perWallet + WALLET_RESERVE_LAMPORTS : null;
  const fundTotal = fundEach !== null ? fundEach * BigInt(wallets.length) : null;
  const working = busy !== null;
  const indexes = wallets.map((w) => w.index);
  const refresh = () => void balances.refetch();

  const fund = () => {
    if (!owner || fundEach === null) return;
    void sequence.start(
      `Fund ${wallets.length} ${wallets.length === 1 ? "wallet" : "wallets"} from your private balance`,
      wallets.map((w, k) => ({
        label: `fund wallet ${w.index + 1}`,
        spec: () =>
          withdrawalSpec({
            network: NETWORK,
            signer: owner,
            assetMint: NATIVE_SOL_MINT,
            symbol: "SOL",
            decimals: 9,
            amount: fundEach,
            token2022: false,
            recipient: w.address,
            requestedPrivacy: "public",
            title: `Fund wallet ${w.index + 1} (${k + 1} of ${wallets.length})`,
            onSettled: refresh,
          }),
      })),
      wallets.slice(0, -1).map((_, k) => `wallets funded so far keep their SOL; the other ${wallets.length - k - 1} are not funded yet. Fund them any time.`),
    );
  };

  const fundBlocked =
    privateStatus !== "ready"
      ? "Unlock your private balance to fund these wallets."
      : fundTotal === null || perWallet === 0n
        ? "Enter how much SOL each wallet should spend."
        : fundTotal > privateSol
          ? `Your private balance has ${formatAmount(privateSol, 9)} SOL; this needs ${formatAmount(fundTotal, 9)} SOL.`
          : null;

  return (
    <section className={`${styles.panel} glass`} aria-labelledby="wallets-heading">
      <header className={styles.head}>
        <h2 id="wallets-heading" className={styles.title}>
          Wallets <span className={styles.count}>{wallets.length} of {MAX_WALLETS}</span>
        </h2>
        <div className={styles.headTools}>
          <button type="button" className="btn btn-quiet" onClick={() => void addWallet()} disabled={status === "opening" || shown.length >= MAX_WALLETS || working}>
            {status === "opening" ? <Spinner size={14} /> : <Icon name="plus" size={16} />}
            {status === "opening" ? "Waiting for signature" : "Add wallet"}
          </button>
          <button type="button" className="icon-btn" aria-label="Close wallets in this tab" title="Close wallets in this tab" onClick={closeWallets} disabled={working}>
            <Icon name="close" size={16} />
          </button>
        </div>
      </header>

      {error ? (
        <div className="note note-error">
          <Icon name="warning" size={16} />
          <span>{error}</span>
        </div>
      ) : null}

      {wallets.length > 0 ? (
        <>
          <ol className={styles.list}>
            {wallets.map((w) => {
              const b = balanceOf(w.index);
              const run = runs[w.index];
              return (
                <li key={w.index} className={styles.row}>
                  <div className={styles.rowMain}>
                    <span className={styles.name}>Wallet {w.index + 1}</span>
                    <span className={`${styles.address} num`}>{shortAddress(w.address)}</span>
                    <CopyButton value={w.address} label={`Copy wallet ${w.index + 1}'s address`} />
                    <span className={`${styles.amounts} num`}>
                      <span>
                        <Sensitive>{b ? `${formatAmount(b.lamports, 9, { maxFraction: 4 })} SOL` : "…"}</Sensitive>
                      </span>
                      {token && b ? (
                        <span>
                          <Sensitive>{`${formatAmount(b.token, token.decimals, { maxFraction: 4 })} ${token.symbol}`}</Sensitive>
                        </span>
                      ) : null}
                    </span>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`Hide wallet ${w.index + 1}`}
                      title="Hide this wallet. Its funds stay in it; adding a wallet brings it back."
                      onClick={() => removeWallet(w.index)}
                      disabled={working}
                    >
                      <Icon name="minus" size={16} />
                    </button>
                  </div>
                  {run && run.phase !== "idle" ? (
                    <p className={styles.run} data-phase={run.phase}>
                      {run.phase === "working" ? <Spinner size={12} /> : <Icon name={run.phase === "done" ? "check" : "warning"} size={13} />}
                      <span>{run.message}</span>
                      {run.signature ? (
                        <a className="link" href={`https://solscan.io/tx/${run.signature}`} target="_blank" rel="noopener noreferrer">
                          Solscan <Icon name="external" size={12} />
                        </a>
                      ) : null}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ol>

          <label className={styles.field}>
            <span>SOL each wallet spends</span>
            <input className="text-input num" inputMode="decimal" value={perWalletText} onChange={(e) => setPerWalletText(e.target.value.replace(",", "."))} aria-invalid={!parsed.ok} disabled={working} />
          </label>

          <div className={styles.actions}>
            <button type="button" className="btn" onClick={fund} disabled={working || fundBlocked !== null} title={fundBlocked ?? undefined}>
              Fund {wallets.length === 1 ? "it" : `all ${wallets.length}`} from private balance
              {fundTotal !== null && fundBlocked === null ? <span className="num"> ({formatAmount(fundTotal, 9)} SOL)</span> : null}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={working || !token || perWallet === null || perWallet === 0n}
              onClick={() => token && perWallet && void buyWithWallets({ indexes, output: token, perWallet, slippageBps: slippage }).then(refresh)}
            >
              {busy?.startsWith("Buying") ? <Spinner size={16} /> : null}
              {token ? `Buy ${token.symbol} with ${wallets.length === 1 ? "1 wallet" : `${wallets.length} wallets`}` : "Pick a token to buy above"}
            </button>
            <div className={styles.secondary}>
              <button type="button" className="btn btn-quiet" disabled={working || !token} onClick={() => token && void sellAllWithWallets({ indexes, token, slippageBps: slippage }).then(refresh)}>
                {busy?.startsWith("Selling") ? <Spinner size={14} /> : null}
                Sell all {token?.symbol ?? ""}
              </button>
              <button type="button" className="btn btn-quiet" disabled={working || !owner} onClick={() => owner && void sendSolBack({ indexes, to: owner }).then(refresh)}>
                {busy === "Sending SOL back" ? <Spinner size={14} /> : null}
                Send SOL back to your wallet
              </button>
            </div>
          </div>
          {fundBlocked && privateStatus !== "ready" ? <p className={styles.hint}>{fundBlocked}</p> : null}

          <div className="note note-warn">
            <Icon name="warning" size={16} />
            <span>
              Not anonymous yet. Funding from your private balance is a public withdrawal that shows your wallet as the sender, and sending SOL back shows these wallets paying you, so
              they can be linked to you. Each wallet keeps {formatAmount(WALLET_RESERVE_LAMPORTS, 9)} SOL back for fees. These wallets live in this tab: NOCT re-creates them from your
              wallet&apos;s signature and stores nothing.
            </span>
          </div>
        </>
      ) : null}
    </section>
  );
}
