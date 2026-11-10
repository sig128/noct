import "server-only";
import { z } from "zod";

const url = z.string().url();

const schema = z.object({
  JUPITER_API_BASE: url.default("https://api.jup.ag"),
  JUPITER_API_KEY: z.string().min(8).optional(),
  SOLANA_RPC_URL_MAINNET: url.optional(),
  HELIUS_API_KEY: z.string().min(8).optional(),
  SPR_INDEXER_URL_MAINNET: url.default("https://dgcj4pjarvo65.cloudfront.net"),
  SPR_PROVER_URL_MAINNET: url.default("https://d3ky2kt0ntqxt1.cloudfront.net"),
  SPR_POLICY_BASE: url.default("https://d3gbdb0egjwcw9.cloudfront.net/tee-policy"),
  /** Operator switch for mainnet private balances (Default Ring launched on mainnet 2026-11-10; beta). */
  SPR_MAINNET_ENABLED: z.enum(["true", "false"]).default("false"),
  PYTH_API_KEY: z.string().min(8).optional(),
  PYTH_HERMES_BASE: url.default("https://pyth.dourolabs.app/hermes"),
  NOCT_ALLOWED_ORIGINS: z.string().optional(),
  NOCT_ICON_HOSTS: z.string().optional(),
});

export type ServerEnv = z.infer<typeof schema>;

let cached: ServerEnv | null = null;

export function serverEnv(): ServerEnv {
  if (cached) return cached;
  // An empty assignment (KEY= in .env files) means "unset", so defaults apply.
  const present = Object.fromEntries(Object.entries(process.env).filter(([, v]) => typeof v === "string" && v.trim() !== ""));
  const parsed = schema.safeParse(present);
  if (!parsed.success) {
    // Never echo values; names only.
    const names = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid server configuration: ${names}`);
  }
  cached = parsed.data;
  return cached;
}

/** Solana mainnet RPC: the configured endpoint, else Helius (with a key), else the public one. */
export function rpcUrl(): string {
  const env = serverEnv();
  if (env.SOLANA_RPC_URL_MAINNET) return env.SOLANA_RPC_URL_MAINNET;
  if (env.HELIUS_API_KEY) return `https://mainnet.helius-rpc.com/?api-key=${env.HELIUS_API_KEY}`;
  return "https://api.mainnet-beta.solana.com";
}

export function rpcIsDefaultPublic(): boolean {
  const env = serverEnv();
  return !env.SOLANA_RPC_URL_MAINNET && !env.HELIUS_API_KEY;
}
