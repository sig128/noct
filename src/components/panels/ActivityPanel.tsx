"use client";

import { useState } from "react";
import { formatAmount } from "@/lib/decimal";
import { useActivity, usePrivate } from "@/lib/client/stores";
import { useTokensByMint } from "@/lib/client/hooks";
import { NATIVE_SOL_MINT } from "@/lib/tokens/types";
import { ModulePanel } from "@/components/shell/ModulePanel";
import { EmptyState, ExplorerLinks, Sensitive } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/Icon";
import styles from "./panels.module.css";

const PHASE_TEXT: Record<string, string> = {
  quoting: "Preparing",
  review: "In review",
  awaitingApproval: "Awaiting approval",
  preparing: "Waiting for wallet",
  submitting: "Submitting",
  confirming: "Confirming",
  completed: "Done",
  rejected: "Signature declined",
  retryableFailure: "Did not complete",
  pendingRecovery: "Checking the chain",
  cancelled: "Cancelled",
  staleQuote: "Expired",
  editing: "Closed",
};

const KIND_TEXT: Record<string, string> = {
  deposit: "Deposit",
  privateTransfer: "Private transfer",
  ringEntry: "Ring entry",
  publicWithdrawal: "Public withdrawal",
  split: "Split",
  merge: "Merge",
};

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function ActivityPanel() {
  const items = useActivity((s) => s.items);
  const priv = usePrivate();
  const tokens = useTokensByMint(priv.history.map((h) => h.asset));
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const exportSelected = () => {
    const rows = priv.history.filter((h) => selected.has(h.id));
    const header = ["id", "kind", "direction", "token", "mint", "amount"];
    const lines = rows.map((h) => {
      const t = tokens.data?.find((x) => x.mint === h.asset);
      const decimals = h.asset === NATIVE_SOL_MINT ? 9 : (t?.decimals ?? 0);
      return [h.id, KIND_TEXT[h.kind] ?? h.kind, h.direction, t?.symbol ?? (h.asset === NATIVE_SOL_MINT ? "SOL" : ""), h.asset, formatAmount(h.amount, decimals, { group: false, maxFraction: decimals })].map(csvCell).join(",");
    });
    const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `noct-private-report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <ModulePanel id="activity" title="Activity" lead="This session's operations and, when unlocked, your private history. Nothing here is stored on a server or kept after you lock.">
      <section className={styles.section} aria-labelledby="session-h">
        <div className={styles.sectionHead}>
          <h2 id="session-h" className={styles.h2}>
            This session
          </h2>
        </div>
        {items.length === 0 ? (
          <EmptyState title="Nothing yet">Swaps, deposits, supplies and loans you start here are tracked until they settle.</EmptyState>
        ) : (
          <ul className={styles.activity}>
            {items.map((i) => (
              <li key={i.operationId} className={styles.activityItem}>
                <Icon name={i.kind === "swap" ? "swap" : i.kind.startsWith("earn") ? "earn" : i.kind === "borrow" ? "borrow" : "balance"} size={18} />
                <div style={{ minWidth: 0 }}>
                  <div className={styles.activityTitle}>{i.title}</div>
                  <div className={styles.activityMeta}>
                    <span>
                      <Sensitive>{i.detail}</Sensitive>
                    </span>
                    <span>{new Date(i.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                    <span>{i.privacyClass === "public" ? "Public" : "Amounts hidden"}</span>
                  </div>
                  {i.signature ? (
                    <div style={{ marginTop: 6 }}>
                      <ExplorerLinks signature={i.signature} />
                    </div>
                  ) : null}
                </div>
                <span className={styles.status} data-phase={i.phase}>
                  {PHASE_TEXT[i.phase] ?? i.phase}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className={styles.section} aria-labelledby="private-history-h">
        <div className={styles.sectionHead}>
          <h2 id="private-history-h" className={styles.h2}>
            Private history
          </h2>
          {priv.status === "ready" && priv.history.length > 0 ? (
            <button type="button" className="btn" disabled={selected.size === 0} onClick={exportSelected}>
              <Icon name="download" size={16} /> Export {selected.size || ""} selected
            </button>
          ) : null}
        </div>
        {priv.status !== "ready" ? (
          <p className={styles.meta}>Locked. Unlock your private balance to read its history.</p>
        ) : priv.history.length === 0 ? (
          <p className={styles.meta}>No private history yet.</p>
        ) : (
          <>
            <p className={styles.lead}>Select rows to export a report you choose to share, for example with an accountant. The file is created in this browser.</p>
            <ul className={styles.activity}>
              {priv.history.map((h) => {
                const t = tokens.data?.find((x) => x.mint === h.asset);
                const decimals = h.asset === NATIVE_SOL_MINT ? 9 : (t?.decimals ?? 0);
                const symbol = t?.symbol ?? (h.asset === NATIVE_SOL_MINT ? "SOL" : `${h.asset.slice(0, 4)}…`);
                return (
                  <li key={h.id} className={styles.activityItem}>
                    <input type="checkbox" aria-label={`Select ${KIND_TEXT[h.kind] ?? h.kind}`} checked={selected.has(h.id)} onChange={() => toggle(h.id)} style={{ marginTop: 3, accentColor: "var(--private)" }} />
                    <div>
                      <div className={styles.activityTitle}>
                        {KIND_TEXT[h.kind] ?? h.kind}, {h.direction === "inbound" ? "received" : h.direction === "outbound" ? "sent" : "to self"}
                      </div>
                      <div className={styles.activityMeta}>
                        <span>{h.kind === "publicWithdrawal" || h.kind === "deposit" ? "Public on chain" : "Token and amount hidden on chain"}</span>
                      </div>
                    </div>
                    <span className="num" style={{ color: "var(--private)", fontSize: "var(--fs-small)" }}>
                      <Sensitive>
                        {h.direction === "outbound" ? "−" : "+"}
                        {formatAmount(h.amount, decimals)} {symbol}
                      </Sensitive>
                    </span>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>
    </ModulePanel>
  );
}
