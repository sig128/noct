import { describe, expect, it } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import { AccountRole, address, appendTransactionMessageInstructions, compileTransaction, createTransactionMessage, getTransactionDecoder, getTransactionEncoder, pipe, setTransactionMessageFeePayer, setTransactionMessageLifetimeUsingBlockhash, type Blockhash } from "@solana/kit";
import { deriveWallet, isWalletsSignature, MAX_WALLETS, signWithWallet, walletsMessage, walletsText } from "@/lib/wallets/derive";

const SECRET = new Uint8Array(32).fill(3);
const PUBLIC = ed25519.getPublicKey(SECRET);
const OWNER = "Owner1111111111111111111111111111111111111";

describe("NOCT wallets", () => {
  it("keeps the wallets text fixed, since any change derives different wallets", () => {
    expect(walletsText("Abc")).toBe(
      [
        "NOCT wallets",
        "",
        "Sign to open your NOCT wallets. They are created from this signature, so this wallet always opens the same ones. Signing is free and moves no funds.",
        "",
        "Only sign this in NOCT. Anyone who gets this signature controls these wallets and their funds.",
        "",
        "Wallet: Abc",
        "Version: 1",
      ].join("\n"),
    );
  });

  it("derives the same distinct wallets from the same signature, up to ten", () => {
    const seed = ed25519.sign(walletsMessage(OWNER), SECRET);
    expect(isWalletsSignature(OWNER, PUBLIC, seed)).toBe(true);
    expect(isWalletsSignature(OWNER, PUBLIC, ed25519.sign(new TextEncoder().encode("other"), SECRET))).toBe(false);
    const first = Array.from({ length: MAX_WALLETS }, (_, i) => deriveWallet(seed, i).address);
    const again = Array.from({ length: MAX_WALLETS }, (_, i) => deriveWallet(new Uint8Array(seed), i).address);
    expect(again).toEqual(first);
    expect(new Set(first).size).toBe(MAX_WALLETS);
    expect(() => deriveWallet(seed, MAX_WALLETS)).toThrow();
    expect(() => deriveWallet(seed.slice(0, 32), 0)).toThrow();
  });

  it("signs a transaction for a wallet with a signature that verifies", () => {
    const seed = ed25519.sign(walletsMessage(OWNER), SECRET);
    const wallet = deriveWallet(seed, 2);
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayer(address(wallet.address), m),
      (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: "EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k" as Blockhash, lastValidBlockHeight: 10n }, m),
      (m) => appendTransactionMessageInstructions([{ programAddress: address("11111111111111111111111111111111"), accounts: [{ address: address(wallet.address), role: AccountRole.WRITABLE_SIGNER }], data: new Uint8Array([2, 0, 0, 0]) }], m),
    );
    const wire = new Uint8Array(getTransactionEncoder().encode(compileTransaction(message)));
    const signed = getTransactionDecoder().decode(signWithWallet(wallet, wire));
    const signature = (signed.signatures as Record<string, Uint8Array | null>)[wallet.address]!;
    expect(ed25519.verify(signature, new Uint8Array(signed.messageBytes), wallet.publicKey)).toBe(true);
    expect(() => signWithWallet(deriveWallet(seed, 3), wire)).toThrow(/not a signer/);
  });
});
