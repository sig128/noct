# NOCT

A swap-first Solana finance workspace. The home screen is a working swap; balances, private transfers, lending, borrowing, activity and security settings open from a rail on the right edge (a bottom bar on phones).

NOCT states, per operation, exactly what becomes public. A public Jupiter swap is labelled public. A private transfer through Solana Privacy Rings hides the token and amount but not the addresses, and says so. Features that do not exist in an audited, deployable form (private swaps, anonymous transfers, private lending, native confidential credit) are shown as unavailable with the reason, never simulated as real.

**Status: pre-release software. Not audited. Not production-ready.** See [docs/implementation-status.md](docs/implementation-status.md) before pointing it at real funds.

## What is in the box

| Area | What it does | Backed by |
| --- | --- | --- |
| Swap | Quotes, review, wallet signature, landing, reconciliation; can pay from the private balance in three signed steps (public trade) and move what was bought back into it | Jupiter Swap API v2 (`/order`, `/execute`), Privacy Rings |
| Token discovery | Search by name, ticker or exact mint; impostor and risk flags; Token-2022 extension checks | Jupiter Tokens v2, on-chain mint accounts |
| Balance | One ledger across public wallet, private balance, supplied, collateral and debt, with no double counting | Solana RPC, Privacy Rings SDK, Jupiter Lend |
| Send and receive | Private transfers (amounts hidden, addresses visible), public withdrawals, receive address | `@heliuslabs/spr` 0.9.0-alpha (Default Ring) |
| Earn | Supply to and withdraw from Jupiter Lend markets (public positions) | Jupiter Lend Earn API (beta) |
| Borrow | Explicit collateral/debt vault pairs, health and liquidation price, oracle freshness gate | Jupiter Lend Borrow API (beta) |
| Activity | This session's operations and, when unlocked, private history | In-memory journal, Privacy Rings indexer |
| Settings and security | Masking, demo mode, network, auto-lock, recovery, permissions, provider and program-authority report | Local settings, on-chain program accounts |
| Demo mode | Made-up data for presentations; clearly marked; cannot sign or send | Local fixtures in the client |

## Requirements

- Node.js 22.12 or newer (the Privacy Rings SDK requires 22.12+ or 24+)
- npm 10+
- A Solana wallet that implements Wallet Standard `solana:signTransaction` (and `solana:signMessage` for unlocking a private balance)

## Run it locally

```sh
npm ci
cp .env.example .env.local   # optional: every variable has a safe default or degrades with a message
npm run dev                  # http://localhost:3000
```

Production build:

```sh
npm run build
npm start                    # http://localhost:3000
```

Without any keys the app runs against public endpoints: Jupiter's keyless API (low rate limit) and the public Solana RPC. Private balances need `HELIUS_API_KEY`. The independent oracle check reads Pyth's on-chain feeds and needs no Pyth key. The Settings panel lists what this deployment has configured.

## Configuration

Names only; see [.env.example](.env.example) for descriptions. Secrets stay on the server and are never sent to the browser.

| Variable | Purpose | Default |
| --- | --- | --- |
| `JUPITER_API_BASE` | Jupiter API host | `https://api.jup.ag` |
| `JUPITER_API_KEY` | Jupiter API key (higher limits) | unset: keyless |
| `SOLANA_RPC_URL_MAINNET`, `SOLANA_RPC_URL_DEVNET` | Dedicated RPC endpoints | Helius (if key set) or public RPC |
| `HELIUS_API_KEY` | Privacy Rings indexer and prover access; Helius RPC | unset: private balances off |
| `SPR_INDEXER_URL_DEVNET`, `SPR_PROVER_URL_DEVNET`, `SPR_INDEXER_URL_MAINNET`, `SPR_PROVER_URL_MAINNET`, `SPR_POLICY_BASE` | Privacy Rings service endpoints | values published in the SDK README |
| `SPR_MAINNET_ENABLED` | Allow mainnet private balances | `false` |
| `PYTH_API_KEY`, `PYTH_HERMES_BASE` | Optional: Pyth prices from Hermes instead of on-chain feeds | unset: on-chain feeds via the RPC |
| `NOCT_ALLOWED_ORIGINS` | Extra origins allowed to call write endpoints | same origin only |
| `NOCT_ICON_HOSTS` | Extra hosts the token-icon proxy may fetch | built-in allowlist |
| `NOCT_SILENT_LOGS` | `1` silences operational logs | logs on |
| `NOCT_DIST_DIR` | Alternative build directory | `.next` |

