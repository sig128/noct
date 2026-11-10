# Integration matrix

Evidence date for everything below: **2026-11-10**, unless a row says otherwise. "Verified" means checked that day against the provider's documentation, the published package, or a live read-only response. It never means audited, endorsed or safe for production funds.

No upstream source commits are pinned. Code dependencies are pinned by exact version in `package.json` with integrity hashes in `package-lock.json`; HTTP services are pinned by versioned path (`/swap/v2`, `/tokens/v2`, `/price/v3`, `/lend/v1`, `/v2/updates`).

## At a glance

| Integration | Version or contract | Networks NOCT uses | Used for | State in NOCT |
| --- | --- | --- | --- | --- |
| Jupiter Swap API | v2 `GET /swap/v2/order`, `POST /swap/v2/execute` | mainnet | Public swaps | Implemented; exercised against fixtures; not run with real funds |
| Jupiter Tokens API | v2 `GET /tokens/v2/search` | mainnet | Search, exact-mint lookup, metadata | Implemented; fixture-tested |
| Jupiter Price API | v3 `GET /price/v3?ids=` | mainnet | USD display only | Implemented; fixture-tested |
| Jupiter Lend Earn API | beta, `/lend/v1/earn/*` | mainnet | Supply and withdraw | Implemented; fixture-tested |
| Jupiter Lend Borrow API | beta, `/lend/v1/borrow/*` | mainnet | Vaults, positions, operate | Implemented; fixture-tested |
| Solana Privacy Rings | `@heliuslabs/spr` **0.9.0-alpha** | devnet; mainnet gated off | Private balance, private transfer, public withdrawal | Implemented; **not run against live services** (needs `HELIUS_API_KEY`) |
| Pyth price service | Hermes-compatible `GET /v2/updates/price/latest` | n/a (off-chain) | Independent check before risk-increasing borrow actions | Implemented; needs `PYTH_API_KEY` |
| Solana JSON-RPC | standard methods (allowlisted) | mainnet, devnet | Balances, mint accounts, simulation, submission, status | Implemented; fixture-tested |
| Wallet Standard | `@wallet-standard/app` 1.1.1, `@solana/wallet-standard-features` 1.5.0 | n/a | Connect, sign transaction, sign derivation message | Implemented; tested with an injected QA wallet only |

## Jupiter Swap API v2

- Base: `JUPITER_API_BASE` (default `https://api.jup.ag`). Optional `JUPITER_API_KEY` is added server-side as `x-api-key`. Without a key the keyless tier applies, with a low rate limit.
- `GET /swap/v2/order` with `inputMint`, `outputMint`, `amount` (base units), `swapMode=ExactIn`, `excludeRouters=dflow,okx`, `maxSupportedTransactionVersion=0`, optional `taker` and `slippageBps`. Without `taker` the response is a quote; with it, an assembled transaction plus `requestId`.
- `POST /swap/v2/execute` with `{ signedTransaction, requestId, lastValidBlockHeight? }`. Jupiter lands the transaction. NOCT never retries this call; it reconciles by signature instead.
- Accepted routers and the top-level programs each may invoke (enforced on the server before the browser sees the transaction, and again on the client and on `/execute`):
  - `metis`: System, Compute Budget, Token, Token-2022, Associated Token, Memo, Jupiter aggregator v6
  - `jupiterz` (RFQ): System, Compute Budget, Token, Token-2022, Associated Token, Memo, Jupiter order engine; only the order's `maker`, `signatureFeePayer` or `prioritizationFeePayer` may co-sign or pay fees
- Excluded routers: `dflow`, `okx`. Their settlement programs were not verified, so they are excluded in the request and refused if returned.
- Evidence: assembled `/order` transactions are not to be modified and are landed via `/execute` (developers.jup.ag/docs/swap).

## Jupiter Tokens v2 and Price v3

- `GET /tokens/v2/search?query=` for text search; a comma-separated mint list performs exact lookups. Fields used: id, name, symbol, icon, decimals, tokenProgram, verification, organic score, holder count, liquidity, audit flags, mint and freeze authority, launchpad, creation time.
- All metadata is treated as untrusted: names and symbols are stripped of bidirectional and zero-width characters and length-bounded; icons load only through `/api/token-icon` from an allowlist of hosts with content-type and magic-byte checks.
- `GET /price/v3?ids=` (up to 50 mints) for USD display. Prices never feed a transaction amount.

