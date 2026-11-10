import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WalletAccount } from "@wallet-standard/base";
import { txFlow, useTxFlow, type BuiltTx, type TxSpec } from "@/lib/client/tx-flow";
import { journal, reservations, useActivity, useWallet } from "@/lib/client/stores";
import { PROFILES } from "@/lib/privacy/model";
import { PROGRAMS, ROUTER_PROGRAMS } from "@/lib/tx/programs";
import type { SwapIntent } from "@/lib/operations/intent";
import type { WalletOption } from "@/lib/wallet/standard";
import { keypair, signWith, unsignedTx } from "./helpers/tx";

type RpcHandler = (method: string, params: unknown[]) => unknown;

function stubRpc(handler: RpcHandler) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { id: number; method: string; params: unknown[] };
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: handler(body.method, body.params) }), { status: 200, headers: { "content-type": "application/json" } });
    }),
  );
}

function intentFor(signer: string, operationId: string, extra: Partial<SwapIntent> = {}): SwapIntent {
  return {
    kind: "swap",
    operationId,
    network: "mainnet",
    adapter: "test",
    protocolVersion: "1",
    privacyClass: "public",
    requestedPrivacyClass: "public",
    expiresAt: Date.now() + 20_000,
    allowedPrograms: ROUTER_PROGRAMS.metis!,
    signer,
    inputMint: "So11111111111111111111111111111111111111112",
    outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    inputDecimals: 9,
    outputDecimals: 6,
    maxInput: 1_000n,
    expectedOutput: 100n,
    minNetOutput: 99n,
    slippageBps: 50,
    router: "metis",
    allowedRouters: ["metis"],
    feeBps: 0,
    feeMint: null,
    networkFeeLamports: 5_000n,
    rentLamports: 0n,
    recipient: signer,
    ...extra,
  };
}

async function setup(opts: { reject?: number; alter?: (signer: string) => Uint8Array } = {}) {
  const { kp, address } = await keypair();
  let calls = 0;
  const sign = vi.fn(async ({ transaction }: { transaction: Uint8Array }) => {
    calls += 1;
    if (opts.reject && calls <= opts.reject) throw Object.assign(new Error("User rejected the request"), { code: 4001 });
    // A wallet that rewrites the transaction before signing (as Phantom does when it adds safety checks).
    return [{ signedTransaction: await signWith(kp, opts.alter ? opts.alter(address) : transaction) }];
  });
  const option = {
    name: "Test wallet",
    icon: "data:image/svg+xml;base64,",
    canSignTransaction: true,
    signsV1: true,
    canSignMessage: true,
    wallet: { name: "Test wallet", chains: ["solana:mainnet"], accounts: [], features: { "solana:signTransaction": { version: "1.0.0", supportedTransactionVersions: [0], signTransaction: sign } } },
  } as unknown as WalletOption;
  const account = { address, publicKey: new Uint8Array(32), chains: ["solana:mainnet"], features: [] } as unknown as WalletAccount;
  useWallet.setState({ option, account, address, status: "connected", epoch: 7 });
  return { address, sign };
}

const simulateOk: RpcHandler = (method) => (method === "simulateTransaction" ? { context: { slot: 1 }, value: { err: null, logs: [], unitsConsumed: 1000 } } : null);

function spec(signer: string, over: Partial<TxSpec> = {}, wirePrograms: string[] = [PROGRAMS.jupiterAggregatorV6]): TxSpec {
  return {
    kind: "swap",
    title: "Test swap",
    network: "mainnet",
    signer,
    disclosure: PROFILES.publicSwap,
    requestedPrivacy: "public",
    activityDetail: "1 SOL",
    primaryLabel: "Sign",
    simulate: true,
    async build({ operationId }): Promise<BuiltTx> {
      return { wire: unsignedTx(signer, wirePrograms), lastValidBlockHeight: 150n, intent: intentFor(signer, operationId), rows: [], expiresAt: Date.now() + 20_000 };
    },
    policy: () => ({ feePayer: signer, allowedPrograms: ROUTER_PROGRAMS.metis!, allowedVersions: [0] }),
    submit: async () => ({ status: "unknown", signature: null, message: "Timed out waiting for the relay." }),
    ...over,
  };
}

