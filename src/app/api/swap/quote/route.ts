import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { badRequest, errorResponse, rateLimit } from "@/lib/server/guard";
import { fetchOrder } from "@/lib/server/jupiter";
import { UpstreamError } from "@/lib/server/http";

export const dynamic = "force-dynamic";

const addr = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const params = z.object({
  inputMint: addr,
  outputMint: addr,
  amount: z.string().regex(/^[1-9]\d{0,19}$/),
  slippageBps: z.coerce.number().int().min(1).max(5_000).optional(),
});

/** Public quote: no wallet address is sent, so no transaction is built. */
export async function GET(req: NextRequest) {
  const limited = rateLimit(req, "quote");
  if (limited) return limited;
  const parsed = params.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return badRequest("Invalid quote parameters");
  if (parsed.data.inputMint === parsed.data.outputMint) return badRequest("Choose two different tokens");
  try {
    const order = await fetchOrder(parsed.data, req.signal);
    return NextResponse.json({ order, receivedAt: Date.now() });
  } catch (error) {
    if (error instanceof UpstreamError && error.status === 400) {
      return NextResponse.json({ error: "no_route", message: error.message }, { status: 422 });
    }
    return errorResponse(error);
  }
}
