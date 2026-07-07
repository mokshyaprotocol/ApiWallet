/**
 * Kind-aware pricing dispatcher. The router calls these instead of the raw
 * constant-product functions so each pool is priced by the correct model:
 *   - constant-product / bonding-curve -> AMM math over reserveA/B
 *   - concentrated -> exact CLMM tick math (falls back to AMM if no state)
 *   - dlmm -> exact DLMM bin math (falls back to AMM if no state)
 */
import { Pool } from "./types.js";
import { poolAmountOut, spotPrice as ammSpot } from "./amm.js";
import { clmmQuote, clmmSpotPrice } from "./clmm.js";
import { dlmmQuote, dlmmSpotPrice } from "./dlmm.js";

export function quotePool(pool: Pool, tokenIn: string, amountIn: bigint): bigint {
  switch (pool.kind) {
    case "concentrated":
      return pool.clmm ? clmmQuote(pool, tokenIn, amountIn) : poolAmountOut(pool, tokenIn, amountIn);
    case "dlmm":
      return pool.dlmm ? dlmmQuote(pool, tokenIn, amountIn) : poolAmountOut(pool, tokenIn, amountIn);
    case "constant-product":
    case "bonding-curve":
    default:
      return poolAmountOut(pool, tokenIn, amountIn);
  }
}

export function spotPriceOf(pool: Pool, tokenIn: string): number {
  switch (pool.kind) {
    case "concentrated":
      return pool.clmm ? clmmSpotPrice(pool, tokenIn) : ammSpot(pool, tokenIn);
    case "dlmm":
      return pool.dlmm ? dlmmSpotPrice(pool, tokenIn) : ammSpot(pool, tokenIn);
    default:
      return ammSpot(pool, tokenIn);
  }
}
