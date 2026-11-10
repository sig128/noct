/**
 * Privacy is a property of an operation on a specific integration, never a
 * UI setting. Each profile below states what an observer of the public chain
 * (and each service in the path) can learn, and cites the evidence.
 */

export type Visibility = "public" | "hidden" | "not_applicable";

export type PrivacyClass =
  /** A. Amounts/assets hidden; participants visible. */
  | "confidential_transfer"
  /** B. Participants hidden too, by a validated system. */
  | "anonymous_transfer"
  /** C. Public venue execution through a protocol-controlled account. */
  | "wallet_private_public_execution"
  /** D. Execution itself confidential. Only with an integration that establishes it. */
  | "fully_confidential_execution"
  /** E. Ordinary public operation. */
  | "public";

export interface Evidence {
  claim: string;
  source: string;
  verifiedOn: string;
}

export interface DisclosureProfile {
  id: string;
  privacyClass: PrivacyClass;
  /** One short line for the main flow. */
  summary: string;
  sender: Visibility;
  recipient: Visibility;
  asset: Visibility;
  amount: Visibility;
  /** Whether a public deposit or withdrawal leg is visible on chain. */
  publicEntryExit: "deposit" | "withdrawal" | "both" | "none";
  venueExecution: Visibility;
  /** Who can read the hidden parts. */
  authorizedViewers: string[];
  /** What services in the path observe beyond the chain. */
  metadataExposure: string[];
  custody: string;
  dependencies: string[];
  evidence: Evidence[];
}

const VERIFIED = "2026-11-10";

export const PROFILES = {
  publicSwap: {
    id: "publicSwap",
    privacyClass: "public",
    summary: "Public market execution.",
    sender: "public",
    recipient: "public",
    asset: "public",
    amount: "public",
    publicEntryExit: "none",
    venueExecution: "public",
    authorizedViewers: ["Anyone reading the Solana ledger"],
    metadataExposure: [
      "Jupiter receives your wallet address, the pair and amount when the transaction is built",
      "Jupiter's landing service submits the signed transaction",
      "NOCT's server relays these requests and sees their timing",
    ],
    custody: "Your wallet signs; tokens never leave your wallet's control.",
    dependencies: ["Jupiter Swap API v2 (order/execute)", "Solana RPC"],
    evidence: [
      { claim: "Assembled /order transactions cannot be modified; Jupiter lands them via /execute.", source: "developers.jup.ag/docs/swap", verifiedOn: VERIFIED },
    ],
  },
  privateDeposit: {
    id: "privateDeposit",
    // The deposit leg itself is an ordinary public transfer.
    privacyClass: "public",
    summary: "Public deposit into your private balance.",
    sender: "public",
    recipient: "public",
    asset: "public",
    amount: "public",
    publicEntryExit: "deposit",
    venueExecution: "not_applicable",
    authorizedViewers: ["Anyone reading the Solana ledger (the deposit leg)", "You, for the resulting private balance"],
    metadataExposure: ["The Helius indexer and RPC observe your requests and IP via NOCT's proxy", "NOCT's server relays requests and sees their timing"],
    custody: "Self-custodial in the Solana Privacy Rings shielded pool program.",
    dependencies: ["Solana Privacy Rings (Default Ring)", "Helius Photon indexer", "Helius prover (Nitro enclave)"],
    evidence: [
      { claim: "Deposit from a public balance: asset, amount, sender and recipient are public; only the resulting private balance is encrypted.", source: "helius.dev/docs/privacy/concepts/overview", verifiedOn: VERIFIED },
    ],
  },
  privateTransfer: {
    id: "privateTransfer",
    privacyClass: "confidential_transfer",
    summary: "Amounts hidden; addresses visible.",
    sender: "public",
    recipient: "public",
    asset: "hidden",
    amount: "hidden",
    publicEntryExit: "none",
    venueExecution: "not_applicable",
    authorizedViewers: ["You", "The recipient", "Anyone holding your derivation signature"],
    metadataExposure: [
      "The Helius prover enclave receives the transfer's proof inputs, encrypted to its attested key",
      "The Helius indexer observes which encrypted notes your wallet queries",
      "NOCT's server relays these requests and sees their timing",
    ],
    custody: "Self-custodial; every private transaction needs your wallet's signature.",
    dependencies: ["Solana Privacy Rings (Default Ring)", "Helius Photon indexer", "Helius prover (Nitro enclave)"],
    evidence: [
      { claim: "Default Ring transfer: asset, amount and memo private; sender and recipient public.", source: "helius.dev/docs/privacy/concepts/overview", verifiedOn: VERIFIED },
      { claim: "zkSecurity audit (Aug 2026) reported a high finding that the public private_tx_hash linked spent notes; check fix status before relying on spend unlinkability.", source: "privacy-rings/audits/zk_security_solana_privacy_rings_v1_audit.pdf", verifiedOn: VERIFIED },
      { claim: "Default Ring live on Solana mainnet; Helius states the core programs were audited by Certora, OtterSec and ZK Security.", source: "helius.dev/privacy; decrypt.co/382806", verifiedOn: VERIFIED },
    ],
  },
  privateWithdrawal: {
    id: "privateWithdrawal",
    // Asset, amount and recipient become public; classify the operation, not the pool.
    privacyClass: "public",
    summary: "Public withdrawal.",
    sender: "public",
    recipient: "public",
    asset: "public",
    amount: "public",
    publicEntryExit: "withdrawal",
    venueExecution: "not_applicable",
    authorizedViewers: ["Anyone reading the Solana ledger"],
    metadataExposure: ["Same services as a private transfer"],
    custody: "Funds leave the shielded pool to a public Solana address.",
    dependencies: ["Solana Privacy Rings (Default Ring)"],
    evidence: [
      { claim: "Withdraw to public balance: asset, amount and recipient are public; sender public in a confidential Ring.", source: "helius.dev/docs/privacy/concepts/overview", verifiedOn: VERIFIED },
    ],
  },
  earnSupply: {
    id: "earnSupply",
    privacyClass: "public",
    summary: "Public lending position.",
    sender: "public",
    recipient: "public",
    asset: "public",
    amount: "public",
    publicEntryExit: "none",
    venueExecution: "public",
    authorizedViewers: ["Anyone reading the Solana ledger"],
    metadataExposure: ["Jupiter receives your wallet address and amount when the transaction is built"],
    custody: "Assets sit in Jupiter Lend; you hold the receipt token (jlToken) in your wallet.",
    dependencies: ["Jupiter Lend Earn API (beta)", "Jupiter Lend programs"],
    evidence: [{ claim: "Earn deposit returns an unsigned transaction for the signer's public wallet.", source: "developers.jup.ag/docs/lend/earn/api", verifiedOn: VERIFIED }],
  },
  externalBorrow: {
    id: "externalBorrow",
    privacyClass: "public",
    summary: "Public loan position.",
    sender: "public",
    recipient: "public",
    asset: "public",
    amount: "public",
    publicEntryExit: "none",
    venueExecution: "public",
    authorizedViewers: ["Anyone reading the Solana ledger", "Liquidators"],
    metadataExposure: ["Jupiter receives your wallet address and amounts when the transaction is built"],
    custody: "Collateral is held by the Jupiter Lend vault; the position is an NFT in your wallet.",
    dependencies: ["Jupiter Lend Borrow API (beta)", "Jupiter Lend vault programs", "Vault oracle sources"],
    evidence: [{ claim: "Borrow /operate returns an unsigned VersionedTransaction for the signer.", source: "developers.jup.ag/docs/lend/borrow/api", verifiedOn: VERIFIED }],
  },
} satisfies Record<string, DisclosureProfile>;

