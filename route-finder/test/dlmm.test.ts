import { describe, it, expect } from "vitest";
import { binPrice, dlmmQuote } from "../src/core/dlmm.js";
import { DlmmBin, Pool } from "../src/core/types.js";
import { A, B } from "./helpers.js";

function dlmmPool(activeId: number, binStep: number, bins: DlmmBin[], feeBps = 0): Pool {
  return {
    id: "dlmm1",
    dex: "meteora-dlmm",
    kind: "dlmm",
    tokenA: A, // X
    tokenB: B, // Y
    reserveA: 1n,
    reserveB: 1n,
    feeBps,
    dlmm: { activeId, binStep, bins },
  };
}

describe("DLMM bin math", () => {
  it("bin prices follow (1 + binStep/1e4)^id", () => {
    expect(binPrice(0, 100)).toBe(1);
    expect(binPrice(1, 100)).toBeCloseTo(1.01, 10);
    expect(binPrice(-1, 100)).toBeCloseTo(1 / 1.01, 10);
  });

  it("swaps X->Y within the active bin at price 1.0", () => {
    const pool = dlmmPool(0, 100, [{ id: 0, reserveX: 0n, reserveY: 1_000_000n }]);
    expect(dlmmQuote(pool, A, 1000n)).toBe(1000n); // price 1.0, no fee
  });

  it("walks into lower bins when the active bin is drained (X->Y)", () => {
    const pool = dlmmPool(0, 100, [
      { id: 0, reserveX: 0n, reserveY: 500n }, // price 1.0 -> 500 X drains it
      { id: -1, reserveX: 0n, reserveY: 1_000_000n }, // price ~0.990099
    ]);
    // 500 X drains bin0 (500 Y), remainder 500 X into bin -1 at ~0.9901 -> ~495 Y
    const out = dlmmQuote(pool, A, 1000n);
    expect(out).toBeGreaterThan(990n);
    expect(out).toBeLessThan(1000n);
  });

  it("swaps Y->X into higher bins", () => {
    const pool = dlmmPool(0, 100, [{ id: 0, reserveX: 1_000_000n, reserveY: 0n }]);
    // price 1.0 (Y per X): 1000 Y buys ~1000 X
    expect(dlmmQuote(pool, B, 1000n)).toBe(1000n);
  });

  it("applies the fee", () => {
    const bins = [{ id: 0, reserveX: 0n, reserveY: 1_000_000n }];
    const noFee = dlmmQuote(dlmmPool(0, 100, bins, 0), A, 10_000n);
    const withFee = dlmmQuote(dlmmPool(0, 100, bins, 100), A, 10_000n);
    expect(withFee).toBeLessThan(noFee);
  });
});
