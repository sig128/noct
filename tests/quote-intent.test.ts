import { describe, expect, it } from "vitest";
import { orderResponseSchema } from "@/lib/swap/jupiter-schema";
import { buildSwapIntent, isQuoteStale, normalizeOrder, QuoteNormalizeError, verifyOrderMatchesIntent, QUOTE_TTL_MS } from "@/lib/swap/quote";
import { LatestRequestTracker, quoteKey } from "@/lib/swap/quote-tracker";
import { approveIntent, assertApprovalValid, describeIntentChanges, ApprovalError, freezeIntent } from "@/lib/operations/intent";
import { NATIVE_SOL_MINT, USDC_MINT } from "@/lib/tokens/types";

const TAKER = "Demo4dd7ess111111111111111111111111111111";

/** Shape per developers.jup.ag/docs/api-reference/swap/order (2026-11-10). */
const order = {
  mode: "ultra",
  inputMint: NATIVE_SOL_MINT,
  outputMint: USDC_MINT,
  inAmount: "100000000",
  outAmount: "8180000",
  otherAmountThreshold: "8139100",
  swapMode: "ExactIn",
  slippageBps: 50,
  priceImpact: -0.02,
  routePlan: [{ swapInfo: { ammKey: "8sLbNZoA1cfnvMJLPfp98ZLAnFSYCFApfJKMbiXNLwxj", label: "Raydium CLMM", inputMint: NATIVE_SOL_MINT, outputMint: USDC_MINT, inAmount: "100000000", outAmount: "8180000" }, percent: 100, bps: 10000 }],
  feeBps: 10,
  feeMint: USDC_MINT,
  platformFee: { amount: "8180", feeBps: 10, feeMint: USDC_MINT },
  signatureFeeLamports: 5000,
  prioritizationFeeLamports: 41000,
  rentFeeLamports: 0,
  router: "metis",
  transactionVersion: 0,
  transaction: null,
  lastValidBlockHeight: "372000000",
  requestId: "req-1",
  taker: null,
};

describe("Jupiter order normalisation", () => {
  it("accepts the documented shape and keeps amounts as integers", () => {
    const q = normalizeOrder(orderResponseSchema.parse(order), 1000);
    expect(q.inAmount).toBe(100_000_000n);
    expect(q.minOut).toBe(8_139_100n);
    expect(q.prioritizationFeeLamports).toBe(41_000n);
    expect(q.lastValidBlockHeight).toBe(372_000_000n);
    expect(q.route[0]!.label).toBe("Raydium CLMM");
  });
  it("rejects a minimum above the expected output", () => {
    expect(() => normalizeOrder(orderResponseSchema.parse({ ...order, otherAmountThreshold: "9000000" }))).toThrow(QuoteNormalizeError);
  });
  it("rejects non-integer amounts and malformed mints at the schema", () => {
    expect(orderResponseSchema.safeParse({ ...order, inAmount: "1.5" }).success).toBe(false);
    expect(orderResponseSchema.safeParse({ ...order, inputMint: "not-a-mint" }).success).toBe(false);
  });
  it("marks quotes stale after the TTL or an RFQ expiry", () => {
    const q = normalizeOrder(orderResponseSchema.parse(order), 1_000);
    expect(isQuoteStale(q, 1_000 + QUOTE_TTL_MS - 1)).toBe(false);
    expect(isQuoteStale(q, 1_000 + QUOTE_TTL_MS)).toBe(true);
    const rfq = normalizeOrder(orderResponseSchema.parse({ ...order, router: "jupiterz", expireAt: new Date(5_000).toISOString() }), 1_000);
    expect(isQuoteStale(rfq, 5_000)).toBe(true);
  });
});

describe("stale quote cancellation and races", () => {
  it("only the latest request may apply, even if an older one resolves later", async () => {
    const tracker = new LatestRequestTracker<string>();
    const a = tracker.begin("1 SOL");
    const b = tracker.begin("2 SOL");
    expect(a.signal.aborted).toBe(true);
    expect(tracker.isCurrent(a.id)).toBe(false);
    expect(tracker.isCurrent(b.id, "2 SOL")).toBe(true);
    tracker.cancel();
    expect(tracker.isCurrent(b.id)).toBe(false);
    expect(b.signal.aborted).toBe(true);
  });
  it("reversing the pair changes the quote key", () => {
    const k1 = quoteKey({ inputMint: NATIVE_SOL_MINT, outputMint: USDC_MINT, amount: 1n, slippageBps: null, network: "mainnet" });
    const k2 = quoteKey({ inputMint: USDC_MINT, outputMint: NATIVE_SOL_MINT, amount: 1n, slippageBps: null, network: "mainnet" });
    expect(k1).not.toBe(k2);
  });
});

describe("intent binding and approval", () => {
  const quote = normalizeOrder(orderResponseSchema.parse({ ...order, transaction: "AQ==", taker: TAKER }));
  const intent = freezeIntent(buildSwapIntent(quote, { operationId: "op-1", network: "mainnet", signer: TAKER, inputDecimals: 9, outputDecimals: 6, expiresAt: Date.now() + 20_000 }));

  it("binds network, mints, input, net minimum, fees, route policy, programs and recipient", () => {
    expect(intent).toMatchObject({ network: "mainnet", inputMint: NATIVE_SOL_MINT, outputMint: USDC_MINT, maxInput: 100_000_000n, minNetOutput: 8_139_100n, feeBps: 10, router: "metis", recipient: TAKER, signer: TAKER });
    expect(intent.allowedPrograms).toContain("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");
    expect(Object.isFrozen(intent)).toBe(true);
  });

  it("a changed fee, amount, recipient, route policy or minimum voids the approval", async () => {
    const approval = await approveIntent(intent);
    await expect(assertApprovalValid(intent, approval)).resolves.toBeUndefined();
    for (const change of [{ feeBps: 20 }, { maxInput: 100_000_001n }, { recipient: "Demo1ook11111111111111111111111111111111111" }, { allowedRouters: ["metis", "okx"] }, { minNetOutput: 8_000_000n }]) {
      const changed = { ...intent, ...change };
      await expect(assertApprovalValid(changed, approval)).rejects.toBeInstanceOf(ApprovalError);
      expect(describeIntentChanges(intent, changed).length).toBe(1);
    }
  });

  it("expired terms cannot be approved or used", async () => {
    const expired = { ...intent, expiresAt: Date.now() - 1 };
    await expect(approveIntent(expired)).rejects.toMatchObject({ code: "expired" });
    const approval = await approveIntent(intent);
    await expect(assertApprovalValid(intent, approval, intent.expiresAt + 1)).rejects.toMatchObject({ code: "expired" });
  });

  it("an assembled order must still satisfy the approved intent", () => {
    expect(verifyOrderMatchesIntent(quote, intent).ok).toBe(true);
    expect(verifyOrderMatchesIntent({ ...quote, minOut: quote.minOut - 1n }, intent).problems).toContain("The minimum you receive dropped.");
    expect(verifyOrderMatchesIntent({ ...quote, feeBps: 25 }, intent).problems).toContain("The provider fee increased.");
    expect(verifyOrderMatchesIntent({ ...quote, router: "okx" }, intent).problems.join(" ")).toMatch(/not allowed/);
    expect(verifyOrderMatchesIntent({ ...quote, inAmount: 1n }, intent).problems).toContain("The amount you pay changed.");
    expect(verifyOrderMatchesIntent({ ...quote, prioritizationFeeLamports: 999_999n }, intent).problems).toContain("The network fee increased.");
  });
});
