import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { badRequest, errorResponse, rateLimit, readJsonBody, sameOriginGuard } from "@/lib/server/guard";
import { buildOperateTransaction } from "@/lib/server/jupiter";
import { checkTransactionPolicy, inspectTransactionBase64 } from "@/lib/tx/inspect";
import { BORROW_PROGRAMS } from "@/lib/tx/programs";

export const dynamic = "force-dynamic";

const MIN_I128 = "-170141183460469231731687303715884105728";
const signed = z.string().regex(/^-?\d{1,39}$/);
const body = z.object({
  vaultId: z.number().int().min(1).max(100_000),
  positionId: z.number().int().min(0),
  signer: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/),
  colAmount: signed,
  debtAmount: signed,
});

export async function POST(req: NextRequest) {
  const blocked = sameOriginGuard(req) ?? rateLimit(req, "order");
  if (blocked) return blocked;
  try {
    const parsed = body.safeParse(await readJsonBody(req, 2_000));
    if (!parsed.success) return badRequest("Invalid borrow request");
    const { colAmount, debtAmount } = parsed.data;
    if (colAmount === "0" && debtAmount === "0") return badRequest("Nothing to do");
    for (const v of [colAmount, debtAmount]) {
      if (v.startsWith("-") && v !== MIN_I128 && BigInt(v) < -(10n ** 30n)) return badRequest("Amount out of range");
    }
    const built = await buildOperateTransaction(parsed.data);
    const inspected = inspectTransactionBase64(built.transaction);
    const policy = checkTransactionPolicy(inspected, { feePayer: parsed.data.signer, allowedPrograms: BORROW_PROGRAMS, maxSigners: 1 });
    if (!policy.ok) {
      return NextResponse.json({ error: "policy_violation", message: policy.violations.join(" "), unknownPrograms: policy.unknownPrograms }, { status: 422 });
    }
    return NextResponse.json({ transaction: built.transaction, nftId: built.nftId ?? null, programs: inspected.programs, builtAt: Date.now() });
  } catch (error) {
    return errorResponse(error);
  }
}
