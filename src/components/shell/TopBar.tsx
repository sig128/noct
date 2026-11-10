"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePrivate, useSettings, useSettingsReady, useWallet } from "@/lib/client/stores";
import { solanaRpc } from "@/lib/client/rpc";
import { shortAddress } from "@/lib/tokens/sanitize";
import { disconnect } from "@/lib/client/session";
import { Icon } from "@/components/ui/Icon";
import { MoonMark } from "@/components/ui/MoonMark";
import { CopyButton } from "@/components/ui/primitives";
import styles from "./shell.module.css";

function useRpcHealth(): "ok" | "slow" | "down" | "idle" {
  const network = useSettings((s) => s.network);
  const demo = useSettings((s) => s.demoMode);
  const ready = useSettingsReady();
  const [state, setState] = useState<"ok" | "slow" | "down" | "idle">("idle");
  useEffect(() => {
    if (demo || !ready) {
      setState("idle");
      return;
    }
    let cancelled = false;
    const check = async () => {
      const started = performance.now();
      try {
        await solanaRpc.getSlot(network);
        if (!cancelled) setState(performance.now() - started > 2500 ? "slow" : "ok");
      } catch {
        if (!cancelled) setState("down");
      }
    };
    void check();
    const t = setInterval(check, 30_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [network, demo, ready]);
  return state;
}

export function TopBar() {
  const network = useSettings((s) => s.network);
  const demo = useSettings((s) => s.demoMode);
  const { address, status, option } = useWallet();
  const health = useRpcHealth();
  const privateOpen = usePrivate((s) => s.status === "ready");
  const [menu, setMenu] = useState(false);
  const healthText = demo ? "Demo data" : health === "ok" ? "RPC healthy" : health === "slow" ? "RPC slow" : health === "down" ? "RPC unreachable" : "Checking RPC";

  return (
    <header className={styles.topbar}>
      {demo ? <div className={styles.demoEdge} aria-hidden="true" /> : null}
      <div className={styles.brand}>
        <Link href="/" className={styles.wordmark} aria-label="noct, swap">
          <MoonMark size={22} />
          <span className={styles.wordmarkText}>noct</span>
        </Link>
        {demo ? (
          <span className={styles.demoPill} role="status">
            Demo mode
          </span>
        ) : null}
      </div>
      <div className={styles.topRight}>
        {privateOpen ? (
          <button type="button" className={styles.lockPill} onClick={() => usePrivate.getState().lock("Locked from the top bar.")} title="Your private balance is decrypted in this tab. Lock it to clear it from memory.">
            <Icon name="unlock" size={15} />
            <span className={styles.lockText}>Unlocked</span>
            <span className="vh">. Lock private balance</span>
          </button>
        ) : null}
        <span className={styles.netPill} title={healthText}>
          <span className={styles.dot} data-state={demo ? "slow" : health === "idle" ? undefined : health} aria-hidden="true" />
          <span>{network === "mainnet" ? "Mainnet" : "Devnet"}</span>
          <span className="vh">, {healthText}</span>
        </span>
        {status === "connected" && address ? (
          <div style={{ position: "relative" }}>
            <button type="button" className={`btn ${styles.walletBtn}`} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
              <Icon name="wallet" size={16} />
              <span className="num">{shortAddress(address)}</span>
              <Icon name="chevronDown" size={14} />
            </button>
            {menu ? <WalletMenu address={address} walletName={option?.name ?? "Wallet"} onClose={() => setMenu(false)} /> : null}
          </div>
        ) : (
          <button
            type="button"
            className={`btn ${styles.walletBtn}`}
            onClick={() => useWallet.getState().set({ pickerOpen: true })}
            disabled={status === "connecting"}
          >
            <Icon name="wallet" size={16} />
            {status === "connecting" ? "Connecting…" : demo ? "Demo wallet" : "Connect wallet"}
          </button>
        )}
      </div>
    </header>
  );
}

function WalletMenu({ address, walletName, onClose }: { address: string; walletName: string; onClose(): void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const onClick = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("[data-wallet-menu]")) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
    };
  }, [onClose]);
  return (
    <div
      data-wallet-menu
      role="menu"
      className="glass"
      style={{ position: "absolute", right: 0, top: 48, width: 280, padding: 14, borderRadius: 18, background: "var(--surface-raised)", zIndex: 40 }}
    >
      <p style={{ margin: 0, color: "var(--text-2)", fontSize: "var(--fs-small)" }}>{walletName}</p>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
        <span className="num" style={{ fontSize: "var(--fs-small)", overflowWrap: "anywhere" }}>
          {address}
        </span>
        <CopyButton value={address} label="Copy wallet address" />
      </div>
      <button
        type="button"
        role="menuitem"
        className="btn"
        style={{ width: "100%", marginTop: 12 }}
        onClick={() => {
          onClose();
          void disconnect();
        }}
      >
        Disconnect
      </button>
    </div>
  );
}
