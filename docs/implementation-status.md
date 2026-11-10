# Implementation status

As of 2026-11-10. Five categories, from strongest evidence to none. "Fixtures" means the local stand-in for Jupiter and Solana RPC in `scripts/fixture-upstream.mjs`, which serves documented response shapes; it proves the code path, not the provider's live behaviour.

## 1. Verified in this build

Evidence: `npm run typecheck` (strict), 144 Vitest tests in 12 files, a production `next build`, 25 browser interaction checks (`npm run qa:interaction -- --slow`) and 38 screenshots at 1440, 1280, 768 and 390 px with no horizontal overflow and no console errors (`npm run qa:visual`), all against the production build backed by fixtures.

| Area | What was verified |
| --- | --- |
| Amount math | Base-unit parsing and formatting up to 24 decimals and u64 max, no rounding up, input normalisation, floor/ceil helpers, exact rational prices, MAX that keeps SOL for fees and rent and solves for input-side Token-2022 fees |
| Token safety | Metadata sanitising, icon proxy (public HTTPS hosts through an image service, the operator's own IPFS gateway, Helius's image cache with the metadata's own URL spelling, staggered attempts, no direct requests to public IPFS gateways, redirects kept on the allowlist, raster only), impostor ticker detection (Cyrillic, digit, lowercase-l lookalikes), risk notes, mint-account parsing for SPL and Token-2022 extensions, transfer-fee epochs |
| Quotes | Schema validation, staleness, latest-request-wins under races, results never shown for an earlier search or amount |
| Intents | Digest binding of every material field; any change or expiry voids approval; assembled order re-checked against the intent |
| Transaction checks | Decoding, version, fee payer, required signers and co-signers, program allowlist, garbage rejection (the order, execute, Earn and Borrow routes apply the same function; the routes themselves have no dedicated tests) |
| Lifecycle | State machine, timeout-then-reconcile without resubmitting, late landing reported as completed, expiry proven before retry, RPC failure never counted as "did not land", wallet/network change cancels, declined signature recoverable, expired terms unsignable, explicit downgrade consent, reservations |
| Swap flow (browser, fixtures) | Connect, quote, costs and route, review with full mints, program and simulation checks, one signature, landing, receipt, Activity entry |
| Duplicate protection (browser) | A double click produces one signature request and one `/execute` call |
| Wallet rejection (browser) | Nothing reaches `/execute`; the review offers "Try signing again" |
| Quote expiry (browser) | After 25 s signing is withdrawn; "Get fresh terms" rebuilds without a signature |
| Ledger | Receipt tokens counted once as supplied underlying, reservations and pending outflows excluded from spendable, debt netted |
| Capabilities | Route, private holding, Earn and collateral eligibility answered separately; blocked Token-2022 extensions refused for private holding |
| Credit math | Jupiter Lend vault capacity, LTV, health, liquidation price, oracle staleness and deviation gates; risk-reducing actions always allowed |
| Shell and navigation | Rail order and names, keyboard and pointer previews (to the left, delayed, hoverable), Escape and focus return, previews never covering an edited amount, deep links, back/forward, swap draft kept across modules, 404 for unknown modules, mobile bottom bar and More sheet with 44 px targets, tablet tap without hover, modal focus trap, reduced motion |
| Landing and launch (browser) | The ring on the landing page with a plain description; the app behind it is inert; "Launch app" opens `/swap`, glides the ring onto its anchor beside the swap and focuses the swap; Back returns to the landing; stacked layout without overflow on phones |
| Transaction ring (browser) | The dialog's ring and the background ring go from waiting (wallet prompt) to moving (sending) to landed; the background ring settles back to idle; reduced motion stops all rotation |
| Mainnet only | The RPC and Privacy Rings relays refuse any other network; capabilities and Settings describe mainnet only; preferences stored by older versions (network, demo switch) are dropped on load |
| Paying from the private balance | Three reviewed steps (move out, swap, move back in), consent required before the first, settled amounts passed forward, stop notes; unit tests run each step through the full signing path (no browser check, which would need a Privacy Rings service) |
| Hygiene | Only `noct.settings.v1` in storage; no address, amount or key material in storage, cookies or URL; masking hides balances in the card, panel and previews; CSP and framing headers; `no-store` on APIs; cross-origin writes refused |
| Server | Log redaction, URL key redaction, metadata mapping, request guards (including the prover's octet-stream bodies), empty env values treated as unset |

## 2. Implemented, not verified against live services

These paths exist end to end in code, compile into the production bundle and use documented contracts, but were never run against the real provider or with real funds in this build.

| Area | Why unverified | What to check first |
| --- | --- | --- |
| Public swaps on mainnet | No real wallet or funds were used | A small swap with a hardware or test wallet; compare the review with the wallet's own preview |
| Live token search, prices, mint reads | The sandbox used fixtures | Search a few memecoins by name and mint; check Token-2022 fee display on a fee-bearing mint |
| Token icons with `NOCT_IPFS_GATEWAY` | No gateway was configured; the path is unit-tested only. Live checks on 2026-11-10: icons on Arweave, GitHub and Google Storage load; WIF loads from Helius's cache; IPFS icons Helius does not hold (Fartcoin, GOAT, USELESS) show initials | Set a gateway and open the token picker; watch `icon.miss` in the logs |
| Jupiter Lend supply, withdraw and borrow | Beta API; no funds | Supply and withdraw a small amount; open, repay and close a minimal position |
| Privacy Rings: unlock, sync, balances, history, registration, deposit, private transfer, public withdrawal | No `HELIUS_API_KEY` in this environment; only the deployed relay's signed policy endpoint was read | With a small amount: unlock, register, deposit a little SOL, transfer between two wallets, withdraw |
| Swaps paid from the private balance (live) | Depends on the Privacy Rings path above plus a live Jupiter swap | A small three-step run on mainnet after the private balance works |
| Wallet compatibility | Tested only with an injected QA wallet | Phantom, Solflare, Backpack and a hardware wallet; v1 transaction support for private operations |
| Program upgrade-authority report | Fixture RPC has no program accounts, so Settings shows "Not deployed on mainnet" there | Read against mainnet RPC |
| Pyth independent check | On-chain feed reading tested against synthetic accounts and the published account addresses only | Compare with the vault oracle on a live market |
| Reconciliation under real congestion | Simulated in tests only | Observe a slow landing; confirm no resubmission and correct final state |

## 3. Requires keys or access

| Needs | Unlocks |
| --- | --- |
| `HELIUS_API_KEY` | Privacy Rings indexer and prover access, and Helius mainnet RPC |
| `HELIUS_API_KEY` + `SPR_MAINNET_ENABLED=true` | Private balances (Helius launched the Default Ring on mainnet on 2026-11-10; still beta) |
| `PYTH_API_KEY` (optional) | Pyth prices from Hermes instead of Pyth's on-chain feed accounts; the independent check works without it |
| `JUPITER_API_KEY` | Higher Jupiter rate limits than the keyless tier |
| `SOLANA_RPC_URL_MAINNET` | A dedicated RPC instead of the rate-limited public endpoint (Helius is used when only `HELIUS_API_KEY` is set) |

## 4. Experimental or reference only

| Item | Status |
| --- | --- |
| Native confidential credit (`src/lib/credit/native-reference.ts`) | Executable specification with tests; no circuits, program or privacy; gated off for real funds |
| Two-phase escrow for private swaps (`src/lib/operations/two-phase.ts`) | Executable specification with tests; no program deployed |
| Fixture upstream and QA wallet (`scripts/`) | Test infrastructure only; not part of the build |

No program was deployed and no funds were moved in this build. NOCT runs on mainnet only; there is no test network or demo mode in the app.

## 5. Not available or not implemented

| Item | Reason |
| --- | --- |
| Private swaps | Helius's example maker/taker swap uses insecure public test keys; a mainnet version needs its own key setup, an audit and a liquidity provider. Prototyping on a local test chain is in progress |
| Anonymous transfers (class B) | Need a Custom Ring program; none is deployed for NOCT and Custom Ring mainnet readiness is unverified |
| Private Earn positions | Jupiter Lend positions are held by a public wallet; no privacy custody integration for receipt tokens |
| Native confidential credit | See section 4 and docs/credit-model.md |
| Private balances by default | Off in code; the operator switches them on per deployment (`SPR_MAINNET_ENABLED=true`) |
| Persistent operation journal | In memory per tab by design for now; closing the tab during recovery loses the local record |
| Shared rate-limit store, per-session quotas | Per-instance memory only |
| Nonce-based CSP | Inline framework scripts are allowed instead |
| User-supplied indexer or RPC in the UI | Configurable on the server only |
| Limit orders, DCA, fiat on-ramps, notifications | Out of scope |
| Localisation | English only |
