# Aggregator Router (on-chain)

The **execution half** of an agent-native DEX aggregator, in Rust/Anchor. It
takes a route computed off-chain and executes it **atomically** across venues in
one transaction, enforcing an on-chain venue allowlist and a real-balance
slippage bound.

Program id: `7c8LDstCZnVxtcKLBdMD6YFmmNbVUTaQnZNv9Txmh8t6`

## Why the aggregator is split in two

Route-finding (which pools, how to split, multi-hop) needs live state from every
pool plus pathfinding — it cannot run inside a program's compute budget, so like
**every** aggregator (Jupiter included) it runs **off-chain**. What lives
on-chain is *execution*: this program. It receives a plan and guarantees how it
runs.

```
off-chain route-finder  ─plan─▶  aggregator_router.route()  ─CPI─▶  Raydium / Meteora / Pump …
   (pool data + split/                (this program:                   (venue swap programs)
    multi-hop search)             allowlist + slippage + atomic)
```

## `route(amount_in, min_amount_out, legs)`

- `legs`: ordered `SwapLeg`s. A leg is one CPI into one venue; sequential legs
  are **multi-hop**, several legs into the same output token are a **split**.
  Each leg carries a `venue` selector, a slice range into `remaining_accounts`,
  and the venue's raw instruction `data` (all built off-chain).
- The program CPIs each leg, then requires `output_token_account` to have
  increased by at least `min_amount_out`.

### Guarantees the program enforces (independent of the off-chain planner)

1. **Allowlist** — a leg can only target a known venue program (`Venue` enum);
   nothing else is reachable via CPI.
2. **Slippage** — enforced as a measured balance delta on the output account
   *after* all legs, so it holds even if a venue misbehaves or the tx is
   sandwiched.
3. **Signature scope** — the router adds no signatures of its own; it forwards
   the authority's signer privilege to venues, so the only signer venues see is
   the caller (a user, or the api-wallet session PDA via `execute_trade`).

## Fees (Jupiter / DFlow-style)

`route(amount_in, min_amount_out, integrator_fee_bps, legs)` skims fees from the
**output** token, then enforces `min_amount_out` on the **net** (post-fee):

- **Integrator fee** — a third party integrating the router sets
  `integrator_fee_bps` (capped at `MAX_INTEGRATOR_FEE_BPS = 255`, mirroring
  Jupiter's historical `platformFeeBps` ceiling) and passes `integrator_fee_account`.
  This is the "build-on-us" fee, exactly like Jupiter's `platformFeeBps` /
  DFlow's `platformFeeBps`.
- **Protocol fee** — a fixed `PROTOCOL_FEE_BPS` (default **20 bps = 0.20%**,
  Jupiter's docs example) is skimmed to `protocol_fee_account`, which **must be
  owned by `PROTOCOL_FEE_RECIPIENT`** (our treasury) — so an integrator can't
  redirect our cut. Set `PROTOCOL_FEE_BPS = 0` to disable.

Both fees are transferred via SPL-Token `Transfer`, signed by the same
`authority` that authorizes the swap (no extra signer). `RouteExecuted` reports
`amount_out` (gross), `net_out`, `protocol_fee`, and `integrator_fee`.

Validated in `bankrun/feeRoute.test.mjs`: correct split (protocol 20 + integrator
50 + net 9930 on 10,000 gross), min-out on the net, treasury-ownership guard, and
the integrator-fee cap.

## Supported venues

| Venue | selector | status |
| --- | --- | --- |
| Raydium AMM v4 | 0 | wired (allowlisted) |
| Raydium CLMM | 1 | wired |
| Raydium CPMM | 2 | wired |
| Meteora DLMM | 3 | wired |
| Meteora Dynamic AMM | 4 | wired |
| Pump.fun (bonding curve) | 5 | wired |
| PumpSwap AMM | 6 | wired |
| Kamino | 7 | reserved (lending/liquidity, not a classic swap venue — interface TBD) |

"Wired" = the router will CPI the venue and enforce allowlist + slippage. The
per-venue *instruction data* is assembled by the off-chain adapter for each
venue (the mapping the route-finder produces).

## Integration with the api-wallet

This program is meant to be the single program an api-wallet `TradingSession`
allowlists. `execute_trade` CPIs into `route`, giving an AI agent best-price,
multi-venue execution with the same approval-free, non-custodial guarantees.

> CPI-depth note: `execute_trade → route → venue → token program` sits at
> Solana's depth limit (4). For deep venue routes, call `route` directly from
> the session (session PDA as `authority`) rather than nesting through
> `execute_trade`.

## Build

```bash
anchor build -p aggregator_router          # SBF program + IDL
cargo test -p aggregator-router --lib      # venue-id decode test
```

## Roadmap

- Off-chain route-finder (pool ingestion, split/multi-hop search) — Rust crate + service
- Per-venue instruction-data adapters (Raydium/Meteora/Pump builders)
- Kamino integration once the target swap interface is confirmed
- Exact CLMM tick / DLMM bin math in the off-chain pricer
- Optional: Jito bundle submission for MEV-protected agent flow
