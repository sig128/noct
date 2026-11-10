# Security assumptions

This document states what NOCT trusts, what it defends against, and where its protections stop. Nothing here has been independently reviewed. Treat the codebase as unaudited.

## Trust boundaries

| Party | Trusted for | Not trusted for |
| --- | --- | --- |
| The user's wallet | Holding keys; showing the user what it signs; producing honest signatures | Not altering transactions (NOCT re-checks the returned bytes) |
| The browser tab | Holding derived viewing keys and decrypted state in memory while unlocked | Persisting anything private (only `noct.settings.v1` is stored) |
| NOCT's server | Relaying requests, holding provider API keys, validating and rate-limiting | Signing, custody, seeing keys or derivation signatures (it never receives them) |
| Jupiter | Quotes, assembled transactions, landing, lending data | Program choice (allowlisted), fee payer and signers (checked), terms changing after review (intent check and expiry) |
| Helius indexer and prover | Serving encrypted state; generating proofs inside an attested enclave | Reading proof inputs outside the attested enclave (the SDK encrypts to it after verifying signed policy) |
| Solana RPC provider | Honest account data, simulation and status | Privacy of what you read (it sees your queries) |
| Pyth | An independent price for sanity checks | Being the only safeguard (vault oracle age is checked as well) |
| On-chain programs | Enforcing their own rules | Being immutable: upgrade authorities are read live and shown in Settings |

## What the server does

- **No signing endpoint.** No route accepts a private key, seed, mnemonic or derivation signature, and none signs anything.
- **Input validation.** Every route validates bodies and query strings with zod: base58 address shapes, integer-string amounts, bounded enums and lengths. JSON bodies are size-capped before parsing.
- **Cross-origin writes.** State-changing routes require an `Origin` matching the host (or `NOCT_ALLOWED_ORIGINS`) and `Sec-Fetch-Site: same-origin` when the browser sends it, plus a JSON content type. The Privacy Rings relay additionally accepts `application/octet-stream`, which the SDK uses for enclave-encrypted prover requests.
- **Cross-site reads.** Keyed relay `GET`s refuse requests a browser marks `Sec-Fetch-Site: cross-site`, so other sites cannot spend this deployment's provider quota through their visitors.
- **Rate limits.** Token buckets per client IP and route class (read, quote, order, execute, rpc, privacy, icon), sized to upstream cost.
- **RPC relay.** A fixed method allowlist; `getProgramAccounts` only for the two Privacy Rings programs; at most 20 calls per batch and 8 params per call.
- **Program policy.** Assembled Jupiter transactions are inspected on the server before reaching the browser and again on `/execute`; Earn and Borrow transactions are inspected before they are returned.
- **Upstream calls.** Timeouts, response-size caps, `redirect: "error"` (the icon proxy alone follows up to three redirects, each re-checked), no caching of private responses (`Cache-Control: no-store` on every API route except the icon proxy).
- **Icon proxy.** Accepts icon URLs on public HTTPS hosts only (no credentials, ports, IP literals or local names) and fetches them through the wsrv.nl image service, so the server itself never connects to an arbitrary host named in token metadata. Only when the service fails does it fetch directly, and then only from allowlisted hosts, following at most three redirects that stay on the allowlist. It caps size at 1.5 MB and serves only PNG, JPEG, GIF or WebP identified by magic bytes; SVG is never passed through (the service rasterises it). The endpoint can be used to fetch any public image through the service, bounded by the per-IP icon rate limit.
- **Logs.** One JSON line per event with status and latency. Keys matching amount, balance, address, wallet, taker, signer, recipient, mint, signature, key, secret, seed, note, utxo or terms are dropped; URLs have `api-key`, `token` and similar parameters redacted. Configuration errors name variables, never values.
- **Secrets.** Provider keys are read only in server modules guarded by `server-only`; they never appear in client bundles, HTML or responses.

## Browser protections

