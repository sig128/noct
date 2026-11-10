"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ringPaths, type RingDetail } from "./geometry";
import styles from "./ring.module.css";

export type RingMode = "landing" | "idle" | "waiting" | "moving" | "landed" | "failed";
export type RingTone = "public" | "private";

/** Rotation speed in each state, as a multiple of the idle speed. */
const RATE: Record<RingMode, number> = { landing: 7, idle: 1, waiting: 3, moving: 16, landed: 4, failed: 0.6 };
const RAMP_MS = 1100;

/** A point of light orbiting the ring, with a tail that fades behind it. */
function Orbit({ r, extra, sw, turn, reverse }: { r: number; extra: string; sw: number; turn: number; reverse?: boolean }) {
  return (
    <g className={`${styles.orbit} ${extra}`} transform={`rotate(${turn})${reverse ? " scale(-1 1)" : ""}`}>
      <circle r={r} pathLength={100} className={styles.halo} strokeWidth={sw * 9} />
      <circle r={r} pathLength={100} className={styles.tail1} strokeWidth={sw * 2} />
      <circle r={r} pathLength={100} className={styles.tail2} strokeWidth={sw * 2.2} />
      <circle r={r} pathLength={100} className={styles.tail3} strokeWidth={sw * 2.4} />
      <circle r={r} pathLength={100} className={styles.head} strokeWidth={sw * 3.4} />
    </g>
  );
}

/**
 * NOCT's ring. Decorative: every state it shows is also stated in text
 * wherever it matters (the transaction dialog's status and receipt).
 */
export function RingArt({ mode, tone, detail = "full" }: { mode: RingMode; tone: RingTone; detail?: RingDetail }) {
  const uid = `ring${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const compact = detail === "compact";

  // The full ring is ~30k points: build it once the page is idle. The compact one is cheap.
  const [ready, setReady] = useState(compact);
  useEffect(() => {
    if (ready) return;
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (h: number) => void };
    if (w.requestIdleCallback) {
      const handle = w.requestIdleCallback(() => setReady(true), { timeout: 500 });
      return () => w.cancelIdleCallback?.(handle);
    }
    const t = setTimeout(() => setReady(true), 60);
    return () => clearTimeout(t);
  }, [ready]);
  const paths = useMemo(() => (ready ? ringPaths(detail) : null), [ready, detail]);

  // Ease the bands' rotation toward the speed of the current state.
  const spin = useRef<(SVGGElement | null)[]>([]);
  useEffect(() => {
    const animations = spin.current.flatMap((el) => (el && typeof el.getAnimations === "function" ? el.getAnimations() : []));
    if (animations.length === 0) return;
    const target = RATE[mode];
    const from = animations.map((a) => a.playbackRate);
    const started = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - started) / RAMP_MS);
      const eased = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
      animations.forEach((a, i) => {
        a.playbackRate = from[i]! + (target - from[i]!) * eased;
      });
      if (k < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [mode, paths]);

  const sw = compact ? 2.6 : 0.6;
  const k = compact ? 2.6 : 1;
  const lead = { stroke: "var(--ring-lead)" };

  return (
    <svg viewBox="-300 -300 600 600" className={styles.ring} data-mode={mode} data-tone={tone} aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id={`${uid}-fade`} cx="0" cy="0" r="300" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff" stopOpacity="1" />
          <stop offset="0.8" stopColor="#fff" stopOpacity="0.9" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <mask id={`${uid}-mask`} maskUnits="userSpaceOnUse" x="-300" y="-300" width="600" height="600">
          <rect x="-300" y="-300" width="600" height="600" fill={`url(#${uid}-fade)`} />
        </mask>
        <radialGradient id={`${uid}-bloom`} cx="0" cy="0" r="300" gradientUnits="userSpaceOnUse">
          <stop offset="0" style={{ stopColor: "var(--ring-lead)", stopOpacity: 0.5 }} />
          <stop offset="0.55" style={{ stopColor: "var(--ring-lead)", stopOpacity: 0.16 }} />
          <stop offset="1" style={{ stopColor: "var(--ring-lead)", stopOpacity: 0 }} />
        </radialGradient>
      </defs>
      {paths ? (
        <g mask={`url(#${uid}-mask)`} fill="none" strokeLinejoin="round">
          <circle className={styles.bloom} r={300} fill={`url(#${uid}-bloom)`} />
          <g
            ref={(el) => {
              spin.current[0] = el;
            }}
            className={`${styles.spin} ${styles.spinOuter}`}
          >
            {paths.outer.map((d, i) => (
              <path key={`o${i}`} d={d} stroke="var(--text-2)" strokeOpacity={0.08 * k} strokeWidth={sw} />
            ))}
            {paths.bands.map((d, i) => (
              <path key={`b${i}`} d={d} style={lead} strokeOpacity={(0.13 - i * 0.008) * k} strokeWidth={sw} />
            ))}
            <g className={styles.lit}>
              {paths.bands.slice(0, 3).map((d, i) => (
                <path key={`lb${i}`} d={d} style={lead} strokeOpacity={0.8 - i * 0.22} strokeWidth={sw * 1.6} />
              ))}
            </g>
          </g>
          <g
            ref={(el) => {
              spin.current[1] = el;
            }}
            className={`${styles.spin} ${styles.spinMiddle}`}
          >
            {paths.middle.map((d, i) => (
              <path key={`m${i}`} d={d} stroke="var(--text-2)" strokeOpacity={(0.1 - i * 0.006) * k} strokeWidth={sw} />
            ))}
            <g className={styles.lit}>
              {paths.middle.slice(0, 2).map((d, i) => (
                <path key={`lm${i}`} d={d} style={lead} strokeOpacity={0.55 - i * 0.2} strokeWidth={sw * 1.4} />
              ))}
            </g>
          </g>
          <g
            ref={(el) => {
              spin.current[2] = el;
            }}
            className={`${styles.spin} ${styles.spinInner}`}
          >
            <g className={styles.inner}>
              {paths.inner.map((d, i) => (
                <path key={`i${i}`} d={d} stroke="var(--private)" strokeOpacity={(0.2 - i * 0.012) * k} strokeWidth={sw} />
              ))}
            </g>
            <path className={styles.knot} d={paths.knot} style={lead} strokeOpacity={0.22 * k} strokeWidth={sw} />
            <g className={styles.lit}>
              <path d={paths.knot} style={lead} strokeOpacity={0.7} strokeWidth={sw * 1.4} />
            </g>
          </g>
          <g className={styles.comets} fill="none">
            <Orbit r={172} extra={styles.orbitA!} sw={sw} turn={-90} />
            <Orbit r={243} extra={styles.orbitB!} sw={sw} turn={60} reverse />
            <Orbit r={106} extra={styles.orbitC!} sw={sw} turn={170} />
          </g>
          <circle className={styles.core} r={compact ? 7 : 2.5} />
        </g>
      ) : null}
    </svg>
  );
}
