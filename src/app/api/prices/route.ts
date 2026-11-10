import { NextResponse, type NextRequest } from "next/server";
import { badRequest, errorResponse, rateLimit } from "@/lib/server/guard";
import { fetchPrices } from "@/lib/server/jupiter";
import { TtlCache } from "@/lib/server/cache";
import { isLikelySolanaAddress } from "@/lib/tokens/sanitize";

export const dynamic = "force-dynamic";

const cache = new TtlCache<Record<string, { usdPrice: string; blockId: number | null }>>(10_000);

export async function GET(req: NextRequest) {
  const limited = rateLimit(req, "read");
  if (limited) return limited;
  const ids = (req.nextUrl.searchParams.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0 || ids.length > 50 || !ids.every(isLikelySolanaAddress)) return badRequest("ids must be 1–50 mint addresses");
  const key = [...new Set(ids)].sort().join(",");
  try {
    const prices = cache.get(key) ?? (await fetchPrices(key.split(",")));
    cache.set(key, prices);
    return NextResponse.json({ prices, fetchedAt: Date.now() });
  } catch (error) {
    return errorResponse(error);
  }
}
