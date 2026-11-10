# Credit model

NOCT has two credit paths with very different status:

| Path | Class | What it is | Status |
| --- | --- | --- | --- |
| Jupiter Lend vaults ("Jupiter Lend markets" tab) | E, public | External, over-collateralised loans against a fixed collateral/debt pair | Implemented against the Jupiter Lend Borrow API (beta); fixture-tested; not run with real funds |
| Native confidential credit ("Confidential credit" tab) | would be B-like | Loans whose terms, collateral and debt stay encrypted while liquidation still works | **Not available.** Only a local reference model with tests exists; the UI states this and offers nothing that can hold funds |

## External borrowing (Jupiter Lend)

### Pairs, not "borrow anything"

Each vault is one collateral token and one debt token with its own limits. The panel asks for the collateral first, then lists only the debt tokens that collateral actually supports. A token that trades on Jupiter is not, by that fact, collateral; the token dossier beside the swap shows "Accepted as collateral" separately from "Public swap route".

### Parameters shown before any action

Max loan-to-value, liquidation threshold, full-liquidation limit, liquidation penalty (labelled "scale inferred, undocumented"), borrow rate (variable), available liquidity, minimum borrow, the vault's oracle price and its age and source, and the independent oracle check result.

### Position arithmetic (`src/lib/credit/vault-math.ts`)

All in integer base units with explicit rounding:

- collateral value in debt units = ⌊collateral × oraclePrice / 1e18⌋
- max debt = ⌊value × collateralFactor / 1000⌋; liquidation debt = ⌊value × liquidationThreshold / 1000⌋
- LTV = ⌈debt × 10 000 / value⌉ basis points (rounded against the borrower)
- health = liquidation debt / debt (no debt: no health figure, shown as "No debt")
- liquidation price: the collateral price at which debt equals value × threshold, rounded up; plus the percentage drop from today's oracle price
- annual interest at the current rate, rounded up

### Guards

- **Oracle freshness.** A vault oracle older than 15 minutes, or with no timestamp, blocks risk-increasing actions.
- **Independent check.** The vault oracle is compared with Pyth, read from Pyth's on-chain feed accounts (or from Hermes when `PYTH_API_KEY` is set); more than 3% apart blocks risk-increasing actions. Pyth prices older than five minutes are ignored; when no current Pyth price exists for the pair the check is reported as unavailable (not passed).
- **Risk-increasing** means borrowing more or withdrawing collateral. Repaying and adding collateral are always allowed, so a stale oracle can never trap a user in a position they are trying to make safer.
- Borrowing above available liquidity, below the market minimum, or above max LTV is refused before a transaction is built.
- The transaction from `/borrow/operate` must have the signer as fee payer and sole signer, invoke only System, Compute Budget, Token, Token-2022, Associated Token and the Jupiter Lend vaults, liquidity and oracle programs, and pass simulation.
- SOL collateral: the vault takes wrapped SOL; NOCT offers to wrap it in a separate, separately reviewed transaction.

### What is public

Everything: your address, collateral, debt and health are visible on chain to anyone, including liquidators. The review states this ("Public loan position").

## Native confidential credit: reference model only

`src/lib/credit/native-reference.ts` specifies, as executable code with tests, the state transitions a confidential credit system would have to enforce. It has no circuits, no on-chain program and no cryptographic privacy, and `assertRealFundsAllowed` throws unless a production zero-knowledge verifier **and** a production-ready system exist, which is never true in this codebase.

### What the model specifies

- **Committed terms.** Terms (loan id, mints, decimals, principal, APR, origination and maturity, max LTV, liquidation threshold, penalty, close factor, borrower, lender, monitor) are committed as H(domain ‖ terms ‖ blinding). Every transition must present the opening; tampered terms fail.
- **Interest.** Debt is tracked as RAY-scaled (1e27) shares against an index; accrual is linear per period; debt rounds up in the lender's favour; collateral value rounds down.
- **Replay protection.** Every state carries a version; each transition must name the version it extends, so a stale or replayed transition fails.
- **Oracle policy.** Maximum age and maximum confidence-to-price ratio; liquidation eligibility uses the mid price after a wide band is rejected.
- **Liquidation without the borrower.** The monitor (holder of the liquidation witness) or the lender can liquidate an unhealthy loan; repayment is bounded by the close factor; seized collateral = repay × (1 + penalty) / price, rounded down and capped at the collateral held.
- **Bounded monitor authority.** The monitor may only liquidate or declare default after maturity; it cannot withdraw, close or alter terms.
- **Borrower actions.** Repay, add collateral, withdraw collateral (only while staying under max LTV with a fresh oracle, valuing collateral at the low end of the oracle's confidence band), close after full repayment.

### What is missing before it could hold funds

1. Zero-knowledge circuits proving each transition against the committed terms
2. An on-chain settlement program that verifies those proofs and locks collateral
3. Independent availability of the liquidation witness without the borrower
4. Oracle integration with on-chain staleness and confidence enforcement
5. Liquidation monitoring infrastructure with bounded authority
6. Independent security audits of the circuits and program

The same list is rendered in the "Confidential credit" tab and exported as `NATIVE_CREDIT_STATUS`.

## Related reference model: two-phase escrow

`src/lib/operations/two-phase.ts` specifies what a future private-swap escrow must guarantee: one-time commitment of the approved intent digest and nonce, locking exactly the approved input once, execution only on allowed venues and at or above the minimum output, settlement only to the approved destination, and a permissionless refund to the owner after expiry. No such program is deployed and NOCT never routes funds through this model.
