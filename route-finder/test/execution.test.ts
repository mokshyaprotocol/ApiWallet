import { describe, it, expect } from "vitest";
import { PoolGraph, findBestRoute } from "../src/router/router.js";
import { buildRouterPlan } from "../src/execution/legBuilder.js";
import { BuiltSwapIx, Venue, VenueBuilder } from "../src/execution/types.js";
import { encodeSwapBaseIn } from "../src/venues/raydiumAmm.js";
import { cpPool, A, B } from "./helpers.js";

describe("raydium swap data encoding", () => {
  it("encodes swapBaseIn as [9, amountIn u64le, minOut u64le]", () => {
    const data = encodeSwapBaseIn(1n, 0n);
    expect(Array.from(data)).toEqual([9, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const big = encodeSwapBaseIn(256n, 258n);
    expect(big[0]).toBe(9);
    expect(big[1]).toBe(0); // 256 = 0x0100 -> byte1=0, byte2=1
    expect(big[2]).toBe(1);
    expect(big[9]).toBe(2); // 258 = 0x0102 -> byte9=2, byte10=1
    expect(big[10]).toBe(1);
  });
});

describe("buildRouterPlan (leg packing)", () => {
  const mockBuilder: VenueBuilder = async (hop): Promise<BuiltSwapIx> => ({
    venue: Venue.RaydiumAmmV4,
    programId: "PROGRAMPROGRAMPROGRAMPROGRAMPROGRAMPROGRAM11",
    accounts: [
      { pubkey: "acct-owner", isSigner: true, isWritable: false },
      { pubkey: "acct-vault", isSigner: false, isWritable: true },
    ],
    data: encodeSwapBaseIn(hop.amountIn, 0n),
  });

  it("packs a single leg with correct offsets and appends the venue program", async () => {
    const p = cpPool(A, B, 1_000_000n, 1_000_000n);
    const route = findBestRoute(new PoolGraph([p]), A, B, 1000n)!;

    const plan = await buildRouterPlan(
      route,
      { [Venue.RaydiumAmmV4]: mockBuilder },
      { owner: "acct-owner", ataFor: (m) => `ata-${m}` },
      route.amountOut
    );

    expect(plan.legs).toHaveLength(1);
    expect(plan.legs[0].venue).toBe(Venue.RaydiumAmmV4);
    expect(plan.legs[0].accountOffset).toBe(0);
    expect(plan.legs[0].accountLen).toBe(2);
    // 2 leg accounts + 1 appended venue program account
    expect(plan.accounts).toHaveLength(3);
    expect(plan.accounts[2].pubkey).toBe("PROGRAMPROGRAMPROGRAMPROGRAMPROGRAMPROGRAM11");
    expect(plan.accounts[2].isSigner).toBe(false);
    expect(plan.minAmountOut).toBe(route.amountOut);
    expect(plan.amountIn).toBe(1000n);
  });

  it("throws for a venue with no registered builder", async () => {
    const p = cpPool(A, B, 1_000_000n, 1_000_000n, 25, "meteora-dlmm");
    const route = findBestRoute(new PoolGraph([p]), A, B, 1000n)!;
    await expect(
      buildRouterPlan(route, { [Venue.RaydiumAmmV4]: mockBuilder }, { owner: "o", ataFor: (m) => m }, 0n)
    ).rejects.toThrow(/no instruction builder/);
  });
});
