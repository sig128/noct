import { describe, expect, it } from "vitest";
import { assertNoSilentDowngrade, PrivacyDowngradeError, PROFILES, resolvePrivacyMode } from "@/lib/privacy/model";
import { buildLedger, ReservationBook, ReservationError } from "@/lib/balances/ledger";
import { tokenCapabilities } from "@/lib/capabilities";
import { NATIVE_SOL_MINT, USDC_MINT } from "@/lib/tokens/types";

describe("no silent privacy downgrade", () => {
  it("a weaker available mode requires an explicit choice", () => {
    const r = resolvePrivacyMode("confidential_transfer", PROFILES.privateWithdrawal, "Recipient is not registered");
    expect(r.kind).toBe("downgrade_requires_choice");
  });
  it("signing a weaker operation without the choice throws; with it, passes", () => {
    expect(() => assertNoSilentDowngrade("confidential_transfer", "public", null)).toThrow(PrivacyDowngradeError);
    expect(() => assertNoSilentDowngrade("confidential_transfer", "public", "public")).not.toThrow();
    expect(() => assertNoSilentDowngrade("public", "public", null)).not.toThrow();
  });
  it("an unavailable mode is reported as unavailable, not substituted", () => {
    expect(resolvePrivacyMode("anonymous_transfer", null, "No Custom Ring").kind).toBe("unavailable");
  });
  it("profiles state what is hidden per operation", () => {
    expect(PROFILES.privateTransfer).toMatchObject({ sender: "public", recipient: "public", asset: "hidden", amount: "hidden" });
    expect(PROFILES.privateWithdrawal).toMatchObject({ privacyClass: "public", amount: "public", recipient: "public" });
    expect(PROFILES.publicSwap.privacyClass).toBe("public");
    for (const p of Object.values(PROFILES)) expect(p.summary).not.toMatch(/untraceable|anonymous|zero trace/i);
  });
});

describe("one account, no double counting", () => {
  const ledger = buildLedger({
    publicTokens: [
      { mint: USDC_MINT, amount: 1_000n },
      { mint: "jlUSDCmint", amount: 935n }, // receipt token in the wallet
    ],
    privateBalances: [{ mint: USDC_MINT, amount: 640n }],
    pendingOutbound: [{ mint: USDC_MINT, amount: 40n, source: "private" }],
    reservations: [{ operationId: "op1", mint: USDC_MINT, amount: 300n, source: "public" }],
    earnPositions: [{ receiptMint: "jlUSDCmint", assetMint: USDC_MINT, underlying: 1_000n, market: "Jupiter Lend" }],
    borrowPositions: [{ collateralMint: NATIVE_SOL_MINT, collateral: 2_000n, debtMint: USDC_MINT, debt: 250n, market: "vault 1" }],
  });
  it("represents a receipt token only as its supplied underlying", () => {
    expect(ledger.lines.some((l) => l.mint === "jlUSDCmint")).toBe(false);
    expect(ledger.byBucket("supplied")).toEqual([{ mint: USDC_MINT, bucket: "supplied", amount: 1_000n, source: "Jupiter Lend" }]);
  });
  it("subtracts reservations and pending outflows from what can be spent", () => {
    expect(ledger.spendable(USDC_MINT, "public")).toBe(700n);
    expect(ledger.spendable(USDC_MINT, "private")).toBe(600n);
  });
  it("nets debt against assets per mint", () => {
    expect(ledger.net(USDC_MINT)).toBe(1_000n + 640n + 1_000n - 250n);
    expect(ledger.net(NATIVE_SOL_MINT)).toBe(2_000n);
  });
  it("a reservation book refuses to promise the same funds twice", () => {
    const book = new ReservationBook();
    book.reserve({ operationId: "a", mint: USDC_MINT, amount: 600n, source: "public" }, 1_000n);
    expect(() => book.reserve({ operationId: "b", mint: USDC_MINT, amount: 500n, source: "public" }, 1_000n)).toThrow(ReservationError);
    book.release("a");
    expect(() => book.reserve({ operationId: "b", mint: USDC_MINT, amount: 500n, source: "public" }, 1_000n)).not.toThrow();
  });
});

describe("separate capability flags", () => {
  it("a tradable memecoin is not collateral, and a route is not privacy support", () => {
    const { capabilities } = tokenCapabilities({
      mint: "DemoMoth1111111111111111111111111111111111",
      route: "found",
      mintFacts: null,
      privacy: { enabled: false, reason: "No Helius key" },
      earnAssets: new Set([USDC_MINT]),
      collateralMints: new Set([NATIVE_SOL_MINT]),
      debtMints: new Set([USDC_MINT]),
    });
    const get = (k: string) => capabilities.find((c) => c.key === k)!.status;
    expect(get("publicRoute")).toBe("available");
    expect(get("privateHolding")).toBe("unavailable");
    expect(get("privateSwap")).toBe("unavailable");
    expect(get("borrowCollateral")).toBe("unavailable");
    expect(get("earnMarket")).toBe("unavailable");
  });
  it("permanent-delegate tokens are refused for private holding even when privacy is on", () => {
    const { capabilities } = tokenCapabilities({
      mint: "X",
      route: "unchecked",
      mintFacts: { program: "token2022", decimals: 6, supply: 0n, mintAuthority: null, freezeAuthority: null, extensions: [{ type: 12, name: "PermanentDelegate" }], transferFee: null, transferHookProgram: null, permanentDelegate: "D", defaultAccountStateFrozen: false, pausable: false, nonTransferable: false },
      privacy: { enabled: true, reason: null },
      earnAssets: new Set(),
      collateralMints: new Set(),
      debtMints: new Set(),
    });
    expect(capabilities.find((c) => c.key === "privateHolding")!.status).toBe("unavailable");
  });
});
