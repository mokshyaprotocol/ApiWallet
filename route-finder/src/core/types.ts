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
 * A CLMM (Uniswap-v3-style concentrated liquidity) pool snapshot.
 * Convention: token0 = pool.tokenA, token1 = pool.tokenB.
 * `sqrtPriceX64` is √(token1/token0) in Q64.64 fixed point. `ticks` are the
 * initialized ticks, sorted ascending, carrying `liquidityNet`.
 */
export interface ClmmTick {
  tickIndex: number;
  liquidityNet: bigint;
}
export interface ClmmState {
  sqrtPriceX64: bigint;
  liquidity: bigint;
  tickCurrent: number;
  tickSpacing: number;
  ticks: ClmmTick[];
}

/**
 * A DLMM (Meteora-style discrete-bin liquidity) pool snapshot.
 * Convention: token0 = pool.tokenA (X), token1 = pool.tokenB (Y).
 * Bin `id` prices as (1 + binStep/1e4)^id (Y per X). `bins` hold per-bin
 * reserves; only bins with liquidity need be included.
 */
export interface DlmmBin {
  id: number;
  reserveX: bigint;
  reserveY: bigint;
}
export interface DlmmState {
  activeId: number;
  binStep: number; // basis points
  bins: DlmmBin[];
}

/**
 * Normalized pool. `reserveA/B` are the effective constant-product reserves
 * (virtual reserves for a bonding curve). For concentrated/dlmm pools the exact
 * pricing uses `clmm`/`dlmm` when present; if absent the router falls back to a
 * constant-product approximation over `reserveA/B`. `meta` carries venue data
 * the execution layer needs (e.g. Raydium pool id).
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
  clmm?: ClmmState;
  dlmm?: DlmmState;
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
