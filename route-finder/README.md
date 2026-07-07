# @apiwallet/route-finder

The **off-chain** half of the ApiWallet DEX aggregator. It quotes best-price
routes across venues and builds the execution plan (`legs`) that the on-chain
`aggregator_router` program executes. It never holds funds or signs anything —
it only computes a plan; the smart contract enforces safety.

```
this package (off-chain)                 aggregator_router (on-chain)
────────────────────────                 ────────────────────────────
fetch pools (adapters)                    route(amount_in, min_out, legs)
price + split + multi-hop (router)   ─▶   • venue allowlist
build legs + accounts (execution)         • slippage on real balance delta
                                          • atomic, caller-signed
```

## What's implemented

| Layer | Status |
| --- | --- |
| Constant-product + bonding-curve math (exact bigint) | ✅ tested |
| **CLMM tick-walking math** (Uniswap-v3 style, Q64.64) | ✅ tested* |
| **DLMM bin-walking math** (Meteora style) | ✅ tested* |
| Kind-aware pricing dispatcher wired into the router | ✅ tested |
| Router: single-hop, **split** (water-filling), **multi-hop** | ✅ tested |
| Adapters: Raydium (AMM+CLMM), Pump.fun (on-chain curve decode), Mock | ✅ (Raydium verified live) |
| Execution: `Route → RouterPlan` (legs + packed accounts) | ✅ tested |
| Venue builder: **Raydium AMM v4 swapBaseIn** | ✅ (fetches live keys) |
| Venue builders: **PumpSwap, Meteora DLMM** | ✅ data encoders tested; account layouts ⚠️ unvalidated |
| Kamino | ⛔ not a swap venue — see `venues/kamino.ts` |

*The CLMM/DLMM **math** is the exact concentrated-liquidity / bin equations and
is unit-tested for correctness (monotonicity, parity at price 1.0, fee, price
impact). **Bit-exact parity with each protocol's on-chain fixed-point rounding**
(and the tick→sqrtPrice table / bin Q64.64 prices) still needs a mainnet dry-run
before quotes are used for settlement. The PumpSwap/Meteora instruction *data*
encoders are exact (verified anchor discriminators); their *account layouts* are
documented-but-unvalidated and are gated behind `defaultBuilders({ includeUnvalidated: true })`.

## Usage

```ts
import { Aggregator, RaydiumAdapter, defaultBuilders } from "@apiwallet/route-finder";

const agg = new Aggregator([new RaydiumAdapter()]);

// Quote only:
const quote = await agg.quote({
  inputMint: SOL, outputMint: USDC, amount: 1_000_000_000n, slippageBps: 50,
});

// Quote + build the on-chain plan for aggregator_router.route():
const res = await agg.quoteAndPlan(
  { inputMint: SOL, outputMint: USDC, amount: 1_000_000_000n, slippageBps: 50 },
  defaultBuilders(),
  { owner: sessionPda, ataFor: (mint) => deriveAta(mint, sessionPda) }
);
// res.plan = { amountIn, minAmountOut, legs, accounts } -> feed to the program
```

## Verified

`npm test` runs 31 unit tests (constant-product / CLMM / DLMM math, router,
split, multi-hop, leg packing, venue data encoders). A live SOL→USDC quote
against Raydium's mainnet pools returns a correct price with computed slippage
and price impact.

## Mainnet validation harness

`src/sim/` builds a real swap plan, simulates it against mainnet with
`sigVerify:false` + `replaceRecentBlockhash:true` (so it needs **no funds and no
signing** — it "spends" from a real holder's account in simulation only), reads
the destination balance delta, and compares it to the router's predicted output.
This validates **both** the venue account layout (a wrong layout errors) and the
swap math (predicted vs actual).

```bash
# Needs an RPC that allows getTokenLargestAccounts + simulateTransaction
# account overrides (Helius/QuickNode/Triton etc. — free public nodes gate these).
RPC_URL="https://your-rpc" npm run validate
```

Prints predicted vs simulated output and the % gap (a small gap is expected from
cached-vs-live reserves; a large gap or a sim error flags a bug). The harness is
venue-generic; extending it to CLMM/DLMM needs their state-fetching adapters +
the Raydium CLMM instruction builder (next work).

## Trust model

The route-finder is untrusted by design. If it returns a bad or malicious plan,
the on-chain router still enforces the venue allowlist and the aggregate
`min_amount_out` (measured as a real output-balance delta), so the worst case is
a reverted transaction — never a loss. `min_amount_out` is the trust boundary:
this package *suggests*, the contract *guarantees*.

## Run

```bash
npm install
npm test          # unit tests
npm run build     # emit dist/
```
