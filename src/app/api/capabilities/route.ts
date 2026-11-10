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
  const switchedOn = env.SPR_MAINNET_ENABLED === "true";
  return NextResponse.json({
    verifiedOn: "2026-11-10",
    network: "mainnet",
    jupiter: { base: new URL(env.JUPITER_API_BASE).host, keyed: Boolean(env.JUPITER_API_KEY) },
    rpc: { publicDefault: rpcIsDefaultPublic() },
    pyth: { configured: Boolean(env.PYTH_API_KEY) },
    privacy: {
      sdk: "@heliuslabs/spr@0.9.0-alpha",
      configured: heliusKey,
      enabled: heliusKey && switchedOn,
      reason: !heliusKey
        ? "Set HELIUS_API_KEY on the server to use private balances."
        : !switchedOn
          ? "Private balances are switched off on this deployment. The operator turns them on with SPR_MAINNET_ENABLED=true."
          : null,
    },
  });
}
