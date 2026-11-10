import { NextResponse, type NextRequest } from "next/server";
import { errorResponse, badRequest, rateLimit } from "@/lib/server/guard";
import { searchTokens } from "@/lib/server/jupiter";
import { TtlCache, Inflight } from "@/lib/server/cache";
import type { TokenInfo } from "@/lib/tokens/types";
import { isLikelySolanaAddress } from "@/lib/tokens/sanitize";

export const dynamic = "force-dynamic";

const cache = new TtlCache<TokenInfo[]>(30_000);
const inflight = new Inflight<TokenInfo[]>();

export async function GET(req: NextRequest) {
  const limited = rateLimit(req, "read");
  if (limited) return limited;
  const raw = (req.nextUrl.searchParams.get("q") ?? "").trim();
  const ids = (req.nextUrl.searchParams.get("ids") ?? "").trim();
  let query: string;
  if (ids) {
    const mints = ids.split(",").map((s) => s.trim()).filter(Boolean);
    if (mints.length === 0 || mints.length > 50 || !mints.every(isLikelySolanaAddress)) return badRequest("ids must be 1–50 mint addresses");
    query = [...new Set(mints)].sort().join(",");
  } else {
    if (raw.length < 1 || raw.length > 64) return badRequest("q must be 1–64 characters");
    if (/[^\p{L}\p{N}\s._$-]/u.test(raw)) return badRequest("q contains unsupported characters");
    query = raw;
  }
  const key = query.toLowerCase();
  try {
    const hit = cache.get(key);
    const tokens = hit ?? (await inflight.run(key, () => searchTokens(query, req.signal)));
    if (!hit) cache.set(key, tokens);
    return NextResponse.json({ tokens, query: ids ? "mints" : query, fetchedAt: Date.now() });
  } catch (error) {
    return errorResponse(error);
  }
}
