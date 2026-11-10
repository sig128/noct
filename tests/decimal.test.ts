import { describe, expect, it } from "vitest";
import {
  bpsOfCeil,
  bpsOfFloor,
  formatAmount,
  formatBps,
  formatRatioSignificant,
  formatUnits,
  formatUsd,
  formatUsdPrice,
  minOutputAfterSlippage,
  mulDivCeil,
  mulDivFloor,
  normalizeAmountInput,
  parseBaseUnits,
  parseDecimalRatio,
  parseUnits,
  ratioFromNumber,
  valueOf,
} from "@/lib/decimal";

describe("base-unit round trips", () => {
  const cases: [string, number][] = [
    ["0", 0],
    ["1", 0],
    ["123456789", 0],
    ["1.5", 2],
    ["0.000001", 6],
    ["1234.56789", 6],
    ["0.000000001", 9],
    ["18446744073.709551615", 9],
    ["0.000000000001", 12],
    ["1.000000000000000001", 18],
    ["0.000000000000000000000001", 24],
  ];
  it.each(cases)("parse/format %s with %i decimals", (text, decimals) => {
    const parsed = parseUnits(text, decimals, { allowZero: true, max: 10n ** 40n });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(formatUnits(parsed.value, decimals)).toBe(text);
  });

  it("u64 max survives exactly at 9 decimals", () => {
    const r = parseUnits("18446744073.709551615", 9);
    expect(r.ok && r.value).toBe((1n << 64n) - 1n);
    expect(parseUnits("18446744073.709551616", 9)).toEqual({ ok: false, reason: "too_large" });
  });

  it("rejects more decimals than the token has, never rounds", () => {
    expect(parseUnits("1.0000001", 6)).toEqual({ ok: false, reason: "too_many_decimals" });
    expect(parseUnits("1.5", 0)).toEqual({ ok: false, reason: "too_many_decimals" });
  });

  it("rejects exponents, signs, separators and empty input", () => {
    for (const bad of ["1e3", "-1", "+1", "1,000", "0x10", "Infinity", "1 000", "1..2"]) {
      expect(parseUnits(bad, 6).ok).toBe(false);
    }
    expect(parseUnits("", 6)).toEqual({ ok: false, reason: "empty" });
    expect(parseUnits(".", 6)).toEqual({ ok: false, reason: "empty" });
    expect(parseUnits("0", 6)).toEqual({ ok: false, reason: "zero" });
  });

  it("accepts trailing and leading dots while typing", () => {
    expect(parseUnits("1.", 6)).toMatchObject({ ok: true, value: 1_000_000n });
    expect(parseUnits(".5", 6)).toMatchObject({ ok: true, value: 500_000n });
  });
});

describe("amount field editing", () => {
  it("keeps intermediate states", () => {
    expect(normalizeAmountInput("", 6)).toBe("");
    expect(normalizeAmountInput(".", 6)).toBe(".");
    expect(normalizeAmountInput("0.", 6)).toBe("0.");
    expect(normalizeAmountInput("0.0", 6)).toBe("0.0");
    expect(normalizeAmountInput("12.", 6)).toBe("12.");
  });
  it("rejects keystrokes beyond the token's precision", () => {
    expect(normalizeAmountInput("1.1234567", 6)).toBeNull();
    expect(normalizeAmountInput("1.", 0)).toBeNull();
    expect(normalizeAmountInput("1a", 6)).toBeNull();
    expect(normalizeAmountInput("1.2.3", 6)).toBeNull();
  });
  it("normalises commas, spaces and leading zeros", () => {
    expect(normalizeAmountInput("1,5", 6)).toBe("1.5");
    expect(normalizeAmountInput("1 000", 6)).toBe("1000");
    expect(normalizeAmountInput("007", 6)).toBe("7");
    expect(normalizeAmountInput("00.5", 6)).toBe("0.5");
  });
});

