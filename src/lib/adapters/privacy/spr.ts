"use client";

/**
 * PrivacyAdapter over Solana Privacy Rings (@heliuslabs/spr 0.9.0-alpha),
 * Default Ring only. Loaded on demand so the SDK, its WASM hasher and TEE
 * verification code stay out of the initial bundle.
 *
 * Key handling follows the SDK's reviewed design: the wallet signs the exact
 * derivation message from `ed25519DerivationMessage`, `LocalKeys` derives the
 * viewing and nullifier keys from that signature in this tab's memory, and the
 * signature buffer is zeroed immediately. Nothing is persisted. Every private
 * transaction still needs the wallet's own transaction signature.
 */

import type { Network } from "@/lib/operations/intent";

export interface PrivateBalance {
  mint: string;
  amount: bigint;
  notes: number;
}

export interface PrivateHistoryRow {
  id: string;
  kind: "deposit" | "privateTransfer" | "ringEntry" | "publicWithdrawal" | "split" | "merge";
  direction: "inbound" | "outbound" | "selfTransfer";
  asset: string;
  amount: bigint;
}

/** What the user reviewed; the SDK's own intent must match before proving. */
export interface ExpectedIntent {
  kind: "transfer" | "withdrawal";
  asset: string;
  amount: bigint;
  /** Solana address for withdrawals. */
  recipient?: string;
}

export interface PrivacySession {
  readonly owner: string;
  readonly network: Network;
  sync(): Promise<void>;
  balances(): PrivateBalance[];
  history(): PrivateHistoryRow[];
  /** A registration transaction, or null when this wallet is already registered with these keys. */
  buildRegistration(): Promise<Uint8Array | null>;
  buildDeposit(p: { asset: string | null; amount: bigint; tokenAccount?: string; token2022?: boolean }): Promise<Uint8Array>;
  buildTransfer(p: { recipient: string; asset: string | null; amount: bigint; expect: ExpectedIntent }): Promise<Uint8Array>;
  buildWithdrawal(p: { recipient: string; asset: string | null; amount: bigint; token2022?: boolean; expect: ExpectedIntent }): Promise<Uint8Array>;
  /** Sends wallet-signed bytes, waits for confirmation and re-syncs. */
  submit(signed: Uint8Array): Promise<{ signature: string; slot: bigint }>;
  signatureOf(signed: Uint8Array): Promise<string>;
  destroy(): void;
}

export class PrivacyError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const POLICY_PREFIX = "https://d3gbdb0egjwcw9.cloudfront.net/tee-policy/";

const MESSAGES: Record<string, string> = {
  WALLET_RECIPIENT_NOT_REGISTERED: "This recipient has no registered private address. A private transfer to them is not possible.",
  WALLET_INSUFFICIENT_BALANCE: "Not enough private balance for this amount.",
  WALLET_TOO_MANY_INPUTS: "This balance is spread across too many notes for one transfer. Send a smaller amount.",
  WALLET_USER_RECORD_KEYS_MISMATCH: "This wallet is registered with different privacy keys, so payments to it would go elsewhere.",
  WALLET_SPL_INTERFACE_CREATION_RESTRICTED: "The shielded pool does not accept this token.",
  WALLET_UNRESOLVED_ASSET: "The shielded pool does not recognise this token.",
  WALLET_INTENT_MISMATCH: "The prepared transaction did not match what you reviewed. Nothing was signed.",
  WALLET_NOTE_RESERVED: "Part of this balance is held by another pending private transaction. Wait for it to settle.",
  WALLET_SYNC: "Your private balance could not be synchronised. Try again shortly.",
};

export function describePrivacyError(error: unknown): PrivacyError {
  if (error instanceof PrivacyError) return error;
  const e = error as { code?: string; causeCode?: string; message?: string };
  const code = e?.causeCode && MESSAGES[e.causeCode] ? e.causeCode : (e?.code ?? "unknown");
  return new PrivacyError(code, MESSAGES[code] ?? `The privacy service reported ${code}.`);
}

export interface OpenSessionInput {
  network: Network;
  origin: string;
  owner: string;
  ownerPublicKey: Uint8Array;
  /** Signs the exact bytes given and returns the 64-byte signature. */
  signDerivationMessage(message: Uint8Array): Promise<Uint8Array>;
}

