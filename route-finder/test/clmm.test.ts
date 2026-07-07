import { describe, it, expect } from "vitest";
import { getSqrtRatioAtTick, clmmQuote } from "../src/core/clmm.js";
import { Pool } from "../src/core/types.js";
import { A, B } from "./helpers.js";

const Q64 = 1n << 64n;

function clmmPool(sqrtPriceX64: bigint, liquidity: bigint, feeBps = 0): Pool {
  return {
    id: "clmm1",
    dex: "raydium-clmm",
    kind: "concentrated",
    tokenA: A,
    tokenB: B,
    reserveA: 1n,
    reserveB: 1n,
    feeBps,
    clmm: { sqrtPriceX64, liquidity, tickCurrent: 0, tickSpacing: 1, ticks: [] },
  };
}

describe("CLMM tick math", () => {
  it("getSqrtRatioAtTick(0) is 1.0 in Q64.64", () => {
    expect(getSqrtRatioAtTick(0)).toBe(Q64);
  });

  it("is monotonic in tick", () => {
    expect(getSqrtRatioAtTick(100)).toBeGreaterThan(getSqrtRatioAtTick(0));
    expect(getSqrtRatioAtTick(0)).toBeGreaterThan(getSqrtRatioAtTick(-100));
    expect(getSqrtRatioAtTick(887272)).toBeGreaterThan(getSqrtRatioAtTick(1000));
  });

  it("prices a single-range swap near parity at price 1.0 (deep liquidity)", () => {
    const pool = clmmPool(Q64, 1_000_000_000_000_000n); // price 1.0, deep L
    const outAB = clmmQuote(pool, A, 1_000_000n); // zeroForOne
    const outBA = clmmQuote(pool, B, 1_000_000n); // oneForZero
    for (const out of [outAB, outBA]) {
      expect(out).toBeGreaterThan(999_000n); // tiny impact
      expect(out).toBeLessThanOrEqual(1_000_000n);
    }
  });

  it("applies the fee", () => {
    const noFee = clmmQuote(clmmPool(Q64, 1_000_000_000_000_000n, 0), A, 1_000_000n);
    const withFee = clmmQuote(clmmPool(Q64, 1_000_000_000_000_000n, 100), A, 1_000_000n); // 1%
    expect(withFee).toBeLessThan(noFee);
  });

  it("shows worsening marginal rate with size (price impact)", () => {
    const pool = clmmPool(Q64, 1_000_000_000n); // shallower L
    const small = clmmQuote(pool, A, 1_000n);
    const large = clmmQuote(pool, A, 100_000_000n);
    expect(Number(large) / 100_000_000).toBeLessThan(Number(small) / 1_000);
  });

  it("returns 0 without state or liquidity", () => {
    expect(clmmQuote(clmmPool(Q64, 0n), A, 1000n)).toBe(0n);
  });
});
