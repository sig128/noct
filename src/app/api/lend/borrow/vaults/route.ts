import { NextResponse, type NextRequest } from "next/server";
import { errorResponse, rateLimit } from "@/lib/server/guard";
import { fetchVaults } from "@/lib/server/jupiter";
import { TtlCache } from "@/lib/server/cache";

export const dynamic = "force-dynamic";

const cache = new TtlCache<{ vaults: unknown; fetchedAt: number }>(20_000, 4);

export async function GET(req: NextRequest) {
  const limited = rateLimit(req, "read");
  if (limited) return limited;
  try {
    const hit = cache.get("main");
    if (hit) return NextResponse.json(hit);
    const payload = { vaults: await fetchVaults(), fetchedAt: Date.now() };
    cache.set("main", payload);
    return NextResponse.json(payload);
  } catch (error) {
    return errorResponse(error);
  }
}
