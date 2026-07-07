/**
 * Core domain types. Token amounts are always `bigint` base units — routing
 * math is exact, never floating point. Derived numbers (prices, impact) are
 * `number` for display only.
 */

export type DexId =
  | "raydium-amm"
  | "raydium-clmm"
  | "raydium-cpmm"
  | "meteora-dlmm"
  | "meteora-dynamic"
  | "pumpfun"
  | "pumpswap";

export type PoolKind = "constant-product" | "concentrated" | "dlmm" | "bonding-curve";

export interface Token {
  mint: string;
  symbol?: string;
  decimals: number;
}

/**
 * Normalized pool. `reserveA/B` are the *effective* reserves the pricing math
 * consumes (virtual reserves for a bonding curve; total balances for a CLMM as
 * a documented approximation). `meta` carries venue-specific data the execution
 * layer needs to build the swap instruction (e.g. Raydium pool id).
 */
export interface Pool {
  id: string;
  dex: DexId;
  kind: PoolKind;
  tokenA: string;
  tokenB: string;
  reserveA: bigint;
  reserveB: bigint;
  feeBps: number;
  meta?: Record<string, unknown>;
}

export interface RouteHop {
  pool: Pool;
  tokenIn: string;
  tokenOut: string;
  amountIn: bigint;
  amountOut: bigint;
}

export interface RouteStep {
  tokenIn: string;
  tokenOut: string;
  amountIn: bigint;
  amountOut: bigint;
  hops: RouteHop[]; // 1 = single pool, >1 = split across venues
}

export interface Route {
  tokenIn: string;
  tokenOut: string;
  amountIn: bigint;
  amountOut: bigint;
  steps: RouteStep[]; // sequential (multi-hop); each step may be split
  priceImpact: number;
  venues: DexId[];
}

export interface QuoteRequest {
  inputMint: string;
  outputMint: string;
  amount: bigint;
  slippageBps?: number;
  maxSplits?: number;
  maxHops?: number;
}

export interface Quote {
  route: Route;
  amountIn: bigint;
  amountOut: bigint;
  minAmountOut: bigint;
  priceImpact: number;
}
