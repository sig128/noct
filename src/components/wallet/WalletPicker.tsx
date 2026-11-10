"use client";

import { useEffect, useState } from "react";
import { useSettings, useWallet } from "@/lib/client/stores";
import { connect } from "@/lib/client/session";
import { listSolanaWallets, onWalletsChanged, type WalletOption } from "@/lib/wallet/standard";
import { DEMO_WALLET } from "@/lib/adapters/demo";
import { Dialog } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/Icon";
import styles from "./wallet.module.css";

export function WalletPicker() {
  const open = useWallet((s) => s.pickerOpen);
  const error = useWallet((s) => s.error);
  const status = useWallet((s) => s.status);
  const demo = useSettings((s) => s.demoMode);
  const [wallets, setWallets] = useState<WalletOption[]>([]);

  useEffect(() => {
    if (!open) return;
    const refresh = () => setWallets(listSolanaWallets());
    refresh();
    return onWalletsChanged(refresh);
  }, [open]);

  const close = () => useWallet.getState().set({ pickerOpen: false, error: null });

  return (
    <Dialog open={open} onClose={close} labelledBy="wallet-title" size="sm">
      <div className={styles.picker}>
        <div className={styles.head}>
          <h2 id="wallet-title">{demo ? "Demo wallet" : "Connect a wallet"}</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={close}>
            <Icon name="close" size={18} />
          </button>
        </div>
        {demo ? (
          <>
            <p className={styles.lead}>Demo mode uses a made-up wallet with made-up balances. Nothing can be signed or sent.</p>
            <button
              type="button"
              className="btn btn-primary btn-block"
              onClick={() => useWallet.getState().set({ status: "connected", address: DEMO_WALLET, account: null, option: null, pickerOpen: false })}
            >
              Use demo wallet
            </button>
          </>
        ) : (
          <>
            <p className={styles.lead}>Browsing tokens and quotes needs no wallet. Connecting shares your public address with NOCT's server and Jupiter when you build a transaction.</p>
            {wallets.length === 0 ? (
              <div className="note">
                <Icon name="info" size={16} />
                <span>No Solana wallet was detected in this browser. Install a Wallet Standard wallet, then reload this page.</span>
              </div>
            ) : (
              <ul className={styles.list}>
                {wallets.map((w) => (
                  <li key={w.name}>
                    <button type="button" className={styles.walletRow} disabled={status === "connecting"} onClick={() => void connect(w)}>
                      {/* Wallet Standard icons are data: URIs supplied by the extension. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={w.icon} alt="" width={28} height={28} />
                      <span className={styles.walletName}>{w.name}</span>
                      {!w.canSignTransaction ? <span className="chip chip-warn">Cannot sign</span> : null}
                      <Icon name="chevronRight" size={16} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {error ? (
              <div className="note note-error" role="alert">
                <Icon name="warning" size={16} />
                <span>{error}</span>
              </div>
            ) : null}
          </>
        )}
      </div>
    </Dialog>
  );
}
