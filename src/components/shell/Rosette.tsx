"use client";

import { useEffect, useMemo, useState } from "react";

/**
 * Guilloché rosette in the manner of security printing: woven wave bands
 * around a small hypotrochoid knot, with an open centre. Purely decorative,
 * generated deterministically, drawn after the page is idle, still under
 * reduced motion.
 */

function hypotrochoid(R: number, r: number, d: number, scale: number, rotation: number, steps: number): string {
  const k = (R - r) / r;
  const turns = r / gcd(R, r);
  const total = Math.PI * 2 * turns;
  let path = "";
  for (let i = 0; i <= steps; i += 1) {
    const t = (i / steps) * total;
    const x = (R - r) * Math.cos(t) + d * Math.cos(k * t);
    const y = (R - r) * Math.sin(t) - d * Math.sin(k * t);
    const xr = x * Math.cos(rotation) - y * Math.sin(rotation);
    const yr = x * Math.sin(rotation) + y * Math.cos(rotation);
    path += `${i === 0 ? "M" : "L"}${(xr * scale).toFixed(2)} ${(yr * scale).toFixed(2)}`;
  }
  return `${path}Z`;
}

function waveRing(radius: number, amplitude: number, lobes: number, phase: number, steps: number): string {
  let path = "";
  for (let i = 0; i <= steps; i += 1) {
    const t = (i / steps) * Math.PI * 2;
    const rr = radius + amplitude * Math.sin(lobes * t + phase);
    path += `${i === 0 ? "M" : "L"}${(rr * Math.cos(t)).toFixed(2)} ${(rr * Math.sin(t)).toFixed(2)}`;
  }
  return `${path}Z`;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

export function Rosette({ tone = "neutral" }: { tone?: "neutral" | "private" }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
    if (idle) idle(() => setReady(true));
    else setTimeout(() => setReady(true), 120);
  }, []);

  const paths = useMemo(() => {
    if (!ready) return null;
    // Open centre, woven bands: reads as security printing, not as a solid disc.
    const knot = hypotrochoid(72, 27, 30, 0.82, 0, 1600);
    const inner = Array.from({ length: 9 }, (_, i) => waveRing(98 + i * 2.4, 9, 24, i * 0.35, 900));
    const middle = Array.from({ length: 7 }, (_, i) => waveRing(166 + i * 2.8, 7, 48, i * 0.5, 1100));
    const rings = Array.from({ length: 7 }, (_, i) => waveRing(232 + i * 3.2, 7.5, 54, i * 0.42, 1100));
    const outer = Array.from({ length: 4 }, (_, i) => waveRing(266 + i * 2.6, 4, 108, i * 0.7, 1400));
    return { knot, inner, middle, rings, outer };
  }, [ready]);

  const lead = tone === "private" ? "var(--private)" : "var(--accent)";
  return (
    <svg viewBox="-300 -300 600 600" width="100%" height="100%" aria-hidden="true" focusable="false" style={{ overflow: "visible" }}>
      <defs>
        <radialGradient id="rosette-fade" cx="0" cy="0" r="300" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff" stopOpacity="1" />
          <stop offset="0.8" stopColor="#fff" stopOpacity="0.9" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <mask id="rosette-mask">
          <rect x="-300" y="-300" width="600" height="600" fill="url(#rosette-fade)" />
        </mask>
      </defs>
      {paths ? (
        <g mask="url(#rosette-mask)" fill="none" strokeLinejoin="round">
          <g className="rosette-spin-slow">
            {paths.outer.map((d, i) => (
              <path key={`o${i}`} d={d} stroke="var(--text-2)" strokeOpacity={0.08} strokeWidth={0.6} />
            ))}
            {paths.rings.map((d, i) => (
              <path key={`r${i}`} d={d} stroke={lead} strokeOpacity={0.13 - i * 0.008} strokeWidth={0.6} />
            ))}
          </g>
          <g className="rosette-spin-rev">
            {paths.middle.map((d, i) => (
              <path key={`m${i}`} d={d} stroke="var(--text-2)" strokeOpacity={0.1 - i * 0.006} strokeWidth={0.55} />
            ))}
          </g>
          <g className="rosette-spin">
            {paths.inner.map((d, i) => (
              <path key={`i${i}`} d={d} stroke="var(--private)" strokeOpacity={0.2 - i * 0.012} strokeWidth={0.55} />
            ))}
            <path d={paths.knot} stroke={lead} strokeOpacity={0.22} strokeWidth={0.6} />
          </g>
          <circle r="2.5" fill={lead} fillOpacity={0.5} />
        </g>
      ) : null}
      <style>{`
        .rosette-spin{transform-origin:0 0;animation:rosette 360s linear infinite}
        .rosette-spin-rev{transform-origin:0 0;animation:rosette 280s linear infinite reverse}
        .rosette-spin-slow{transform-origin:0 0;animation:rosette 720s linear infinite}
        @keyframes rosette{to{transform:rotate(360deg)}}
        @media (prefers-reduced-motion: reduce){.rosette-spin,.rosette-spin-rev,.rosette-spin-slow{animation:none}}
      `}</style>
    </svg>
  );
}
