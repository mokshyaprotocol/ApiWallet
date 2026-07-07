# Venue swap status & completion plan

Status of on-chain swap execution per venue (routing/quote math is separate —
see the router unit tests).

| Venue | Quote math | Instruction builder | Mainnet swap validated |
| --- | --- | --- | --- |
| **Raydium AMM v4** | ✅ constant-product | ✅ live keys | ✅ **yes** — mainnet sim, predicted vs simulated within 0.05% (`src/sim/validateRaydium.ts`) |
| **Raydium CLMM** | ✅ tick math (unit-tested) | ⬜ | ⬜ |
| **Meteora DLMM** | ✅ bin math (unit-tested) | ✅ `swap2` (from live tx) | ✅ **yes** — bankrun on cloned mainnet state, output matches DLMM SDK to 0.0001% (`bankrun/meteoraSwap.test.mjs`) |
| **Pump.fun** | ✅ bonding curve (unit-tested) | ⚠️ layout mapped; needs IDL/SDK | 🟡 replay-demonstrated (a real buy re-simulated on mainnet credited the exact amount), but not a robust builder — see below |
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

**Replay finding:** re-simulating a *real* pre-graduation buy verbatim on
mainnet (sigVerify:false, boosted max_sol_cost) executed cleanly and credited
the user the exact requested token amount — so the mapped layout is functionally
correct for that variant. However, sampling other live buys showed **different
`buy` variants** (different arg/account shapes, some via routers). Combined with
the non-derivable fee accounts and Token-2022, a *robust* Pump builder needs
Pump's IDL/SDK, not hand-rolling. Our bonding-curve math is unit-tested against
the constant-product model Pump documents.

## Meteora DLMM — current on-chain `swap2` layout (from live mainnet tx)

The current swap is **`swap2`**, not `swap` (deprecated). 17 fixed accounts +
variable bin arrays. Mapped from a real tx:

```
disc = sha256("global:swap2")[:8] = [65,75,63,76,235,91,91,136]
[0]  lb_pair                     (w)
[1]  bin_array_bitmap_extension  (opt -> program id sentinel)
[2]  reserve_x                   (w)
[3]  reserve_y                   (w)
[4]  user_token_in               (w)
[5]  user_token_out              (w)
[6]  token_x_mint
[7]  token_y_mint
[8]  oracle                      (w)
[9]  host_fee_in                 (opt -> program id sentinel)
[10] user                        signer
[11] token_x_program             (classic or Token-2022)
[12] token_y_program
[13] memo_program                MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr
[14] event_authority
[15] program
[16+] bin_arrays                 (from the DLMM SDK; size-dependent)
data = disc + amount_in(u64) + min_amount_out(u64) + RemainingAccountsInfo(empty vec)
```

`src/venues/meteoraDlmm.ts` now encodes this exact layout. The remaining work to
sim-validate: decode the LbPair state (activeId/binStep/reserves/oracle) and
select the bin arrays for the swap — both provided by `@meteora-ag/dlmm`.

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
