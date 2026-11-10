import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { badRequest, errorResponse, rateLimit, readJsonBody, sameOriginGuard } from "@/lib/server/guard";
import { buildEarnTransaction } from "@/lib/server/jupiter";
import { checkTransactionPolicy, inspectTransactionBase64 } from "@/lib/tx/inspect";
import { EARN_PROGRAMS } from "@/lib/tx/programs";

export const dynamic = "force-dynamic";

const addr = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const body = z.object({
  action: z.enum(["deposit", "withdraw"]),
  asset: addr,
  signer: addr,
  amount: z.string().regex(/^[1-9]\d{0,24}$/),
});

export async function POST(req: NextRequest) {
  const blocked = sameOriginGuard(req) ?? rateLimit(req, "order");
  if (blocked) return blocked;
  try {
    const parsed = body.safeParse(await readJsonBody(req, 2_000));
    if (!parsed.success) return badRequest("Invalid earn request");
    const { action, ...rest } = parsed.data;
    const built = await buildEarnTransaction(action, rest);
    const inspected = inspectTransactionBase64(built.transaction);
    const policy = checkTransactionPolicy(inspected, { feePayer: rest.signer, allowedPrograms: EARN_PROGRAMS, maxSigners: 1 });
    if (!policy.ok) {
      return NextResponse.json({ error: "policy_violation", message: policy.violations.join(" "), unknownPrograms: policy.unknownPrograms }, { status: 422 });
    }
    return NextResponse.json({ transaction: built.transaction, programs: inspected.programs, builtAt: Date.now() });
  } catch (error) {
    return errorResponse(error);
  }
}
