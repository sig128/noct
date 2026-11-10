"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import type { ModuleId } from "@/lib/client/modules";
import { Icon } from "@/components/ui/Icon";
import styles from "./shell.module.css";

/**
 * Frame for a full tool. Escape (outside dialogs and inputs being composed)
 * closes it back to the swap and returns focus to the tool's rail button.
 */
export function ModulePanel({ id, title, lead, children, badge }: { id: ModuleId; title: string; lead?: ReactNode; children: ReactNode; badge?: ReactNode }) {
  const router = useRouter();
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    // Move focus to the panel heading when opened from the rail or a deep link.
    const h = ref.current?.querySelector<HTMLElement>("h1");
    if (h && !ref.current?.contains(document.activeElement)) h.focus({ preventScroll: true });
  }, [id]);

  const close = () => {
    router.push("/swap");
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-rail="${id}"]`)?.focus());
  };

  return (
    <section
      ref={ref}
      className={`${styles.panel} glass`}
      aria-labelledby={`panel-${id}-title`}
      onKeyDown={(e) => {
        if (e.key !== "Escape" || e.defaultPrevented) return;
        if ((e.target as HTMLElement).closest("dialog")) return;
        e.preventDefault();
        close();
      }}
    >
      <header className={styles.panelHead}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <h1 id={`panel-${id}-title`} className={styles.panelTitle} tabIndex={-1} style={{ outline: "none" }}>
              {title}
            </h1>
            {badge}
          </div>
          {lead ? <p className={styles.panelLead}>{lead}</p> : null}
        </div>
        <button type="button" className="icon-btn" aria-label={`Close ${title}`} onClick={close}>
          <Icon name="close" size={18} />
        </button>
      </header>
      <div className={styles.panelBody}>{children}</div>
    </section>
  );
}
