/**
 * Validates the Raydium AMM path end-to-end against mainnet:
 *   fetch pools -> router quote -> build plan -> simulate -> compare.
 *
 *   npx tsx src/sim/validateRaydium.ts
 *
 * A small predicted-vs-actual gap is expected (our reserves come from Raydium's
 * cached API while the simulation uses live on-chain state); a large gap or a
 * simulation error signals a math/layout bug.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { Aggregator } from "../aggregator.js";
import { RaydiumAdapter } from "../adapters/raydium.js";
import { buildRaydiumAmmSwap } from "../venues/raydiumAmm.js";
import { buildRouterPlan } from "../execution/legBuilder.js";
import { Venue } from "../execution/types.js";
import { findFundedHolder, simulatePlan } from "./simulate.js";

const RPC = process.env.RPC_URL ?? "https://api.mainnet-beta.solana.com";
const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

async function main() {
  const connection = new Connection(RPC, "confirmed");
  const amountIn = 100_000_000n; // 0.1 SOL

  // 1) Pools + quote (constant-product / AMM only, since that's the wired builder).
  const pools = (await new RaydiumAdapter().getPoolsForPair(SOL, USDC)).filter(
    (p) => p.kind === "constant-product"
  );
  console.log(`fetched ${pools.length} Raydium AMM pools`);
  const quote = new Aggregator([]).quoteFromPools(pools, {
    inputMint: SOL,
    outputMint: USDC,
    amount: amountIn,
    slippageBps: 50,
  });
  if (!quote) throw new Error("no route");
  console.log("predicted out:", (Number(quote.amountOut) / 1e6).toFixed(6), "USDC");
  console.log("route pools:", quote.route.steps[0].hops.map((h) => h.pool.id).join(", "));

  // 2) Real funded accounts for source (SOL) and dest (USDC).
  const source = await findFundedHolder(connection, SOL);
  const dest = await findFundedHolder(connection, USDC);
  console.log("source (wSOL):", source.tokenAccount.toBase58(), "owner", source.owner.toBase58());
  console.log("dest (USDC):", dest.tokenAccount.toBase58());

  // 3) Build the plan with sim accounts.
  const plan = await buildRouterPlan(
    quote.route,
    { [Venue.RaydiumAmmV4]: buildRaydiumAmmSwap() },
    {
      owner: source.owner.toBase58(),
      ataFor: (mint) => (mint === SOL ? source.tokenAccount.toBase58() : dest.tokenAccount.toBase58()),
    },
    quote.minAmountOut
  );

  // 4) Simulate against mainnet.
  const res = await simulatePlan(connection, plan, source.owner, dest.tokenAccount);
  console.log("\n--- simulation ---");
  console.log("ok:", res.ok, "| computeUnits:", res.computeUnits);
  if (!res.ok) {
    console.log("err:", JSON.stringify(res.err));
    console.log((res.logs ?? []).slice(-12).join("\n"));
    process.exit(1);
  }
  const actual = res.actualOut!;
  const predicted = quote.amountOut;
  const diffPct = (Number(actual - predicted) / Number(predicted)) * 100;
  console.log("actual out  :", (Number(actual) / 1e6).toFixed(6), "USDC");
  console.log("predicted   :", (Number(predicted) / 1e6).toFixed(6), "USDC");
  console.log("diff        :", diffPct.toFixed(3) + "%");
  console.log(
    Math.abs(diffPct) < 3
      ? "\n✅ predicted matches simulated within tolerance — account layout + math validated"
      : "\n⚠️ gap exceeds 3% — investigate (stale data vs math bug)"
  );
}

main().catch((e) => {
  console.error("VALIDATION FAILED:", e.message ?? e);
  process.exit(1);
});
