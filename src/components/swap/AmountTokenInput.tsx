"use client";

import { useId, useState, type ReactNode } from "react";
import { formatAmount, normalizeAmountInput } from "@/lib/decimal";
import type { TokenInfo } from "@/lib/tokens/types";
import { Sensitive, TokenAvatar } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/Icon";
import styles from "./swap.module.css";

/** Long amounts step down in size so every digit stays visible. */
function fitAmountSize(text: string): string | undefined {
  const n = text.length;
  if (n <= 10) return undefined;
  if (n <= 13) return "calc(var(--fs-amount) * 0.82)";
  if (n <= 16) return "calc(var(--fs-amount) * 0.68)";
  return "calc(var(--fs-amount) * 0.56)";
}

interface Common {
  label: string;
  token: TokenInfo | null;
  onPickToken(): void;
  usdText: string | null;
  balance: { amount: bigint; label?: string } | null;
  footerRight?: ReactNode;
  invalid?: boolean;
}

export function AmountTokenInput(
  props: Common & {
    value: string;
    onChange(next: string): void;
    presets?: { label: string; onClick(): void }[];
    describedBy?: string;
  },
) {
  const id = useId();
  const [editing, setEditing] = useState(false);
  const decimals = props.token?.decimals ?? 9;
  return (
    <div className={styles.field} data-invalid={props.invalid ?? false}>
      <div className={styles.fieldTop}>
        <label htmlFor={id} className={styles.fieldLabel}>
          {props.label}
        </label>
        {props.balance && props.token ? (
          <span className={`${styles.balance} num`} id={`${id}-bal`}>
            {props.balance.label ?? "Balance"}{" "}
            <strong>
              <Sensitive>
                {formatAmount(props.balance.amount, props.token.decimals)} {props.token.symbol}
              </Sensitive>
            </strong>
          </span>
        ) : null}
      </div>
      <div className={styles.fieldMain}>
        <input
          id={id}
          className={styles.amount}
          inputMode="decimal"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="0"
          data-amount-input
          data-editing={editing}
          aria-describedby={[props.describedBy, props.balance ? `${id}-bal` : null, `${id}-usd`].filter(Boolean).join(" ") || undefined}
          aria-invalid={props.invalid ?? false}
          value={props.value}
          style={{ fontSize: fitAmountSize(props.value) }}
          onFocus={() => setEditing(true)}
          onBlur={() => setEditing(false)}
          onChange={(e) => {
            const next = normalizeAmountInput(e.target.value, decimals);
            if (next !== null) props.onChange(next);
          }}
        />
        <TokenButton token={props.token} onClick={props.onPickToken} label={props.label} />
      </div>
      <div className={styles.fieldBottom}>
        <span id={`${id}-usd`} className="num">
          {props.usdText ?? ""}
        </span>
        {props.presets && props.presets.length > 0 ? (
          <span className={styles.presets} role="group" aria-label="Amount presets">
            {props.presets.map((p) => (
              <button key={p.label} type="button" className={styles.preset} onClick={p.onClick}>
                {p.label}
              </button>
            ))}
          </span>
        ) : (
          props.footerRight
        )}
      </div>
    </div>
  );
}

export function AmountOutput(props: Common & { amount: bigint | null; loading: boolean; status?: string }) {
  const id = useId();
  return (
    <div className={styles.field}>
      <div className={styles.fieldTop}>
        <span className={styles.fieldLabel} id={`${id}-label`}>
          {props.label}
        </span>
        {props.balance && props.token ? (
          <span className={`${styles.balance} num`}>
            Balance{" "}
            <strong>
              <Sensitive>
                {formatAmount(props.balance.amount, props.token.decimals)} {props.token.symbol}
              </Sensitive>
            </strong>
          </span>
        ) : null}
      </div>
      <div className={styles.fieldMain}>
        {props.loading ? (
          <span className={`skeleton ${styles.amountSkeleton}`} aria-label="Getting a quote" role="status" />
        ) : (
          (() => {
            const text = props.amount !== null && props.token ? formatAmount(props.amount, props.token.decimals, { maxFraction: 6 }) : "0";
            return (
              <output className={styles.amountOut} data-empty={props.amount === null} aria-labelledby={`${id}-label`} style={{ fontSize: fitAmountSize(text) }}>
                {text}
              </output>
            );
          })()
        )}
        <TokenButton token={props.token} onClick={props.onPickToken} label={props.label} />
      </div>
      <div className={styles.fieldBottom}>
        <span className="num">{props.usdText ?? props.status ?? ""}</span>
        {props.footerRight}
      </div>
    </div>
  );
}

function TokenButton({ token, onClick, label }: { token: TokenInfo | null; onClick(): void; label: string }) {
  return (
    <button type="button" className={styles.tokenBtn} data-empty={!token} onClick={onClick} aria-label={token ? `${label}: ${token.symbol}. Change token` : `Select token for ${label.toLowerCase()}`}>
      {token ? (
        <>
          <TokenAvatar symbol={token.symbol} icon={token.icon} mint={token.mint} size={26} />
          <span className={styles.tokenSym}>{token.symbol}</span>
        </>
      ) : (
        <span>Select token</span>
      )}
      <Icon name="chevronDown" size={15} />
    </button>
  );
}