export async function openPrivacySession(input: OpenSessionInput): Promise<PrivacySession> {
  const [spr, sprClient, sprKeypair, sprWallet, kit] = await Promise.all([
    import("@heliuslabs/spr"),
    import("@heliuslabs/spr/client"),
    import("@heliuslabs/spr/keypair"),
    import("@heliuslabs/spr/wallet"),
    import("@solana/kit"),
  ]);

  const relay = `${input.origin}/api/spr/${input.network}`;
  // Every SDK request goes to this origin; the signed TEE policy is fetched
  // through the relay and still verified against the SDK's pinned signers.
  const relayFetch: typeof fetch = (resource, init) => {
    const url = typeof resource === "string" ? resource : resource instanceof URL ? resource.href : resource.url;
    if (url.startsWith(POLICY_PREFIX)) return fetch(`${relay}/policy`, { ...init, credentials: "same-origin" });
    return fetch(resource, { ...init, credentials: "same-origin" });
  };

  const client = await spr.createSprClient({
    solanaRpcUrl: `${input.origin}/api/rpc/${input.network}`,
    indexerUrl: `${relay}/indexer`,
    proverUrl: `${relay}/prover`,
    proverTee: sprClient.SignedTeePolicy.forNetwork(input.network),
    fetch: relayFetch,
  });

  if (input.ownerPublicKey.length !== 32) throw new PrivacyError("bad_key", "Wallet public key must be 32 bytes.");
  const message = sprKeypair.ed25519DerivationMessage(input.ownerPublicKey as Parameters<typeof sprKeypair.ed25519DerivationMessage>[0]);
  const seed = await input.signDerivationMessage(message);
  let keys: ReturnType<typeof spr.LocalKeys.fromDerivationSeed>;
  try {
    keys = spr.LocalKeys.fromDerivationSeed({ solanaPublicKey: kit.address(input.owner), derivationSeed: seed }, client.proofService);
  } catch (error) {
    throw new PrivacyError("derivation_rejected", `The wallet's signature did not derive privacy keys (${(error as Error).message}).`);
  } finally {
    seed.fill(0);
  }

  const wallet = new spr.Wallet({ identity: keys.address() });
  let destroyed = false;
  const owner = kit.address(input.owner);

  const encode = (tx: Parameters<ReturnType<typeof kit.getTransactionEncoder>["encode"]>[0]) => new Uint8Array(kit.getTransactionEncoder().encode(tx));
  const guard = () => {
    if (destroyed) throw new PrivacyError("locked", "The private balance is locked.");
  };

  const approvalFor = (expect: ExpectedIntent) => async (request: { solanaPublicKey: string; intent: { kind: string; asset?: string; amount?: bigint; recipient?: unknown } }) => {
    const intent = request.intent;
    const mismatch = (field: string) => new PrivacyError("WALLET_INTENT_MISMATCH", `${MESSAGES.WALLET_INTENT_MISMATCH} (${field})`);
    if (request.solanaPublicKey !== owner) throw mismatch("signer");
    if (intent.kind !== expect.kind) throw mismatch("kind");
    if (intent.asset !== expect.asset) throw mismatch("asset");
    if (intent.amount !== expect.amount) throw mismatch("amount");
    if (expect.kind === "withdrawal" && String(intent.recipient) !== expect.recipient) throw mismatch("recipient");
    return sprWallet.approveIntent(intent as Parameters<typeof sprWallet.approveIntent>[0]);
  };

  const sol = (asset: string | null) => asset ?? spr.SOL_MINT;

  const session: PrivacySession = {
    owner: input.owner,
    network: input.network,
    async sync() {
      guard();
      try {
        await spr.syncWallet({ client, wallet, keys });
      } catch (error) {
        throw describePrivacyError(error);
      }
    },
    balances() {
      guard();
      return spr.getPrivateTokenBalances(wallet).map((b) => ({ mint: String(b.mint), amount: b.amount, notes: b.utxos.length }));
    },
    history() {
      guard();
      return spr.getPrivateTransactions(wallet).map((t) => ({
        id: String(t.id),
        kind: t.kind,
        direction: t.direction,
        asset: String(t.asset),
        amount: t.amount,
      }));
    },
    async buildRegistration() {
      guard();
      try {
        const tx = await spr.buildRegistrationTransaction({ client, owner, address: keys.address() });
        return tx === undefined ? null : encode(tx);
      } catch (error) {
        throw describePrivacyError(error);
      }
    },
    async buildDeposit(p) {
      guard();
      try {
        const tx = await spr.buildDepositTransaction({
          client,
          feePayer: owner,
          recipient: keys.address(),
          ...(p.asset ? { asset: kit.address(p.asset) } : {}),
          ...(p.tokenAccount ? { splTokenAccount: kit.address(p.tokenAccount) } : {}),
          ...(p.token2022 ? { splTokenProgram: spr.SPL_TOKEN_2022_PROGRAM_ID } : {}),
          amount: p.amount,
        });
        return encode(tx);
      } catch (error) {
        throw describePrivacyError(error);
      }
    },
    async buildTransfer(p) {
      guard();
      try {
        const tx = await spr.buildTransferTransaction({
          client,
          wallet,
          keys,
          feePayer: owner,
          recipient: kit.address(p.recipient),
          ...(p.asset ? { asset: kit.address(p.asset) } : {}),
          amount: p.amount,
          approve: approvalFor({ ...p.expect, asset: sol(p.expect.asset) }) as never,
        });
        return encode(tx);
      } catch (error) {
        throw describePrivacyError(error);
      }
    },
    async buildWithdrawal(p) {
      guard();
      try {
        const tx = await spr.buildWithdrawalTransaction({
          client,
          wallet,
          keys,
          feePayer: owner,
          recipient: kit.address(p.recipient),
          ...(p.asset ? { asset: kit.address(p.asset) } : {}),
          ...(p.token2022 ? { splTokenProgram: spr.SPL_TOKEN_2022_PROGRAM_ID } : {}),
          amount: p.amount,
          approve: approvalFor({ ...p.expect, asset: sol(p.expect.asset) }) as never,
        });
        return encode(tx);
      } catch (error) {
        throw describePrivacyError(error);
      }
    },
    async signatureOf(signed) {
      const decoded = kit.getTransactionDecoder().decode(signed);
      return String(kit.getSignatureFromTransaction(decoded));
    },
    async submit(signed) {
      guard();
      const decoded = kit.getTransactionDecoder().decode(signed);
      const signature = kit.getSignatureFromTransaction(decoded);
      const wire = kit.getBase64EncodedWireTransaction(decoded);
      await client.solanaRpc.sendTransaction(wire, { encoding: "base64", preflightCommitment: "confirmed" }).send();
      const slot = await client.confirmTransaction(signature);
      await spr.syncWallet({ client, wallet, keys, config: { requireSlot: slot } });
      return { signature: String(signature), slot };
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      keys.destroy();
    },
  };
  return session;
}
