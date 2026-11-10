import { beforeAll, describe, expect, it } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import type { ProofService } from "@heliuslabs/spr";
import { expandSeed, keysFromNoctSignature, nextUnlockMethod, noctUnlockMessage, noctUnlockText } from "@/lib/adapters/privacy/unlock";
import { unlockError } from "@/lib/client/session";
import { WalletActionError } from "@/lib/wallet/standard";

const unused = async () => {
  throw new Error("not used");
};
const proofs = { prove: unused, proveMerge: unused } as unknown as ProofService;
const SECRET = new Uint8Array(32).fill(5);
const PUBLIC = ed25519.getPublicKey(SECRET);
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

let owner: string;
beforeAll(async () => {
  const keypair = await import("@heliuslabs/spr/keypair");
  if (!keypair.isPoseidonInitialized()) await keypair.initializePoseidon();
  const kit = await import("@solana/kit");
  owner = kit.getAddressDecoder().decode(PUBLIC);
});

describe("unlocking a private balance", () => {
  it("keeps NOCT's unlock text fixed, since any change derives different keys", () => {
    expect(noctUnlockText("Owner111")).toBe(
      [
        "NOCT private balance",
        "",
        "Sign to open your private balance (Solana Privacy Rings) in NOCT. Signing is free and moves no funds.",
        "",
        "Only sign this in NOCT. Anyone who gets this signature can see your private balance and history.",
        "",
        "Wallet: Owner111",
        "Key version: 1",
      ].join("\n"),
    );
  });

  it("expands a seed into exactly the keys the SDK derives from that seed", async () => {
    const spr = await import("@heliuslabs/spr");
    const keypair = await import("@heliuslabs/spr/keypair");
    const kit = await import("@solana/kit");
    const seed = ed25519.sign(keypair.ed25519DerivationMessage(PUBLIC as never), SECRET);
    const sdk = spr.LocalKeys.fromDerivationSeed({ solanaPublicKey: kit.address(owner), derivationSeed: new Uint8Array(seed) }, proofs);
    const ours = await expandSeed({ ownerPublicKey: PUBLIC, seed: new Uint8Array(seed), proofs });
    expect(hex(ours.address().toBytes())).toBe(hex(sdk.address().toBytes()));
  });

  it("derives the same keys every time from the wallet's signature over NOCT's text, and refuses any other signature", async () => {
    const signature = ed25519.sign(noctUnlockMessage(owner), SECRET);
    const first = await keysFromNoctSignature({ owner, ownerPublicKey: PUBLIC, signature: new Uint8Array(signature), proofs });
    const again = await keysFromNoctSignature({ owner, ownerPublicKey: PUBLIC, signature: new Uint8Array(signature), proofs });
    expect(hex(again.address().toBytes())).toBe(hex(first.address().toBytes()));

    const otherText = ed25519.sign(new TextEncoder().encode("something else"), SECRET);
    await expect(keysFromNoctSignature({ owner, ownerPublicKey: PUBLIC, signature: new Uint8Array(otherText), proofs })).rejects.toThrow(/not this wallet's signature/);
    const otherKey = ed25519.sign(noctUnlockMessage(owner), new Uint8Array(32).fill(6));
    await expect(keysFromNoctSignature({ owner, ownerPublicKey: PUBLIC, signature: new Uint8Array(otherKey), proofs })).rejects.toThrow(/not this wallet's signature/);
  });

  it("moves to NOCT's text only when the wallet refuses the standard message or its keys don't match the registration", () => {
    expect(nextUnlockMethod("standard", new WalletActionError("refused_format", "x"))).toBe("noct");
    expect(nextUnlockMethod("standard", new WalletActionError("altered_message", "x"))).toBe("noct");
    expect(nextUnlockMethod("standard", { code: "WALLET_USER_RECORD_KEYS_MISMATCH" })).toBe("noct");
    expect(nextUnlockMethod("standard", new WalletActionError("rejected", "x"))).toBeNull();
    expect(nextUnlockMethod("standard", new Error("network"))).toBeNull();
    expect(nextUnlockMethod("noct", new WalletActionError("refused_format", "x"))).toBeNull();
  });

  it("explains a balance set up with the standard message that this wallet can't sign", () => {
    const mismatch = Object.assign(new Error("This wallet is registered with different privacy keys, so payments to it would go elsewhere."), { code: "WALLET_USER_RECORD_KEYS_MISMATCH" });
    expect(unlockError(mismatch, "noct", new WalletActionError("refused_format", "x"), "Phantom")).toBe(
      "This wallet's private balance was set up with Privacy Rings' standard message, which Phantom won't sign. Open it with a wallet app that signs that message, using the same account.",
    );
    expect(unlockError(mismatch, "standard", null, "Phantom")).toBe(mismatch.message);
    expect(unlockError(new WalletActionError("rejected", "Signature declined in the wallet."), "noct", null, "Phantom")).toBe("Signature declined in the wallet.");
  });
});
