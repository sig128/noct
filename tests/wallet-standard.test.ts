import { describe, expect, it } from "vitest";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import { liveAccount, signExactMessage, walletReason, WalletActionError, type WalletOption } from "@/lib/wallet/standard";

const ADDRESS = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";

function account(): WalletAccount {
  return Object.freeze({ address: ADDRESS, publicKey: new Uint8Array(32).fill(1), chains: ["solana:mainnet"] as const, features: ["solana:signMessage"] as const });
}

function option(signMessage: (input: { account: WalletAccount; message: Uint8Array }) => Promise<unknown>, accounts: WalletAccount[] = []): WalletOption {
  const wallet = {
    version: "1.0.0",
    name: "Phantom",
    icon: "data:image/svg+xml;base64,",
    chains: ["solana:mainnet"],
    accounts,
    features: { "solana:signMessage": { version: "1.0.0", signMessage: async (...inputs: { account: WalletAccount; message: Uint8Array }[]) => [await signMessage(inputs[0]!)] } },
  } as unknown as Wallet;
  return { name: "Phantom", icon: "", wallet, canSignTransaction: true, signsV1: true, canSignMessage: true };
}

const MESSAGE = Uint8Array.from([0xff, 0x73, 0x6f, 0x6c, 1, 2, 3]);
const SIGNATURE = new Uint8Array(64).fill(9);

describe("wallet message signing", () => {
  it("signs with the wallet's current object for the account, not a stale one", async () => {
    const stale = account();
    const fresh = account();
    const wallet = option(async (input) => {
      if (input.account !== fresh) throw new Error("invalid account");
      return { signedMessage: input.message, signature: SIGNATURE };
    }, [fresh]);
    expect(liveAccount(wallet, stale)).toBe(fresh);
    await expect(signExactMessage(wallet, stale, MESSAGE)).resolves.toEqual(SIGNATURE);
  });

  it("shows the wallet's own reason when it cannot sign, as plain text", async () => {
    const wallet = option(async () => {
      throw new Error("Messages that start with the off‮-chain prefix are not supported");
    });
    const error = await signExactMessage(wallet, account(), MESSAGE).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WalletActionError);
    expect((error as WalletActionError).code).toBe("failed");
    expect((error as WalletActionError).message).toBe("Phantom could not sign the message. The wallet said: Messages that start with the off-chain prefix are not supported.");
  });

  it("keeps a declined request a decline, and a signature over other bytes a refusal", async () => {
    const declined = await signExactMessage(
      option(async () => {
        throw Object.assign(new Error("User rejected the request."), { code: 4001 });
      }),
      account(),
      MESSAGE,
    ).catch((e: unknown) => e);
    expect((declined as WalletActionError).code).toBe("rejected");

    const altered = await signExactMessage(option(async (input) => ({ signedMessage: Uint8Array.from([0, ...input.message]), signature: SIGNATURE })), account(), MESSAGE).catch((e: unknown) => e);
    expect((altered as WalletActionError).code).toBe("altered_message");
  });

  it("bounds the wallet's reason and ignores anything that is not text", () => {
    expect(Array.from(walletReason(new Error("x".repeat(400)))).length).toBe(160);
    expect(walletReason({ message: { nested: true } })).toBe("");
    expect(walletReason(undefined)).toBe("");
  });
});