## Jupiter Lend (beta)

| Endpoint | Purpose | NOCT checks |
| --- | --- | --- |
| `GET /lend/v1/earn/tokens` | Markets, rates, conversion rates, withdrawable liquidity | Schema validation; integer strings only |
| `GET /lend/v1/earn/positions?users=` | Supplied positions | Address validation |
| `POST /lend/v1/earn/deposit`, `/withdraw` | Unsigned transaction for the signer | Fee payer is the signer, one signer, programs within the Earn set |
| `GET /lend/v1/borrow/vaults` | Vault parameters, oracle price and timestamp | Schema validation; scale handling below |
| `GET /lend/v1/borrow/positions?users=` | Position NFTs, collateral, debt | Address validation |
| `POST /lend/v1/borrow/operate` | Unsigned transaction for a collateral/debt change | Fee payer is the signer, one signer, programs within the Borrow set; simulation before signing |

Scales used by the vault math (`src/lib/credit/vault-math.ts`):

- `collateralFactor`, `liquidationThreshold`, `liquidationMaxLimit`: per mille (800 = 80%). Documented.
- Rates and borrow fee: basis points. Documented for Earn; live values agree.
- `liquidationPenalty`: basis points. **Inferred** from the Fluid convention; undocumented. The UI labels it "scale inferred, undocumented".
- `oraclePrice`: debt base units per collateral base unit × 1e18. **Derived** by cross-checking live vaults against token prices.

## Solana Privacy Rings

- Package: `@heliuslabs/spr` **0.9.0-alpha** (npm `latest` and `alpha` tags, package modified 2026-11-04). Loaded on demand in the browser only.
- Naming and version drift: Helius's privacy documentation names the TypeScript SDK `@heliuslabs/zolana` (npm `latest` 0.5.0-alpha, `alpha` tag 0.8.0-alpha) and links API references for 0.1.3-alpha. NOCT pins `@heliuslabs/spr` 0.9.0-alpha, the package whose README documents the endpoints and TEE policy used here. Re-check before upgrading.
- Ring: **Default Ring only.** Custom Rings (anonymous model, relayer-submitted) are not integrated.
- Programs (allowlisted for privacy transactions and the only `getProgramAccounts` targets the RPC relay permits):
  - Shielded pool `ring1GaLCuJnkUMVkX2JeZLTTX17wKsV4fZmPVzXANW`
  - User registry `regy3WAeRXMYuMYxr5iK3Bf9Arr3PcxGxyzAddbiqDQ`
- Services (defaults from the SDK README, overridable by env; the README calls the mainnet ones "deployment examples"):

  | Service | Devnet | Mainnet |
  | --- | --- | --- |
  | Indexer (Photon) | `https://d34xe1hqb2ibg2.cloudfront.net` | `https://dgcj4pjarvo65.cloudfront.net` |
  | Prover (Nitro enclave) | `https://dd73hh473h6ha.cloudfront.net` | `https://d3ky2kt0ntqxt1.cloudfront.net` |
  | Signed TEE policy | `SPR_POLICY_BASE/devnet.json` | `SPR_POLICY_BASE/mainnet.json` |

- Transport: the browser reaches all three through `/api/spr/{network}/{indexer|prover|policy}`, which adds the API key server-side. Prover requests are encrypted by the SDK to an enclave whose attestation it verifies against pinned policy signers, so the relay sees sizes, timing and routes only.
- Transactions: version 1 Solana transactions. Wallet support for v1 in `solana:signTransaction` is required and was **not** verified against any production wallet.
- Launch status, conflicting sources:
  - Helius privacy docs (helius.dev/docs/privacy, read 2026-11-10): "Status: Beta, devnet only — mainnet has not launched", and the programs are "under audit by three independent security firms", with no reports linked.
  - The 0.9.0-alpha README lists mainnet indexer and prover endpoints.
  - An audit report by zkSecurity (v1, August 2026) was observed in the project's repository listing earlier in this build. It reports a high-severity finding that the public `private_tx_hash` linked spent notes. Fix status was not verified.
  - NOCT therefore keeps **mainnet private balances off** (`SPR_MAINNET_ENABLED=false`) and treats the system as unaudited.
