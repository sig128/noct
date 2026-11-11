import { NextResponse, type NextRequest } from "next/server";
import { badRequest, errorResponse, rateLimit } from "@/lib/server/guard";
import { fundingStatus } from "@/lib/server/intents";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const limited = rateLimit(req, "read");
  if (limited) return limited;
  const depositAddress = req.nextUrl.searchParams.get("depositAddress") ?? "";
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(depositAddress)) return badRequest("Invalid deposit address");
  try {
    return NextResponse.json(await fundingStatus(depositAddress));
  } catch (error) {
    return errorResponse(error);
  }
}
