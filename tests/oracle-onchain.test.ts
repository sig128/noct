import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { parsePriceUpdateV2, PRICE_UPDATE_V2_DISCRIMINATOR, pushFeedAccount } from "@/lib/oracle/onchain";

const SOL_USD = "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";
const BTC_USD = "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43";

function account(feedHex: string, opts: { full?: boolean; price?: bigint; conf?: bigint; expo?: number; publish?: bigint } = {}): Uint8Array {
  const full = opts.full ?? true;
  const head = 8 + 32 + (full ? 1 : 2);
  const buf = new Uint8Array(head + 84 + 8);
  buf.set(PRICE_UPDATE_V2_DISCRIMINATOR, 0);
  buf[40] = full ? 1 : 0;
  if (!full) buf[41] = 5;
  buf.set(Uint8Array.from(feedHex.match(/../g)!.map((b) => parseInt(b, 16))), head);
  const v = new DataView(buf.buffer);
  let o = head + 32;
  v.setBigInt64(o, opts.price ?? 16_543_210_000n, true);
  v.setBigUint64(o + 8, opts.conf ?? 7_500_000n, true);
  v.setInt32(o + 16, opts.expo ?? -8, true);
  v.setBigInt64(o + 20, opts.publish ?? 1_794_340_000n, true);
  return buf;
}

describe("Pyth prices read from Solana without an API key", () => {
  it("derives the published push feed accounts", async () => {
    expect(await pushFeedAccount(BTC_USD)).toBe("4cSM2e6rvbGQUFiJbqytoVMi5GgghSMr8LwVrT9VPSPo");
    expect(await pushFeedAccount(SOL_USD)).toBe("7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE");
  });

  it("uses the Anchor discriminator of PriceUpdateV2", () => {
    const expected = createHash("sha256").update("account:PriceUpdateV2").digest().subarray(0, 8);
    expect(Array.from(PRICE_UPDATE_V2_DISCRIMINATOR)).toEqual(Array.from(expected));
  });

  it("parses a fully verified update for the expected feed", () => {
    expect(parsePriceUpdateV2(account(SOL_USD), SOL_USD)).toEqual({ price: "16543210000", conf: "7500000", expo: -8, publish_time: 1_794_340_000, verification: "full" });
  });

  it("reports partial verification so callers can refuse it", () => {
    expect(parsePriceUpdateV2(account(SOL_USD, { full: false }), SOL_USD)?.verification).toBe("partial");
  });

  it("rejects another feed, a foreign account type and truncated data", () => {
    expect(parsePriceUpdateV2(account(BTC_USD), SOL_USD)).toBeNull();
    const wrong = account(SOL_USD);
    wrong[0] = 0;
    expect(parsePriceUpdateV2(wrong, SOL_USD)).toBeNull();
    expect(parsePriceUpdateV2(account(SOL_USD).subarray(0, 90), SOL_USD)).toBeNull();
  });
});
