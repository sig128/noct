# Transaction lifecycle

Every financial operation (swap, private deposit, transfer or withdrawal, Earn supply or withdraw, borrow operate, wrap or unwrap SOL, registration) runs through one coordinator, `src/lib/client/tx-flow.ts`, driven by one state machine, `src/lib/operations/state-machine.ts`. A module describes its operation as a `TxSpec` (build, policy, submit, optional reservation and alternative); the coordinator owns everything that must be identical across operations.

## States

```
editing ─► quoting ─► review ─► awaitingApproval ─► preparing ─► submitting ─► confirming ─► completed
              │          │            │                 │             │             │
              │          ├► staleQuote├► staleQuote     ├► rejected   └► pendingRecovery ─► completed
              │          └► unsupported                 └► retryableFailure            ├► retryableFailure
              └► retryableFailure                                                       └► refunded
any non-in-flight state ─► cancelled ─► editing
```

The full transition table is in `TRANSITIONS`; any other transition throws `InvalidTransitionError`. `submitting`, `confirming` and `pendingRecovery` are **in flight**: nothing can be rebuilt, cancelled or resubmitted while an operation is in one of them. Closing the dialog only hides it; tracking continues.

## From inputs to signature

1. **Quote** (swaps): debounced, aborted when inputs change, keyed by pair, amount, slippage and network. A quote is shown only for the exact amount in the field. Quotes refresh every 15 seconds and stop refreshing while a review is open.
2. **Build.** The module requests an executable transaction (Jupiter `/order` with the wallet as `taker`, Jupiter Lend `/earn/*` or `/borrow/operate`, or the Privacy Rings SDK). The server re-inspects Jupiter transactions against the router's program allowlist before returning them.
3. **Intent.** The build produces a frozen intent: every material field (amounts in base units, minimum net output, fees, rent, recipient, router policy, slippage, mints, signer, network, privacy class, allowed programs, expiry). Its digest is SHA-256 over a canonical encoding prefixed with `noct/intent/v1`.
4. **Inspect.** The coordinator decodes the exact bytes the wallet will sign (legacy, v0 or v1) and checks: the wallet is a required signer and the fee payer (or the fee payer is an expected sponsor), no other signer is required unless it is an expected co-signer and already signed, the signer count is bounded, every top-level program is allowlisted, and no top-level program hides behind a lookup table.
5. **Simulate.** The transaction is simulated against current chain state. A failed or impossible simulation blocks signing; NOCT never asks a wallet to sign an unsimulated transaction (the Privacy Rings SDK path simulates too).
6. **Review.** The dialog shows the terms from the built transaction, the full mints, the disclosure grid, the program and simulation checks, and a countdown. Swap terms are valid for at most 25 seconds (and never past Jupiter's own `expireAt`); private operations for 60 seconds.
7. **Approve.** On "Sign":
   - the wallet and network must be the ones the review was built for (a wallet epoch increments on any account or network change; a mismatch cancels with "Nothing was signed");
   - the intent is approved and the approval re-validated against the digest and expiry; an expired approval moves to `staleQuote` and offers "Get fresh terms";
   - `assertNoSilentDowngrade` refuses a weaker privacy class than requested unless the user ticked the explicit consent;
   - the input amount is **reserved** in the ledger so a second operation cannot spend it concurrently.
8. **Sign.** `solana:signTransaction` only. If the wallet returns a different message (for example after adding priority fees), the result must pass the same policy again or nothing is sent.

## Submission and reconciliation

- The submission's signature (the fee payer's) is recorded in the operation journal **before** anything is sent, together with its `lastValidBlockHeight`.
- Swaps are landed through Jupiter `/execute`; other operations through RPC `sendTransaction`. Neither call is retried blindly.
- If the outcome is unknown (timeout, network error, ambiguous response), the operation moves to `pendingRecovery` and `reconcileSignature` asks the chain about **that exact signature**, every 3 seconds:
  - landed and succeeded → `completed`
  - landed and failed → `retryableFailure` ("your funds did not move, apart from the network fee")
  - not found, block height still within `lastValidBlockHeight` → keep waiting ("Do not resubmit")
  - not found and the block height has passed `lastValidBlockHeight`, confirmed by a second status read → `retryableFailure` ("expired without landing; nothing moved")
  - status unavailable → keep waiting and say so
- Without a recorded expiry height, NOCT cannot prove a transaction will never land, so it keeps the operation open instead of offering a retry.

## Duplicate-spend protection

- **Journal gate.** `OperationJournal.recordSubmission` throws `DuplicateSubmissionError` if the operation already has a submission that is not proven dead (landed-failed or expired-not-landed). Recording the same signature twice is idempotent.
- **One live operation.** Starting a new operation while one is in flight is refused.
- **Reservations.** Approved amounts are reserved per source (public or private) until the operation settles, so the balance shown as spendable excludes them.
- **UI.** The sign button is replaced by a busy state as soon as approval starts; a double click signs and submits once (checked in the browser QA).
- **Refresh, not retry.** "Get fresh terms" abandons the old terms under a new operation id; it is never offered while anything is in flight.

## Failure handling

| Situation | Result |
| --- | --- |
| Wallet declines | `rejected`; nothing sent; reservation released; "Try signing again" re-uses the same reviewed bytes while they are valid |
| Terms expire before signing | `staleQuote`; signing disabled; "Get fresh terms" |
| Policy violation or failed simulation | Signing blocked with the reason |
| Wallet adds its own safety checks (Lighthouse) or changes fee settings | Sent, after NOCT confirms every reviewed instruction is unchanged and in order and the fee payer, signers, version and blockhash are the same; the dialog says so |
| Wallet changes the transaction in any other way | `rejected`; nothing sent; the dialog says what changed |
| Recipient not registered for private transfers | Failure with an explicit alternative: review a public withdrawal (with downgrade consent) |
| Jupiter reports failure with a signature | Reconcile that signature before saying anything about funds |
| Wallet or account change, or lock | Session invalidated; private views cleared; non-in-flight operations cancelled |

## Guided sequences

Some actions are a series of transactions, such as paying from the private balance (move out, swap, move back in). `src/lib/client/sequence.ts` runs them as separate operations: each step is a full `TxSpec` with its own review, checks, simulation and signature, and the next step starts only when the user presses "Continue" after the previous one confirmed. Each step is built from the amounts the previous step settled (for a swap, Jupiter's reported output, or the reviewed minimum if that is unknown); if a step cannot be built from known amounts it stops with a message instead of guessing. "Stop here" ends the series and says where the funds are.

## What the ring shows

The ring beside the swap and the smaller one in the transaction dialog follow the same phases: it breathes while the wallet is asked to sign (`preparing`), lights race round it while the transaction is on its way (`submitting`, `confirming`, `pendingRecovery`), and it flares when the operation lands (`completed`); a failure turns its centre coral for a moment. It is decoration on top of the coordinator's state, never a source of it: every state it shows is also stated in words (the dialog's status button, notes and receipt). With reduced motion it does not turn or race; only its brightness changes.

## Where the guarantees stop

- NOCT does not decode Jupiter's route instructions, so the minimum-output bound inside the transaction is taken from Jupiter's response and confirmed only indirectly by simulation.
- The journal lives in the tab's memory. Closing the tab during `pendingRecovery` loses the local record (the transaction itself is unaffected; the wallet's history shows it).
- Simulation reflects chain state at that moment; markets can move before landing, within the reviewed minimum output.
