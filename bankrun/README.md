# bankrun tests — our api-wallet swapping through our router

In-process SVM tests ([bankrun](https://github.com/kevinheavey/solana-bankrun))
that exercise the on-chain programs **without a validator** (the local
`solana-test-validator` fails with a rocksdb "blockstore error" in this
environment; bankrun runs the real SVM in Node, so tests still run).

They inject funded SPL token accounts directly and drive real CPIs.

## What they prove

- **`routerSwap.test.mjs`** — `aggregator_router.route()` executes a real
  token-moving swap, enforces the aggregate `min_amount_out` (slippage), and
  rejects a disabled venue. (3/3)
- **`fullChain.test.mjs`** — the full path: `delegated_trading.execute_trade`
  (session key signs, no owner approval) → CPI into `aggregator_router.route()`
  → SPL token transfer. Funds move, the session PDA's lent signature propagates
  through the router to the venue, the nonce advances, and a replayed nonce is
  rejected. (3/3)

To let a token Transfer stand in for a DEX swap in-process, `aggregator_router`
is built with the **`localnet-mock`** feature, which remaps the first venue slot
to the SPL Token program. Production builds never enable it.

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

- **`pumpSwap.test.mjs`** — Pump.fun `buyV2` via `@pump-fun/pump-sdk`.
  `pump-fetch.cjs` builds a real buy for a live pre-graduation mint (the SDK
  resolves all 27 accounts — fee program, volume accumulators, Token-2022),
  dumps the pump + fee programs, and clones the referenced accounts. The buy is
  correctly constructed; on-chain execution here is blocked by test-engine
  limits (bankrun deadlines on the 10 MB program; litesvm is web3.js-v2-only) —
  see `route-finder/VENUES.md`.

```bash
RPC_URL="https://your-rpc" node bankrun/pump-fetch.cjs
SBF_OUT_DIR=$PWD/bankrun/fixtures npx tsx bankrun/pumpSwap.test.mjs
```

Fixtures (`bankrun/fixtures/`, incl. large program `.so` files) are gitignored —
regenerate with the fetch scripts.

## Run

```bash
# Build the inputs (from repo root):
anchor build -p delegated_trading                                # real router id
anchor build -p aggregator_router -- --features localnet-mock    # token = venue

# Run:
npm run test:bankrun
# or individually:
SBF_OUT_DIR=$PWD/target/deploy npx tsx bankrun/fullChain.test.mjs
```
