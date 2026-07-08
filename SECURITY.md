# Security audit — on-chain programs

Scope: the Rust/Anchor programs that custody or move funds —
`programs/delegated-trading` (api-wallet) and `programs/aggregator-router`.
Off-chain code (`route-finder`, `app`) holds no funds and is out of scope here
(it only *suggests* a plan; the programs enforce safety).

Method: manual review of every instruction handler for authority/ownership
checks, CPI signature scope, arithmetic, replay, and account confusion, plus
targeted litesvm exploit tests.

## Findings

### H-1 — Unchecked `token_program` in `route()` → arbitrary-program CPI with the authority's signature  ✅ FIXED
`route()` skims fees by CPI-ing `token_program` (a caller-supplied account) with
`[output_token_account (w), fee_dest (w), authority (signer)]`. `token_program`
was an `UncheckedAccount`, so a malicious caller (e.g. a rogue session key) could
pass a **fake program**; the router would invoke it **with the authority's
signature over the output account**, letting it drain the output to any
destination. The post-fee slippage check used a *computed* `net_out`, so it would
not have caught the drain.

**Fix** (`instructions/route.rs`):
- require `token_program ∈ {SPL Token, Token-2022}` **and** `token_program ==
  output_token_account.owner` (the program that owns the output account), so the
  fee CPI can only ever hit the real token program for that account;
- enforce `min_amount_out` on the **re-read** output balance after fees (not the
  computed net), closing the whole class of "a transfer moved more than intended".

Regression test: `bankrun/feeRoute.test.mjs` case 5 (malicious `token_program`
rejected) + the existing fee cases still pass.

### M-1 — Session limits/allowlists were advisory relative to the opaque `route_data`  ✅ FIXED (one documented residual)
`execute_trade` checked `amount_in`/`input_mint`/`output_mint` against the
session's limits, but the swap rode in the **opaque `route_data`** forwarded to
the router, so a malicious session key could under-declare.

**Fix** — bound the route to the declared values at both ends:
- `execute_trade` now parses the forwarded route_data header
  (`[disc][input_mint][output_mint][amount_in]…`) and rejects it unless the
  discriminator is `route`, and the embedded `input_mint`/`output_mint`/`amount_in`
  equal the session-checked (allowlisted/limited) values (`RouteDataMismatch`).
- `route()` now takes `input_mint`/`output_mint` and an explicit
  `input_token_account`, and enforces: `input_token_account.mint == input_mint`,
  `output_token_account.mint == output_mint`, and **input actually spent ≤
  `amount_in`** (measured as a balance delta) — so the declared mints and cap
  bind the real swap.

Tests: `bankrun/feeRoute.test.mjs` cases 6 (mint mismatch rejected) and 7 (input
over-cap rejected).

**Residual (LOW):** the input-spent cap is measured on the *declared*
`input_token_account`. A malicious caller could pass a decoy input account (of
the same mint) and have the venue legs debit a *different* account, bypassing the
per-trade amount cap. The output mint and net-out are still enforced, and all
funds remain session-PDA-scoped, so this only softens the per-trade *amount* cap
for a malicious session — it cannot exfiltrate to a foreign mint or the owner's
wallet. Full closure requires the router to constrain leg debits to the declared
input account (venue-specific; future work).

### Verified safe (no action)
- **Signature scope** — `execute_trade` uses `invoke_signed` lending **only** the
  `TradingSession` PDA's signature, and only to the pinned `ROUTER_PROGRAM_ID`.
  The router adds no signature of its own. So funds can only move from
  session-PDA-owned accounts; the owner's wallet is never exposed.
- **PDA / owner checks** — session PDA validated by seeds+bump;
  `update_session`/`revoke_session` use `has_one = owner`; owner and
  session_pubkey are immutable (bound by the seeds); `create_session` uses
  `init` (no re-init).
- **Replay** — `execute_trade` pins the nonce; `record_trade` bumps it with
  checked arithmetic.
- **Arithmetic** — checked add/sub throughout state accounting and fees (u128
  intermediate for fee math); `overflow-checks = true` in the release profile.
- **Fee integrity** — `protocol_fee_account` must be owned by
  `PROTOCOL_FEE_RECIPIENT`; integrator fee capped at `MAX_INTEGRATOR_FEE_BPS`.
- **Venue allowlist** — `route()` legs can only CPI the hardcoded `Venue`
  program ids.

## Venue-integration security (Raydium / Meteora / Pump)

`route()` CPIs external DEX programs, forwarding caller-controlled accounts +
data with the authority's signature. Threat model of that surface:

### V-4 — output/input account owner not explicitly verified  ✅ FIXED  (MEDIUM)
The output account's owner was only *implicitly* checked (the fee transfer, from
output, is signed by the authority so it must own the account). But the fee
rounds to 0 for small swaps (`received < 500` → protocol fee 0), so a malicious
session key could route a small swap's output to a **foreign account**
(exfiltration). Fixed: `route()` now explicitly requires
`input_token_account.owner == output_token_account.owner == authority`,
independent of fees. Test: `feeRoute.test.mjs` case 8.

