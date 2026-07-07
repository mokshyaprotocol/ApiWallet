import { describe, it, expect } from "vitest";
import { bondingCurveToPool, PUMP_FEE_BPS } from "../src/core/bondingCurve.js";
import { poolAmountOut } from "../src/core/amm.js";
import { SOL } from "./helpers.js";

describe("pump.fun bonding curve", () => {
  const TOKEN = "TokenMintTokenMintTokenMintTokenMintTokenMint";
  const state = {
    poolId: "curve1",
    tokenMint: TOKEN,
    solMint: SOL,
    virtualSolReserves: 30_000_000_000n, // 30 SOL
    virtualTokenReserves: 1_073_000_000_000_000n,
    realSolReserves: 0n,
    realTokenReserves: 0n,
  };

  it("normalizes to a constant-product pool over virtual reserves", () => {
    const p = bondingCurveToPool(state);
    expect(p.kind).toBe("bonding-curve");
    expect(p.feeBps).toBe(PUMP_FEE_BPS);
    expect(p.tokenA).toBe(SOL);
    expect(p.tokenB).toBe(TOKEN);
    expect(p.reserveA).toBe(30_000_000_000n);
  });

  it("a buy (SOL in) returns tokens out", () => {
    const p = bondingCurveToPool(state);
    const out = poolAmountOut(p, SOL, 1_000_000_000n); // 1 SOL in
    expect(out).toBeGreaterThan(0n);
  });
});
