import { Pool } from "../core/types.js";

export interface DexAdapter {
  readonly id: string;
  getPoolsForPair(mintA: string, mintB: string): Promise<Pool[]>;
}

/** UI (human) amount -> base units, flooring. */
export function toBaseUnits(uiAmount: number | string, decimals: number): bigint {
  const s = typeof uiAmount === "number" ? uiAmount.toFixed(decimals) : uiAmount;
  const [whole, frac = ""] = s.split(".");
  const fracPadded = (frac + "0".repeat(decimals)).slice(0, decimals);
  return BigInt((whole === "" || whole === "-" ? "0" : whole) + fracPadded);
}
