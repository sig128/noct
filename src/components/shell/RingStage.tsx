"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePrivate } from "@/lib/client/stores";
import { RingArt } from "@/components/ring/RingArt";
import { useTxRing } from "@/components/ring/useTxRing";
import styles from "./shell.module.css";

export type Stage = "landing" | "launching" | "app";

/** Layout size of the ring box; placement moves and scales it with a transform. */
const BASE = 1000;

interface Placement {
  /** Centre and diameter in viewport pixels. */
  cx: number;
  cy: number;
  size: number;
  opacity: number;
  /** Jump without gliding (window resize). */
  snap: boolean;
}

function visibleRect(el: Element | null): DOMRect | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? r : null;
}

/**
 * One ring for the whole app. On the landing page it sits in the landing's
 * slot; once the app launches it glides to its place beside the swap (an
 * anchor the swap screen lays out), or into the logo where there is no room.
 * It also reflects the operation in flight (see useTxRing).
 */
export function RingStage({ stage, showInApp }: { stage: Stage; showInApp: boolean }) {
  const [place, setPlace] = useState<Placement | null>(null);
  const [shown, setShown] = useState(false);
  const last = useRef<Placement | null>(null);
  const tx = useTxRing();
  const privateOpen = usePrivate((s) => s.status === "ready");

  useLayoutEffect(() => {
    const measure = (snap: boolean) => {
      let next: Placement | null = null;
      if (stage === "landing") {
        const r = visibleRect(document.querySelector("[data-ring-slot]"));
        if (r) next = { cx: r.left + r.width / 2, cy: r.top + r.height / 2, size: r.width, opacity: 1, snap };
      } else {
        const anchor = showInApp ? document.querySelector<HTMLElement>("[data-ring-anchor]") : null;
        const r = visibleRect(anchor);
        if (anchor && r) {
          const max = Number.parseFloat(getComputedStyle(anchor).getPropertyValue("--ambient-max")) || 1;
          next = { cx: r.left + r.width / 2, cy: r.top + r.height / 2, size: r.width, opacity: max, snap };
        } else if (stage === "launching") {
          const home = visibleRect(document.querySelector("[data-ring-home]"));
          if (home) next = { cx: home.left + home.width / 2, cy: home.top + home.height / 2, size: home.width * 3, opacity: 0, snap };
        }
        if (!next && last.current) next = { ...last.current, opacity: 0, snap };
      }
      if (next) {
        last.current = next;
        setPlace(next);
      }
    };
    measure(false);
    const onResize = () => measure(true);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [stage, showInApp]);

  // Fade in after the first placement so the ring never flashes at the wrong spot.
  useEffect(() => {
    if (!place || shown) return;
    const frame = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(frame);
  }, [place, shown]);

  const mode = stage === "landing" ? "landing" : tx.mode;
  const tone = tx.tone ?? (privateOpen ? "private" : "public");
  const scale = place ? place.size / BASE : 0;
  return (
    <div className={styles.ringStage} data-ring="stage" aria-hidden="true">
      <div
        className={styles.ringBox}
        data-ready={shown ? "true" : undefined}
        data-snap={place?.snap ? "true" : undefined}
        style={{
          width: BASE,
          height: BASE,
          transform: place ? `translate3d(${place.cx - BASE / 2}px, ${place.cy - BASE / 2}px, 0) scale(${shown ? scale : scale * 0.92})` : "scale(0)",
          opacity: place && shown ? place.opacity : 0,
        }}
      >
        <RingArt mode={mode} tone={tone} detail="full" />
      </div>
    </div>
  );
}
