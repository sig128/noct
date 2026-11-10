"use client";

import { useId } from "react";
import { formatAmount, formatUnits, normalizeAmountInput } from "@/lib/decimal";
import { Sensitive, TokenAvatar } from "@/components/ui/primitives";
import { useTokenLabel } from "@/components/swap/useTokenLabel";
import styles from "./panels.module.css";

/**
 * Asset with its catalog symbol. `fallbackSymbol` (from a curated provider such
 * as the lending API) is used only when the token catalog has no entry.
 */
export function AssetCell({ mint, sub, fallbackSymbol }: { mint: string; sub?: string; fallbackSymbol?: string }) {
  const label = useTokenLabel(mint);
  const symbol = !label.known && fallbackSymbol ? fallbackSymbol : label.symbol;
  return (
    <span className={styles.asset}>
      <TokenAvatar symbol={symbol} icon={label.token?.icon ?? null} mint={mint} size={26} />
      <span className={styles.assetText}>
        <span className={styles.assetSym}>{symbol}</span>
        <span className={styles.assetSub}>{sub ?? label.name}</span>
      </span>
    </span>
  );
}

export function TokenAmount({ mint, amount, prefix }: { mint: string; amount: bigint; prefix?: string }) {
  const label = useTokenLabel(mint);
  return (
    <span className="num">
      <Sensitive>
        {prefix}
        {formatAmount(amount, label.decimals)} {label.symbol}
      </Sensitive>
    </span>
  );
}

export function AmountField({
  label,
  value,
  onChange,
  decimals,
  symbol,
  max,
  maxLabel = "Max",
  invalid,
  hint,
}: {
  label: string;
  value: string;
  onChange(v: string): void;
  decimals: number;
  symbol: string;
  max?: bigint | null;
  maxLabel?: string;
  invalid?: boolean;
  hint?: string;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className={styles.fieldLabel}>
        {label}
      </label>
      <div className={styles.formRow}>
        <input
          id={id}
          className="text-input num"
          inputMode="decimal"
          autoComplete="off"
          placeholder={`0 ${symbol}`}
          value={value}
          aria-invalid={invalid ?? false}
          aria-describedby={hint ? `${id}-h` : undefined}
          onChange={(e) => {
            const next = normalizeAmountInput(e.target.value, decimals);
            if (next !== null) onChange(next);
          }}
        />
        {max !== undefined && max !== null && max > 0n ? (
          <button type="button" className="btn" onClick={() => onChange(formatUnits(max, decimals))}>
            {maxLabel}
          </button>
        ) : null}
      </div>
      {hint ? (
        <p id={`${id}-h`} className={styles.hint} style={{ marginTop: 6 }}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function Select({ label, value, onChange, options }: { label: string; value: string; onChange(v: string): void; options: { value: string; label: string }[] }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className={styles.fieldLabel}>
        {label}
      </label>
      <select id={id} className={styles.select} value={value} onChange={(e) => onChange(e.target.value)} style={{ width: "100%" }}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