- Not usable for private swaps: Helius's example swap and escrow programs use deterministic test keys and are marked unsafe for production. NOCT does not route funds through them.

## Pyth price service

- `GET {PYTH_HERMES_BASE}/v2/updates/price/latest?ids[]=…&parsed=true` with `Authorization: Bearer {PYTH_API_KEY}`, server-side only. Default base `https://pyth.dourolabs.app/hermes`. The public Hermes endpoint stopped serving unauthenticated requests on 2026-08-26, so without a key the route returns `503 not_configured` and the borrow panel reports the independent check as unavailable.
- Feed ids (read from `/v2/price_feeds`, 2026-11-10): SOL, USDC, USDT, JUP, BONK, WIF, EURC, JitoSOL, mSOL. A mint without a mapped feed has no independent check; feeds are never guessed from a symbol.

## Solana RPC

- Browser calls go to `/api/rpc/{network}`; the server forwards to `SOLANA_RPC_URL_*`, else Helius (with key), else the public RPC.
- Allowed methods: `getAccountInfo`, `getBalance`, `getBlockHeight`, `getEpochInfo`, `getFeeForMessage`, `getGenesisHash`, `getHealth`, `getLatestBlockhash`, `getMinimumBalanceForRentExemption`, `getMultipleAccounts`, `getProgramAccounts` (Privacy Rings programs only), `getRecentPrioritizationFees`, `getSignatureStatuses`, `getSlot`, `getTokenAccountBalance`, `getTokenAccountsByOwner`, `getTransaction`, `getVersion`, `isBlockhashValid`, `sendTransaction`, `simulateTransaction`.

## Program IDs NOCT may ask a wallet to sign for

| Program | ID | Used by |
| --- | --- | --- |
| System | `11111111111111111111111111111111` | all |
| Compute Budget | `ComputeBudget111111111111111111111111111111` | all |
| Token | `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` | all |
| Token-2022 | `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` | all |
| Associated Token | `ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL` | all |
| Memo | `MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr` | swaps |
| Jupiter aggregator v6 | `JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4` | swaps (metis) |
| Jupiter order engine | `61DFfeTKM7trxYcPQCM78bJ794ddZprZpAwAnLiwTpYH` | swaps (jupiterz) |
| Jupiter Lend earn | `jup3YeL8QhtSx1e253b2FDvsMNC87fDrgQZivbrndc9` | earn |
| Jupiter Lend liquidity | `jupeiUmn818Jg1ekPURTpr4mFo29p46vygyykFJ3wZC` | earn, borrow |
| Jupiter Lend rewards | `jup7TthsMgcR9Y3L277b8Eo9uboVSmu1utkuXHNUKar` | earn |
| Jupiter Lend vaults | `jupr81YtYssSyPt8jbnGuiWon5f6x9TcDEFxYe3Bdzi` | borrow |
| Jupiter Lend oracle | `jupnw4B6Eqs7ft6rxpzYLJZYSnrpRgPcr589n5Kv4oc` | borrow |
| Privacy Rings shielded pool | `ring1GaLCuJnkUMVkX2JeZLTTX17wKsV4fZmPVzXANW` | private balance |
| Privacy Rings user registry | `regy3WAeRXMYuMYxr5iK3Bf9Arr3PcxGxyzAddbiqDQ` | private balance |

The allowlist covers top-level instructions. Programs those invoke by CPI are trusted to the invoking program. A transaction that references a top-level program through an address lookup table is refused because it cannot be checked before signing.

Upgrade authority: Settings reads each program's ProgramData account from the chain (`BPFLoaderUpgradeab1e11111111111111111111111`) and shows whether it is upgradeable and by whom, instead of relying on a stored claim.

## Wallet Standard

- Discovery via `@wallet-standard/app`; NOCT prefers an account that advertises the selected chain (`solana:mainnet` or `solana:devnet`).
- `solana:signTransaction` for every transaction (legacy and v0; v1 for Privacy Rings). NOCT never uses sign-and-send, so it can inspect, simulate, submit and reconcile itself.
- `solana:signMessage` to sign the exact Privacy Rings derivation message. The result is rejected if the wallet returns a different message.
