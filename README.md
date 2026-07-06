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

| Program                    | Address                                        |
| -------------------------- | ---------------------------------------------- |
| `delegated_trading`        | `HgUSLposEwz5MnUV6SFABbxVHmSZ1dkbuowWsjAe1s2E`  |
| `mock_jupiter` (test only) | `4oVmoU4zT21MVgFdTp5N5AayCvMsXZDGE5Xq7QZQvjrN`  |

> The devnet build uses the `mock-jupiter` feature because Jupiter runs only on
> mainnet-beta. `node scripts/smoke-devnet.js` exercises the full flow against
> these deployed programs (create session → execute a trade signed solely by the
> session key). See `app/` for the Phantom-connected UI.

## Security model

The single most important guarantee: when the program CPIs into Jupiter it calls
`invoke_signed` lending **only** the `TradingSession` PDA's signature. It never
signs as the owner and never signs for any other account. Therefore a swap can
only move funds whose authority is the session PDA — it is structurally
impossible for a crafted route to drain the owner's main wallet, close an
account, or reassign an authority.

A session key **can only**:

- Call `execute_trade` — a Jupiter v6 swap that respects the session's
  allowlists and per-trade / rolling-daily volume limits.

A session key can **never**:

- `SystemProgram::Transfer`, SPL token transfers, close accounts, change
  authorities, perform arbitrary CPI, or withdraw SOL/tokens.

## Instructions

| Instruction       | Signer      | Purpose                                             |
| ----------------- | ----------- | --------------------------------------------------- |
| `create_session`  | owner       | Create the session PDA and initialize limits        |
| `update_session`  | owner       | Update limits / expiry / allowlists (owner is fixed)|
| `revoke_session`  | owner       | Permanently disable the session (one-way latch)     |
| `execute_trade`   | session key | Execute an approved Jupiter swap via guarded CPI     |

## Layout

```
programs/delegated-trading/   The protocol program
  src/
    lib.rs                    Program entrypoint & instruction wiring
    state.rs                  TradingSession account + invariants
    constants.rs              Seeds, limits, verified Jupiter program id
    errors.rs                 Error codes
    events.rs                 SessionCreated/Updated/Revoked, TradeExecuted/Rejected
    instructions/             One module per instruction handler
programs/mock-jupiter/        Test-only mock aggregator (never deployed to mainnet)
tests/                        Full Anchor/TS test suite
```

## Build & test

Requires the Anchor + Solana toolchains. This project was developed against
**Anchor 0.29.0** and **Solana 1.17.x**.

```bash
# Install JS deps
yarn install

# Build (the mock-jupiter feature retargets the verified aggregator id at the
# bundled mock program so the CPI path is exercised on a local validator)
anchor build -- --features mock-jupiter

# After a fresh clone, align declare_id! with your locally generated keypairs:
anchor keys sync

# Run the test suite
anchor test -- --features mock-jupiter
```

> **Keypairs are not committed** (this is a public repo). `anchor build`
> generates fresh program keypairs under `target/deploy/`. If you change the
> mock program's id, update the `mock-jupiter` constant in
> `programs/delegated-trading/src/constants.rs` accordingly.

## Tests covered

create / update / revoke session · expired session · invalid signer · invalid
program · invalid token · exceeded per-trade limit · exceeded daily limit ·
successful (mock) Jupiter trade · replay-attack prevention · revoked-session
rejection.

## License

MIT
