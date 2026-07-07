import { describe, it, expect } from "vitest";
import { PoolGraph, findBestRoute } from "../src/router/router.js";
import { poolAmountOut } from "../src/core/amm.js";
import { cpPool, A, B, SOL } from "./helpers.js";

describe("router", () => {
  it("routes a single direct pool", () => {
    const p = cpPool(A, B, 1_000_000n, 1_000_000n);
    const g = new PoolGraph([p]);
    const r = findBestRoute(g, A, B, 1000n)!;
    expect(r).not.toBeNull();
    expect(r.steps).toHaveLength(1);
    expect(r.amountOut).toBe(poolAmountOut(p, A, 1000n));
  });

  it("picks the better of two parallel pools for a small order", () => {
    const deep = cpPool(A, B, 10_000_000n, 10_000_000n, 25);
    const shallow = cpPool(A, B, 100_000n, 100_000n, 25);
    const g = new PoolGraph([shallow, deep]);
    const r = findBestRoute(g, A, B, 1000n, { maxSplits: 1 })!;
    // with a single split allowed, it should choose the deep pool
    expect(r.amountOut).toBe(poolAmountOut(deep, A, 1000n));
  });

  it("split beats a single pool on a large order across parallel pools", () => {
    // Two equal pools: splitting a large order reduces price impact.
    const p1 = cpPool(A, B, 1_000_000n, 1_000_000n, 0);
    const p2 = cpPool(A, B, 1_000_000n, 1_000_000n, 0);
    const g = new PoolGraph([p1, p2]);
    const amount = 400_000n;
    const split = findBestRoute(g, A, B, amount, { maxSplits: 2 })!;
    const singleOnly = findBestRoute(g, A, B, amount, { maxSplits: 1 })!;
    expect(split.amountOut).toBeGreaterThan(singleOnly.amountOut);
    expect(split.steps[0].hops.length).toBe(2);
  });

  it("finds a 2-hop route through an intermediary when no direct pool exists", () => {
    const aSol = cpPool(A, SOL, 1_000_000n, 1_000_000n, 0);
    const solB = cpPool(SOL, B, 1_000_000n, 1_000_000n, 0);
    const g = new PoolGraph([aSol, solB]);
    const r = findBestRoute(g, A, B, 1000n, { maxHops: 2 });
    expect(r).not.toBeNull();
    expect(r!.steps).toHaveLength(2);
    expect(r!.amountOut).toBeGreaterThan(0n);
  });

  it("treats explicit undefined options as defaults (regression)", () => {
    const p = cpPool(A, B, 1_000_000n, 1_000_000n);
    const g = new PoolGraph([p]);
    // A QuoteRequest with unset maxSplits/maxHops forwards undefined here.
    const r = findBestRoute(g, A, B, 1000n, { maxSplits: undefined, maxHops: undefined });
    expect(r).not.toBeNull();
    expect(r!.amountOut).toBe(poolAmountOut(p, A, 1000n));
  });

  it("returns null when there is no path", () => {
    const g = new PoolGraph([cpPool(A, SOL, 1000n, 1000n)]);
    expect(findBestRoute(g, A, B, 1000n)).toBeNull();
  });
});
