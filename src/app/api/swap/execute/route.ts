import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { badRequest, errorResponse, rateLimit, readJsonBody, sameOriginGuard } from "@/lib/server/guard";
import { executeOrder } from "@/lib/server/jupiter";
import { inspectTransactionBase64, checkTransactionPolicy } from "@/lib/tx/inspect";
import { ROUTER_PROGRAMS } from "@/lib/tx/programs";
import { WALLET_ADDED_PROGRAMS } from "@/lib/tx/wallet-changes";
import { log } from "@/lib/server/log";

export const dynamic = "force-dynamic";

const body = z.object({
  signedTransaction: z.string().min(100).max(8_000).regex(/^[A-Za-z0-9+/=]+$/),
  requestId: z.string().min(4).max(200),
  router: z.enum(["metis", "jupiterz"]),
  taker: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/),
  lastValidBlockHeight: z.string().regex(/^\d{1,20}$/).optional(),
});

/**
 * Relays a user-signed transaction to Jupiter's landing service. This
 * endpoint never signs anything; it only re-checks the transaction against
 * the same program allowlist and forwards it.
 */
export async function POST(req: NextRequest) {
  const blocked = sameOriginGuard(req) ?? rateLimit(req, "execute");
  if (blocked) return blocked;
  try {
    const parsed = body.safeParse(await readJsonBody(req, 12_000));
    if (!parsed.success) return badRequest("Invalid execute request");
    const inspected = inspectTransactionBase64(parsed.data.signedTransaction);
    const policy = checkTransactionPolicy(inspected, {
      feePayer: parsed.data.taker,
      // The browser already compared the signed transaction with the reviewed one; a wallet's own safety checks may remain.
      allowedPrograms: [...(ROUTER_PROGRAMS[parsed.data.router] ?? []), ...WALLET_ADDED_PROGRAMS],
      allowedCoSigners: inspected.requiredSigners.filter((s) => s !== parsed.data.taker),
      allowedVersions: [0, "legacy"],
      maxSigners: 3,
    });
    if (!policy.ok) return NextResponse.json({ error: "policy_violation", message: policy.violations.join(" ") }, { status: 422 });
    if (!inspected.presignedBy.includes(parsed.data.taker)) return badRequest("Transaction is not signed by the wallet");
    const started = Date.now();
    const result = await executeOrder({
      signedTransaction: parsed.data.signedTransaction,
      requestId: parsed.data.requestId,
      ...(parsed.data.lastValidBlockHeight ? { lastValidBlockHeight: parsed.data.lastValidBlockHeight } : {}),
    });
    log("swap_execute", { status: result.status, code: result.code, ms: Date.now() - started });
    return NextResponse.json({ result });
  } catch (error) {
    return errorResponse(error);
  }
}
