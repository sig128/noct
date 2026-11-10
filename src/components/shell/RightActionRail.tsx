"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { MODULES, type ModuleId } from "@/lib/client/modules";
import { Icon } from "@/components/ui/Icon";
import { ToolPreviewContent } from "./ToolPreview";
import styles from "./shell.module.css";

const OPEN_DELAY = 140;
const CLOSE_DELAY = 220;

interface PreviewState {
  id: ModuleId;
  anchorY: number;
  source: "pointer" | "focus";
}

function intersects(a: DOMRect, b: DOMRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

export function RightActionRail({ active }: { active: ModuleId }) {
  const router = useRouter();
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [compact, setCompact] = useState(false);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerType = useRef<string>("mouse");
  const buttons = useRef<Partial<Record<ModuleId, HTMLAnchorElement | null>>>({});
  const previewRef = useRef<HTMLDivElement | null>(null);

  const clearTimers = () => {
    if (openTimer.current) clearTimeout(openTimer.current);
    if (closeTimer.current) clearTimeout(closeTimer.current);
  };

  const anchorFor = (id: ModuleId) => {
    const el = buttons.current[id];
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    return r.top + r.height / 2;
  };

  const scheduleOpen = (id: ModuleId, source: PreviewState["source"]) => {
    clearTimers();
    openTimer.current = setTimeout(() => setPreview({ id, anchorY: anchorFor(id), source }), source === "focus" ? 60 : OPEN_DELAY);
  };

  const scheduleClose = useCallback(() => {
    if (openTimer.current) clearTimeout(openTimer.current);
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setPreview(null), CLOSE_DELAY);
  }, []);

  const cancelClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  };

  const closeAndFocus = useCallback((id: ModuleId) => {
    clearTimers();
    setPreview(null);
    buttons.current[id]?.focus();
  }, []);

  useEffect(() => () => clearTimers(), []);

  // Previews must never cover an amount being edited: fall back to a label.
  useLayoutEffect(() => {
    if (!preview || !previewRef.current) return;
    const active = document.activeElement as HTMLElement | null;
    const editing = document.querySelector<HTMLElement>("[data-amount-input][data-editing='true']") ?? (active?.matches("[data-amount-input]") ? active : null);
    if (!editing) {
      setCompact(false);
      return;
    }
    setCompact(intersects(previewRef.current.getBoundingClientRect(), editing.getBoundingClientRect()));
  }, [preview]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLAnchorElement>, index: number, id: ModuleId) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeAndFocus(id);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = MODULES[(index + (e.key === "ArrowDown" ? 1 : MODULES.length - 1)) % MODULES.length]!;
      buttons.current[next.id]?.focus();
    } else if (e.key === "ArrowLeft" && preview?.id === id) {
      const first = previewRef.current?.querySelector<HTMLElement>("button, a, input, [tabindex]:not([tabindex='-1'])");
      if (first) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  const top = preview ? Math.max(76, Math.min(preview.anchorY - 40, (typeof window !== "undefined" ? window.innerHeight : 800) - 320)) : 0;

  return (
    <>
      <nav aria-label="Tools" className={`${styles.rail} glass`}>
        {MODULES.map((m, i) => (
          <Link
            key={m.id}
            href={m.href}
            ref={(el) => {
              buttons.current[m.id] = el;
            }}
            data-rail={m.id}
            aria-label={m.label}
            aria-current={active === m.id ? "page" : undefined}
            aria-describedby={preview?.id === m.id && !compact ? "tool-preview" : undefined}
            className={styles.railBtn}
            data-previewing={preview?.id === m.id}
            onPointerDown={(e) => {
              pointerType.current = e.pointerType;
            }}
            onPointerEnter={(e) => {
              if (e.pointerType === "mouse") scheduleOpen(m.id, "pointer");
            }}
            onPointerLeave={(e) => {
              if (e.pointerType === "mouse") scheduleClose();
            }}
            onFocus={() => {
              if (pointerType.current !== "touch") scheduleOpen(m.id, "focus");
            }}
            onBlur={(e) => {
              if (!previewRef.current?.contains(e.relatedTarget as Node)) scheduleClose();
            }}
            onClick={() => {
              clearTimers();
              setPreview(null);
            }}
            onKeyDown={(e) => onKeyDown(e, i, m.id)}
          >
            <Icon name={m.icon} size={20} />
          </Link>
        ))}
      </nav>
      {preview ? (
        <div
          ref={previewRef}
          id="tool-preview"
          role="region"
          aria-label={`${MODULES.find((m) => m.id === preview.id)!.label} preview`}
          className={`${styles.preview} glass`}
          data-compact={compact}
          style={{ top, right: "calc(var(--rail-inset) + var(--rail-w) + 12px)" }}
          onPointerEnter={cancelClose}
          onPointerLeave={scheduleClose}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              closeAndFocus(preview.id);
            }
          }}
          onBlur={(e) => {
            const next = e.relatedTarget as Node | null;
            if (!previewRef.current?.contains(next) && !Object.values(buttons.current).some((b) => b?.contains(next))) scheduleClose();
          }}
        >
          {compact ? (
            <span style={{ fontSize: "var(--fs-small)", fontWeight: 540 }}>{MODULES.find((m) => m.id === preview.id)!.label}</span>
          ) : (
            <ToolPreviewContent
              id={preview.id}
              onOpen={() => {
                const def = MODULES.find((m) => m.id === preview.id)!;
                setPreview(null);
                router.push(def.href);
              }}
            />
          )}
        </div>
      ) : null}
    </>
  );
}