beforeEach(() => {
  useTxFlow.setState({ open: false, spec: null, operationId: null, phase: "editing", built: null });
  useActivity.getState().clear();
  reservations.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("transaction coordinator", () => {
  it("after a submission timeout it reconciles by signature and completes without resubmitting", async () => {
    const { address, sign } = await setup();
    let statusCalls = 0;
    stubRpc((method) => {
      if (method === "simulateTransaction") return { context: { slot: 1 }, value: { err: null, logs: [], unitsConsumed: 1200 } };
      if (method === "getSignatureStatuses") {
        statusCalls += 1;
        return { context: { slot: 1 }, value: [statusCalls >= 2 ? { slot: 5, err: null, confirmationStatus: "confirmed" } : null] };
      }
      if (method === "getBlockHeight") return 100;
      throw new Error(`unexpected ${method}`);
    });
    await txFlow.start(spec(address));
    expect(useTxFlow.getState().phase).toBe("awaitingApproval");
    expect(useTxFlow.getState().simulation?.ok).toBe(true);
    await txFlow.approve();
    const s = useTxFlow.getState();
    expect(s.phase).toBe("completed");
    expect(sign).toHaveBeenCalledTimes(1);
    const record = journal.get(s.operationId!)!;
    expect(record.submissions).toHaveLength(1);
    expect(record.phase).toBe("completed");
    expect(useActivity.getState().items[0]!.phase).toBe("completed");
  });

  it("sends a transaction the wallet only added its own safety checks to, and says so", async () => {
    const { address } = await setup({ alter: (signer) => unsignedTx(signer, [PROGRAMS.jupiterAggregatorV6, PROGRAMS.lighthouse]) });
    stubRpc(simulateOk);
    let noteWhenSent: string | null | undefined;
    const submit = vi.fn(async () => {
      noteWhenSent = useTxFlow.getState().note;
      return { status: "confirmed" as const, signature: "5".repeat(88) };
    });
    await txFlow.start(spec(address, { submit }));
    await txFlow.approve();
    expect(submit).toHaveBeenCalledTimes(1);
    expect(useTxFlow.getState().phase).toBe("completed");
    expect(noteWhenSent).toMatch(/added its own safety checks \(Lighthouse/);
  });

  it("does not send a transaction the wallet changed in any other way, and says what changed", async () => {
    const submit = vi.fn(async () => ({ status: "unknown" as const, signature: null, message: "x" }));
    const { address } = await setup({ alter: (signer) => unsignedTx(signer, [PROGRAMS.jupiterAggregatorV6, "Vote111111111111111111111111111111111111111"]) });
    stubRpc(simulateOk);
    await txFlow.start(spec(address, { submit }));
    await txFlow.approve();
    const s = useTxFlow.getState();
    expect(submit).not.toHaveBeenCalled();
    expect(s.phase).toBe("rejected");
    expect(s.error).toMatch(/Your wallet changed the transaction after review \(it added or changed an instruction for Unrecognised program Vote…1111\), so NOCT did not send it\./);
  });

  it("blocks signing when the transaction invokes a program outside the allowlist", async () => {
    const { address, sign } = await setup();
    stubRpc(() => ({ context: { slot: 1 }, value: { err: null, logs: [] } }));
    await txFlow.start(spec(address, {}, [PROGRAMS.jupiterAggregatorV6, "Vote111111111111111111111111111111111111111"]));
    expect(useTxFlow.getState().violations.length).toBeGreaterThan(0);
    expect(txFlow.canApprove().ok).toBe(false);
    await txFlow.approve();
    expect(sign).not.toHaveBeenCalled();
  });

  it("blocks signing when simulation fails", async () => {
    const { address, sign } = await setup();
    stubRpc((method) => (method === "simulateTransaction" ? { context: { slot: 1 }, value: { err: { InstructionError: [0, { Custom: 6001 }] }, logs: ["Program log: SlippageToleranceExceeded"] } } : null));
    await txFlow.start(spec(address));
    expect(useTxFlow.getState().simulation).toMatchObject({ ok: false });
    expect(txFlow.canApprove().reason).toMatch(/simulation/);
    await txFlow.approve();
    expect(sign).not.toHaveBeenCalled();
  });

  it("a wallet or network change during review invalidates the operation", async () => {
    const { address, sign } = await setup();
    stubRpc((method) => (method === "simulateTransaction" ? { context: { slot: 1 }, value: { err: null, logs: [] } } : null));
    await txFlow.start(spec(address));
    useWallet.getState().bump();
    await txFlow.approve();
    expect(sign).not.toHaveBeenCalled();
    expect(useTxFlow.getState().open).toBe(false);
    expect(useTxFlow.getState().note).toMatch(/changed/);
  });

  it("a declined signature returns to a recoverable state and can be retried", async () => {
    const { address, sign } = await setup({ reject: 1 });
    stubRpc((method) => {
      if (method === "simulateTransaction") return { context: { slot: 1 }, value: { err: null, logs: [] } };
      if (method === "getSignatureStatuses") return { context: { slot: 1 }, value: [{ slot: 9, err: null, confirmationStatus: "confirmed" }] };
      return 100;
    });
    await txFlow.start(spec(address, { submit: async () => ({ status: "confirmed", signature: "x", rows: [] }) }));
    await txFlow.approve();
    expect(useTxFlow.getState().phase).toBe("rejected");
    expect(useTxFlow.getState().error).toMatch(/declined/);
    await txFlow.approve();
    expect(sign).toHaveBeenCalledTimes(2);
    expect(useTxFlow.getState().phase).toBe("completed");
  });

  it("expired terms cannot be signed", async () => {
    const { address, sign } = await setup();
    stubRpc((method) => (method === "simulateTransaction" ? { context: { slot: 1 }, value: { err: null, logs: [] } } : null));
    await txFlow.start(
      spec(address, {
        async build({ operationId }) {
          return { wire: unsignedTx(address, [PROGRAMS.jupiterAggregatorV6]), lastValidBlockHeight: 150n, intent: intentFor(address, operationId, { expiresAt: Date.now() - 1 }), rows: [], expiresAt: Date.now() - 1 };
        },
      }),
    );
    await txFlow.approve();
    expect(sign).not.toHaveBeenCalled();
    expect(useTxFlow.getState().phase).toBe("staleQuote");
  });

  it("a weaker privacy outcome needs the user's explicit acceptance", async () => {
    const { address } = await setup();
    stubRpc(simulateOk);
    await txFlow.start(
      spec(address, {
        requestedPrivacy: "confidential_transfer",
        downgradeNotice: "This becomes a public withdrawal.",
        submit: async () => ({ status: "confirmed", signature: "sig-1", rows: [] }),
      }),
    );
    expect(txFlow.canApprove()).toEqual({ ok: false, reason: "Confirm the privacy change to continue." });
    await txFlow.approve();
    expect(useTxFlow.getState().phase).toBe("awaitingApproval");
    txFlow.setDowngradeAccepted(true);
    await txFlow.approve();
    expect(useTxFlow.getState().phase).toBe("completed");
  });

  it("refuses to reserve funds another operation already holds", async () => {
    const { address, sign } = await setup();
    stubRpc(simulateOk);
    reservations.reserve({ operationId: "other", mint: "So11111111111111111111111111111111111111112", amount: 900n, source: "public" }, 1_000n);
    await txFlow.start(spec(address, { reserve: { mint: "So11111111111111111111111111111111111111112", amount: 500n, source: "public", available: 1_000n }, submit: async () => ({ status: "confirmed", signature: "sig-2" }) }));
    await txFlow.approve();
    expect(useTxFlow.getState().phase).toBe("awaitingApproval");
    expect(useTxFlow.getState().error).toMatch(/Another operation/);
    expect(sign).not.toHaveBeenCalled();
  });
});

describe("guided sequences (paying from the private balance)", () => {
  let signer = "";
  // Each step is a full operation: real wire bytes, policy check, simulation and a wallet signature.
  const step = (title: string, outputs: Record<string, string> | undefined, privacy: "public" | "confidential_transfer" = "public", notice?: string): TxSpec =>
    spec(signer, {
      title,
      requestedPrivacy: privacy,
      downgradeNotice: notice,
      activityDetail: title,
      submit: async () => ({ status: "confirmed", signature: `sig-${title}`, outputs }),
    });

  beforeEach(async () => {
    signer = (await setup()).address;
    stubRpc(simulateOk);
  });

  it("runs each step only after the previous one confirmed, passing settled amounts forward", async () => {
    const { sequence, useSequence } = await import("@/lib/client/sequence");
    const seen: Record<string, string>[] = [];
    await sequence.start("Private-balance swap", [
      { label: "move out", spec: () => step("out", undefined, "confidential_transfer", "This runs in three public steps.") },
      { label: "swap", spec: () => step("swap", { received: "4200", minimum: "4100" }) },
      {
        label: "move in",
        spec: (o) => {
          seen.push({ ...o });
          return step(`in-${o.received}`, undefined);
        },
      },
    ]);
    // Step 1 needs the explicit consent to a public flow.
    expect(useTxFlow.getState().phase).toBe("awaitingApproval");
    expect(txFlow.canApprove().ok).toBe(false);
    txFlow.setDowngradeAccepted(true);
    await txFlow.approve();
    expect(useTxFlow.getState().phase).toBe("completed");
    expect(sequence.next()?.label).toBe("swap");

    await sequence.advance();
    expect(useSequence.getState().index).toBe(1);
    await txFlow.approve();
    expect(useTxFlow.getState().outputs).toEqual({ received: "4200", minimum: "4100" });

    await sequence.advance();
    expect(seen).toEqual([{ received: "4200", minimum: "4100" }]);
    expect(useTxFlow.getState().spec?.title).toBe("in-4200");
    expect(sequence.next()).toBeNull();
    sequence.stop();
    expect(useSequence.getState().title).toBeNull();
  });

  it("does not advance before the current step completes", async () => {
    const { sequence, useSequence } = await import("@/lib/client/sequence");
    await sequence.start("Two steps", [
      { label: "a", spec: () => step("a", undefined) },
      { label: "b", spec: () => step("b", undefined) },
    ]);
    await sequence.advance();
    expect(useSequence.getState().index).toBe(0);
    expect(useTxFlow.getState().spec?.title).toBe("a");
    sequence.stop();
  });

  it("stops with a message instead of guessing when a step cannot be built", async () => {
    const { sequence, useSequence } = await import("@/lib/client/sequence");
    await sequence.start("Broken", [
      { label: "a", spec: () => step("a", undefined) },
      {
        label: "b",
        spec: () => {
          throw new Error("The amount received is not known yet.");
        },
      },
    ]);
    await txFlow.approve();
    await sequence.advance();
    expect(useSequence.getState().index).toBe(0);
    expect(useTxFlow.getState().error).toMatch(/not known/);
    sequence.stop();
  });
});
