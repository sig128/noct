"use client";

import { getAddressDecoder } from "@solana/kit";
import type { Network } from "@/lib/operations/intent";
import { PROGRAMS } from "@/lib/tx/programs";
import { solanaRpc } from "./rpc";

export const UPGRADEABLE_LOADER = "BPFLoaderUpgradeab1e11111111111111111111111";

export interface ProgramAuthority {
  program: string;
  label: string;
  state: "upgradeable" | "immutable" | "not_upgradeable_loader" | "missing" | "error";
  authority: string | null;
  lastDeploySlot: bigint | null;
}

const decoder = getAddressDecoder();

/**
 * Reads who can replace a program's code. A program with an upgrade
 * authority can change any rule, including who may move funds.
 */
export async function readProgramAuthority(network: Network, program: string, label: string): Promise<ProgramAuthority> {
  try {
    const account = await solanaRpc.getAccountBytes(network, program);
    if (!account) return { program, label, state: "missing", authority: null, lastDeploySlot: null };
    if (account.owner !== UPGRADEABLE_LOADER) return { program, label, state: "not_upgradeable_loader", authority: null, lastDeploySlot: null };
    // UpgradeableLoaderState::Program { programdata_address } → tag u32 = 2
    const view = new DataView(account.data.buffer, account.data.byteOffset, account.data.byteLength);
    if (view.getUint32(0, true) !== 2) return { program, label, state: "error", authority: null, lastDeploySlot: null };
    const programData = decoder.decode(account.data.subarray(4, 36));
    const pd = await solanaRpc.getAccountBytes(network, programData);
    if (!pd) return { program, label, state: "error", authority: null, lastDeploySlot: null };
    // ProgramData { slot: u64, upgrade_authority_address: Option<Pubkey> } → tag u32 = 3
    const pv = new DataView(pd.data.buffer, pd.data.byteOffset, pd.data.byteLength);
    if (pv.getUint32(0, true) !== 3) return { program, label, state: "error", authority: null, lastDeploySlot: null };
    const slot = pv.getBigUint64(4, true);
    const hasAuthority = pd.data[12] === 1;
    return {
      program,
      label,
      state: hasAuthority ? "upgradeable" : "immutable",
      authority: hasAuthority ? decoder.decode(pd.data.subarray(13, 45)) : null,
      lastDeploySlot: slot,
    };
  } catch {
    return { program, label, state: "error", authority: null, lastDeploySlot: null };
  }
}

export const GOVERNED_PROGRAMS: { program: string; label: string }[] = [
  { program: PROGRAMS.privacyRingsPool, label: "Privacy Rings shielded pool" },
  { program: PROGRAMS.privacyRingsRegistry, label: "Privacy Rings user registry" },
  { program: PROGRAMS.jupiterAggregatorV6, label: "Jupiter aggregator v6" },
  { program: PROGRAMS.jupiterLendLending, label: "Jupiter Lend earn" },
  { program: PROGRAMS.jupiterLendVaults, label: "Jupiter Lend vaults" },
];
