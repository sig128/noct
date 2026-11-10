import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { badRequest, errorResponse, rateLimit, readJsonBody, sameOriginGuard } from "@/lib/server/guard";
import { rpcUrl } from "@/lib/server/env";
import { upstreamJson } from "@/lib/server/http";
import { log } from "@/lib/server/log";

export const dynamic = "force-dynamic";

/**
 * Read and submit methods the app and the privacy SDK need. Anything else
 * (admin, validator-only or heavy unbounded scans) is refused.
 */
const ALLOWED_METHODS = new Set([
  "getAccountInfo",
  "getBalance",
  "getBlockHeight",
  "getEpochInfo",
  "getFeeForMessage",
  "getGenesisHash",
  "getHealth",
  "getLatestBlockhash",
  "getMinimumBalanceForRentExemption",
  "getMultipleAccounts",
  "getProgramAccounts",
  "getRecentPrioritizationFees",
  "getSignatureStatuses",
  "getSlot",
  "getTokenAccountBalance",
  "getTokenAccountsByOwner",
  "getTransaction",
  "getVersion",
  "isBlockhashValid",
  "sendTransaction",
  "simulateTransaction",
]);

/** getProgramAccounts is limited to the programs whose registries the SDK scans. */
const SCANNABLE_PROGRAMS = new Set(["ring1GaLCuJnkUMVkX2JeZLTTX17wKsV4fZmPVzXANW", "regy3WAeRXMYuMYxr5iK3Bf9Arr3PcxGxyzAddbiqDQ"]);

const call = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string().max(64), z.number()]),
  method: z.string().max(64),
  params: z.array(z.unknown()).max(8).optional(),
});

const payload = z.union([call, z.array(call).min(1).max(20)]);

export async function POST(req: NextRequest, ctx: { params: Promise<{ network: string }> }) {
  const { network } = await ctx.params;
  if (network !== "mainnet" && network !== "devnet") return badRequest("Unknown network");
  const blocked = sameOriginGuard(req) ?? rateLimit(req, "rpc");
  if (blocked) return blocked;
  try {
    const parsed = payload.safeParse(await readJsonBody(req, 96_000));
    if (!parsed.success) return badRequest("Invalid JSON-RPC request");
    const calls = Array.isArray(parsed.data) ? parsed.data : [parsed.data];
    for (const c of calls) {
      if (!ALLOWED_METHODS.has(c.method)) return NextResponse.json({ jsonrpc: "2.0", id: c.id, error: { code: -32601, message: `Method ${c.method} is not available through NOCT` } }, { status: 200 });
      if (c.method === "getProgramAccounts" && !SCANNABLE_PROGRAMS.has(String(c.params?.[0] ?? ""))) {
        return NextResponse.json({ jsonrpc: "2.0", id: c.id, error: { code: -32601, message: "Program scans are limited to Privacy Rings registries" } }, { status: 200 });
      }
    }
    const started = Date.now();
    const result = await upstreamJson(rpcUrl(network), {
      service: `rpc-${network}`,
      method: "POST",
      body: parsed.data,
      timeoutMs: calls.some((c) => c.method === "sendTransaction") ? 20_000 : 12_000,
      maxBytes: 8_000_000,
    });
    log("rpc", { network, methods: calls.map((c) => c.method).join(","), status: result.status, ms: Date.now() - started });
    return NextResponse.json(result.data, { status: result.status === 200 ? 200 : 502 });
  } catch (error) {
    return errorResponse(error);
  }
}
