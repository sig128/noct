import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { badRequest, errorResponse, rateLimit, readJsonBody, sameOriginGuard } from "@/lib/server/guard";
import { submitDeposit } from "@/lib/server/intents";

export const dynamic = "force-dynamic";

const body = z.object({ depositAddress: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/), txHash: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,90}$/) });

export async function POST(req: NextRequest) {
  const blocked = sameOriginGuard(req) ?? rateLimit(req, "read");
  if (blocked) return blocked;
  try {
    const parsed = body.safeParse(await readJsonBody(req, 2_000));
    if (!parsed.success) return badRequest("Invalid deposit report");
    await submitDeposit(parsed.data.depositAddress, parsed.data.txHash);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
