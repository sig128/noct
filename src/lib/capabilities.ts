import type { MintFacts } from "@/lib/tokens/mint-account";
import { extensionRestrictions, type Restriction } from "@/lib/tokens/mint-account";
import { UNAVAILABLE } from "@/lib/privacy/model";
import { NATIVE_SOL_MINT } from "@/lib/tokens/types";

export type CapabilityStatus = "available" | "unavailable" | "unknown";

export interface Capability {
  key: "publicRoute" | "privateHolding" | "privateEntryExit" | "privateSwap" | "earnMarket" | "borrowCollateral" | "borrowDebt";
  label: string;
  status: CapabilityStatus;
  detail: string;
}

export interface CapabilityInput {
  mint: string;
  /** Result of the most recent quote involving this mint, if any. */
  route: "found" | "none" | "unchecked";
  mintFacts: MintFacts | null | undefined;
  privacy: { enabled: boolean; reason: string | null };
  earnAssets: ReadonlySet<string>;
  collateralMints: ReadonlySet<string>;
  debtMints: ReadonlySet<string>;
}

const HOLDING_BLOCKERS: Restriction["code"][] = ["non_transferable", "permanent_delegate", "transfer_hook", "pausable", "default_frozen"];

/**
 * Per-token, per-action capability flags. Each answer is independent: a
 * tradable route says nothing about private custody, and private custody
 * says nothing about collateral eligibility.
 */
export function tokenCapabilities(input: CapabilityInput): { capabilities: Capability[]; restrictions: Restriction[] } {
  const restrictions = input.mintFacts ? extensionRestrictions(input.mintFacts) : [];
  const blocking = restrictions.filter((r) => HOLDING_BLOCKERS.includes(r.code));
  const isSol = input.mint === NATIVE_SOL_MINT;

  const publicRoute: Capability = {
    key: "publicRoute",
    label: "Public swap route",
    status: input.route === "found" ? "available" : input.route === "none" ? "unavailable" : "unknown",
    detail: input.route === "found" ? "Jupiter found an executable route for the selected pair." : input.route === "none" ? "Jupiter has no executable route for the selected pair." : "Checked when you request a quote.",
  };

  let holding: Capability;
  if (!input.privacy.enabled) {
    holding = { key: "privateHolding", label: "Private holding", status: "unavailable", detail: input.privacy.reason ?? "Private balances are not available here." };
  } else if (blocking.length > 0) {
    holding = { key: "privateHolding", label: "Private holding", status: "unavailable", detail: `NOCT does not shield this token: ${blocking[0]!.message}` };
  } else if (!isSol && input.mintFacts === undefined) {
    holding = { key: "privateHolding", label: "Private holding", status: "unknown", detail: "Mint not inspected yet." };
  } else if (input.mintFacts?.program === "token2022") {
    holding = { key: "privateHolding", label: "Private holding", status: "unknown", detail: "The SDK supports Token-2022, but this mint's extensions are not verified with the pool. The deposit build reports if the pool refuses it." };
  } else {
    holding = { key: "privateHolding", label: "Private holding", status: "available", detail: "Default Ring: token and amount hidden in transfers; addresses visible." };
  }

  const entryExit: Capability = {
    ...holding,
    key: "privateEntryExit",
    label: "Deposit and withdraw",
    detail: holding.status === "available" ? "Deposits and withdrawals are public transactions." : holding.detail,
  };

  return {
    restrictions,
    capabilities: [
      publicRoute,
      holding,
      entryExit,
      { key: "privateSwap", label: "Private swap settlement", status: "unavailable", detail: UNAVAILABLE.privateSwap },
      {
        key: "earnMarket",
        label: "Earn market",
        status: input.earnAssets.has(input.mint) ? "available" : "unavailable",
        detail: input.earnAssets.has(input.mint) ? "Jupiter Lend has an Earn market for this asset (public position)." : "No listed Earn market for this asset.",
      },
      {
        key: "borrowCollateral",
        label: "Accepted as collateral",
        status: input.collateralMints.has(input.mint) ? "available" : "unavailable",
        detail: input.collateralMints.has(input.mint) ? "At least one listed vault accepts it as collateral." : "No listed market accepts it as collateral. Tradable does not mean borrowable.",
      },
      {
        key: "borrowDebt",
        label: "Borrowable",
        status: input.debtMints.has(input.mint) ? "available" : "unavailable",
        detail: input.debtMints.has(input.mint) ? "At least one listed vault lends it." : "No listed market lends it.",
      },
    ],
  };
}
