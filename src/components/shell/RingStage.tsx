"use client";

import { useLayoutEffect, useRef } from "react";
import { usePrivate } from "@/lib/client/stores";
import { RingArt } from "@/components/ring/RingArt";
import { useTxRing } from "@/components/ring/useTxRing";
import styles from "./shell.module.css";

export type Stage = "landing" | "launching" | "app";

/** Layout size of the ring box; placement moves and scales it with a transform. */
const BASE = 1240;

interface Placement {
  /** Centre and diameter in viewport pixels. */
  cx: number;
  cy: number;
  size: number;
  opacity: number;
}

function visibleRect(el: Element | null): DOMRect | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? r : null;
}

/** Where the ring belongs right now, or null when nothing on the page says. */
function measure(stage: Stage, showInApp: boolean, last: Placement | null): Placement | null {
  if (stage === "landing") {
    const r = visibleRect(document.querySelector("[data-ring-slot]"));
    return r ? { cx: r.left + r.width / 2, cy: r.top + r.height / 2, size: r.width, opacity: 1 } : null;
  }
  // In the app: centred behind the swap, at the size the swap screen lays out.
  const sizer = showInApp ? document.querySelector<HTMLElement>("[data-ring-anchor]") : null;
  const size = visibleRect(sizer);
  if (sizer && size) {
    const centre = visibleRect(document.querySelector("[data-ring-center]")) ?? size;
    const max = Number.parseFloat(getComputedStyle(sizer).getPropertyValue("--ambient-max")) || 1;
    return { cx: centre.left + centre.width / 2, cy: centre.top + centre.height / 2, size: size.width, opacity: max };
  }
  if (stage === "launching") {
    // No room for the ring at this width: it shrinks into the logo.
    const home = visibleRect(document.querySelector("[data-ring-home]"));
    if (home) return { cx: home.left + home.width / 2, cy: home.top + home.height / 2, size: home.width * 3, opacity: 0 };
  }
  return last ? { ...last, opacity: 0 } : null;
}

function write(el: HTMLElement, p: Placement, scale: number, opacity: number) {
  el.style.transform = `translate3d(${(p.cx - BASE / 2).toFixed(1)}px, ${(p.cy - BASE / 2).toFixed(1)}px, 0) scale(${((p.size / BASE) * scale).toFixed(4)})`;
  el.style.opacity = String(opacity);
}

/**
 * One ring for the whole app. On the landing page it sits in the landing's
 * slot; once the app launches it glides to its place behind the swap, or
 * into the logo where there is no room. It follows the swap when the page
 * scrolls, and reflects the operation in flight (see useTxRing). Placement
 * is written straight to the element, so scrolling never re-renders the art.
 */
export function RingStage({ stage, showInApp }: { stage: Stage; showInApp: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const last = useRef<Placement | null>(null);
  const tx = useTxRing();
  const privateOpen = usePrivate((s) => s.status === "ready");

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    let frame = 0;
    const place = (snap: boolean) => {
      const next = measure(stage, showInApp, last.current);
      if (!next) return;
      const first = last.current === null;
      last.current = next;
      if (first) {
        // Put it in place unseen, then let it fade and settle in.
        write(el, next, 0.92, 0);
        frame = requestAnimationFrame(() => {
          el.setAttribute("data-ready", "true");
          write(el, next, 1, next.opacity);
        });
        return;
      }
      if (snap) el.setAttribute("data-snap", "true");
      else el.removeAttribute("data-snap");
      write(el, next, 1, next.opacity);
    };
    place(false);
    let pending = 0;
    const follow = () => {
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(() => place(true));
    };
    window.addEventListener("resize", follow);
    window.addEventListener("scroll", follow, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(pending);
      // If the fade-in frame never ran, later moves should still glide.
      el.setAttribute("data-ready", "true");
      window.removeEventListener("resize", follow);
      window.removeEventListener("scroll", follow);
    };
  }, [stage, showInApp]);

  const mode = stage === "landing" ? "landing" : tx.mode;
  const tone = tx.tone ?? (privateOpen ? "private" : "public");
  return (
    <div className={styles.ringStage} data-ring="stage" aria-hidden="true">
      <div ref={box} className={styles.ringBox} style={{ width: BASE, height: BASE, opacity: 0 }}>
        <RingArt mode={mode} tone={tone} detail="full" />
      </div>
    </div>
  );
}
