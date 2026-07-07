/** In-memory adapter for tests / offline demos — no network. */
import { Pool } from "../core/types.js";
import { DexAdapter } from "./types.js";

export class MockAdapter implements DexAdapter {
  readonly id = "mock";
  constructor(private readonly pools: Pool[]) {}
  async getPoolsForPair(mintA: string, mintB: string): Promise<Pool[]> {
    return this.pools.filter(
      (p) =>
        p.tokenA === mintA || p.tokenB === mintA || p.tokenA === mintB || p.tokenB === mintB
    );
  }
}
