/**
 * Fixed-point helpers. Every token amount in NOCT is an integer count of base
 * units (bigint). JavaScript `number` is never used for balances or money
 * arithmetic; prices that arrive as JSON numbers are converted to exact
 * rationals from their shortest decimal representation before use.
 */

export const U64_MAX = (1n << 64n) - 1n;
export const MAX_SUPPORTED_DECIMALS = 24;
export const BPS_DENOMINATOR = 10_000n;

export type AmountParseFailure = "empty" | "invalid" | "too_many_decimals" | "too_large" | "zero";

export type AmountParseResult =
  | { ok: true; value: bigint; normalized: string }
  | { ok: false; reason: AmountParseFailure };

const STRICT_DECIMAL = /^(\d+)(?:\.(\d+))?$/;
const EDITABLE_DECIMAL = /^\d*(?:\.\d*)?$/;

export function pow10(exp: number): bigint {
  if (!Number.isInteger(exp) || exp < 0 || exp > 80) throw new RangeError(`pow10: unsupported exponent ${exp}`);
  return 10n ** BigInt(exp);
}

function assertDecimals(decimals: number): void {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > MAX_SUPPORTED_DECIMALS) {
    throw new RangeError(`Unsupported token decimals: ${decimals}`);
  }
}

/**
 * Normalises keyboard input for an amount field while the user is still
 * typing. Accepts intermediate states such as "", "0.", ".5" and returns
 * `null` when the keystroke should be rejected (so the field keeps its
 * previous value and the caret does not jump).
 */
export function normalizeAmountInput(raw: string, decimals: number): string | null {
  assertDecimals(decimals);
  let text = raw.replace(/[\s_  ]/g, "");
  // Accept a single comma as the decimal separator (common on EU keyboards).
  if (!text.includes(".") && (text.match(/,/g) ?? []).length === 1) text = text.replace(",", ".");
  if (text.includes(",")) return null;
  if (!EDITABLE_DECIMAL.test(text)) return null;
  const [whole = "", fraction] = text.split(".");
  if (fraction !== undefined && fraction.length > decimals) return null;
  if (decimals === 0 && text.includes(".")) return null;
  // Collapse leading zeros ("007" → "7") but keep "0" and "0.x".
  const trimmedWhole = whole.replace(/^0+(?=\d)/, "");
  return fraction === undefined ? trimmedWhole : `${trimmedWhole}.${fraction}`;
}

