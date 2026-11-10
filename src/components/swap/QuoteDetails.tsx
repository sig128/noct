"use client";

import { useId, useState } from "react";
import { formatAmount, formatBps } from "@/lib/decimal";
import type { SwapQuote } from "@/lib/swap/quote";
import { networkCostLamports } from "@/lib/swap/quote";
import type { TokenInfo } from "@/lib/tokens/types";
import { lamportsText, routeText } from "@/lib/client/swap-spec";
import { Row } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/Icon";
import styles from "./swap.module.css";

export function QuoteDetails({ quote, input, output, taker, transferFeeBps }: { quote: SwapQuote; input: TokenInfo; output: TokenInfo; taker: string | null; transferFeeBps: number | null }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const fee = networkCostLamports(quote, taker);
  return (
    <div className={styles.details}>
      <button type="button" className={styles.detailsToggle} aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        <span>Costs and route</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span className="num" style={{ color: "var(--text-3)" }}>
            Min {formatAmount(quote.minOut, output.decimals)} {output.symbol}
          </span>
          <Icon name="chevronDown" size={15} />
        </span>
      </button>
      {open ? (
        <dl id={id} className={styles.detailsBody}>
          <Row label="Minimum received" tone="accent">
            {formatAmount(quote.minOut, output.decimals)} {output.symbol}
          </Row>
          <Row label="Price impact" tone={quote.priceImpactPct !== null && quote.priceImpactPct <= -1 ? "warn" : "default"}>
            {quote.priceImpactPct === null ? "Not reported" : `${Math.abs(quote.priceImpactPct).toFixed(2)}%`}
          </Row>
          <Row label="Slippage limit">{quote.slippageBps ? formatBps(quote.slippageBps) : "Set by Jupiter"}</Row>
          <Row label="Provider fee">{quote.feeBps ? `${formatBps(quote.feeBps)} (Jupiter)` : "None"}</Row>
          <Row label="Network fee">{quote.gasless ? "Paid by Jupiter" : fee > 0n ? `About ${lamportsText(fee)}` : "Set when the transaction is built"}</Row>
          {quote.rentFeeLamports > 0n ? <Row label="Account rent">{lamportsText(quote.rentFeeLamports)}</Row> : null}
          {transferFeeBps ? (
            <Row label="Token transfer fee" tone="warn">
              Up to {formatBps(transferFeeBps)} withheld by the mint
            </Row>
          ) : null}
          <Row label="Route">{routeText(quote)}</Row>
          <Row label="Router" tone="muted">
            {quote.router === "metis" ? "Metis aggregator" : quote.router === "jupiterz" ? "JupiterZ market makers" : quote.router}
          </Row>
          <Row label={`${input.symbol} spent`} tone="muted">
            {formatAmount(quote.inAmount, input.decimals, { maxFraction: input.decimals })} exactly
          </Row>
        </dl>
      ) : null}
    </div>
  );
}
