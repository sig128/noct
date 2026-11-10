"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useSettings } from "@/lib/client/stores";
import { Icon } from "./Icon";
import styles from "./ui.module.css";

/** Native modal dialog: real focus trap, inert background, Escape to close, focus restored on close. */
export function Dialog({
  open,
  onClose,
  labelledBy,
  children,
  size = "md",
  dismissible = true,
}: {
  open: boolean;
  onClose(): void;
  labelledBy: string;
  children: ReactNode;
  size?: "sm" | "md" | "lg";
  dismissible?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      returnFocus.current = document.activeElement as HTMLElement | null;
      d.showModal();
    } else if (!open && d.open) {
      d.close();
      const target = returnFocus.current;
      returnFocus.current = null;
      if (target && document.contains(target)) target.focus();
    }
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      data-size={size}
      aria-labelledby={labelledBy}
      onCancel={(e) => {
        e.preventDefault();
        if (dismissible) onClose();
      }}
      onKeyDown={(e) => {
        // Native modal dialogs let Tab leave for the browser chrome; keep focus inside.
        if (e.key !== "Tab" || !ref.current) return;
        const focusable = [...ref.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter(
          (el) => el.offsetParent !== null || el === document.activeElement,
        );
        if (focusable.length === 0) return;
        const first = focusable[0]!;
        const last = focusable[focusable.length - 1]!;
        const current = document.activeElement as HTMLElement | null;
        if (e.shiftKey && (current === first || !ref.current.contains(current))) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (current === last || !ref.current.contains(current))) {
          e.preventDefault();
          first.focus();
        }
      }}
      onMouseDown={(e) => {
        if (dismissible && e.target === ref.current) onClose();
      }}
    >
      {open ? <div className={`${styles.dialogBody} glass`}>{children}</div> : null}
    </dialog>
  );
}

function hueOf(seed: string): number {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 360;
}

export function TokenAvatar({ symbol, icon, mint, size = 28 }: { symbol: string; icon: string | null; mint: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const letters = Array.from(symbol.replace(/[^\p{L}\p{N}]/gu, "")).slice(0, 2).join("") || "?";
  const hue = hueOf(mint);
  return (
    <span className={styles.avatar} style={{ width: size, height: size, ["--hue" as string]: String(hue) }} aria-hidden="true">
      {icon && !failed ? (
        // Same-origin proxied raster only; see /api/token-icon.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={icon} alt="" width={size} height={size} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      ) : (
        <span className={styles.monogram} style={{ fontSize: Math.round(size * 0.38) }}>
          {letters}
        </span>
      )}
    </span>
  );
}

/** Renders protected values, or a security tint when balance masking is on. */
export function Sensitive({ children, force }: { children: ReactNode; force?: boolean }) {
  const mask = useSettings((s) => s.maskBalances);
  if (mask || force) return <span className="tint" role="img" aria-label="Hidden" />;
  return <>{children}</>;
}

export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <button
      type="button"
      className="icon-btn"
      aria-label={copied ? "Copied" : label}
      title={copied ? "Copied" : label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
        } catch {
          setCopied(false);
        }
      }}
    >
      <Icon name={copied ? "check" : "copy"} size={16} />
    </button>
  );
}

export function Toggle({ checked, onChange, label, description }: { checked: boolean; onChange(v: boolean): void; label: string; description?: string }) {
  const id = useId();
  return (
    <div className={styles.toggleRow}>
      <div className={styles.toggleText}>
        <label htmlFor={id} className={styles.toggleLabel}>
          {label}
        </label>
        {description ? (
          <p className={styles.toggleDesc} id={`${id}-d`}>
            {description}
          </p>
        ) : null}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={description ? `${id}-d` : undefined}
        className={styles.switch}
        data-on={checked}
        onClick={() => onChange(!checked)}
      >
        <span className={styles.switchKnob} />
      </button>
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: NoInfer<T>; label: string; disabled?: boolean }[]; onChange(v: NoInfer<T>): void; label: string }) {
  return (
    <div className={styles.segmented} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          disabled={o.disabled}
          data-active={value === o.value}
          className={styles.segment}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Row({ label, children, tone }: { label: ReactNode; children: ReactNode; tone?: "default" | "muted" | "warn" | "private" | "accent" }) {
  return (
    <div className={styles.row} data-tone={tone ?? "default"}>
      <dt>{label}</dt>
      <dd className="num">{children}</dd>
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className={styles.empty}>
      <p className={styles.emptyTitle}>{title}</p>
      {children ? <div className={styles.emptyBody}>{children}</div> : null}
      {action ? <div className={styles.emptyAction}>{action}</div> : null}
    </div>
  );
}

/** Mainnet explorer links for a transaction signature. */
export function ExplorerLinks({ signature }: { signature: string }) {
  return (
    <span className={styles.links}>
      <a className="link" href={`https://solscan.io/tx/${signature}`} target="_blank" rel="noopener noreferrer">
        Solscan <Icon name="external" size={13} />
      </a>
      <a className="link" href={`https://explorer.solana.com/tx/${signature}`} target="_blank" rel="noopener noreferrer">
        Solana Explorer <Icon name="external" size={13} />
      </a>
    </span>
  );
}