describe("display formatting", () => {
  it("never rounds up", () => {
    expect(formatAmount(1_999_999n, 6, { maxFraction: 2 })).toBe("1.99");
    expect(formatAmount(999_999_999n, 9, { maxFraction: 3 })).toBe("0.9999");
  });
  it("shows tiny amounts with significant digits, and a floor marker when empty", () => {
    expect(formatAmount(1n, 9)).toBe("0.000000001");
    expect(formatAmount(1_234n, 12, { smallSignificant: 3 })).toBe("0.00000000123");
    expect(formatAmount(1n, 18, { smallSignificant: 4 })).toMatch(/^0\.0+1$/);
  });
  it("groups large balances", () => {
    expect(formatAmount(123_456_789_000_000n, 6, { maxFraction: 2 })).toBe("123,456,789");
    expect(formatAmount(2_400_000_000_000n, 6)).toBe("2,400,000");
  });
});

describe("rounding helpers", () => {
  it("mulDiv floors and ceils correctly", () => {
    expect(mulDivFloor(10n, 3n, 4n)).toBe(7n);
    expect(mulDivCeil(10n, 3n, 4n)).toBe(8n);
    expect(mulDivCeil(8n, 1n, 4n)).toBe(2n);
    expect(mulDivCeil(0n, 5n, 3n)).toBe(0n);
  });
  it("fees charged to the user round up; credits round down", () => {
    expect(bpsOfCeil(1n, 30)).toBe(1n);
    expect(bpsOfFloor(1n, 30)).toBe(0n);
    expect(bpsOfCeil(10_000n, 30)).toBe(30n);
  });
  it("minimum output after slippage rounds down", () => {
    expect(minOutputAfterSlippage(1_000_001n, 50)).toBe(995_000n);
    expect(minOutputAfterSlippage(1n, 1)).toBe(0n);
    expect(() => minOutputAfterSlippage(100n, 10_001)).toThrow();
  });
  it("parses API integer strings strictly", () => {
    expect(parseBaseUnits("123")).toBe(123n);
    expect(parseBaseUnits("-1")).toBeNull();
    expect(parseBaseUnits("1.0")).toBeNull();
    expect(parseBaseUnits(1.5)).toBeNull();
  });
});

describe("prices as exact rationals", () => {
  it("parses decimal and exponent forms", () => {
    expect(parseDecimalRatio("81.8009")).toEqual({ num: 818009n, den: 10000n });
    expect(parseDecimalRatio("1e-7")).toEqual({ num: 1n, den: 10_000_000n });
    expect(ratioFromNumber(0.0000001083)).toEqual({ num: 1083n, den: 10_000_000_000n });
    expect(ratioFromNumber(-1)).toBeNull();
    expect(ratioFromNumber(Number.NaN)).toBeNull();
  });
  it("values a low-price memecoin balance without floating point drift", () => {
    const bonk = parseDecimalRatio("0.00001083")!;
    const v = valueOf(2_400_000_000_000n, 5, bonk); // 24,000,000 BONK
    expect(formatUsd(v)).toBe("$259.92");
  });
  it("formats tiny USD and bps", () => {
    expect(formatUsd({ num: 1n, den: 1000n })).toBe("<$0.01");
    expect(formatBps(445)).toBe("4.45%");
    expect(formatBps(5)).toBe("0.05%");
    expect(formatRatioSignificant({ num: 1n, den: 3n }, 4)).toBe("0.3333");
  });
});

describe("unit price formatting", () => {
  it("keeps cents from $1 up and significant digits below", () => {
    expect(formatUsdPrice(parseDecimalRatio("81.8"))).toBe("$81.80");
    expect(formatUsdPrice(parseDecimalRatio("0.4512"))).toBe("$0.451");
    expect(formatUsdPrice(parseDecimalRatio("0.00001083"))).toBe("$0.0000108");
    expect(formatUsdPrice(parseDecimalRatio("0"))).toBe("$0.00");
    expect(formatUsdPrice(null)).toBe("");
  });
});
