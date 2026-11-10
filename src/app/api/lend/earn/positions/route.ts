import { NextResponse, type NextRequest } from "next/server";
import { badRequest, errorResponse, rateLimit } from "@/lib/server/guard";
import { fetchEarnPositions } from "@/lib/server/jupiter";
import { isLikelySolanaAddress } from "@/lib/tokens/sanitize";

export const dynamic = "force-dynamic";

/** Public positions of one wallet. Not cached: it is user-specific. */
export async function GET(req: NextRequest) {
  const limited = rateLimit(req, "read");
  if (limited) return limited;
  const user = req.nextUrl.searchParams.get("user") ?? "";
  if (!isLikelySolanaAddress(user)) return badRequest("user must be a wallet address");
  try {
    return NextResponse.json({ positions: await fetchEarnPositions(user), fetchedAt: Date.now() });
  } catch (error) {
    return errorResponse(error);
  }
}
