# ApiWallet — Delegated Trading Session Protocol

A production-grade Solana [Anchor](https://www.anchor-lang.com/) program that lets
a wallet (**owner**) grant a **session key** the ability to execute a narrow,
pre-approved set of swaps on its behalf — **without ever exposing the owner's
private key and without ever granting custody.**

## Live demo & deployment

- **Live app (Vercel):** https://app-sand-delta-31.vercel.app/
  — connect Phantom (set to **Devnet**), approve once, then trade with no popups.
- **Frontend source:** [`app/`](./app)

### Deployed programs (devnet)

| Program                   | Address                                        |
| ------------------------- | ---------------------------------------------- |
| `delegated_trading`       | `HgUSLposEwz5MnUV6SFABbxVHmSZ1dkbuowWsjAe1s2E`  |
| `aggregator_router`       | `7c8LDstCZnVxtcKLBdMD6YFmmNbVUTaQnZNv9Txmh8t6`  |
| `mock_router` (test only) | `4oVmoU4zT21MVgFdTp5N5AayCvMsXZDGE5Xq7QZQvjrN`  |

> **Note:** the devnet-deployed `delegated_trading` predates the router rewire
> (it still CPIs a mock aggregator). The code now CPIs our own
> `aggregator_router`; redeploying that upgrade is pending. `node
> scripts/smoke-devnet.js` exercises the deployed flow (create session → execute
> a trade signed solely by the session key). See `app/` for the Phantom UI,
> `route-finder/` for the off-chain router, and
> `programs/aggregator-router/` for the on-chain execution router.

## Security model

The single most important guarantee: when the program CPIs into our
`aggregator_router` it calls `invoke_signed` lending **only** the
`TradingSession` PDA's signature. It never signs as the owner and never signs
for any other account. Therefore a swap can only move funds whose authority is
the session PDA — it is structurally impossible for a crafted route to drain the
owner's main wallet, close an account, or reassign an authority.

A session key **can only**:

- Call `execute_trade` — a swap routed through our own `aggregator_router`
  (best-price execution across Raydium/Meteora/Pump), respecting the session's
  allowlists and per-trade / rolling-daily volume limits. No third-party
  aggregator is involved.

A session key can **never**:

- `SystemProgram::Transfer`, SPL token transfers, close accounts, change
  authorities, perform arbitrary CPI, or withdraw SOL/tokens.

## Instructions

| Instruction       | Signer      | Purpose                                             |
| ----------------- | ----------- | --------------------------------------------------- |
| `create_session`  | owner       | Create the session PDA and initialize limits        |
| `update_session`  | owner       | Update limits / expiry / allowlists (owner is fixed)|
| `revoke_session`  | owner       | Permanently disable the session (one-way latch)     |
| `execute_trade`   | session key | Execute an approved swap via the aggregator router (guarded CPI)     |

## Layout

```
programs/delegated-trading/   The protocol program
  src/
    lib.rs                    Program entrypoint & instruction wiring
    state.rs                  TradingSession account + invariants
    constants.rs              Seeds, limits, verified router program id
    errors.rs                 Error codes
    events.rs                 SessionCreated/Updated/Revoked, TradeExecuted/Rejected
    instructions/             One module per instruction handler
programs/mock-router/        Test-only mock CPI target (router stand-in; never on mainnet)
tests/                        Full Anchor/TS test suite
```

## Build & test

Requires the Anchor + Solana toolchains. This project was developed against
**Anchor 0.29.0** and **Solana 1.17.x**.

```bash
# Install JS deps
yarn install

# Build (the mock-router feature retargets the verified aggregator id at the
# bundled mock program so the CPI path is exercised on a local validator)
anchor build -- --features mock-router

# After a fresh clone, align declare_id! with your locally generated keypairs:
anchor keys sync

# Run the test suite
anchor test -- --features mock-router
```

> **Keypairs are not committed** (this is a public repo). `anchor build`
> generates fresh program keypairs under `target/deploy/`. If you change the
> mock program's id, update the `mock-router` constant in
> `programs/delegated-trading/src/constants.rs` accordingly.

### In-process SVM tests (bankrun / litesvm)

`anchor test` needs a local validator, which fails in some environments
(`solana-test-validator` hits a rocksdb "blockstore error"). The same programs
are covered by **in-process SVM tests** that run the real SVM in Node — no
validator required. These are the fastest way to validate a change locally.

```bash
# Build the program inputs (from repo root):
anchor build -p delegated_trading                              # real router id
anchor build -p aggregator_router -- --features localnet-mock  # token = venue

# Run the local suite (no RPC / fixtures needed):
export SBF_OUT_DIR=$PWD/target/deploy
npx tsx bankrun/routerSwap.test.mjs     # route() swap + slippage + venue guard
npx tsx bankrun/fullChain.test.mjs      # execute_trade -> route() -> swap, approval-free
npx tsx bankrun/feeRoute.test.mjs       # fee model + M-1/V-1/V-4/token_program guards
npx tsx bankrun/threeVenue.test.mjs     # 3 venues atomically in one v0 tx
npx tsx bankrun/fuzz.test.mjs 800 0xC0FFEE   # seeded property fuzz of route()
```

See [`bankrun/README.md`](bankrun/README.md) for details, plus the
mainnet-clone swap tests (Meteora DLMM, Pump) that need an RPC endpoint.

## Tests covered

create / update / revoke session · expired session · invalid signer · invalid
program · invalid token · exceeded per-trade limit · exceeded daily limit ·
successful (mock) routed trade · replay-attack prevention · revoked-session
rejection.

## License

MIT
