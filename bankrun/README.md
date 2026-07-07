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
