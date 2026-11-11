import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { badRequest, errorResponse, rateLimit, readJsonBody, sameOriginGuard } from "@/lib/server/guard";
import { quoteSolFunding } from "@/lib/server/intents";

export const dynamic = "force-dynamic";

const address = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const lamports = z.string().regex(/^[1-9]\d{0,17}$/);
const body = z.object({ recipient: address, refundTo: address, amount: lamports });

/** A dry quote (no deposit address): what a wallet would receive, and how long it takes. */
export async function GET(req: NextRequest) {
  const limited = rateLimit(req, "quote");
  if (limited) return limited;
  const parsed = body.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return badRequest("Invalid funding quote request");
  try {
    const result = await quoteSolFunding({ ...parsed.data, amount: BigInt(parsed.data.amount), dry: true });
    return NextResponse.json({ quote: result.quote });
  } catch (error) {
    return errorResponse(error);
  }
}

/** A live quote with a deposit address. Its signature is returned so the browser can keep it for disputes. */
export async function POST(req: NextRequest) {
  const blocked = sameOriginGuard(req) ?? rateLimit(req, "order");
  if (blocked) return blocked;
  try {
    const parsed = body.safeParse(await readJsonBody(req, 4_000));
    if (!parsed.success) return badRequest("Invalid funding quote request");
    const result = await quoteSolFunding({ ...parsed.data, amount: BigInt(parsed.data.amount), dry: false });
    return NextResponse.json({ quote: result.quote, signature: result.signature, correlationId: result.correlationId, timestamp: result.timestamp });
  } catch (error) {
    return errorResponse(error);
  }
}