Severity is MEDIUM, not HIGH: exploitation is gated to the fee-rounds-to-zero
band (`received * 20 / 10000 == 0`, i.e. `received < 500` base units), so it was
a low-throughput exfiltration of small per-trade amounts by an *already*
malicious session key, not a bulk drain — and it is now closed regardless of
amount.

### V-1 — `route()` forwards arbitrary instruction data to an allowlisted venue  ✅ FIXED
A leg's `data` was opaque and forwarded verbatim; `route()` pinned the venue
*program* but not the *instruction*. So a caller could invoke any venue
instruction the authority can sign (not just "swap") — e.g. an LP withdrawal.

**Fix** (`constants.rs` / `route.rs`): each leg is now checked against a
per-venue **swap-instruction allowlist** before the CPI —
`require!(venue.is_allowed_swap_ix(&leg.data), DisallowedInstruction)`. Allowed
selectors: Raydium AMM v4 `swapBaseIn`(9)/`swapBaseOut`(11), Raydium CLMM
`swap`/`swapV2`, Raydium CPMM `swapBaseIn`/`swapBaseOut`, Meteora DLMM
`swap`/`swap2`, Meteora Dynamic `swap`, Pump/PumpSwap `buy`/`sell` (Anchor
discriminators). Any other instruction to a venue program is rejected. Test:
`feeRoute.test.mjs` case 9 (non-swap leg rejected); still bounded by the
output-gain / input-cap / session-PDA constraints as defense in depth.

### V-2 — Token-2022 transfer-fee / transfer-hook output mints  ✅ FIXED (partial — transfer-fee; hook documented)
The fee skim previously used the plain SPL-Token `Transfer` (tag 3), which
reverts on a mint owned by the Token-2022 program.

**Fix** (`instructions/route.rs`): the fee transfers now use `transferChecked`
(tag 12) and the `token_program` is bound to the **actual owner** of the output
account (`token_program == output_token_account.owner ∈ {SPL Token,
Token-2022}`, from the H-1 fix). So a Token-2022 output mint now collects fees
correctly. `route()` takes an explicit `output_mint_account`, checks it equals
the declared `output_mint`, reads its `decimals` (offset 44), and passes them to
`transferChecked` — which also validates the transferred amount against the
mint. Tests: all `feeRoute.test.mjs` cases run through `transferChecked` (a real
SPL mint account is injected); fuzz clean over 4,000 iters.

**Residual (transfer-hook mints, DOCUMENTED):** for a Token-2022 mint with a
**transfer hook**, `transferChecked` alone still reverts unless the hook's extra
accounts are resolved and appended — so the route reverts (since the protocol
fee is always on) for that token class, a liveness limitation that **includes
some graduated Pump tokens**. No user funds are lost (slippage is enforced on
the real post-transfer balance). Full support requires resolving the hook's
`ExtraAccountMetaList` per mint, or waiving the protocol fee for hook mints
(future work). Transfer-*fee* mints (the common extension) are handled.

### V-3 — venues are upgradeable and trusted  ⚠️ INHERENT
Raydium/Meteora/Pump are upgradeable by their teams. A malicious/compromised
venue upgrade, given the authority's signature, could touch session-PDA accounts
**beyond** the declared `input_token_account` (our caps bind only the declared
input + the output). This is the irreducible trust of CPI-ing external programs.
Our checks bound the *declared* accounts; to bound the rest, **fund the session
PDA per-trade and keep minimal balances in it.**

### Verified safe
- **No reentrancy** — the Solana runtime forbids a program being re-entered; our
  fee state changes happen after the venue CPIs regardless.
- **Program pinning** — venue ids are hardcoded (`Venue` enum, unit-tested);
  `invoke()` exposes only each leg's slice accounts to the venue, not the whole
  remaining-accounts pool.
- **CPI depth** — `execute_trade → route → venue → token program` sits at
  Solana's depth limit (4); a venue doing deeper internal CPIs would fail
  (liveness, not a safety issue) — call `route()` directly for deep routes.

## Fuzzing
`bankrun/fuzz.test.mjs` runs a seeded property fuzz of `route()` against the real
program bytecode (litesvm): randomized amounts, fee bps, leg counts/offsets,
account validity, and malformed instruction data. It asserts route() never
panics and never succeeds while violating an invariant (net-out ≥ min_out, exact
post-fee net, protocol fee only to the treasury, integrator-fee/leg caps,
input-spent cap, no success on garbage data). Clean over 4,000 iterations across
5 seeds (550 executed swaps through `transferChecked` + adversarial reverts, 0
violations).

## Operational notes
- **Never enable the `mock-router` / `localnet-mock` features in a production
  build** — they remap program ids for tests. Production = default features.
- The protocol-fee treasury must own a token account (per output mint) for fee
  collection; its secret key is not in the repo.
