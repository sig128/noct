"use client";

import { getWallets } from "@wallet-standard/app";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import {
  StandardConnect,
  StandardDisconnect,
  StandardEvents,
  type StandardConnectFeature,
  type StandardDisconnectFeature,
  type StandardEventsFeature,
} from "@wallet-standard/features";
import {
  SolanaSignMessage,
  SolanaSignTransaction,
  type SolanaSignMessageFeature,
  type SolanaSignTransactionFeature,
} from "@solana/wallet-standard-features";
import type { Network } from "@/lib/operations/intent";

export type SolanaChain = "solana:mainnet" | "solana:devnet";

export function chainFor(network: Network): SolanaChain {
  return network === "mainnet" ? "solana:mainnet" : "solana:devnet";
}

export interface WalletOption {
  name: string;
  icon: string;
  wallet: Wallet;
  canSignTransaction: boolean;
  /** Version-1 transactions are what Privacy Rings builders return. */
  signsV1: boolean;
  canSignMessage: boolean;
}

function features(wallet: Wallet) {
  return wallet.features as Partial<StandardConnectFeature & StandardDisconnectFeature & StandardEventsFeature & SolanaSignTransactionFeature & SolanaSignMessageFeature>;
}

function describe(wallet: Wallet): WalletOption | null {
  const f = features(wallet);
  const solana = wallet.chains.some((c) => c.startsWith("solana:"));
  if (!solana || !f[StandardConnect]) return null;
  const signTx = f[SolanaSignTransaction];
  return {
    name: wallet.name,
    icon: wallet.icon,
    wallet,
    canSignTransaction: Boolean(signTx),
    signsV1: Boolean(signTx?.supportedTransactionVersions.includes(1)),
    canSignMessage: Boolean(f[SolanaSignMessage]),
  };
}

export function listSolanaWallets(): WalletOption[] {
  if (typeof window === "undefined") return [];
  return getWallets()
    .get()
    .map(describe)
    .filter((w): w is WalletOption => w !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function onWalletsChanged(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const api = getWallets();
  const off1 = api.on("register", cb);
  const off2 = api.on("unregister", cb);
  return () => {
    off1();
    off2();
  };
}

export class WalletActionError extends Error {
  constructor(
    readonly code: "rejected" | "unsupported" | "no_account" | "failed" | "altered_message",
    message: string,
  ) {
    super(message);
  }
}

function isUserRejection(error: unknown): boolean {
  const e = error as { code?: number; name?: string; message?: string };
  return e?.code === 4001 || /reject|denied|cancel|declin/i.test(`${e?.name ?? ""} ${e?.message ?? ""}`);
}

export async function connectWallet(option: WalletOption, network: Network): Promise<WalletAccount> {
  const connect = features(option.wallet)[StandardConnect];
  if (!connect) throw new WalletActionError("unsupported", `${option.name} does not support connecting.`);
  try {
    const { accounts } = await connect.connect();
    const chain = chainFor(network);
    const account = accounts.find((a) => a.chains.includes(chain)) ?? accounts.find((a) => a.chains.some((c) => c.startsWith("solana:")));
    if (!account) throw new WalletActionError("no_account", `${option.name} has no Solana account for ${network}.`);
    return account;
  } catch (error) {
    if (error instanceof WalletActionError) throw error;
    if (isUserRejection(error)) throw new WalletActionError("rejected", "Connection was declined in the wallet.");
    throw new WalletActionError("failed", `${option.name} could not connect.`);
  }
}

export async function disconnectWallet(option: WalletOption): Promise<void> {
  const disconnect = features(option.wallet)[StandardDisconnect];
  try {
    await disconnect?.disconnect();
  } catch {
    // Disconnect is best effort; local state is cleared regardless.
  }
}

export function onAccountsChanged(option: WalletOption, cb: (accounts: readonly WalletAccount[]) => void): () => void {
  const events = features(option.wallet)[StandardEvents];
  if (!events) return () => {};
  return events.on("change", (props) => {
    if (props.accounts) cb(props.accounts);
  });
}

export async function signTransaction(option: WalletOption, account: WalletAccount, transaction: Uint8Array, network: Network): Promise<Uint8Array> {
  const signer = features(option.wallet)[SolanaSignTransaction];
  if (!signer) throw new WalletActionError("unsupported", `${option.name} cannot sign transactions.`);
  try {
    const [out] = await signer.signTransaction({ account, transaction, chain: chainFor(network) });
    if (!out) throw new WalletActionError("failed", "The wallet returned no signed transaction.");
    return new Uint8Array(out.signedTransaction);
  } catch (error) {
    if (error instanceof WalletActionError) throw error;
    if (isUserRejection(error)) throw new WalletActionError("rejected", "Signature declined in the wallet. Nothing was sent.");
    throw new WalletActionError("failed", "The wallet could not sign this transaction.");
  }
}

/** Signs raw bytes and refuses a signature over anything other than those exact bytes. */
export async function signExactMessage(option: WalletOption, account: WalletAccount, message: Uint8Array): Promise<Uint8Array> {
  const signer = features(option.wallet)[SolanaSignMessage];
  if (!signer) throw new WalletActionError("unsupported", `${option.name} cannot sign messages.`);
  try {
    const [out] = await signer.signMessage({ account, message });
    if (!out) throw new WalletActionError("failed", "The wallet returned no signature.");
    const signed = new Uint8Array(out.signedMessage);
    if (signed.length !== message.length || signed.some((b, i) => b !== message[i])) {
      throw new WalletActionError("altered_message", `${option.name} changed the message before signing, so it cannot derive a private balance.`);
    }
    return new Uint8Array(out.signature);
  } catch (error) {
    if (error instanceof WalletActionError) throw error;
    if (isUserRejection(error)) throw new WalletActionError("rejected", "Signature declined in the wallet.");
    throw new WalletActionError("failed", "The wallet could not sign the message.");
  }
}