## Checks

```sh
npm run typecheck        # TypeScript, strict
npm test                 # unit and integration tests (Vitest)
npm run build            # production build
npm run check            # all three
```

### Browser QA against local fixtures

The fixture server is test infrastructure: it stands in for Jupiter and a Solana RPC with documented response shapes so the live code path can run without network access or funds. The QA wallet it pairs with cannot produce a valid signature for any real network.

```sh
npm run build
npm run fixtures                      # terminal 1: fixture upstream on 127.0.0.1:4010
JUPITER_API_BASE=http://127.0.0.1:4010 \
SOLANA_RPC_URL_MAINNET=http://127.0.0.1:4010/rpc \
SOLANA_RPC_URL_DEVNET=http://127.0.0.1:4010/rpc \
NOCT_SILENT_LOGS=1 npx next start -p 3100 -H 127.0.0.1   # terminal 2
npm run qa:visual                     # screenshots at 1440, 1280, 768 and 390 px into qa-output/
npm run qa:interaction                # keyboard, pointer, touch, routing, lifecycle and hygiene checks
npm run qa:interaction -- --slow      # adds the 25-second quote-expiry check
```

The QA scripts drive Chrome through `playwright-core`; set `QA_CHROME` to your Chrome or Chromium binary (default `/usr/bin/google-chrome`) and `QA_BASE` if the server is elsewhere.

## Project layout

```
src/app/                 routes: / (swap), /[module], /api/* server relays
src/components/          shell (rail, previews, panels), swap, tx review, panels, ui primitives
src/lib/decimal.ts       integer and fixed-point amount math
src/lib/tokens/          sanitising, identity and impostor checks, risk, mint-account parsing
src/lib/swap/            Jupiter schemas, quote normalisation, intent checks
src/lib/tx/              transaction decoding and program allowlists
src/lib/operations/      intents, state machine, journal, reconciliation, escrow reference model
src/lib/privacy/         disclosure profiles and downgrade rules
src/lib/credit/          Jupiter Lend vault math, native credit reference model
src/lib/adapters/        Privacy Rings adapter, demo data
src/lib/server/          env, guards, rate limits, logging, upstream clients
scripts/                 fixture upstream and browser QA (test infrastructure)
tests/                   Vitest suites
docs/                    integration matrix, privacy model, lifecycle, credit, security, status, release checklist
```

## Documents

- [Integration matrix](docs/integration-matrix.md): versions, networks, program IDs, endpoints, audit status, evidence dates
- [Privacy model](docs/privacy-model.md): what each operation reveals, to whom
- [Transaction lifecycle](docs/transaction-lifecycle.md): intents, approval, signing, reconciliation, duplicate protection
- [Credit model](docs/credit-model.md): external borrowing today, and the native confidential credit reference model
- [Security assumptions](docs/security-assumptions.md): trust boundaries, server hardening, known gaps
- [Implementation status](docs/implementation-status.md): verified, unverified, blocked and unimplemented
- [Release checklist](docs/release-checklist.md)

## Ground rules this code keeps

- No signing endpoint exists. The server never sees a private key, seed or derivation signature.
- Only non-secret preferences persist in the browser (`noct.settings.v1`). Balances, addresses, keys and history live in memory and are cleared on lock.
- Amounts are integers in base units end to end and prices are exact decimal ratios. Floating point appears only in display-only market statistics such as a token's reported liquidity.
- A transaction is inspected, checked against a program allowlist and simulated before the wallet is asked to sign it.
- A submission whose outcome is unknown is reconciled by signature; it is never blindly resent.
