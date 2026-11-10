"use client";

import { formatUsdPrice, parseDecimalRatio } from "@/lib/decimal";
import { usePrices } from "@/lib/client/hooks";
import { usePrivate, useSettings, useSwapDraft } from "@/lib/client/stores";
import styles from "./swap.module.css";

/** Compact market and privacy context under the swap card. */
export function ContextStrip() {
  const input = useSwapDraft((s) => s.input);
  const requested = useSwapDraft((s) => s.requestedPrivacy);
  const network = useSettings((s) => s.network);
  const demo = useSettings((s) => s.demoMode);
  const privateStatus = usePrivate((s) => s.status);
  const prices = usePrices([input?.mint]);
  const price = input ? prices.data?.[input.mint]?.usdPrice : undefined;
  const ratio = price ? parseDecimalRatio(price) : null;
  return (
    <div className={`${styles.strip} glass`} role="group" aria-label="Market and privacy context">
      <div className={styles.cell}>
        <span className={styles.cellLabel}>{input ? `${input.symbol} price` : "Price"}</span>
        <span className={`${styles.cellValue} num`}>{ratio ? formatUsdPrice(ratio) : input ? "No reliable price" : "Select a token"}</span>
      </div>
      <div className={styles.cell}>
        <span className={styles.cellLabel}>Routing</span>
        <span className={styles.cellValue}>{demo ? "Demo quotes" : network === "mainnet" ? "Jupiter, mainnet" : "Mainnet only"}</span>
      </div>
      <div className={styles.cell}>
        <span className={styles.cellLabel}>Privacy</span>
        <span className={styles.cellValue} style={{ color: requested === "public" ? undefined : "var(--private)" }} title={privateStatus === "ready" ? "Swaps execute publicly. Your private balance is open in this tab." : undefined}>
          {requested === "public" ? "Public execution" : "Public trade"}
        </span>
      </div>
    </div>
  );
}
