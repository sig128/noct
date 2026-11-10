import { address, getProgramDerivedAddress } from "@solana/kit";

/**
 * Pyth prices read straight from Solana, without a Pyth API key. Pyth keeps
 * "push" price feed accounts updated on chain for widely used feeds; each is a
 * PDA of the Pyth Push Oracle program with seeds [shard id (u16 LE), feed id].
 * The account holds a PriceUpdateV2 written by the Pyth Solana Receiver after
 * it verifies Wormhole guardian signatures.
 *
 * Verified 2026-11-10: the derivation reproduces the published BTC/USD
 * (4cSM2e6r…PSPo) and SOL/USD (7UVimffx…LiE) shard-0 accounts.
 */
export const PYTH_PUSH_ORACLE_PROGRAM = "pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT";
export const PYTH_RECEIVER_PROGRAM = "rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ";
/** First 8 bytes of sha256("account:PriceUpdateV2"). */
export const PRICE_UPDATE_V2_DISCRIMINATOR = Uint8Array.from([34, 241, 35, 99, 157, 126, 244, 205]);

export interface OnchainPythPrice {
  price: string;
  conf: string;
  expo: number;
  publish_time: number;
  /** Full: every required guardian signature was verified when posted. */
  verification: "full" | "partial";
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/, "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(clean)) throw new Error("Feed id must be 32 bytes of hex");
  return Uint8Array.from(clean.match(/../g)!.map((b) => parseInt(b, 16)));
}

/** The push feed account for a feed id (shard 0 by default). */
export async function pushFeedAccount(feedIdHex: string, shard = 0): Promise<string> {
  const seed = new Uint8Array([shard & 0xff, (shard >> 8) & 0xff]);
  const [pda] = await getProgramDerivedAddress({ programAddress: address(PYTH_PUSH_ORACLE_PROGRAM), seeds: [seed, hexToBytes(feedIdHex)] });
  return pda;
}

/**
 * Parses a PriceUpdateV2 account (Anchor, Borsh): discriminator, write
 * authority, verification level (Partial{u8} | Full), price message, posted
 * slot. Returns null unless the bytes are well formed and carry `expectedFeedId`.
 */
export function parsePriceUpdateV2(data: Uint8Array, expectedFeedIdHex: string): OnchainPythPrice | null {
  if (data.length < 8 + 32 + 1 + 84) return null;
  for (let i = 0; i < 8; i += 1) if (data[i] !== PRICE_UPDATE_V2_DISCRIMINATOR[i]) return null;
  let off = 8 + 32;
  const tag = data[off];
  let verification: OnchainPythPrice["verification"];
  if (tag === 0) {
    verification = "partial";
    off += 2;
  } else if (tag === 1) {
    verification = "full";
    off += 1;
  } else return null;
  if (data.length < off + 84) return null;
  const expected = hexToBytes(expectedFeedIdHex);
  for (let i = 0; i < 32; i += 1) if (data[off + i] !== expected[i]) return null;
  off += 32;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const price = view.getBigInt64(off, true);
  const conf = view.getBigUint64(off + 8, true);
  const expo = view.getInt32(off + 16, true);
  const publishTime = view.getBigInt64(off + 20, true);
  if (expo < -30 || expo > 30 || publishTime <= 0n) return null;
  return { price: price.toString(), conf: conf.toString(), expo, publish_time: Number(publishTime), verification };
}
