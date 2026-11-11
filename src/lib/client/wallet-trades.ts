"use client";

import {
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Blockhash,
} from "@solana/kit";
import { NETWORK } from "@/lib/operations/intent";
import { executeErrorMessage, normalizeOrder, orderErrorMessage } from "@/lib/swap/quote";
import { orderResponseSchema } from "@/lib/swap/jupiter-schema";
import { NATIVE_SOL_MINT, type TokenInfo } from "@/lib/tokens/types";
import { base64ToBytes, bytesToBase64, checkTransactionPolicy, inspectTransactionBytes } from "@/lib/tx/inspect";
import { PROGRAMS, ROUTER_PROGRAMS } from "@/lib/tx/programs";
import { signWithWallet, type DerivedWallet } from "@/lib/wallets/derive";
import { formatAmount } from "@/lib/decimal";
import { api, ApiError } from "./api";
import { solanaRpc, waitForConfirmation } from "./rpc";
import { setRun, useWallets, walletKey } from "./wallets";

/**
 * SOL each NOCT wallet keeps back from a buy: network fees and the rent of
 * the token account the buy opens (about 0.002 SOL), with room for Token-2022
 * accounts and priority fees.
 */
export const WALLET_RESERVE_LAMPORTS = 4_000_000n;
/** Network fee for a one-signature transfer. */
const TRANSFER_FEE_LAMPORTS = 5_000n;

function reason(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message;
  const message = (error as Error | null)?.message;
  return message ? message.slice(0, 200) : fallback;
}

/** One Jupiter order for a NOCT wallet: checked, simulated, signed in this tab and landed through Jupiter. */
async function swapFromWallet(wallet: DerivedWallet, p: { inputMint: string; outputMint: string; amount: bigint; slippageBps: number | null }, say: (message: string) => void) {
  say("Getting a price");
  const raw = await api.order({ inputMint: p.inputMint, outputMint: p.outputMint, amount: p.amount, taker: wallet.address, slippageBps: p.slippageBps });
  const order = normalizeOrder(orderResponseSchema.parse(raw.order), raw.receivedAt);
  if (!order.transaction || !order.requestId) throw new Error(orderErrorMessage(order.router, order.errorCode, order.errorMessage));
  if (order.inAmount !== p.amount || order.inputMint !== p.inputMint || order.outputMint !== p.outputMint) throw new Error("The order returned does not match the requested swap.");

  const wire = base64ToBytes(order.transaction);
  const inspected = inspectTransactionBytes(wire);
  const check = checkTransactionPolicy(inspected, {
    feePayer: inspected.feePayer === wallet.address ? wallet.address : inspected.feePayer,
    allowedPrograms: ROUTER_PROGRAMS[order.router] ?? [],
    allowedCoSigners: order.coSigners,
    allowedVersions: [0, "legacy"],
    maxSigners: 3,
  });
  if (!check.ok) throw new Error(check.violations.join(" "));
  if (!inspected.requiredSigners.includes(wallet.address)) throw new Error("The order is not for this wallet.");
  if (inspected.feePayer !== wallet.address && !order.coSigners.includes(inspected.feePayer)) throw new Error("Someone unexpected would pay the fee.");

  say("Checking it against the chain");
  const simulation = await solanaRpc.simulate(NETWORK, order.transaction);
  if (simulation.err) throw new Error(`It would fail on chain, so nothing was sent (${JSON.stringify(simulation.err).slice(0, 120)}).`);

  say("Sending");
  const signed = signWithWallet(wallet, wire);
  const { result } = await api.execute({ signedTransaction: bytesToBase64(signed), requestId: order.requestId, router: order.router, taker: wallet.address, lastValidBlockHeight: order.lastValidBlockHeight });
  if (result.status === "Success" && result.signature) {
    return { signature: result.signature, received: BigInt(result.outputAmountResult ?? result.totalOutputAmount ?? "0") };
  }
  const message = executeErrorMessage(result.code, result.error);
  throw Object.assign(new Error(message), { signature: result.signature ?? null });
}

/** Runs `work` for each wallet one after another, recording progress; one wallet failing does not stop the rest. */
async function eachWallet(label: string, indexes: readonly number[], work: (wallet: DerivedWallet, say: (message: string) => void) => Promise<{ message: string; signature: string | null }>) {
  if (useWallets.getState().busy) return;
  useWallets.setState({ busy: label, runs: {} });
  try {
    for (const index of indexes) {
      let wallet: DerivedWallet;
      try {
        wallet = walletKey(index);
      } catch (error) {
        setRun(index, { phase: "failed", message: reason(error, "This wallet is not open.") });
        continue;
      }
      setRun(index, { phase: "working", message: "Starting", signature: null });
      try {
        const done = await work(wallet, (message) => setRun(index, { message }));
        setRun(index, { phase: "done", message: done.message, signature: done.signature });
      } catch (error) {
        setRun(index, { phase: "failed", message: reason(error, "It did not go through."), signature: (error as { signature?: string | null }).signature ?? null });
      }
    }
  } finally {
    useWallets.setState({ busy: null });
  }
}

