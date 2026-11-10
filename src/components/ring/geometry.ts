/**
 * Geometry for NOCT's ring: woven wave bands around a hypotrochoid knot, in the
 * manner of security printing. Deterministic, computed once per detail level.
 * Units are viewBox units on a -300..300 square centred on the origin.
 */

export type RingDetail = "full" | "compact";

export interface RingPaths {
  knot: string;
  inner: string[];
  middle: string[];
  bands: string[];
  outer: string[];
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

function hypotrochoid(R: number, r: number, d: number, scale: number, steps: number): string {
  const k = (R - r) / r;
  const total = Math.PI * 2 * (r / gcd(R, r));
  let path = "";
  for (let i = 0; i <= steps; i += 1) {
    const t = (i / steps) * total;
    const x = (R - r) * Math.cos(t) + d * Math.cos(k * t);
    const y = (R - r) * Math.sin(t) - d * Math.sin(k * t);
    path += `${i === 0 ? "M" : "L"}${(x * scale).toFixed(2)} ${(y * scale).toFixed(2)}`;
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

const cache = new Map<RingDetail, RingPaths>();

export function ringPaths(detail: RingDetail): RingPaths {
  const hit = cache.get(detail);
  if (hit) return hit;
  const full = detail === "full";
  const paths: RingPaths = full
    ? {
        knot: hypotrochoid(72, 27, 30, 0.82, 1600),
        inner: Array.from({ length: 9 }, (_, i) => waveRing(98 + i * 2.4, 9, 24, i * 0.35, 900)),
        middle: Array.from({ length: 7 }, (_, i) => waveRing(166 + i * 2.8, 7, 48, i * 0.5, 1100)),
        bands: Array.from({ length: 7 }, (_, i) => waveRing(232 + i * 3.2, 7.5, 54, i * 0.42, 1100)),
        outer: Array.from({ length: 4 }, (_, i) => waveRing(266 + i * 2.6, 4, 108, i * 0.7, 1400)),
      }
    : {
        knot: hypotrochoid(72, 27, 30, 0.82, 720),
        inner: Array.from({ length: 4 }, (_, i) => waveRing(98 + i * 5, 9, 24, i * 0.7, 420)),
        middle: Array.from({ length: 3 }, (_, i) => waveRing(166 + i * 6, 7, 48, i * 0.9, 520)),
        bands: Array.from({ length: 3 }, (_, i) => waveRing(232 + i * 7, 7.5, 54, i * 0.8, 560)),
        outer: Array.from({ length: 2 }, (_, i) => waveRing(268 + i * 6, 4, 108, i * 1.2, 760)),
      };
  cache.set(detail, paths);
  return paths;
}
