"use client";

import { formatUsdPrice, parseDecimalRatio } from "@/lib/decimal";
import { usePrices } from "@/lib/client/hooks";
import { useSwapDraft } from "@/lib/client/stores";
import styles from "./swap.module.css";

/** Compact market and privacy context under the swap card. */
export function ContextStrip() {
  const input = useSwapDraft((s) => s.input);
  const requested = useSwapDraft((s) => s.requestedPrivacy);
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
        <span className={styles.cellValue}>Jupiter, mainnet</span>
      </div>
      <div className={styles.cell}>
        <span className={styles.cellLabel}>Privacy</span>
        <span className={styles.cellValue} style={{ color: requested === "public" ? undefined : "var(--warn)" }} title="Swaps are public on chain, including swaps with private funds.">
          {requested === "public" ? "Public execution" : "Public trade"}
        </span>
      </div>
    </div>
  );
}