/** Strictly parses a decimal string into base units. No exponents, signs or rounding. */
export function parseUnits(text: string, decimals: number, opts: { max?: bigint; allowZero?: boolean } = {}): AmountParseResult {
  assertDecimals(decimals);
  const max = opts.max ?? U64_MAX;
  const trimmed = text.trim();
  if (trimmed === "" || trimmed === ".") return { ok: false, reason: "empty" };
  const candidate = trimmed.startsWith(".") ? `0${trimmed}` : trimmed.endsWith(".") ? trimmed.slice(0, -1) : trimmed;
  const match = STRICT_DECIMAL.exec(candidate);
  if (!match) return { ok: false, reason: "invalid" };
  const whole = match[1] ?? "0";
  const fraction = match[2] ?? "";
  if (fraction.length > decimals) return { ok: false, reason: "too_many_decimals" };
  const value = BigInt(whole) * pow10(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
  if (value > max) return { ok: false, reason: "too_large" };
  if (value === 0n && !opts.allowZero) return { ok: false, reason: "zero" };
  return { ok: true, value, normalized: formatUnits(value, decimals) };
}

/** Exact decimal rendering of base units, trailing zeros trimmed, no grouping. */
export function formatUnits(value: bigint, decimals: number): string {
  assertDecimals(decimals);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const base = pow10(decimals);
  const whole = abs / base;
  const fraction = abs % base;
  let out = whole.toString();
  if (decimals > 0 && fraction > 0n) {
    out += `.${fraction.toString().padStart(decimals, "0").replace(/0+$/, "")}`;
  }
  return negative ? `-${out}` : out;
}

function groupThousands(whole: string): string {
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export interface DisplayOptions {
  /** Maximum fraction digits shown for values ≥ 1. */
  maxFraction?: number;
  /** Significant digits kept for values < 1. */
  smallSignificant?: number;
  /** Minimum fraction digits (padding). */
  minFraction?: number;
  group?: boolean;
}

/**
 * Human display of base units. Always rounds toward zero so the UI never
 * shows more than the user actually has or will receive.
 */
export function formatAmount(value: bigint, decimals: number, opts: DisplayOptions = {}): string {
  assertDecimals(decimals);
  const { maxFraction = 6, smallSignificant = 4, minFraction = 0, group = true } = opts;
  if (value === 0n) return minFraction > 0 ? `0.${"0".repeat(minFraction)}` : "0";
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const base = pow10(decimals);
  const whole = abs / base;
  const fractionStr = (abs % base).toString().padStart(decimals, "0");

  let fractionDigits: number;
  if (whole > 0n) {
    fractionDigits = Math.min(maxFraction, decimals);
  } else {
    const firstNonZero = fractionStr.search(/[1-9]/);
    if (firstNonZero === -1) return "0";
    fractionDigits = Math.min(decimals, firstNonZero + smallSignificant);
  }
  let fraction = fractionStr.slice(0, fractionDigits).replace(/0+$/, "");
  if (fraction.length < minFraction) fraction = fraction.padEnd(Math.min(minFraction, decimals), "0");
  const wholeStr = group ? groupThousands(whole.toString()) : whole.toString();
  if (whole === 0n && fraction.replace(/0/g, "") === "") {
    const threshold = `0.${"0".repeat(Math.max(0, fractionDigits - 1))}1`;
    return `${negative ? "-" : ""}<${threshold}`;
  }
  return `${negative ? "-" : ""}${wholeStr}${fraction ? `.${fraction}` : ""}`;
}

export function mulDivFloor(a: bigint, b: bigint, c: bigint): bigint {
  if (c === 0n) throw new RangeError("mulDivFloor: division by zero");
  if (a < 0n || b < 0n || c < 0n) throw new RangeError("mulDivFloor: negative operand");
  return (a * b) / c;
}

export function mulDivCeil(a: bigint, b: bigint, c: bigint): bigint {
  if (c === 0n) throw new RangeError("mulDivCeil: division by zero");
  if (a < 0n || b < 0n || c < 0n) throw new RangeError("mulDivCeil: negative operand");
  const product = a * b;
  return product === 0n ? 0n : (product - 1n) / c + 1n;
}

/** amount × bps / 10_000, rounded down. */
export function bpsOfFloor(amount: bigint, bps: number | bigint): bigint {
  const b = BigInt(bps);
  if (b < 0n || b > BPS_DENOMINATOR) throw new RangeError(`bps out of range: ${bps}`);
  return mulDivFloor(amount, b, BPS_DENOMINATOR);
}

/** amount × bps / 10_000, rounded up (use for fees charged to the user). */
export function bpsOfCeil(amount: bigint, bps: number | bigint): bigint {
  const b = BigInt(bps);
  if (b < 0n || b > BPS_DENOMINATOR) throw new RangeError(`bps out of range: ${bps}`);
  return mulDivCeil(amount, b, BPS_DENOMINATOR);
}

/** Lowest acceptable output after slippage, rounded down. */
export function minOutputAfterSlippage(expectedOut: bigint, slippageBps: number): bigint {
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 10_000) throw new RangeError("slippage out of range");
  return mulDivFloor(expectedOut, BPS_DENOMINATOR - BigInt(slippageBps), BPS_DENOMINATOR);
}

export const minBig = (a: bigint, b: bigint): bigint => (a < b ? a : b);
export const maxBig = (a: bigint, b: bigint): bigint => (a > b ? a : b);

/** Parses a non-negative base-unit integer string from an API. */
export function parseBaseUnits(value: unknown): bigint | null {
  if (typeof value === "bigint") return value >= 0n ? value : null;
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null;
  if (typeof value !== "string" || !/^\d{1,40}$/.test(value)) return null;
  return BigInt(value);
}

/** Parses a signed integer string (borrow positions, operate amounts). */
export function parseSignedBaseUnits(value: unknown): bigint | null {
  if (typeof value === "string" && /^-?\d{1,40}$/.test(value)) return BigInt(value);
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  return null;
}

// ---------------------------------------------------------------------------
// Exact rationals for prices and valuations.
// ---------------------------------------------------------------------------

export interface Ratio {
  readonly num: bigint;
  readonly den: bigint;
}

const DECIMAL_WITH_EXP = /^(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/;

/** Exact rational from a decimal string such as "81.8009", "1e-7" or "2.5E+3". */
export function parseDecimalRatio(text: string): Ratio | null {
  const match = DECIMAL_WITH_EXP.exec(text.trim());
  if (!match) return null;
  const whole = match[1] ?? "0";
  const fraction = match[2] ?? "";
  const exp = Number(match[3] ?? "0");
  if (!Number.isInteger(exp) || Math.abs(exp) > 60) return null;
  let num = BigInt(whole + fraction);
  let den = pow10(fraction.length);
  if (exp > 0) num *= pow10(exp);
  if (exp < 0) den *= pow10(-exp);
  return reduce({ num, den });
}

/** Exact rational of a finite, non-negative JSON number via its shortest decimal form. */
export function ratioFromNumber(value: unknown): Ratio | null {
  if (typeof value === "string") return parseDecimalRatio(value);
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return parseDecimalRatio(value.toString());
}

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y > 0n) [x, y] = [y, x % y];
  return x;
}

