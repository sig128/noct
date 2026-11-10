import { describe, expect, it } from "vitest";
import { getAddressEncoder, address } from "@solana/kit";
import { activeTransferFee, extensionRestrictions, parseMintAccount, transferFeeFor, MintParseError } from "@/lib/tokens/mint-account";
import { SPL_TOKEN_PROGRAM, TOKEN_2022_PROGRAM, NATIVE_SOL_MINT } from "@/lib/tokens/types";
import { maxSpendable, netAfterTransferFee, presetAmount, DEFAULT_SOL_RESERVE_LAMPORTS, TOKEN_ACCOUNT_RENT_LAMPORTS } from "@/lib/swap/max";

const enc = getAddressEncoder();
const AUTH = address("BJE5MMbqXjVwjAF7oxwPYXnTXDyspzZyt4vwenNw5ruG");
const HOOK = address("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");

function baseMint(decimals: number, opts: { mintAuth?: boolean; freezeAuth?: boolean } = {}): Uint8Array {
  const b = new Uint8Array(82);
  const v = new DataView(b.buffer);
  if (opts.mintAuth) {
    v.setUint32(0, 1, true);
    b.set(enc.encode(AUTH), 4);
  }
  v.setBigUint64(36, 1_000_000n, true);
  b[44] = decimals;
  b[45] = 1;
  if (opts.freezeAuth) {
    v.setUint32(46, 1, true);
    b.set(enc.encode(AUTH), 50);
  }
  return b;
}

function tlv(type: number, value: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + value.length);
  const v = new DataView(out.buffer);
  v.setUint16(0, type, true);
  v.setUint16(2, value.length, true);
  out.set(value, 4);
  return out;
}

function token2022(decimals: number, exts: Uint8Array[]): Uint8Array {
  const head = new Uint8Array(166);
  head.set(baseMint(decimals));
  head[165] = 1; // AccountType::Mint
  const total = exts.reduce((a, e) => a + e.length, 0);
  const out = new Uint8Array(166 + total);
  out.set(head);
  let o = 166;
  for (const e of exts) {
    out.set(e, o);
    o += e.length;
  }
  return out;
}

function transferFeeExt(older: [bigint, bigint, number], newer: [bigint, bigint, number]): Uint8Array {
  const v = new Uint8Array(108);
  const dv = new DataView(v.buffer);
  dv.setBigUint64(72, older[0], true);
  dv.setBigUint64(80, older[1], true);
  dv.setUint16(88, older[2], true);
  dv.setBigUint64(90, newer[0], true);
  dv.setBigUint64(98, newer[1], true);
  dv.setUint16(106, newer[2], true);
  return tlv(1, v);
}

describe("mint account inspection", () => {
  it("reads an SPL mint's authorities and decimals", () => {
    const f = parseMintAccount(baseMint(6, { mintAuth: true, freezeAuth: true }), SPL_TOKEN_PROGRAM);
    expect(f.program).toBe("spl");
    expect(f.decimals).toBe(6);
    expect(f.mintAuthority).toBe(AUTH);
    expect(f.freezeAuthority).toBe(AUTH);
    expect(f.extensions).toHaveLength(0);
  });

  it("parses Token-2022 transfer fee, hook, permanent delegate, pausable and default-frozen", () => {
    const hook = new Uint8Array(64);
    hook.set(enc.encode(HOOK), 32);
    const delegate = enc.encode(AUTH) as Uint8Array;
    const data = token2022(9, [transferFeeExt([0n, 5_000n, 100], [900n, 1_000n, 250]), tlv(14, hook), tlv(12, new Uint8Array(delegate)), tlv(26, new Uint8Array(65)), tlv(6, new Uint8Array([2]))]);
    const f = parseMintAccount(data, TOKEN_2022_PROGRAM);
    expect(f.program).toBe("token2022");
    expect(f.transferHookProgram).toBe(HOOK);
    expect(f.permanentDelegate).toBe(AUTH);
    expect(f.pausable).toBe(true);
    expect(f.defaultAccountStateFrozen).toBe(true);
    const codes = extensionRestrictions(f).map((r) => r.code);
    expect(codes).toEqual(expect.arrayContaining(["permanent_delegate", "transfer_hook", "pausable", "default_frozen", "transfer_fee"]));
  });

  it("selects the fee schedule by epoch and caps the fee", () => {
    const f = parseMintAccount(token2022(6, [transferFeeExt([0n, 5_000n, 100], [900n, 1_000n, 250])]), TOKEN_2022_PROGRAM);
    const older = activeTransferFee(f, 899n)!;
    const newer = activeTransferFee(f, 900n)!;
    expect(older.basisPoints).toBe(100);
    expect(newer.basisPoints).toBe(250);
    expect(transferFeeFor(100_000n, older)).toBe(1_000n);
    expect(transferFeeFor(10_000_000n, older)).toBe(5_000n); // capped
    expect(transferFeeFor(1n, newer)).toBe(1n); // rounds up
    expect(netAfterTransferFee(100_000n, newer)).toEqual({ net: 99_000n, withheld: 1_000n });
  });

  it("blocks non-transferable tokens", () => {
    const f = parseMintAccount(token2022(0, [tlv(9, new Uint8Array())]), TOKEN_2022_PROGRAM);
    expect(extensionRestrictions(f).find((r) => r.code === "non_transferable")?.severity).toBe("block");
  });

  it("refuses accounts that are not mints", () => {
    expect(() => parseMintAccount(baseMint(6), "11111111111111111111111111111111")).toThrow(MintParseError);
    expect(() => parseMintAccount(new Uint8Array(10), SPL_TOKEN_PROGRAM)).toThrow(MintParseError);
  });
});

describe("MAX spend", () => {
  it("keeps SOL for fees, rent and a reserve", () => {
    const r = maxSpendable({ balance: 1_000_000_000n, isNativeSol: true, networkFeeLamports: 50_000n, rentLamports: TOKEN_ACCOUNT_RENT_LAMPORTS });
    expect(r.amount).toBe(1_000_000_000n - 50_000n - TOKEN_ACCOUNT_RENT_LAMPORTS - DEFAULT_SOL_RESERVE_LAMPORTS);
  });
  it("never goes negative", () => {
    expect(maxSpendable({ balance: 1_000n, isNativeSol: true, networkFeeLamports: 5_000n, rentLamports: 0n }).amount).toBe(0n);
  });
  it("solves for an input-side fee so amount + fee ≤ balance", () => {
    const r = maxSpendable({ balance: 1_000_000n, isNativeSol: false, networkFeeLamports: 0n, rentLamports: 0n, inputFeeBps: 30 });
    expect(r.amount + (r.amount * 30n + 9_999n) / 10_000n).toBeLessThanOrEqual(1_000_000n);
    expect(r.amount + 1n + ((r.amount + 1n) * 30n + 9_999n) / 10_000n).toBeGreaterThan(1_000_000n);
  });
  it("spends a full token balance when there is no input fee", () => {
    expect(maxSpendable({ balance: 123n, isNativeSol: false, networkFeeLamports: 5_000n, rentLamports: 0n }).amount).toBe(123n);
  });
  it("presets round down", () => {
    expect(presetAmount(101n, 50)).toBe(50n);
    expect(presetAmount(NATIVE_SOL_MINT.length > 0 ? 3n : 0n, 25)).toBe(0n);
  });
});
