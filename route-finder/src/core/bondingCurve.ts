/**
 * Pump.fun bonding-curve math. Economically identical to a constant-product AMM
 * over (virtualSol+realSol, virtualToken+realToken), so we normalize to a Pool
 * and reuse the AMM math. Pump protocol fee ~1% (100 bps).
 */
import { Pool } from "./types.js";

export const PUMP_FEE_BPS = 100;

export interface BondingCurveState {
  poolId: string;
  tokenMint: string;
  solMint: string;
  virtualSolReserves: bigint;
  virtualTokenReserves: bigint;
  realSolReserves: bigint;
  realTokenReserves: bigint;
}

export function bondingCurveToPool(s: BondingCurveState): Pool {
  return {
    id: s.poolId,
    dex: "pumpfun",
    kind: "bonding-curve",
    tokenA: s.solMint,
    tokenB: s.tokenMint,
    reserveA: s.virtualSolReserves + s.realSolReserves,
    reserveB: s.virtualTokenReserves + s.realTokenReserves,
    feeBps: PUMP_FEE_BPS,
    meta: { curve: s.poolId, tokenMint: s.tokenMint },
  };
}