/** Each wallet buys `output` with up to `perWallet` lamports of its SOL, keeping WALLET_RESERVE_LAMPORTS back. */
export function buyWithWallets(p: { indexes: readonly number[]; output: TokenInfo; perWallet: bigint; slippageBps: number | null }) {
  return eachWallet(`Buying ${p.output.symbol}`, p.indexes, async (wallet, say) => {
    say("Checking its SOL");
    const balance = await solanaRpc.getLamports(NETWORK, wallet.address);
    const spendable = balance - WALLET_RESERVE_LAMPORTS;
    const amount = spendable < p.perWallet ? spendable : p.perWallet;
    if (amount <= 0n) throw new Error("Not enough SOL in this wallet. Fund it first.");
    const { signature, received } = await swapFromWallet(wallet, { inputMint: NATIVE_SOL_MINT, outputMint: p.output.mint, amount, slippageBps: p.slippageBps }, say);
    return { message: `Bought ${formatAmount(received, p.output.decimals)} ${p.output.symbol} for ${formatAmount(amount, 9)} SOL`, signature };
  });
}

/** Each wallet sells all of its `token` for SOL. */
export function sellAllWithWallets(p: { indexes: readonly number[]; token: TokenInfo; slippageBps: number | null }) {
  return eachWallet(`Selling ${p.token.symbol}`, p.indexes, async (wallet, say) => {
    say(`Checking its ${p.token.symbol}`);
    const holdings = await solanaRpc.getTokenHoldings(NETWORK, wallet.address);
    const amount = holdings.filter((h) => h.mint === p.token.mint && !h.frozen).reduce((sum, h) => sum + h.amount, 0n);
    if (amount <= 0n) return { message: `No ${p.token.symbol} to sell`, signature: null };
    const { signature, received } = await swapFromWallet(wallet, { inputMint: p.token.mint, outputMint: NATIVE_SOL_MINT, amount, slippageBps: p.slippageBps }, say);
    return { message: `Sold ${formatAmount(amount, p.token.decimals)} ${p.token.symbol} for ${formatAmount(received, 9)} SOL`, signature };
  });
}

/** A one-instruction SOL transfer from a NOCT wallet, signed in this tab. */
async function transferFromWallet(wallet: DerivedWallet, to: string, lamports: bigint): Promise<string> {
  const { blockhash, lastValidBlockHeight } = await solanaRpc.getLatestBlockhash(NETWORK);
  const data = new Uint8Array(12);
  const view = new DataView(data.buffer);
  view.setUint32(0, 2, true); // System program: Transfer
  view.setBigUint64(4, lamports, true);
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(address(wallet.address), m),
    (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: blockhash as Blockhash, lastValidBlockHeight }, m),
    (m) =>
      appendTransactionMessageInstructions(
        [
          {
            programAddress: address(PROGRAMS.system),
            accounts: [
              { address: address(wallet.address), role: AccountRole.WRITABLE_SIGNER },
              { address: address(to), role: AccountRole.WRITABLE },
            ],
            data,
          },
        ],
        m,
      ),
  );
  const wire = new Uint8Array(getTransactionEncoder().encode(compileTransaction(message)));
  const signed = signWithWallet(wallet, wire);
  const signature = await solanaRpc.sendRaw(NETWORK, bytesToBase64(signed));
  const status = await waitForConfirmation(NETWORK, signature);
  if (!status) throw Object.assign(new Error("Sent, but not confirmed yet. Check the wallet's balance before trying again."), { signature });
  if (status.found && status.err) throw Object.assign(new Error("The transfer failed on chain."), { signature });
  return signature;
}

/** Each wallet sends all its SOL, minus the network fee, to `to`. */
export function sendSolBack(p: { indexes: readonly number[]; to: string }) {
  return eachWallet("Sending SOL back", p.indexes, async (wallet, say) => {
    say("Checking its SOL");
    const balance = await solanaRpc.getLamports(NETWORK, wallet.address);
    const lamports = balance - TRANSFER_FEE_LAMPORTS;
    if (lamports <= 0n) return { message: "No SOL to send", signature: null };
    say("Sending");
    const signature = await transferFromWallet(wallet, p.to, lamports);
    return { message: `Sent ${formatAmount(lamports, 9)} SOL to your wallet`, signature };
  });
}
