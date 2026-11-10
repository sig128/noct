import { NextResponse, type NextRequest } from "next/server";
import { badRequest, errorResponse, rateLimit } from "@/lib/server/guard";
import { rpcUrl, serverEnv } from "@/lib/server/env";
import { z } from "zod";
import { parsePriceUpdateV2, pushFeedAccount, PYTH_PUSH_ORACLE_PROGRAM, PYTH_RECEIVER_PROGRAM } from "@/lib/oracle/onchain";
import { parseWith, upstreamJson, UpstreamError } from "@/lib/server/http";
import { hermesResponseSchema } from "@/lib/oracle/pyth";
import { feedForMint } from "@/lib/oracle/feeds";
import { TtlCache } from "@/lib/server/cache";

export const dynamic = "force-dynamic";

const cache = new TtlCache<unknown>(3_000);

const accountsSchema = z.object({
  result: z.object({
    value: z.array(z.union([z.null(), z.object({ owner: z.string(), data: z.tuple([z.string().max(4_000), z.literal("base64")]) })])).max(16),
  }),
});

type Feed = { mint: string; feed: { feedId: string; symbol: string } };

/**
 * Pyth's push feed accounts on Solana, read through this deployment's RPC.
 * Needs no Pyth API key. Only fully verified updates are used.
 */
async function onchainPrices(feeds: Feed[]): Promise<Record<string, unknown>> {
  const accounts = await Promise.all(feeds.map((f) => pushFeedAccount(f.feed.feedId)));
  const res = await upstreamJson(rpcUrl("mainnet"), {
    service: "solana-rpc",
    method: "POST",
    body: { jsonrpc: "2.0", id: 1, method: "getMultipleAccounts", params: [accounts, { encoding: "base64", commitment: "confirmed" }] },
    timeoutMs: 5_000,
  });
  if (res.status !== 200) throw new UpstreamError("status", "solana-rpc", `RPC returned ${res.status}`, res.status);
  const parsed = parseWith(accountsSchema, res.data, "solana-rpc");
  const prices: Record<string, unknown> = {};
  parsed.result.value.forEach((account, i) => {
    const f = feeds[i]!;
    if (!account || (account.owner !== PYTH_RECEIVER_PROGRAM && account.owner !== PYTH_PUSH_ORACLE_PROGRAM)) return;
    const update = parsePriceUpdateV2(Uint8Array.from(Buffer.from(account.data[0], "base64")), f.feed.feedId);
    if (!update || update.verification !== "full") return;
    prices[f.mint] = {
      feedId: f.feed.feedId,
      symbol: f.feed.symbol,
      source: "pyth-onchain",
      price: { price: update.price, conf: update.conf, expo: update.expo, publish_time: update.publish_time },
    };
  });
  return prices;
}

/**
 * Independent Pyth prices for mints with a verified feed mapping: from Hermes
 * when PYTH_API_KEY is set (Hermes requires a key since 2026-08-26), otherwise
 * from Pyth's push feed accounts on Solana, which need no Pyth key.
 */
export async function GET(req: NextRequest) {
  const limited = rateLimit(req, "read");
  if (limited) return limited;
  const env = serverEnv();
  const mints = (req.nextUrl.searchParams.get("mints") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (mints.length === 0 || mints.length > 12) return badRequest("mints must list 1–12 mints");
  const feeds = mints.map((m) => ({ mint: m, feed: feedForMint(m) })).filter((x): x is Feed => x.feed !== null);
  if (feeds.length === 0) return NextResponse.json({ prices: {}, unmapped: mints });
  if (!env.PYTH_API_KEY) {
    try {
      const key = `onchain:${feeds.map((f) => f.feed.feedId).join(",")}`;
      let prices = cache.get(key) as Record<string, unknown> | undefined;
      if (!prices) {
        prices = await onchainPrices(feeds);
        cache.set(key, prices);
      }
      return NextResponse.json({ prices, unmapped: mints.filter((m) => !feedForMint(m)), fetchedAt: Date.now(), source: "pyth-onchain" });
    } catch (error) {
      return errorResponse(error);
    }
  }
  const query = feeds.map((f) => `ids[]=${f.feed.feedId}`).join("&");
  const key = query;
  try {
    let data = cache.get(key);
    if (!data) {
      const res = await upstreamJson(`${env.PYTH_HERMES_BASE.replace(/\/+$/, "")}/v2/updates/price/latest?${query}&parsed=true`, {
        service: "pyth-hermes",
        headers: { authorization: `Bearer ${env.PYTH_API_KEY}` },
        timeoutMs: 4_000,
        retries: 1,
      });
      if (res.status !== 200) throw new UpstreamError("status", "pyth-hermes", `Hermes returned ${res.status}`, res.status);
      data = res.data;
      cache.set(key, data);
    }
    const parsed = parseWith(hermesResponseSchema, data, "pyth-hermes");
    const byFeed = new Map((parsed.parsed ?? []).map((p) => [p.id.replace(/^0x/, "").toLowerCase(), p]));
    const prices: Record<string, unknown> = {};
    for (const f of feeds) {
      const entry = byFeed.get(f.feed.feedId);
      if (entry) prices[f.mint] = { feedId: f.feed.feedId, symbol: f.feed.symbol, source: "pyth-hermes", price: entry.price };
    }
    return NextResponse.json({ prices, unmapped: mints.filter((m) => !feedForMint(m)), fetchedAt: Date.now() });
  } catch (error) {
    return errorResponse(error);
  }
}