export type ProfileId = keyof typeof PROFILES;

/** Higher number = more hidden. Used to detect a downgrade. */
const STRENGTH: Record<PrivacyClass, number> = {
  public: 0,
  wallet_private_public_execution: 1,
  confidential_transfer: 2,
  anonymous_transfer: 3,
  fully_confidential_execution: 4,
};

export function privacyStrength(c: PrivacyClass): number {
  return STRENGTH[c];
}

export type ModeResolution =
  | { kind: "as_requested"; profile: DisclosureProfile }
  | { kind: "downgrade_requires_choice"; requested: PrivacyClass; available: DisclosureProfile; reason: string }
  | { kind: "unavailable"; requested: PrivacyClass; reason: string };

/**
 * Resolves the requested privacy class against what an integration can do.
 * A weaker profile is never returned silently: the caller must present the
 * downgrade and obtain an explicit choice before anything is signed.
 */
export function resolvePrivacyMode(requested: PrivacyClass, available: DisclosureProfile | null, reason: string): ModeResolution {
  if (!available) return { kind: "unavailable", requested, reason };
  if (privacyStrength(available.privacyClass) >= privacyStrength(requested)) return { kind: "as_requested", profile: available };
  return { kind: "downgrade_requires_choice", requested, available, reason };
}

export class PrivacyDowngradeError extends Error {
  constructor(readonly requested: PrivacyClass, readonly actual: PrivacyClass) {
    super(`Refusing to sign: requested ${requested} but the prepared operation is ${actual}, and no explicit downgrade choice was recorded.`);
  }
}

/** Last check before signing. Throws unless the downgrade was explicitly accepted. */
export function assertNoSilentDowngrade(requested: PrivacyClass, actual: PrivacyClass, explicitlyAccepted: PrivacyClass | null): void {
  if (privacyStrength(actual) >= privacyStrength(requested)) return;
  if (explicitlyAccepted === actual) return;
  throw new PrivacyDowngradeError(requested, actual);
}

export const UNAVAILABLE = {
  privateSwap:
    "No private swap is live on mainnet yet. Helius's example swap program uses public test keys, so anyone could forge its proofs; a mainnet version needs its own key setup and an audit.",
  anonymousTransfer:
    "Anonymous transfers need a Custom Ring program. NOCT has no Custom Ring deployment, and Custom Ring mainnet readiness is unverified.",
  privateEarn:
    "Jupiter Lend positions are held by a public wallet. No privacy custody integration for receipt tokens is available.",
  nativeCredit:
    "Confidential credit needs circuits, a settlement program, liquidation monitoring and audits. Only a local reference model exists.",
} as const;
