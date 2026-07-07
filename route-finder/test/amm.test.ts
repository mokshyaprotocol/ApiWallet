import { describe, it, expect } from "vitest";
import { getAmountOut, poolAmountOut, orient } from "../src/core/amm.js";
import { cpPool, A, B } from "./helpers.js";

describe("constant-product AMM math", () => {
  it("matches the closed-form with no fee", () => {
    // 100 in, reserves 1000/1000, fee 0 => 100*1000/1100 = 90 (floored)
    expect(getAmountOut(100n, 1000n, 1000n, 0)).toBe(90n);
  });

  it("applies the fee to the input", () => {
    // inAfterFee = 100*9975/10000 = 99; 99*1000/1099 = 90
    expect(getAmountOut(100n, 1000n, 1000n, 25)).toBe(90n);
  });

  it("returns 0 for degenerate inputs", () => {
    expect(getAmountOut(0n, 1000n, 1000n, 25)).toBe(0n);
    expect(getAmountOut(100n, 0n, 1000n, 25)).toBe(0n);
    expect(getAmountOut(100n, 1000n, 0n, 25)).toBe(0n);
  });

  it("is monotonic in amountIn", () => {
    const a = getAmountOut(100n, 1_000_000n, 1_000_000n, 25);
    const b = getAmountOut(200n, 1_000_000n, 1_000_000n, 25);
    expect(b).toBeGreaterThan(a);
  });

  it("exhibits price impact (marginal rate decreases with size)", () => {
    const small = getAmountOut(1_000n, 1_000_000n, 1_000_000n, 0);
    const large = getAmountOut(500_000n, 1_000_000n, 1_000_000n, 0);
    // rate for large fill is worse than for small fill
    expect(Number(large) / 500_000).toBeLessThan(Number(small) / 1_000);
  });

  it("orients reserves by input token and rejects unknown tokens", () => {
    const p = cpPool(A, B, 10n, 20n);
    expect(orient(p, A).reserveOut).toBe(20n);
    expect(orient(p, B).reserveOut).toBe(10n);
    expect(() => orient(p, "ZZZ")).toThrow();
    expect(poolAmountOut(p, A, 1n)).toBeGreaterThanOrEqual(0n);
  });
});
