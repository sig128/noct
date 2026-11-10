import type { Network } from "@/lib/operations/intent";
import type { SignatureStatus } from "@/lib/operations/reconcile";
import { SPL_TOKEN_PROGRAM, TOKEN_2022_PROGRAM } from "@/lib/tokens/types";
import { base64ToBytes } from "@/lib/tx/inspect";
import { ApiError } from "./api";

let nextId = 1;

async function rpc<T>(network: Network, method: string, params: unknown[] = [], signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/rpc/${network}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
      signal,
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    throw new ApiError("network", "The Solana RPC relay could not be reached.", 0);
  }
  const body = (await res.json().catch(() => null)) as { result?: T; error?: { code: number; message: string }; message?: string } | null;
  if (!res.ok) throw new ApiError("rpc_http", body?.message ?? `RPC relay returned ${res.status}`, res.status);
  if (!body) throw new ApiError("rpc_body", "RPC returned an empty response", res.status);
  if (body.error) throw new ApiError(`rpc_${body.error.code}`, body.error.message, res.status);
  return body.result as T;
}

export interface TokenHolding {
  mint: string;
  amount: bigint;
  decimals: number;
  program: "spl" | "token2022";
  account: string;
  frozen: boolean;
}

type ParsedTokenAccount = {
  pubkey: string;
  account: { data: { parsed: { info: { mint: string; state: string; tokenAmount: { amount: string; decimals: number } } } } };
};

export const solanaRpc = {
  async getLamports(network: Network, owner: string, signal?: AbortSignal): Promise<bigint> {
    const r = await rpc<{ value: number }>(network, "getBalance", [owner, { commitment: "confirmed" }], signal);
    return BigInt(r.value);
  },

  async getTokenHoldings(network: Network, owner: string, signal?: AbortSignal): Promise<TokenHolding[]> {
    const fetchProgram = async (programId: string, program: "spl" | "token2022") => {
      const r = await rpc<{ value: ParsedTokenAccount[] }>(network, "getTokenAccountsByOwner", [owner, { programId }, { encoding: "jsonParsed", commitment: "confirmed" }], signal);
      return r.value.map((a) => ({
        mint: a.account.data.parsed.info.mint,
        amount: BigInt(a.account.data.parsed.info.tokenAmount.amount),
        decimals: a.account.data.parsed.info.tokenAmount.decimals,
        program,
        account: a.pubkey,
        frozen: a.account.data.parsed.info.state === "frozen",
      }));
    };
    const [spl, t22] = await Promise.all([fetchProgram(SPL_TOKEN_PROGRAM, "spl"), fetchProgram(TOKEN_2022_PROGRAM, "token2022")]);
    return [...spl, ...t22];
  },

  async getAccountBytes(network: Network, address: string, signal?: AbortSignal): Promise<{ data: Uint8Array; owner: string } | null> {
    const r = await rpc<{ value: { data: [string, string]; owner: string } | null }>(network, "getAccountInfo", [address, { encoding: "base64", commitment: "confirmed" }], signal);
    if (!r.value) return null;
    return { data: base64ToBytes(r.value.data[0]), owner: r.value.owner };
  },

  async getEpoch(network: Network): Promise<bigint> {
    const r = await rpc<{ epoch: number }>(network, "getEpochInfo", [{ commitment: "confirmed" }]);
    return BigInt(r.epoch);
  },

  async getSignatureStatus(network: Network, signature: string): Promise<SignatureStatus> {
    const r = await rpc<{ value: ({ slot: number; err: unknown; confirmationStatus: "processed" | "confirmed" | "finalized" | null } | null)[] }>(network, "getSignatureStatuses", [
      [signature],
      { searchTransactionHistory: true },
    ]);
    const s = r.value[0];
    return s ? { found: true, err: s.err ?? null, confirmationStatus: s.confirmationStatus, slot: BigInt(s.slot) } : { found: false };
  },

  async getBlockHeight(network: Network): Promise<bigint> {
    return BigInt(await rpc<number>(network, "getBlockHeight", [{ commitment: "confirmed" }]));
  },

  async simulate(network: Network, base64Tx: string): Promise<{ err: unknown; logs: string[]; unitsConsumed: number | null }> {
    const r = await rpc<{ value: { err: unknown; logs: string[] | null; unitsConsumed?: number } }>(network, "simulateTransaction", [
      base64Tx,
      { encoding: "base64", sigVerify: false, replaceRecentBlockhash: false, commitment: "processed" },
    ]);
    return { err: r.value.err ?? null, logs: r.value.logs ?? [], unitsConsumed: r.value.unitsConsumed ?? null };
  },

  async sendRaw(network: Network, base64Tx: string): Promise<string> {
    return rpc<string>(network, "sendTransaction", [base64Tx, { encoding: "base64", skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 0 }]);
  },

  /** Latest blockhash; its expiry height is an upper bound for transactions built just before. */
  async getLatestBlockhash(network: Network): Promise<{ blockhash: string; lastValidBlockHeight: bigint }> {
    const r = await rpc<{ value: { blockhash: string; lastValidBlockHeight: number } }>(network, "getLatestBlockhash", [{ commitment: "confirmed" }]);
    return { blockhash: r.value.blockhash, lastValidBlockHeight: BigInt(r.value.lastValidBlockHeight) };
  },

  /** Network fee actually charged, from the confirmed transaction's metadata. */
  async getTransactionFee(network: Network, signature: string): Promise<bigint | null> {
    try {
      const r = await rpc<{ meta: { fee: number } | null } | null>(network, "getTransaction", [signature, { commitment: "confirmed", maxSupportedTransactionVersion: 1, encoding: "json" }]);
      return r?.meta ? BigInt(r.meta.fee) : null;
    } catch {
      return null;
    }
  },

  async getSlot(network: Network, signal?: AbortSignal): Promise<bigint> {
    return BigInt(await rpc<number>(network, "getSlot", [{ commitment: "confirmed" }], signal));
  },
};

/** Waits for a signature to reach `confirmed`, polling; returns null on timeout (outcome unknown). */
export async function waitForConfirmation(network: Network, signature: string, timeoutMs = 60_000): Promise<SignatureStatus | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const status = await solanaRpc.getSignatureStatus(network, signature);
      if (status.found && (status.err || status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized")) return status;
    } catch {
      // transient; keep polling until the deadline
    }
    await new Promise((r) => setTimeout(r, 1_500));
  }
  return null;
}
