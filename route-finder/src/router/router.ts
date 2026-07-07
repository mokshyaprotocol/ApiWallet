/**
 * The routing engine. Given a pool snapshot, finds the output-maximizing way to
 * swap `amountIn` using single-hop, split (water-filling across parallel pools),
 * and bounded multi-hop. Exact bigint math throughout.
 */
import { DexId, Pool, Route, RouteHop, RouteStep } from "../core/types.js";
import { quotePool, spotPriceOf } from "../core/pricing.js";

export interface RouteOptions {
  maxSplits: number;
  maxHops: number;
  splitGranularity: number;
}
const DEFAULTS: RouteOptions = { maxSplits: 3, maxHops: 2, splitGranularity: 100 };

export class PoolGraph {
  private byToken = new Map<string, Pool[]>();
  constructor(pools: Pool[]) {
    for (const p of pools) {
      if (p.reserveA <= 0n || p.reserveB <= 0n) continue;
      this.add(p.tokenA, p);
      this.add(p.tokenB, p);
    }
  }
  private add(t: string, p: Pool) {
    const a = this.byToken.get(t);
    if (a) a.push(p);
    else this.byToken.set(t, [p]);
  }
  direct(a: string, b: string): Pool[] {
    return (this.byToken.get(a) ?? []).filter(
      (p) => (p.tokenA === a && p.tokenB === b) || (p.tokenA === b && p.tokenB === a)
    );
  }
  neighbors(token: string): Set<string> {
    const out = new Set<string>();
    for (const p of this.byToken.get(token) ?? [])
      out.add(p.tokenA === token ? p.tokenB : p.tokenA);
    return out;
  }
}

/**
 * Water-filling splitter: spread `amountIn` across up to `maxSplits` pools to
 * maximize total out. Each chunk goes to the pool with the best *marginal*
 * output at its current allocation — a strong approximation of the optimal
 * split for nonlinear constant-product curves. Only used if it beats a single
 * pool.
 */
function computeStep(
  pools: Pool[],
  tokenIn: string,
  tokenOut: string,
  amountIn: bigint,
  opts: RouteOptions
): RouteStep | null {
  if (pools.length === 0 || amountIn <= 0n) return null;

  const ranked = [...pools].sort((a, b) =>
    quotePool(b, tokenIn, amountIn) > quotePool(a, tokenIn, amountIn) ? 1 : -1
  );
  const candidates = ranked.slice(0, Math.max(1, opts.maxSplits));
  const single = candidates[0];
  const singleOut = quotePool(single, tokenIn, amountIn);

  const chunk = amountIn / BigInt(opts.splitGranularity);
  let alloc: bigint[];
  let out: bigint;
  if (chunk <= 0n || candidates.length === 1) {
    alloc = candidates.map((p) => (p === single ? amountIn : 0n));
    out = singleOut;
  } else {
    alloc = new Array<bigint>(candidates.length).fill(0n);
    let remaining = amountIn;
    while (remaining > 0n) {
      const step = remaining < chunk ? remaining : chunk;
      let bestI = 0;
      let bestGain = -1n;
      for (let i = 0; i < candidates.length; i++) {
        const cur = quotePool(candidates[i], tokenIn, alloc[i]);
        const next = quotePool(candidates[i], tokenIn, alloc[i] + step);
        const gain = next - cur;
        if (gain > bestGain) {
          bestGain = gain;
          bestI = i;
        }
      }
      alloc[bestI] += step;
      remaining -= step;
    }
    out = candidates.reduce((acc, p, i) => acc + quotePool(p, tokenIn, alloc[i]), 0n);
    if (out <= singleOut) {
      alloc = candidates.map((p) => (p === single ? amountIn : 0n));
      out = singleOut;
    }
  }

  const hops: RouteHop[] = [];
  candidates.forEach((p, i) => {
    if (alloc[i] > 0n)
      hops.push({
        pool: p,
        tokenIn,
        tokenOut,
        amountIn: alloc[i],
        amountOut: quotePool(p, tokenIn, alloc[i]),
      });
  });
  return { tokenIn, tokenOut, amountIn, amountOut: out, hops };
}

function stepMid(step: RouteStep): number {
  const best = step.hops.reduce((a, b) => (b.amountOut > a.amountOut ? b : a));
  return spotPriceOf(best.pool, step.tokenIn);
}

function routeFromSteps(
  tokenIn: string,
  tokenOut: string,
  amountIn: bigint,
  steps: RouteStep[]
): Route {
  const amountOut = steps[steps.length - 1].amountOut;
  const mid = steps.reduce((m, s) => m * stepMid(s), 1);
  const realized = amountIn === 0n ? 0 : Number(amountOut) / Number(amountIn);
  const impact = mid > 0 ? Math.max(0, 1 - realized / mid) : 0;
  const venues = Array.from(new Set<DexId>(steps.flatMap((s) => s.hops.map((h) => h.pool.dex))));
  return { tokenIn, tokenOut, amountIn, amountOut, steps, priceImpact: impact, venues };
}

export function findBestRoute(
  graph: PoolGraph,
  inputMint: string,
  outputMint: string,
  amountIn: bigint,
  options: Partial<RouteOptions> = {}
): Route | null {
  // Coalesce per-field so an explicit `undefined` (e.g. from an unset request
  // field) falls back to the default instead of overriding it with undefined.
  const opts: RouteOptions = {
    maxSplits: options.maxSplits ?? DEFAULTS.maxSplits,
    maxHops: options.maxHops ?? DEFAULTS.maxHops,
    splitGranularity: options.splitGranularity ?? DEFAULTS.splitGranularity,
  };
  const candidates: Route[] = [];

  const directStep = computeStep(graph.direct(inputMint, outputMint), inputMint, outputMint, amountIn, opts);
  if (directStep) candidates.push(routeFromSteps(inputMint, outputMint, amountIn, [directStep]));

  if (opts.maxHops >= 2) {
    const fromIn = graph.neighbors(inputMint);
    const toOut = graph.neighbors(outputMint);
    for (const mid of fromIn) {
      if (mid === outputMint || mid === inputMint || !toOut.has(mid)) continue;
      const s1 = computeStep(graph.direct(inputMint, mid), inputMint, mid, amountIn, opts);
      if (!s1 || s1.amountOut <= 0n) continue;
      const s2 = computeStep(graph.direct(mid, outputMint), mid, outputMint, s1.amountOut, opts);
      if (!s2 || s2.amountOut <= 0n) continue;
      candidates.push(routeFromSteps(inputMint, outputMint, amountIn, [s1, s2]));
    }
  }

  if (candidates.length === 0) return null;
  return candidates.reduce((best, r) => (r.amountOut > best.amountOut ? r : best));
}
