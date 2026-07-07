/**
 * Aggregator — public entry point. Fans out to venue adapters, unions their
 * pools into one graph, runs the router, and (optionally) builds the on-chain
 * execution plan. Pool fetches run concurrently and a failing venue is skipped
 * rather than failing the quote.
 */
import { Pool, Quote, QuoteRequest, Route } from "./core/types.js";
import { DexAdapter } from "./adapters/types.js";
import { findBestRoute, PoolGraph } from "./router/router.js";
import { buildRouterPlan } from "./execution/legBuilder.js";
import { BuildContext, RouterPlan, Venue, VenueBuilder } from "./execution/types.js";

export class Aggregator {
  constructor(private readonly adapters: DexAdapter[]) {}

  async collectPools(inputMint: string, outputMint: string): Promise<Pool[]> {
    const results = await Promise.allSettled(
      this.adapters.map((a) => a.getPoolsForPair(inputMint, outputMint))
    );
    const pools: Pool[] = [];
    for (const r of results) if (r.status === "fulfilled") pools.push(...r.value);
    const seen = new Set<string>();
    return pools.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
  }

  async quote(req: QuoteRequest): Promise<Quote | null> {
    const pools = await this.collectPools(req.inputMint, req.outputMint);
    return this.quoteFromPools(pools, req);
  }

  quoteFromPools(pools: Pool[], req: QuoteRequest): Quote | null {
    const graph = new PoolGraph(pools);
    const route = findBestRoute(graph, req.inputMint, req.outputMint, req.amount, {
      maxSplits: req.maxSplits,
      maxHops: req.maxHops,
    });
    if (!route) return null;
    return this.toQuote(route, req.slippageBps ?? 50);
  }

  /** Quote AND build the on-chain execution plan in one call. */
  async quoteAndPlan(
    req: QuoteRequest,
    builders: Partial<Record<Venue, VenueBuilder>>,
    ctx: BuildContext
  ): Promise<{ quote: Quote; plan: RouterPlan } | null> {
    const quote = await this.quote(req);
    if (!quote) return null;
    const plan = await buildRouterPlan(quote.route, builders, ctx, quote.minAmountOut);
    return { quote, plan };
  }

  private toQuote(route: Route, slippageBps: number): Quote {
    const minAmountOut = (route.amountOut * BigInt(10_000 - slippageBps)) / 10_000n;
    return {
      route,
      amountIn: route.amountIn,
      amountOut: route.amountOut,
      minAmountOut,
      priceImpact: route.priceImpact,
    };
  }
}
