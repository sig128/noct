import { z } from "zod";
import { pow10, type Ratio } from "@/lib/decimal";

/** Hermes-compatible /v2/updates/price/latest parsed entry. */
export const hermesParsedSchema = z.object({
  id: z.string().regex(/^(0x)?[0-9a-f]{64}$/i),
  price: z.object({
    price: z.string().regex(/^-?\d{1,30}$/),
    conf: z.string().regex(/^\d{1,30}$/),
    expo: z.number().int().min(-30).max(30),
    publish_time: z.number().int(),
  }),
  ema_price: z
    .object({ price: z.string(), conf: z.string(), expo: z.number().int(), publish_time: z.number().int() })
    .optional(),
});

export const hermesResponseSchema = z.object({ parsed: z.array(hermesParsedSchema).max(64).nullable().optional() });

export interface OraclePrice {
  feedId: string;
  price: Ratio;
  confidence: Ratio;
  publishTime: number;
}

export type OracleAssessment =
  | { usable: true; price: OraclePrice; ageSeconds: number; confidenceBps: bigint }
  | { usable: false; reason: string };

/** Converts a Pyth fixed-point (value × 10^expo) to an exact ratio. Negative prices are rejected. */
export function pythToRatio(value: string, expo: number): Ratio | null {
  const v = BigInt(value);
  if (v < 0n) return null;
  return expo >= 0 ? { num: v * pow10(expo), den: 1n } : { num: v, den: pow10(-expo) };
}

export function parseHermesEntry(entry: z.infer<typeof hermesParsedSchema>): OraclePrice | null {
  const price = pythToRatio(entry.price.price, entry.price.expo);
  const confidence = pythToRatio(entry.price.conf, entry.price.expo);
  if (!price || !confidence || price.num === 0n) return null;
  return { feedId: entry.id.replace(/^0x/, "").toLowerCase(), price, confidence, publishTime: entry.price.publish_time };
}

export interface OraclePolicy {
  maxAgeSeconds: number;
  maxConfidenceBps: bigint;
}

export const DEFAULT_ORACLE_POLICY: OraclePolicy = { maxAgeSeconds: 60, maxConfidenceBps: 100n };

/** Staleness and confidence gate. Values outside policy are unusable, not "approximately right". */
export function assessOracle(price: OraclePrice | null, nowSeconds: number, policy: OraclePolicy = DEFAULT_ORACLE_POLICY): OracleAssessment {
  if (!price) return { usable: false, reason: "No price from the oracle." };
  const ageSeconds = Math.max(0, nowSeconds - price.publishTime);
  if (ageSeconds > policy.maxAgeSeconds) return { usable: false, reason: `Oracle price is ${ageSeconds}s old (limit ${policy.maxAgeSeconds}s).` };
  // conf / price in bps
  const confidenceBps = (price.confidence.num * price.price.den * 10_000n) / (price.price.num * price.confidence.den);
  if (confidenceBps > policy.maxConfidenceBps) {
    return { usable: false, reason: `Oracle confidence band is ${(Number(confidenceBps) / 100).toFixed(2)}% of price.` };
  }
  return { usable: true, price, ageSeconds, confidenceBps };
}

/** Lower bound (price − conf) for valuing collateral; upper bound for debt. */
export function conservativeBounds(p: OraclePrice): { low: Ratio; high: Ratio } {
  const low = { num: p.price.num * p.confidence.den - p.confidence.num * p.price.den, den: p.price.den * p.confidence.den };
  const high = { num: p.price.num * p.confidence.den + p.confidence.num * p.price.den, den: p.price.den * p.confidence.den };
  return { low: low.num > 0n ? low : { num: 0n, den: 1n }, high };
}
