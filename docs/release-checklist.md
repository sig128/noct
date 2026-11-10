# Release checklist

Short and blocking: every unchecked line is a reason not to ship.

## Before any deployment

- [ ] `npm ci && npm run check` passes from a clean clone (typecheck, 120+ tests, production build)
- [ ] `npm run qa:visual` and `npm run qa:interaction -- --slow` pass against the fixture-backed production build
- [ ] `.env` reviewed: secrets only in the host's secret store, never in the repository or client code
- [ ] Deployment sits behind a proxy that overwrites `X-Forwarded-For`; rate limits backed by a shared store if more than one instance runs
- [ ] Fixture server and QA wallet absent from the deployment
- [ ] Security headers present on a deployed page (`Content-Security-Policy`, `X-Frame-Options`, `Strict-Transport-Security`)

## Before real funds (mainnet, public operations)

- [ ] Independent security review of this codebase, with findings resolved
- [ ] Small-value mainnet swap, Earn supply and withdraw, and a minimal borrow position completed with at least two production wallets; reviews matched each wallet's own preview
- [ ] A forced timeout during submission reconciled correctly without resubmission
- [ ] Integration matrix re-verified: Jupiter endpoints and routers, Lend scales (penalty and oracle units), program IDs and upgrade authorities
- [ ] Dedicated RPC, `JUPITER_API_KEY` and `PYTH_API_KEY` configured; Settings shows them as configured
- [ ] Security contact and incident process published

## Before private balances

- [ ] Devnet: unlock, register, deposit, private transfer between two wallets, public withdrawal and recovery on a second device all work with `HELIUS_API_KEY`
- [ ] Wallets in scope sign version-1 transactions
- [ ] Privacy Rings audit reports published by Helius and read; the reported `private_tx_hash` linkability finding confirmed fixed
- [ ] Helius lists mainnet as launched; the SDK version and service endpoints re-checked against the docs
- [ ] Only then: `SPR_MAINNET_ENABLED=true`

## Never ship

- Private swaps, anonymous transfers, private Earn or native confidential credit presented as available without an audited implementation behind them
- Any copy that claims "untraceable", "zero trace", "100% anonymous", audited status or production readiness that does not exist
