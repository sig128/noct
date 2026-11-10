import { ed25519 } from "@noble/curves/ed25519.js";
import type { LocalKeys, ProofService } from "@heliuslabs/spr";
import { WalletActionError } from "@/lib/wallet/standard";

/**
 * How a wallet's signature becomes the seed a private balance's keys are
 * expanded from.
 *
 * "standard": the wallet signs the SDK's derivation message (a Solana
 * off-chain message v0 around "TSPP/derive/v1") and
 * `LocalKeys.fromDerivationSeed` derives the keys. Any Privacy Rings client
 * can repeat this.
 *
 * "noct": for wallets that refuse those bytes (Phantom reads them as a
 * transaction), the wallet signs NOCT's fixed text instead. The signature is
 * checked against the wallet's key, then expanded into keys exactly as the SDK
 * expands a standard seed; only the seed differs. A balance opened this way
 * opens only in apps that use this same text.
 */
export type UnlockMethod = "standard" | "noct";

/** NOCT's unlock text. It must never change: different text derives different keys. */
export function noctUnlockText(owner: string): string {
  return [
    "NOCT private balance",
    "",
    "Sign to open your private balance (Solana Privacy Rings) in NOCT. Signing is free and moves no funds.",
    "",
    "Only sign this in NOCT. Anyone who gets this signature can see your private balance and history.",
    "",
    `Wallet: ${owner}`,
    "Key version: 1",
  ].join("\n");
}

export function noctUnlockMessage(owner: string): Uint8Array {
  return new TextEncoder().encode(noctUnlockText(owner));
}

/**
 * The SDK's key expansion for an Ed25519 wallet, applied to any 64-byte seed:
 * the same steps `LocalKeys.fromDerivationSeed` takes after checking its seed.
 */
export async function expandSeed(input: { ownerPublicKey: Uint8Array; seed: Uint8Array; proofs: ProofService }): Promise<LocalKeys> {
  const [spr, keypair, internal] = await Promise.all([import("@heliuslabs/spr"), import("@heliuslabs/spr/keypair"), import("@heliuslabs/spr/internal")]);
  if (input.ownerPublicKey.length !== 32 || input.seed.length !== 64) throw new Error("expected a 32-byte key and a 64-byte seed");
  return internal.roleExpansion(input.seed, "ed25519", (roles) => {
    const viewing = keypair.ViewingKey.fromBytes(roles.viewingSecret);
    const nullifier = keypair.NullifierKey.fromSecret(roles.nullifierSecret);
    try {
      const address = keypair.ShieldedAddress.fromPublicKeys(keypair.ShieldedPublicKey.fromEd25519(input.ownerPublicKey as never), nullifier.publicKey(), viewing.publicKey());
      // fromKeys keeps its own copies.
      return spr.LocalKeys.fromKeys({ address, viewingKeys: [viewing], nullifierKey: nullifier }, input.proofs);
    } finally {
      viewing.destroy();
      nullifier.destroy();
    }
  });
}

/**
 * Keys from a wallet's signature over NOCT's unlock text. Throws unless the
 * signature is this wallet's signature over exactly that text.
 */
export async function keysFromNoctSignature(input: { owner: string; ownerPublicKey: Uint8Array; signature: Uint8Array; proofs: ProofService }): Promise<LocalKeys> {
  if (input.ownerPublicKey.length !== 32 || input.signature.length !== 64) throw new Error("expected a 32-byte key and a 64-byte signature");
  if (!ed25519.verify(input.signature, noctUnlockMessage(input.owner), input.ownerPublicKey, { zip215: false })) {
    throw new Error("the signature is not this wallet's signature over NOCT's unlock text");
  }
  return expandSeed({ ownerPublicKey: input.ownerPublicKey, seed: input.signature, proofs: input.proofs });
}

const KEYS_MISMATCH = "WALLET_USER_RECORD_KEYS_MISMATCH";

export function isKeysMismatch(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === KEYS_MISMATCH;
}

/**
 * What to try after an unlock attempt fails, or null to stop: a wallet that
 * refuses the standard message, or standard keys that do not match this
 * wallet's registration (it was set up with NOCT's text), move on to NOCT's
 * text.
 */
export function nextUnlockMethod(tried: UnlockMethod, error: unknown): UnlockMethod | null {
  if (tried !== "standard") return null;
  if (error instanceof WalletActionError && (error.code === "refused_format" || error.code === "altered_message")) return "noct";
  if (isKeysMismatch(error)) return "noct";
  return null;
}
