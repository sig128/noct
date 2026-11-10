import type { TokenInfo } from "@/lib/tokens/types";
import type { JupiterExecuteResponse, JupiterOrderResponse } from "@/lib/swap/jupiter-schema";

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  let response: Response;
  try {
    response = await fetch(path, {
      ...rest,
      method: json !== undefined ? "POST" : (rest.method ?? "GET"),
      headers: { accept: "application/json", ...(json !== undefined ? { "content-type": "application/json" } : {}), ...rest.headers },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    throw new ApiError("network", "NOCT's server could not be reached. Check your connection.", 0);
  }
  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok) {
    const body = (data ?? {}) as { error?: string; message?: string };
    throw new ApiError(body.error ?? `http_${response.status}`, body.message ?? `Request failed (${response.status}).`, response.status);
  }
  return data as T;
}

export interface Capabilities {
  verifiedOn: string;
  jupiter: { base: string; keyed: boolean };
  rpc: Record<"mainnet" | "devnet", { publicDefault: boolean }>;
  pyth: { configured: boolean };
  privacy: {
    sdk: string;
    devnet: { configured: boolean; enabled: boolean; reason: string | null };
    mainnet: { configured: boolean; enabled: boolean; reason: string | null };
  };
}

export const api = {
  capabilities: (signal?: AbortSignal) => request<Capabilities>("/api/capabilities", { signal }),
  searchTokens: (q: string, signal?: AbortSignal) => request<{ tokens: TokenInfo[]; fetchedAt: number }>(`/api/tokens/search?q=${encodeURIComponent(q)}`, { signal }),
  tokensByMint: (mints: readonly string[], signal?: AbortSignal) =>
    request<{ tokens: TokenInfo[]; fetchedAt: number }>(`/api/tokens/search?ids=${mints.join(",")}`, { signal }),
  prices: (mints: readonly string[], signal?: AbortSignal) =>
    request<{ prices: Record<string, { usdPrice: string; blockId: number | null }>; fetchedAt: number }>(`/api/prices?ids=${mints.join(",")}`, { signal }),
  quote: (p: { inputMint: string; outputMint: string; amount: bigint; slippageBps?: number | null }, signal?: AbortSignal) => {
    const q = new URLSearchParams({ inputMint: p.inputMint, outputMint: p.outputMint, amount: p.amount.toString() });
    if (p.slippageBps) q.set("slippageBps", String(p.slippageBps));
    return request<{ order: JupiterOrderResponse; receivedAt: number }>(`/api/swap/quote?${q}`, { signal });
  },
  order: (p: { inputMint: string; outputMint: string; amount: bigint; taker: string; slippageBps?: number | null }, signal?: AbortSignal) =>
    request<{ order: JupiterOrderResponse; receivedAt: number }>("/api/swap/order", {
      signal,
      json: { inputMint: p.inputMint, outputMint: p.outputMint, amount: p.amount.toString(), taker: p.taker, ...(p.slippageBps ? { slippageBps: p.slippageBps } : {}) },
    }),
  execute: (p: { signedTransaction: string; requestId: string; router: string; taker: string; lastValidBlockHeight?: bigint | null }, signal?: AbortSignal) =>
    request<{ result: JupiterExecuteResponse }>("/api/swap/execute", {
      signal,
      json: {
        signedTransaction: p.signedTransaction,
        requestId: p.requestId,
        router: p.router,
        taker: p.taker,
        ...(p.lastValidBlockHeight ? { lastValidBlockHeight: p.lastValidBlockHeight.toString() } : {}),
      },
    }),
  oracle: (mints: readonly string[], signal?: AbortSignal) =>
    request<{ prices: Record<string, { feedId: string; symbol: string; price: { price: string; conf: string; expo: number; publish_time: number } }>; unmapped: string[] }>(
      `/api/oracle?mints=${mints.join(",")}`,
      { signal },
    ),
  earnMarkets: (signal?: AbortSignal) => request<{ markets: EarnMarketRaw[]; fetchedAt: number }>("/api/lend/earn/markets", { signal }),
  earnPositions: (user: string, signal?: AbortSignal) => request<{ positions: Record<string, unknown>[]; fetchedAt: number }>(`/api/lend/earn/positions?user=${user}`, { signal }),
  earnTx: (p: { action: "deposit" | "withdraw"; asset: string; signer: string; amount: bigint }) =>
    request<{ transaction: string; programs: string[]; builtAt: number }>("/api/lend/earn/tx", { json: { ...p, amount: p.amount.toString() } }),
  vaults: (signal?: AbortSignal) => request<{ vaults: VaultRaw[]; fetchedAt: number }>("/api/lend/borrow/vaults", { signal }),
  borrowPositions: (user: string, signal?: AbortSignal) =>
    request<{ positions: { id: number; vaultId: number; supply: string; borrow: string; dustBorrow: string | null; isLiquidated: boolean }[]; fetchedAt: number }>(
      `/api/lend/borrow/positions?user=${user}`,
      { signal },
    ),
  operate: (p: { vaultId: number; positionId: number; signer: string; colAmount: string; debtAmount: string }) =>
    request<{ transaction: string; nftId: number | null; programs: string[]; builtAt: number }>("/api/lend/borrow/operate", { json: p }),
};

export interface EarnMarketRaw {
  id: number;
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  assetAddress: string;
  asset: { symbol: string; decimals: number; price?: string | null; logo_url?: string | null; name?: string };
  totalAssets: string;
  totalSupply: string;
  convertToShares: string;
  convertToAssets: string;
  rewardsRate: string;
  supplyRate: string;
  totalRate: string;
  liquiditySupplyData?: { withdrawalLimit?: string; withdrawable?: string; lastUpdateTimestamp?: string | number };
}

export interface VaultRaw {
  id: number;
  address: string;
  supplyToken: { address: string; symbol: string; decimals: number; price?: string | null; logoUrl?: string | null };
  borrowToken: { address: string; symbol: string; decimals: number; price?: string | null; logoUrl?: string | null };
  collateralFactor: string;
  liquidationThreshold: string;
  liquidationMaxLimit: string;
  liquidationPenalty: string;
  borrowFee: string;
  supplyRate: string;
  borrowRate: string;
  borrowable: string;
  withdrawable: string;
  minimumBorrowing: string;
  oracle?: string;
  oraclePrice: string;
  oracleTimestamp?: number;
  oracleSources: { source: string; invert?: boolean; sourceType?: Record<string, unknown> }[];
  totalPositions?: number;
}
