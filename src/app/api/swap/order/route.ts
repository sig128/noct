import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { badRequest, errorResponse, rateLimit, readJsonBody, sameOriginGuard } from "@/lib/server/guard";
import { fetchOrder } from "@/lib/server/jupiter";
import { UpstreamError } from "@/lib/server/http";
import { checkTransactionPolicy, inspectTransactionBase64 } from "@/lib/tx/inspect";
import { ROUTER_PROGRAMS } from "@/lib/tx/programs";

export const dynamic = "force-dynamic";

const addr = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const body = z.object({
  inputMint: addr,
  outputMint: addr,
  amount: z.string().regex(/^[1-9]\d{0,19}$/),
  taker: addr,
  slippageBps: z.number().int().min(1).max(5_000).optional(),
});

/**
 * Assembled order for a connected wallet. The server re-inspects the
 * transaction and refuses one that invokes programs outside the router's
 * allowlist, before the browser ever asks the wallet to sign it.
 */
export async function POST(req: NextRequest) {
  const blocked = sameOriginGuard(req) ?? rateLimit(req, "order");
  if (blocked) return blocked;
  try {
    const parsed = body.safeParse(await readJsonBody(req, 4_000));
    if (!parsed.success) return badRequest("Invalid order request");
    if (parsed.data.inputMint === parsed.data.outputMint) return badRequest("Choose two different tokens");
    const order = await fetchOrder(parsed.data, req.signal);
    if (order.transaction) {
      const allowed = ROUTER_PROGRAMS[order.router];
      if (!allowed) return NextResponse.json({ error: "router_not_allowed", message: `Router ${order.router} is not accepted.` }, { status: 422 });
      const inspected = inspectTransactionBase64(order.transaction);
      const policy = checkTransactionPolicy(inspected, {
        feePayer: parsed.data.taker,
        allowedPrograms: allowed,
        // RFQ makers and gasless sponsors sign at /execute; only they may co-sign.
        allowedCoSigners: [order.maker, order.signatureFeePayer, order.prioritizationFeePayer].filter(
          (s): s is string => typeof s === "string" && s !== parsed.data.taker,
        ),
        allowedVersions: [0, "legacy"],
        maxSigners: 3,
      });
      if (!policy.ok) {
        return NextResponse.json({ error: "policy_violation", message: policy.violations.join(" "), unknownPrograms: policy.unknownPrograms }, { status: 422 });
      }
    }
    return NextResponse.json({ order, receivedAt: Date.now() });
  } catch (error) {
    if (error instanceof UpstreamError && error.status === 400) return NextResponse.json({ error: "no_route", message: error.message }, { status: 422 });
    return errorResponse(error);
  }
}