- Content Security Policy: `default-src 'self'`; `connect-src 'self'` (every provider call goes through the server); `img-src 'self' data: blob:`; `frame-ancestors 'none'`; `object-src 'none'`; `base-uri 'self'`; `form-action 'self'`. Also `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Cross-Origin-Opener-Policy: same-origin`, a restrictive `Permissions-Policy`, and HSTS in production.
- Token metadata is untrusted: bidirectional overrides and zero-width characters are stripped, lengths bounded, everything rendered as text. No `dangerouslySetInnerHTML` in the codebase.
- Impostor defence: ticker skeletons catch confusable symbols (for example a second "BONK" or "B0NK"); unverified tokens that reuse a verified ticker are flagged "Not the verified …"; selecting a token with a danger-level flag requires a confirmation step that shows its full mint, and every review shows both full mints.
- Private state (derived keys, balances, history, addresses, amounts) lives in memory and is cleared on lock: manually, after inactivity, when the tab is hidden (if chosen), on page unload, and on any wallet or account change.
- Network reads wait for persisted settings to load, so quotes use the stored slippage from the first request. Preferences stored by older versions (a network choice, a demo switch) are dropped on load; NOCT runs on mainnet only.
- External explorer links open with `rel="noopener noreferrer"`.

## Wallet interaction

- Only `solana:signTransaction` and `solana:signMessage` are used. NOCT submits and reconciles itself.
- A signed transaction whose message differs from the reviewed one is sent only if it passes the same policy again.
- A derivation-message signature is accepted only if the wallet returns exactly the requested message.
- A wallet epoch increments on any account or network change; an approval built under an older epoch is refused.

## Known gaps and operator responsibilities

1. **Per-instance rate limits.** Buckets live in process memory. Multiple instances or serverless cold starts multiply the effective budget. Production needs a shared store (for example Redis) or the platform's rate limiting.
2. **Client IP source.** Limits key on `X-Forwarded-For`. Deploy behind a proxy that overwrites that header (most managed platforms do); otherwise clients can rotate it to evade per-IP limits.
3. **Keyed relays.** Anyone who can reach a deployment can consume its Jupiter, Helius and Pyth quotas within the rate limits, from non-browser clients. Production should add per-session tokens or quotas.
4. **CSP allows `'unsafe-inline'` scripts and styles.** Required by the framework's inline bootstrap without a nonce pipeline. A nonce-based CSP is the next hardening step. `'wasm-unsafe-eval'` is required by the privacy SDK's hasher.
5. **Version-1 transactions.** Privacy Rings transactions are v1. Whether a given wallet supports v1 in `signTransaction` was not verified with production wallets; NOCT checks the wallet's declared `supportedTransactionVersions` and refuses to unlock a private balance with a wallet that does not list version 1.
6. **Derivation signature phishing.** Any site that gets a user to sign the same fixed message can read that user's private balance and history. NOCT warns about this; it cannot prevent it.
7. **Alpha dependencies.** The Privacy Rings SDK is 0.9.0-alpha; Jupiter Lend APIs are beta. Interfaces and behaviour may change.
8. **Beta privacy system.** Helius launched the Default Ring on mainnet on 2026-11-10 and states audits by Certora, OtterSec and ZK Security; the reports were not reviewed here, and an earlier high-severity linkability finding's fix status is unverified. Mainnet private balances are off unless the operator enables them.
9. **In-memory journal.** Duplicate-spend protection and reconciliation state do not survive closing the tab.
10. **No account system.** NOCT has no server-side sessions or user records, by design; abuse controls are limited to rate limits.
11. **Supply chain.** Dependencies are pinned and locked, but not vendored or independently reviewed.
12. **Test infrastructure.** `scripts/fixture-upstream.mjs` and the QA wallet in `scripts/qa-lib.mjs` exist only for local testing. They are not part of the build and must never be deployed or pointed at real endpoints.

## Reporting

There is no published security contact for this pre-release codebase. Before any deployment holding user funds, add one, commission an independent review, and resolve the gaps above.
