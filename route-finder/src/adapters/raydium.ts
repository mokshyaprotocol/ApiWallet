/**
 * Raydium adapter — pool data for quoting.
 *
 * Source: Raydium's public pool API (schema verified). Standard pools are
 * constant-product (priced exactly); Concentrated (CLMM) reserves from this
 * endpoint are total balances, so constant-product pricing is an approximation
 * (flagged via kind `concentrated`; exact tick math is roadmap). The pool `id`
 * is carried in meta so the execution layer can fetch its full key set.
 *
 * Production: swap `fetch` for on-chain vault reads / a Geyser feed for
 * current-slot freshness.
 */
import { Pool } from "../core/types.js";
import { DexAdapter, toBaseUnits } from "./types.js";

const RAYDIUM_API = "https://api-v3.raydium.io";

interface RayMint {
  address: string;
  decimals: number;
}
interface RayPool {
  id: string;
  programId: string;
  type: string;
  feeRate: number;
  mintA: RayMint;
  mintB: RayMint;
  mintAmountA: number;
  mintAmountB: number;
}

export class RaydiumAdapter implements DexAdapter {
  readonly id = "raydium";
  constructor(private readonly apiBase: string = RAYDIUM_API) {}

  async getPoolsForPair(mintA: string, mintB: string): Promise<Pool[]> {
    const url =
      `${this.apiBase}/pools/info/mint?mint1=${mintA}&mint2=${mintB}` +
      `&poolType=all&poolSortField=liquidity&sortType=desc&pageSize=50&page=1`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`raydium api ${res.status}`);
    const json: any = await res.json();
    const rows: RayPool[] = json?.data?.data ?? [];
    return rows.filter((p) => p.mintAmountA > 0 && p.mintAmountB > 0).map((p) => this.normalize(p));
  }

  private normalize(p: RayPool): Pool {
    const clmm = p.type === "Concentrated";
    return {
      id: p.id,
      dex: clmm ? "raydium-clmm" : "raydium-amm",
      kind: clmm ? "concentrated" : "constant-product",
      tokenA: p.mintA.address,
      tokenB: p.mintB.address,
      reserveA: toBaseUnits(p.mintAmountA, p.mintA.decimals),
      reserveB: toBaseUnits(p.mintAmountB, p.mintB.decimals),
      feeBps: Math.round(p.feeRate * 10_000),
      meta: { poolId: p.id, programId: p.programId, rayType: p.type },
    };
  }
}
