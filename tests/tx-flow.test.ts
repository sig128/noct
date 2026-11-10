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

async function setup(opts: { reject?: number } = {}) {
  const { kp, address } = await keypair();
  let calls = 0;
  const sign = vi.fn(async ({ transaction }: { transaction: Uint8Array }) => {
    calls += 1;
    if (opts.reject && calls <= opts.reject) throw Object.assign(new Error("User rejected the request"), { code: 4001 });
    return [{ signedTransaction: await signWith(kp, transaction) }];
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

function spec(signer: string, over: Partial<TxSpec> = {}, wirePrograms: string[] = [PROGRAMS.jupiterAggregatorV6]): TxSpec {
  return {
    kind: "swap",
    title: "Test swap",
    network: "mainnet",
    signer,
    demo: false,
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
    await txFlow.start(
      spec(address, {
        demo: true,
        requestedPrivacy: "confidential_transfer",
        downgradeNotice: "This becomes a public withdrawal.",
        submit: async () => ({ status: "confirmed", signature: "demo-1", rows: [] }),
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
    const { address } = await setup();
    reservations.reserve({ operationId: "other", mint: "So11111111111111111111111111111111111111112", amount: 900n, source: "public" }, 1_000n);
    await txFlow.start(spec(address, { demo: true, reserve: { mint: "So11111111111111111111111111111111111111112", amount: 500n, source: "public", available: 1_000n }, submit: async () => ({ status: "confirmed", signature: "demo-2" }) }));
    await txFlow.approve();
    expect(useTxFlow.getState().phase).toBe("awaitingApproval");
    expect(useTxFlow.getState().error).toMatch(/Another operation/);
  });
});
