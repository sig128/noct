import { ed25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { getAddressDecoder, getTransactionDecoder, getTransactionEncoder } from "@solana/kit";

/** How many NOCT wallets one connected wallet can open. */
export const MAX_WALLETS = 10;

/**
 * The text the connected wallet signs to open its NOCT wallets. The wallets
 * are derived from that signature, so the same wallet always opens the same
 * ones and nothing is stored. It must never change: different text derives
 * different wallets.
 */
export function walletsText(owner: string): string {
  return [
    "NOCT wallets",
    "",
    "Sign to open your NOCT wallets. They are created from this signature, so this wallet always opens the same ones. Signing is free and moves no funds.",
    "",
    "Only sign this in NOCT. Anyone who gets this signature controls these wallets and their funds.",
    "",
    `Wallet: ${owner}`,
    "Version: 1",
  ].join("\n");
}

export function walletsMessage(owner: string): Uint8Array {
  return new TextEncoder().encode(walletsText(owner));
}

/** True when `signature` is `ownerPublicKey`'s Ed25519 signature over walletsText(owner). */
export function isWalletsSignature(owner: string, ownerPublicKey: Uint8Array, signature: Uint8Array): boolean {
  if (ownerPublicKey.length !== 32 || signature.length !== 64) return false;
  try {
    return ed25519.verify(signature, walletsMessage(owner), ownerPublicKey, { zip215: false });
  } catch {
    return false;
  }
}

export interface DerivedWallet {
  /** 0-based; shown to people as index + 1. */
  readonly index: number;
  readonly address: string;
  readonly publicKey: Uint8Array;
  /** The Ed25519 private key. Kept in memory only. */
  readonly secret: Uint8Array;
}

const SALT = new TextEncoder().encode("NOCT wallets v1");

/** Wallet `index` from the 64-byte signature over walletsText. */
export function deriveWallet(seed: Uint8Array, index: number): DerivedWallet {
  if (seed.length !== 64) throw new Error("expected a 64-byte signature");
  if (!Number.isInteger(index) || index < 0 || index >= MAX_WALLETS) throw new Error(`wallet index must be 0 to ${MAX_WALLETS - 1}`);
  const secret = hkdf(sha256, seed, SALT, new TextEncoder().encode(`wallet ${index}`), 32);
  const publicKey = ed25519.getPublicKey(secret);
  return { index, address: getAddressDecoder().decode(publicKey), publicKey, secret };
}

/**
 * Adds this wallet's signature to a wire transaction it is a required signer
 * of. Other signature slots are left as they are.
 */
export function signWithWallet(wallet: DerivedWallet, wire: Uint8Array): Uint8Array {
  const decoded = getTransactionDecoder().decode(wire);
  const signatures = decoded.signatures as Record<string, Uint8Array | null>;
  if (!(wallet.address in signatures)) throw new Error("This wallet is not a signer of the transaction.");
  const signature = ed25519.sign(new Uint8Array(decoded.messageBytes), wallet.secret);
  return new Uint8Array(getTransactionEncoder().encode({ ...decoded, signatures: { ...signatures, [wallet.address]: signature } } as never));
}
