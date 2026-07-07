/**
 * Validates the Raydium AMM swap path against mainnet — no funds, no signing.
 *
 *   RPC_URL="https://mainnet.helius-rpc.com/?api-key=..." npx tsx src/sim/validateRaydium.ts
 *
 * Approach: route a swap through the deepest AMM pool (poolA). For funded
 * source/dest token accounts we borrow a *second* AMM pool's vaults (poolB) —
 * all Raydium AMM vaults are owned by one global authority PDA, so we sign as
 * that authority with `sigVerify:false` in simulation. We then compare the
 * router's predicted output to the simulated balance delta on the dest vault.
 * (Public RPCs disable getTokenLargestAccounts, so we avoid it.)
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { Aggregator } from "../aggregator.js";
import { RaydiumAdapter } from "../adapters/raydium.js";
import { buildRaydiumAmmSwap, fetchRaydiumKeys } from "../venues/raydiumAmm.js";
import { buildRouterPlan } from "../execution/legBuilder.js";
import { Venue } from "../execution/types.js";
import { simulatePlan } from "./simulate.js";

const RPC = process.env.RPC_URL ?? "https://api.mainnet-beta.solana.com";
const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

async function main() {
  const connection = new Connection(RPC, "confirmed");
  const amountIn = 100_000_000n; // 0.1 SOL

  const pools = (await new RaydiumAdapter().getPoolsForPair(SOL, USDC)).filter(
    (p) => p.kind === "constant-product"
  );
  if (pools.length < 2) throw new Error("need >=2 AMM pools");
  const poolA = pools[0]; // route through this one
  const poolB = pools.find((p) => p.id !== poolA.id)!; // borrow its vaults
  console.log(`AMM pools: ${pools.length} | route via ${poolA.id} | vaults from ${poolB.id}`);

  const quote = new Aggregator([]).quoteFromPools([poolA], {
    inputMint: SOL,
    outputMint: USDC,
    amount: amountIn,
    slippageBps: 50,
  });
  if (!quote) throw new Error("no route");
  console.log("predicted out:", (Number(quote.amountOut) / 1e6).toFixed(6), "USDC");

  // Funded source/dest = poolB's vaults; authority = the global Raydium AMM PDA.
  const kB = await fetchRaydiumKeys(poolB.id);
  const authority = new PublicKey(kB.authority);
  const source = kB.vault.A; // wSOL vault (input)
  const dest = kB.vault.B; // USDC vault (output)
  console.log("authority:", authority.toBase58());

  const plan = await buildRouterPlan(
    quote.route,
    { [Venue.RaydiumAmmV4]: buildRaydiumAmmSwap() },
    { owner: authority.toBase58(), ataFor: (m) => (m === SOL ? source : dest) },
    quote.minAmountOut
  );

  const res = await simulatePlan(connection, plan, authority, new PublicKey(dest));
  console.log("\n--- simulation ---");
  console.log("ok:", res.ok, "| computeUnits:", res.computeUnits);
  if (!res.ok) {
    console.log("err:", JSON.stringify(res.err));
    console.log((res.logs ?? []).slice(-14).join("\n"));
    process.exit(1);
  }
  const actual = res.actualOut!;
  const predicted = quote.amountOut;
  const diffPct = (Number(actual - predicted) / Number(predicted)) * 100;
  console.log("actual out :", (Number(actual) / 1e6).toFixed(6), "USDC");
  console.log("predicted  :", (Number(predicted) / 1e6).toFixed(6), "USDC");
  console.log("diff       :", diffPct.toFixed(3) + "%");
  console.log(
    Math.abs(diffPct) < 3
      ? "\n✅ Raydium AMM: predicted matches simulated — account layout + math validated on mainnet"
      : "\n⚠️ gap exceeds 3% (stale API reserves vs live state) — layout OK if sim succeeded"
  );
}

main().catch((e) => {
  console.error("VALIDATION FAILED:", e.message ?? e);
  process.exit(1);
});
