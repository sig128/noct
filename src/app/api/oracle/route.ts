import { NextResponse, type NextRequest } from "next/server";
import { badRequest, errorResponse, rateLimit } from "@/lib/server/guard";
import { serverEnv } from "@/lib/server/env";
import { parseWith, upstreamJson, UpstreamError } from "@/lib/server/http";
import { hermesResponseSchema } from "@/lib/oracle/pyth";
import { feedForMint } from "@/lib/oracle/feeds";
import { TtlCache } from "@/lib/server/cache";

export const dynamic = "force-dynamic";

const cache = new TtlCache<unknown>(3_000);

/**
 * Independent Pyth prices for mints with a verified feed mapping. Hermes
 * requires an API key since the 2026-08-26 Pyth Core upgrade; without one the
 * route reports that the oracle is not configured rather than guessing.
 */
export async function GET(req: NextRequest) {
  const limited = rateLimit(req, "read");
  if (limited) return limited;
  const env = serverEnv();
  if (!env.PYTH_API_KEY) {
    return NextResponse.json({ error: "not_configured", message: "Independent oracle prices need PYTH_API_KEY on the server." }, { status: 503 });
  }
  const mints = (req.nextUrl.searchParams.get("mints") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (mints.length === 0 || mints.length > 12) return badRequest("mints must list 1–12 mints");
  const feeds = mints.map((m) => ({ mint: m, feed: feedForMint(m) })).filter((x) => x.feed);
  if (feeds.length === 0) return NextResponse.json({ prices: {}, unmapped: mints });
  const query = feeds.map((f) => `ids[]=${f.feed!.feedId}`).join("&");
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
      const entry = byFeed.get(f.feed!.feedId);
      if (entry) prices[f.mint] = { feedId: f.feed!.feedId, symbol: f.feed!.symbol, price: entry.price };
    }
    return NextResponse.json({ prices, unmapped: mints.filter((m) => !feedForMint(m)), fetchedAt: Date.now() });
  } catch (error) {
    return errorResponse(error);
  }
}
