# Venue swap status & completion plan

Status of on-chain swap execution per venue (routing/quote math is separate —
see the router unit tests).

| Venue | Quote math | Instruction builder | Mainnet swap validated |
| --- | --- | --- | --- |
| **Raydium AMM v4** | ✅ constant-product | ✅ live keys | ✅ **yes** — predicted vs simulated within 0.05% (`src/sim/validateRaydium.ts`) |
| **Raydium CLMM** | ✅ tick math (unit-tested) | ⬜ | ⬜ |
| **Meteora DLMM** | ✅ bin math (unit-tested) | ⚠️ scaffold | ⬜ needs SDK-built accounts (bin arrays) |
| **Pump.fun** | ✅ bonding curve | ⚠️ layout mapped, 2 accts blocked | ⬜ needs IDL/SDK |
| **PumpSwap** | ✅ constant-product | ⚠️ scaffold | ⬜ |

## How Raydium was validated (the reusable technique)

`simulateTransaction({ sigVerify:false, replaceRecentBlockhash:true })` runs the
swap in the simulated ledger without funds or signatures. Public RPCs (incl.
Helius) disable `getTokenLargestAccounts`, so we source funded source/dest token
accounts from a **second AMM pool's vaults** (all Raydium AMM vaults share one
global authority PDA) and sign as that authority. Reading the dest balance delta
gives the actual output to compare against the router's prediction. The same
technique validates any venue once its instruction builder is correct.

## Pump.fun — current on-chain `buy` layout (reverse-engineered from mainnet)

The live instruction is now **18 accounts** (was ~12), with Token-2022 support,
volume accumulators, and an external fee program. Mapped from a real tx:

```
[0]  global                       PDA ["global"]
[1]  fee_recipient                a SOL wallet (from global config)
[2]  mint
[3]  bonding_curve                PDA ["bonding-curve", mint]
[4]  associated_bonding_curve     ATA(bonding_curve, mint, tokenProgram)
[5]  associated_user              ATA(user, mint, tokenProgram)
[6]  user                         signer
[7]  system_program
[8]  token_program                CLASSIC **or** Token-2022 (per mint)
[9]  creator_vault                PDA ["creator-vault", creator]  (creator @ curve+49)
[10] event_authority              PDA ["__event_authority"]
[11] pump_program
[12] global_volume_accumulator    PDA ["global_volume_accumulator"]
[13] user_volume_accumulator      PDA ["user_volume_accumulator", user]
[14] fee_config                   PDA ["fee_config", pump] under fee_program
[15] fee_program                  pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ
[16] ??? (fee-program PDA, unknown seeds — not derivable without the IDL)
[17] ??? (fee-program-owned, 208 bytes — unknown seeds)
data: disc [102,6,61,18,1,218,235,234] + amount(u64) + max_sol_cost(u64)
```

`[16]`/`[17]` belong to Pump's new fee-program integration and can't be derived
by hand. Pump changes this layout frequently.

## Recommended completion path: use official SDKs for instruction-building

Hand-rolled builders break on every venue layout change (proven above). The
robust approach — used by production aggregators — is to let each venue's SDK
build the leg's `data` + accounts, while our on-chain `aggregator_router` keeps
owning execution (venue allowlist, atomicity, aggregate slippage). Plan:

1. **Meteora DLMM** — `@meteora-ag/dlmm`: `DLMM.create(conn, pool)` →
   `swapQuote()` → extract the `swap` instruction (it computes the required bin
   arrays). Wire into a `MeteoraDlmmAdapter` + builder; validate via the sim
   technique above.
2. **Pump.fun** — `@pump-fun/pump-sdk` (or the on-chain IDL): build `buy`/`sell`
   with correct current accounts (incl. the fee-program accounts); validate.
3. Keep our exact CLMM/DLMM/bonding-curve math as the fast quoting layer;
   cross-check it against each SDK's quote.

The router (`programs/aggregator-router`) and api-wallet integration are already
validated in bankrun and need no changes for this.
