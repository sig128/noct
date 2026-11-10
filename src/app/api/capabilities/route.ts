import { NextResponse, type NextRequest } from "next/server";
import { rateLimit } from "@/lib/server/guard";
import { rpcIsDefaultPublic, serverEnv } from "@/lib/server/env";

export const dynamic = "force-dynamic";

/** Which integrations this deployment is configured for. Names only; never secrets. */
export async function GET(req: NextRequest) {
  const limited = rateLimit(req, "read");
  if (limited) return limited;
  const env = serverEnv();
  const heliusKey = Boolean(env.HELIUS_API_KEY);
  return NextResponse.json({
    verifiedOn: "2026-11-10",
    jupiter: { base: new URL(env.JUPITER_API_BASE).host, keyed: Boolean(env.JUPITER_API_KEY) },
    rpc: {
      mainnet: { publicDefault: rpcIsDefaultPublic("mainnet") },
      devnet: { publicDefault: rpcIsDefaultPublic("devnet") },
    },
    pyth: { configured: Boolean(env.PYTH_API_KEY) },
    privacy: {
      sdk: "@heliuslabs/spr@0.9.0-alpha",
      devnet: { configured: heliusKey, enabled: heliusKey, reason: heliusKey ? null : "Set HELIUS_API_KEY on the server to use private balances." },
      mainnet: {
        configured: heliusKey,
        enabled: heliusKey && env.SPR_MAINNET_ENABLED === "true",
        reason: !heliusKey
          ? "Set HELIUS_API_KEY on the server to use private balances."
          : env.SPR_MAINNET_ENABLED !== "true"
            ? "Mainnet private balances are off: Helius lists audits as pending and the endpoints as beta. An operator enables them with SPR_MAINNET_ENABLED=true after review."
            : null,
      },
    },
  });
}
