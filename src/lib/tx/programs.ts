/** Top-level programs NOCT may ask a wallet to sign for, with display names. */
export const PROGRAMS = {
  system: "11111111111111111111111111111111",
  computeBudget: "ComputeBudget111111111111111111111111111111",
  token: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  token2022: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  associatedToken: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  memo: "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
  jupiterAggregatorV6: "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
  jupiterOrderEngine: "61DFfeTKM7trxYcPQCM78bJ794ddZprZpAwAnLiwTpYH",
  jupiterLendLending: "jup3YeL8QhtSx1e253b2FDvsMNC87fDrgQZivbrndc9",
  jupiterLendLiquidity: "jupeiUmn818Jg1ekPURTpr4mFo29p46vygyykFJ3wZC",
  jupiterLendVaults: "jupr81YtYssSyPt8jbnGuiWon5f6x9TcDEFxYe3Bdzi",
  jupiterLendOracle: "jupnw4B6Eqs7ft6rxpzYLJZYSnrpRgPcr589n5Kv4oc",
  jupiterLendRewards: "jup7TthsMgcR9Y3L277b8Eo9uboVSmu1utkuXHNUKar",
  privacyRingsPool: "ring1GaLCuJnkUMVkX2JeZLTTX17wKsV4fZmPVzXANW",
  privacyRingsRegistry: "regy3WAeRXMYuMYxr5iK3Bf9Arr3PcxGxyzAddbiqDQ",
  /** Assertion program some wallets (Phantom) append after review; it only checks state. */
  lighthouse: "L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95",
} as const;

export const PROGRAM_LABELS: Record<string, string> = {
  [PROGRAMS.system]: "System program",
  [PROGRAMS.computeBudget]: "Compute budget",
  [PROGRAMS.token]: "Token program",
  [PROGRAMS.token2022]: "Token-2022 program",
  [PROGRAMS.associatedToken]: "Associated token accounts",
  [PROGRAMS.memo]: "Memo",
  [PROGRAMS.jupiterAggregatorV6]: "Jupiter aggregator v6",
  [PROGRAMS.jupiterOrderEngine]: "Jupiter order engine (RFQ)",
  [PROGRAMS.jupiterLendLending]: "Jupiter Lend earn",
  [PROGRAMS.jupiterLendLiquidity]: "Jupiter Lend liquidity",
  [PROGRAMS.jupiterLendVaults]: "Jupiter Lend vaults",
  [PROGRAMS.jupiterLendOracle]: "Jupiter Lend oracle",
  [PROGRAMS.jupiterLendRewards]: "Jupiter Lend rewards",
  [PROGRAMS.privacyRingsPool]: "Privacy Rings shielded pool",
  [PROGRAMS.privacyRingsRegistry]: "Privacy Rings user registry",
  [PROGRAMS.lighthouse]: "Lighthouse (your wallet's safety checks)",
};

const BASE = [PROGRAMS.system, PROGRAMS.computeBudget, PROGRAMS.token, PROGRAMS.token2022, PROGRAMS.associatedToken];

/** Routers NOCT accepts from Jupiter /order, and the programs each may invoke. */
export const ROUTER_PROGRAMS: Record<string, readonly string[]> = {
  metis: [...BASE, PROGRAMS.jupiterAggregatorV6, PROGRAMS.memo],
  jupiterz: [...BASE, PROGRAMS.jupiterOrderEngine, PROGRAMS.memo],
};

/** dflow and okx settle through programs NOCT has not verified; they are excluded. */
export const EXCLUDED_ROUTERS = ["dflow", "okx"] as const;

export const EARN_PROGRAMS: readonly string[] = [...BASE, PROGRAMS.jupiterLendLending, PROGRAMS.jupiterLendLiquidity, PROGRAMS.jupiterLendRewards];
export const BORROW_PROGRAMS: readonly string[] = [
  ...BASE,
  PROGRAMS.jupiterLendVaults,
  PROGRAMS.jupiterLendLiquidity,
  PROGRAMS.jupiterLendOracle,
];
export const PRIVACY_PROGRAMS: readonly string[] = [...BASE, PROGRAMS.privacyRingsPool, PROGRAMS.privacyRingsRegistry];

export function programLabel(id: string): string {
  return PROGRAM_LABELS[id] ?? `Unrecognised program ${id.slice(0, 4)}…${id.slice(-4)}`;
}
