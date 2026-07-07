import { describe, it, expect } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";
import { PoolGraph, findBestRoute } from "../src/router/router.js";
import { buildRouterPlan } from "../src/execution/legBuilder.js";
import { BuiltSwapIx, Venue, VenueBuilder } from "../src/execution/types.js";
import { encodeRouteData, ROUTE_DISCRIMINATOR, lookupAddressesForPlan } from "../src/execution/routerInstruction.js";
import { buildRouteV0Transaction, makeLookupTableAccount } from "../src/execution/versionedTx.js";
import { cpPool, A, B } from "./helpers.js";

// mock venue builder returning a chunky account set (to exercise LUT compression)
const VENUE_PROG = "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8"; // Raydium AMM v4
const wideBuilder: VenueBuilder = async (hop): Promise<BuiltSwapIx> => ({
  venue: Venue.RaydiumAmmV4,
  programId: VENUE_PROG,
  accounts: Array.from({ length: 10 }, (_, i) => ({
    pubkey: Keypair.generate().publicKey.toBase58(),
    isSigner: false,
    isWritable: i % 2 === 0,
  })),
  data: Buffer.from([9, ...new Array(16).fill(0)]),
});

async function makePlan() {
  const route = findBestRoute(new PoolGraph([cpPool(A, B, 1_000_000n, 1_000_000n)]), A, B, 1000n)!;
  return buildRouterPlan(route, { [Venue.RaydiumAmmV4]: wideBuilder }, { owner: "owner", ataFor: (m) => `ata-${m}` }, route.amountOut);
}

describe("route() instruction encoding", () => {
  it("encodes disc + amountIn + minOut + integratorFeeBps + legs vec", async () => {
    const plan = await makePlan();
    const data = encodeRouteData(plan, 25);
    expect(Array.from(data.subarray(0, 8))).toEqual(Array.from(ROUTE_DISCRIMINATOR));
    expect(data.readBigUInt64LE(8)).toBe(plan.amountIn);
    expect(data.readBigUInt64LE(16)).toBe(plan.minAmountOut);
    expect(data.readUInt16LE(24)).toBe(25); // integrator_fee_bps
    expect(data.readUInt32LE(26)).toBe(plan.legs.length); // 1 leg
  });
});

describe("versioned (v0) transaction + Address Lookup Table", () => {
  it("compiles a v0 tx and compresses accounts via the LUT", async () => {
    const plan = await makePlan();
    const accounts = {
      routerProgramId: new PublicKey("7c8LDstCZnVxtcKLBdMD6YFmmNbVUTaQnZNv9Txmh8t6"),
      authority: Keypair.generate().publicKey,
      outputTokenAccount: Keypair.generate().publicKey,
      tokenProgram: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
      protocolFeeAccount: Keypair.generate().publicKey,
      integratorFeeAccount: Keypair.generate().publicKey,
    };
    const addrs = lookupAddressesForPlan(plan, accounts);
    const lut = makeLookupTableAccount(Keypair.generate().publicKey, addrs);

    const payer = accounts.authority;
    const bh = "11111111111111111111111111111111"; // dummy blockhash

    const withLut = buildRouteV0Transaction(plan, accounts, { payer, recentBlockhash: bh, lookupTables: [lut] });
    const noLut = buildRouteV0Transaction(plan, accounts, { payer, recentBlockhash: bh });

    // v0 message
    expect(withLut.version).toBe(0);
    // LUT actually used
    expect(withLut.message.addressTableLookups.length).toBe(1);
    // compression: fewer static keys than without the LUT
    expect(withLut.message.staticAccountKeys.length).toBeLessThan(noLut.message.staticAccountKeys.length);
    // the compiled instruction still references all accounts (static + looked-up)
    const looked = withLut.message.addressTableLookups.reduce((n, l) => n + l.writableIndexes.length + l.readonlyIndexes.length, 0);
    expect(withLut.message.staticAccountKeys.length + looked).toBe(noLut.message.staticAccountKeys.length);
  });
});
