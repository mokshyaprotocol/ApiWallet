import { Pool } from "../src/core/types.js";

let n = 0;
export function cpPool(
  tokenA: string,
  tokenB: string,
  reserveA: bigint,
  reserveB: bigint,
  feeBps = 25,
  dex: Pool["dex"] = "raydium-amm"
): Pool {
  return {
    id: `pool-${n++}`,
    dex,
    kind: "constant-product",
    tokenA,
    tokenB,
    reserveA,
    reserveB,
    feeBps,
    meta: { poolId: `pool-${n}` },
  };
}

export const A = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
export const B = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
export const SOL = "So11111111111111111111111111111111111111112";