export function reduce(r: Ratio): Ratio {
  if (r.den === 0n) throw new RangeError("ratio with zero denominator");
  const g = gcd(r.num, r.den) || 1n;
  return { num: r.num / g, den: r.den / g };
}

export function ratioMul(a: Ratio, b: Ratio): Ratio {
  return reduce({ num: a.num * b.num, den: a.den * b.den });
}

export function ratioDiv(a: Ratio, b: Ratio): Ratio | null {
  if (b.num === 0n) return null;
  return reduce({ num: a.num * b.den, den: a.den * b.num });
}

export function ratioCompare(a: Ratio, b: Ratio): -1 | 0 | 1 {
  const left = a.num * b.den;
  const right = b.num * a.den;
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Quote-currency value of `amount` base units at `price` per whole token. */
export function valueOf(amount: bigint, decimals: number, price: Ratio): Ratio {
  return reduce({ num: amount * price.num, den: pow10(decimals) * price.den });
}

/** Rounds a ratio toward zero to `fractionDigits` and renders it with grouping. */
export function formatRatio(r: Ratio, fractionDigits: number, opts: { group?: boolean; trim?: boolean } = {}): string {
  const { group = true, trim = false } = opts;
  const scaled = (r.num * pow10(fractionDigits)) / r.den;
  const base = pow10(fractionDigits);
  const whole = scaled / base;
  let fraction = fractionDigits > 0 ? (scaled % base).toString().padStart(fractionDigits, "0") : "";
  if (trim) fraction = fraction.replace(/0+$/, "");
  const wholeStr = group ? groupThousands(whole.toString()) : whole.toString();
  return fraction ? `${wholeStr}.${fraction}` : wholeStr;
}

export function formatUsd(r: Ratio | null | undefined): string {
  if (!r) return "";
  if (r.num === 0n) return "$0.00";
  if (ratioCompare(r, { num: 1n, den: 100n }) < 0) return "<$0.01";
  return `$${formatRatio(r, 2)}`;
}

/**
 * Unit price: cents from $1 up, otherwise three significant digits, so
 * low-priced tokens read as $0.0000108 rather than <$0.01.
 */
export function formatUsdPrice(r: Ratio | null | undefined): string {
  if (!r) return "";
  if (r.num === 0n) return "$0.00";
  if (ratioCompare(r, { num: 1n, den: 1n }) >= 0) return `$${formatRatio(r, 2)}`;
  return `$${formatRatioSignificant(r, 3)}`;
}

/** Ratio rendered with a sensible number of significant digits (rates, prices). */
export function formatRatioSignificant(r: Ratio, significant = 6): string {
  if (r.num === 0n) return "0";
  const whole = r.num / r.den;
  if (whole >= 1n) {
    const wholeDigits = whole.toString().length;
    return formatRatio(r, Math.max(0, significant - wholeDigits), { trim: true });
  }
  // Find the first significant fraction digit.
  let digits = 0;
  let probe = r.num * 10n;
  while (probe < r.den && digits < 40) {
    probe *= 10n;
    digits += 1;
  }
  return formatRatio(r, digits + significant, { group: false, trim: true });
}

/** Percentage string from basis points without floating point drift ("4.45%"). */
export function formatBps(bps: bigint | number, fractionDigits = 2): string {
  const b = BigInt(bps);
  const negative = b < 0n;
  const abs = negative ? -b : b;
  return `${negative ? "-" : ""}${formatRatio({ num: abs, den: 100n }, fractionDigits)}%`;
}
