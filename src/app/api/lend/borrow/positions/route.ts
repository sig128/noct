import { NextResponse, type NextRequest } from "next/server";
import { badRequest, errorResponse, rateLimit } from "@/lib/server/guard";
import { fetchBorrowPositions } from "@/lib/server/jupiter";
import { isLikelySolanaAddress } from "@/lib/tokens/sanitize";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const limited = rateLimit(req, "read");
  if (limited) return limited;
  const user = req.nextUrl.searchParams.get("user") ?? "";
  if (!isLikelySolanaAddress(user)) return badRequest("user must be a wallet address");
  try {
    const positions = await fetchBorrowPositions(user);
    // The nested vault object is large and public; the client already has it.
    const slim = positions.map((p) => ({ id: p.id, vaultId: p.vaultId, supply: p.supply, borrow: p.borrow, dustBorrow: p.dustBorrow ?? null, isLiquidated: p.isLiquidated ?? false }));
    return NextResponse.json({ positions: slim, fetchedAt: Date.now() });
  } catch (error) {
    return errorResponse(error);
  }
}
