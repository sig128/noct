# Privacy model

Privacy in NOCT is a property of **one operation on one integration**, never a mode of the app. Every review screen shows the disclosure profile of the exact transaction about to be signed: who sent it, who received it, which token, how much, whether a public entry or exit leg exists, who can read the hidden parts, and which services see metadata along the way. Profiles live in `src/lib/privacy/model.ts` with the evidence each relies on.

NOCT never describes anything as "untraceable", "zero trace" or "100% anonymous", and there is no global privacy toggle.

## Classes

| Class | Meaning | In NOCT today |
| --- | --- | --- |
| A `confidential_transfer` | Token and amount hidden; sender and recipient visible | Private transfers in the Privacy Rings Default Ring |
| B `anonymous_transfer` | Participants hidden too, by a validated system | **Unavailable.** Needs a Custom Ring program; none is deployed for NOCT and Custom Ring mainnet readiness is unverified |
| C `wallet_private_public_execution` | Public venue execution through a protocol-controlled account | **Unavailable.** No audited settlement exists |
| D `fully_confidential_execution` | Execution itself confidential | **Unavailable.** No integration establishes it |
| E `public` | Ordinary public operation | Swaps, deposits into and withdrawals from the private balance, Earn, external borrowing |

Classes are ordered by strength (E weakest, D strongest). A weaker result than requested is a **downgrade**.

## Operation profiles

| Operation | Class | Sender | Recipient | Token | Amount | Public leg | Can read hidden parts |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Public swap (Jupiter) | E | public | public | public | public | none | n/a: anyone reading the ledger |
| Swap paid from the private balance (three signed steps: move out, Jupiter swap, move back in) | E, each step | public | public | public | public | the move out and the move back in | n/a: the three steps can be linked; only the balance afterwards is hidden |
| Deposit into private balance | E | public | public | public | public | the deposit itself | You, for the resulting private balance |
| Private transfer (Default Ring) | A | public | public | **hidden** | **hidden** | none | You, the recipient, anyone holding your derivation signature |
| Withdrawal to a public address | E | public | public | public | public | the withdrawal itself | n/a |
| Earn supply or withdraw | E | public | public | public | public | none | n/a |
| External borrow (Jupiter Lend) | E | public | public | public | public | none | n/a: also liquidators |

A deposit is public even though its destination is private: the chain shows who deposited which token and how much. A withdrawal is public for the same reason. Holding funds in the pool hides balances, not the entries and exits.

### Metadata exposure beyond the chain

| Service | Observes |
| --- | --- |
| Jupiter | Your wallet address, the pair and amount when an order is assembled; the signed transaction it lands |
| Helius indexer | Which encrypted notes your session queries, and when |
| Helius prover | Proof inputs, encrypted by the SDK to an enclave whose attestation the SDK verifies against pinned policy signers |
| Solana RPC provider | Accounts you read, transactions you simulate and send |
| NOCT's server | Request timing, sizes and routes of everything relayed through it; never bodies in logs, never keys |
| Pyth (when configured) | Which price feeds are read, from NOCT's server |

Your IP address reaches NOCT's server; upstream providers see the server's address instead, except where the wallet itself contacts its own services.

## Rules the code enforces

1. **No silent downgrade.** `resolvePrivacyMode` never returns a weaker profile without flagging it, and `assertNoSilentDowngrade` runs immediately before signing. If the prepared operation is weaker than requested, signing is refused unless the user ticked an explicit consent that names what becomes public. Example: a private transfer to an unregistered recipient fails with `WALLET_RECIPIENT_NOT_REGISTERED`; NOCT offers "Review a public withdrawal instead", and that review shows "The recipient has no private address, so this becomes a public withdrawal: the token, amount and recipient will be visible on chain" with a required checkbox.
2. **Unavailable is shown as unavailable.** A swap whose trade is hidden does not exist on mainnet, so choosing "Private balance" as a swap source runs a guided three-step flow instead: a public move out of the private balance, a public Jupiter swap, and a public deposit back. The card says so before review, and the first step cannot be signed until the user ticks a consent that names what becomes visible. Nothing is presented as a private trade.
3. **Disclosure before signature.** Every review shows a sender, recipient, token and amount grid with visible/hidden states and a "What is visible" sheet listing the profile's metadata exposure, custody and dependencies.
4. **Previews and masking respect privacy.** Hovering the rail never reveals balances that are masked or locked. "Hide amounts" replaces amounts everywhere, including previews, with a security tint.
5. **Per-token capability flags.** A public route, private holding, private entry/exit, Earn market and collateral eligibility are separate answers. A Token-2022 mint with a transfer hook, permanent delegate, non-transferable flag, pausable flag or default-frozen state is not offered for private holding.

