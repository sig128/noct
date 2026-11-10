import type { PrivacyClass } from "@/lib/privacy/model";

/** NOCT runs on Solana mainnet only. The field stays in every intent so a signature is bound to it. */
export type Network = "mainnet";
export const NETWORK: Network = "mainnet";

interface IntentBase {
  operationId: string;
  network: Network;
  adapter: string;
  protocolVersion: string;
  privacyClass: PrivacyClass;
  /** Privacy class the user asked for; differs only after an explicit choice. */
  requestedPrivacyClass: PrivacyClass;
  /** Wall-clock expiry (ms) after which the approval is void. */
  expiresAt: number;
  /** Programs the prepared transaction may invoke at top level. */
  allowedPrograms: readonly string[];
  /** The wallet that signs and pays network fees. */
  signer: string;
}

export interface SwapIntent extends IntentBase {
  kind: "swap";
  inputMint: string;
  outputMint: string;
  inputDecimals: number;
  outputDecimals: number;
  /** ExactIn: the precise amount debited. */
  maxInput: bigint;
  expectedOutput: bigint;
  /** Net amount after slippage and fees; the transaction must enforce it. */
  minNetOutput: bigint;
  slippageBps: number;
  router: string;
  allowedRouters: readonly string[];
  /** Total provider fee rate charged by the router, basis points. */
  feeBps: number;
  feeMint: string | null;
  networkFeeLamports: bigint;
  rentLamports: bigint;
  /** Output destination (the signer's wallet for public swaps). */
  recipient: string;
}

export interface EarnIntent extends IntentBase {
  kind: "earnDeposit" | "earnWithdraw";
  assetMint: string;
  receiptMint: string;
  amount: bigint;
  /** Minimum shares minted (deposit) or maximum shares burned (withdraw). */
  shareBound: bigint;
}

export interface BorrowIntent extends IntentBase {
  kind: "borrowOperate";
  vaultId: number;
  positionId: number;
  collateralMint: string;
  debtMint: string;
  /** Signed base units: positive adds to the position, negative removes. */
  collateralDelta: bigint;
  debtDelta: bigint;
}

export interface PrivateIntent extends IntentBase {
  kind: "privateDeposit" | "privateTransfer" | "privateWithdrawal" | "privateRegistration";
  assetMint: string;
  amount: bigint;
  /** Solana address of the recipient (or the signer for deposits). */
  recipient: string;
}

export type OperationIntent = SwapIntent | EarnIntent | BorrowIntent | PrivateIntent;

export interface IntentApproval {
  operationId: string;
  digest: string;
  approvedAt: number;
}

function canonical(value: unknown): unknown {
  if (typeof value === "bigint") return `n:${value.toString()}`;
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, canonical((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

export function canonicalIntentString(intent: OperationIntent): string {
  return JSON.stringify(canonical(intent));
}

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** SHA-256 over the canonical intent. Every material field participates. */
export async function intentDigest(intent: OperationIntent): Promise<string> {
  const data = new TextEncoder().encode(`noct/intent/v1\n${canonicalIntentString(intent)}`);
  return toHex(await crypto.subtle.digest("SHA-256", data));
}

export function freezeIntent<T extends OperationIntent>(intent: T): Readonly<T> {
  return Object.freeze({ ...intent, allowedPrograms: Object.freeze([...intent.allowedPrograms]) }) as Readonly<T>;
}

export async function approveIntent(intent: OperationIntent, now: number = Date.now()): Promise<IntentApproval> {
  if (now >= intent.expiresAt) throw new ApprovalError("expired", "This quote expired before approval.");
  return { operationId: intent.operationId, digest: await intentDigest(intent), approvedAt: now };
}

export class ApprovalError extends Error {
  constructor(
    readonly code: "expired" | "mismatch" | "wrong_operation",
    message: string,
    readonly changes: readonly string[] = [],
  ) {
    super(message);
  }
}

/** Throws unless `approval` was given for exactly this intent and it is still valid. */
export async function assertApprovalValid(intent: OperationIntent, approval: IntentApproval | null, now: number = Date.now()): Promise<void> {
  if (!approval) throw new ApprovalError("mismatch", "No approval recorded for this operation.");
  if (approval.operationId !== intent.operationId) throw new ApprovalError("wrong_operation", "Approval belongs to another operation.");
  if (now >= intent.expiresAt) throw new ApprovalError("expired", "The approved quote has expired. Review the new terms.");
  if ((await intentDigest(intent)) !== approval.digest) throw new ApprovalError("mismatch", "The operation changed after approval.");
}

const MATERIAL_LABELS: Record<string, string> = {
  maxInput: "amount you pay",
  amount: "amount",
  minNetOutput: "minimum you receive",
  expectedOutput: "expected output",
  feeBps: "provider fee",
  feeMint: "fee token",
  networkFeeLamports: "network fee",
  rentLamports: "account rent",
  recipient: "recipient",
  router: "route",
  allowedRouters: "route policy",
  slippageBps: "slippage",
  inputMint: "token you pay",
  outputMint: "token you receive",
  assetMint: "token",
  signer: "signing wallet",
  network: "network",
  privacyClass: "privacy mode",
  allowedPrograms: "programs invoked",
  collateralDelta: "collateral change",
  debtDelta: "debt change",
  shareBound: "share bound",
  vaultId: "market",
};

/** Human-readable list of material differences between two intents. */
export function describeIntentChanges(before: OperationIntent, after: OperationIntent): string[] {
  const a = canonical(before) as Record<string, unknown>;
  const b = canonical(after) as Record<string, unknown>;
  const changes: string[] = [];
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (key === "expiresAt" || key === "operationId") continue;
    if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) changes.push(MATERIAL_LABELS[key] ?? key);
  }
  return changes;
}

export function newOperationId(): string {
  return crypto.randomUUID();
}
