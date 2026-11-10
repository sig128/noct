import { NextResponse, type NextRequest } from "next/server";
import { errorResponse, rateLimit } from "@/lib/server/guard";
import { fetchEarnTokens } from "@/lib/server/jupiter";
import { TtlCache } from "@/lib/server/cache";

export const dynamic = "force-dynamic";

const cache = new TtlCache<{ markets: unknown; fetchedAt: number }>(30_000, 4);

export async function GET(req: NextRequest) {
  const limited = rateLimit(req, "read");
  if (limited) return limited;
  try {
    const hit = cache.get("all");
    if (hit) return NextResponse.json(hit);
    const markets = await fetchEarnTokens();
    const payload = { markets, fetchedAt: Date.now() };
    cache.set("all", payload);
    return NextResponse.json(payload);
  } catch (error) {
    return errorResponse(error);
  }
}
