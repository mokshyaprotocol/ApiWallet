/**
 * Constant-product AMM math (x*y=k), exact integer arithmetic. Underpins
 * Raydium AMM/CPMM, PumpSwap, Meteora dynamic pools, and Pump.fun bonding
 * curves (the last feeds virtual reserves — see bondingCurve.ts).
 */
import { Pool } from "./types.js";

const BPS = 10_000n;

/**
 * inAfterFee = amountIn * (1 - fee); out = inAfterFee*reserveOut/(reserveIn+inAfterFee).
 * Floors like the on-chain program. 0n for degenerate inputs.
 */
export function getAmountOut(
  amountIn: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
  feeBps: number
): bigint {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) return 0n;
  const inAfterFee = (amountIn * (BPS - BigInt(feeBps))) / BPS;
  if (inAfterFee <= 0n) return 0n;
  return (inAfterFee * reserveOut) / (reserveIn + inAfterFee);
}

export function orient(
  pool: Pool,
  tokenIn: string
): { reserveIn: bigint; reserveOut: bigint; tokenOut: string } {
  if (tokenIn === pool.tokenA)
    return { reserveIn: pool.reserveA, reserveOut: pool.reserveB, tokenOut: pool.tokenB };
  if (tokenIn === pool.tokenB)
    return { reserveIn: pool.reserveB, reserveOut: pool.reserveA, tokenOut: pool.tokenA };
  throw new Error(`token ${tokenIn} not in pool ${pool.id}`);
}

export function poolAmountOut(pool: Pool, tokenIn: string, amountIn: bigint): bigint {
  const { reserveIn, reserveOut } = orient(pool, tokenIn);
  return getAmountOut(amountIn, reserveIn, reserveOut, pool.feeBps);
}

export function spotPrice(pool: Pool, tokenIn: string): number {
  const { reserveIn, reserveOut } = orient(pool, tokenIn);
  if (reserveIn === 0n) return 0;
  return Number(reserveOut) / Number(reserveIn);
}
