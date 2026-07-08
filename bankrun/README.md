# bankrun tests — our api-wallet swapping through our router

In-process SVM tests ([bankrun](https://github.com/kevinheavey/solana-bankrun))
that exercise the on-chain programs **without a validator** (the local
`solana-test-validator` fails with a rocksdb "blockstore error" in this
environment; bankrun runs the real SVM in Node, so tests still run).

They inject funded SPL token accounts directly and drive real CPIs.

## What they prove

- **`routerSwap.test.mjs`** — `aggregator_router.route()` executes a real
  token-moving swap (dest credited **net of the 0.20% protocol fee**), enforces
  the aggregate `min_amount_out` (slippage), and rejects a venue with no allowed
  swap instruction. (3/3)
- **`fullChain.test.mjs`** — the full path: `delegated_trading.execute_trade`
  (session key signs, no owner approval) → CPI into `aggregator_router.route()`
  → SPL token transfer. Funds move (dest nets 499,000 of a 500,000 swap; the
  1,000 protocol fee lands in the treasury account), the session PDA's lent
  signature propagates through the router to the venue, the nonce advances, and
  a replayed nonce is rejected. (3/3)
- **`feeRoute.test.mjs`** — the fee model (Jupiter/DFlow-style) and the security
  fixes: protocol + integrator fee split via `transferChecked`, `min_amount_out`
  on the post-fee net, treasury-owned protocol-fee guard, integrator-fee cap,
  and the rejection cases for a malicious `token_program`, `input_mint` mismatch,
  over-cap input (M-1), foreign output owner (V-4), and a non-swap leg (V-1).
  (9/9)

- **`threeVenue.test.mjs`** — proves **three venues in one versioned (v0)
  transaction**: `route()` runs 3 legs with distinct venue selectors atomically
  and enforces the aggregate slippage bound (atomic revert if unmet). Needs the
  `localnet-mock` build (which maps the first 3 venue slots to the SPL Token
  program, so each leg is a real token Transfer).

```bash
anchor build -p aggregator_router -- --features localnet-mock
npx tsx bankrun/threeVenue.test.mjs
```

- **`fuzz.test.mjs`** — seeded property fuzz of `route()` against the real
  program bytecode. Randomizes scalars, legs, fee bps, account validity, and
  malformed instruction data; asserts route() **never panics** and **never
  succeeds while violating an invariant** (net-out ≥ min_out, exact net after
  fees, protocol fee → treasury only, integrator-fee cap, leg cap, input-spent
  cap, no success on garbage). Clean over 4,000 iterations / 5 seeds
  (550 successful swaps through `transferChecked` + reverts, 0 violations).

```bash
npx tsx bankrun/fuzz.test.mjs [iterations] [seedHex]
```

To let a token Transfer stand in for a DEX swap in-process, `aggregator_router`
is built with the **`localnet-mock`** feature, which maps the first three venue
slots to the SPL Token program. Production builds never enable it.

- **`meteoraSwap.test.mjs`** — validates the real Meteora DLMM **`swap2`**
  instruction against **cloned mainnet state**: `meteora-fetch.cjs` dumps the
  Meteora program `.so` and clones a live SOL/USDT pool (lbPair, reserves,
  oracle, bin array, mints); the test injects funded token accounts, runs our
  `swap2`, and asserts the output matches the DLMM SDK's quote (within 1%).
  Confirmed **0.0001%** on a 0.01 SOL swap.

```bash
# Meteora: regenerate fixtures (needs RPC_URL + @meteora-ag/dlmm), then run
RPC_URL="https://your-rpc" node bankrun/meteora-fetch.cjs
SBF_OUT_DIR=$PWD/bankrun/fixtures npx tsx bankrun/meteoraSwap.test.mjs
```

- **`pumpSwap.test.mjs`** — Pump.fun `buyV2` via `@pump-fun/pump-sdk`, validated
  on cloned mainnet state. `pump-fetch.cjs` builds a real buy for a live
  pre-graduation mint (the SDK resolves all 27 accounts — fee program, volume
  accumulators, Token-2022), dumps the pump + fee programs, and clones the
  referenced accounts. The test loads them into **litesvm** (v1 API, no
  BanksServer deadline — bankrun can't JIT the 10 MB pump program in time),
  injects a funded user, runs the buy, and asserts the user receives the
  SDK-quoted amount. Confirmed **0.0000%**.

```bash
RPC_URL="https://your-rpc" node bankrun/pump-fetch.cjs
npx tsx bankrun/pumpSwap.test.mjs
```

Fixtures (`bankrun/fixtures/`, incl. large program `.so` files) are gitignored —
regenerate with the fetch scripts.

## Run

```bash
# Build the inputs (from repo root):
anchor build -p delegated_trading                                # real router id
anchor build -p aggregator_router -- --features localnet-mock    # token = venue

# The whole local suite (no RPC / fixtures needed):
export SBF_OUT_DIR=$PWD/target/deploy
npx tsx bankrun/routerSwap.test.mjs      # 3/3
npx tsx bankrun/fullChain.test.mjs       # 3/3
npx tsx bankrun/feeRoute.test.mjs        # 9/9
npx tsx bankrun/threeVenue.test.mjs      # 2/2
npx tsx bankrun/fuzz.test.mjs 800 0xC0FFEE

# or via package.json scripts:
npm run test:bankrun     # routerSwap + fullChain
npm run test:fee         # feeRoute
npm run test:threevenue  # threeVenue
npm run test:fuzz        # fuzz
```

> After editing `route.rs`, **rebuild `aggregator_router.so` before rerunning** —
> `solana-bankrun`'s name-based loader reads a stale `.so` silently otherwise.

Last local run (this environment): **routerSwap 3/3 · fullChain 3/3 ·
feeRoute 9/9 · threeVenue 2/2 · fuzz clean (4,000 iters / 5 seeds, 0
violations)**.