## Keys and recovery

- Unlocking asks the wallet to sign **one fixed message** (`ed25519DerivationMessage` from the SDK). The SDK derives the viewing and nullifier keys from that signature in the tab's memory; NOCT zeroes the signature buffer immediately and never stores or sends it.
- **Wallets that refuse that message.** The SDK's message is a Solana off-chain message v0, and the SDK accepts only a signature over exactly those bytes. Phantom refuses it ("You cannot sign solana transactions using sign message"). When a wallet refuses it (or returns a signature over altered bytes), NOCT asks the wallet to sign NOCT's own unlock text instead, shown below. The signature is checked against the wallet's key and expanded into keys exactly as the SDK expands a standard seed (`roleExpansion`, `ViewingKey`, `NullifierKey`, `ShieldedAddress.fromPublicKeys`, `LocalKeys.fromKeys`); a test checks that this expansion gives the SDK's own keys for the same seed. Only the seed differs, so the keys differ from the standard ones.
- **What that means.** A balance unlocked with NOCT's text opens in any app that uses the same text and the same expansion, such as NOCT. Other Privacy Rings apps derive the standard keys and will not see it. The wallet's on-chain registration records whichever keys registered first; if the standard keys do not match it, NOCT tries its text, and if a Phantom-unlocked wallet's registration holds the standard keys, NOCT says the balance must be opened with a wallet app that signs the standard message, with the same account.
- NOCT's unlock text, which must never change (`noctUnlockText` in `src/lib/adapters/privacy/unlock.ts`; the wallet signs its UTF-8 bytes):

  ```text
  NOCT private balance

  Sign to open your private balance (Solana Privacy Rings) in NOCT. Signing is free and moves no funds.

  Only sign this in NOCT. Anyone who gets this signature can see your private balance and history.

  Wallet: <the wallet's address>
  Key version: 1
  ```
- Spending still needs the wallet's own transaction signature every time. The derived keys can read, not spend.
- Anyone who obtains the derivation signature can read the private balance and history. NOCT warns users to sign that message only on NOCT.
- Recovery: connect the same wallet on any device and unlock again; the balance is rebuilt from the chain through the indexer. With the standard message, any client built on the Privacy Rings SDK can derive the same keys from the same wallet and withdraw; with NOCT's text, any client that repeats the steps above can. If the wallet's keys are lost, the private balance is lost with them.
- Locking (manual, after inactivity, on a wallet or account change, when the page is hidden with zero auto-lock, on page unload) destroys the session and clears decrypted state from memory.

## Known privacy limitations

- The Default Ring keeps sender and recipient addresses public. Transaction hashes are public in every ring.
- A zkSecurity report seen during this build described a high-severity linkability issue (`private_tx_hash` linking spent notes). Helius says the core programs have since been audited by Certora, OtterSec and ZK Security; until the fix is confirmed in a published report, spend unlinkability must not be assumed.
- Timing and amount correlation between a public deposit and a later public withdrawal can link them, regardless of the pool.
- NOCT's server, the indexer and the RPC provider see request metadata. Running your own indexer or RPC reduces who sees it; NOCT does not yet support configuring a user-supplied indexer in the UI.
- Mainnet private balances are off unless the operator enables them (`SPR_MAINNET_ENABLED=true`); Helius launched the Default Ring on mainnet on 2026-11-10 and still calls it beta.
