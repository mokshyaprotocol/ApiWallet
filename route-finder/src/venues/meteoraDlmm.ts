/**
 * Meteora DLMM swap-instruction builder.
 *
 * ⚠️ VALIDATION STATUS: the instruction *data* encoder is exact (verified
 * anchor discriminator + `swap(amountIn, minAmountOut)` layout, unit-tested).
 * The *account layout* follows Meteora's documented DLMM `swap` order but has
 * NOT been validated against mainnet in this repo. The bin-array accounts must
 * be supplied by the caller (they depend on the swap size / bins crossed).
 * Verify with a simulated tx before funded use.
 */
import { BuildContext, BuiltSwapIx, AccountMetaLite, Venue } from "../execution/types.js";
import { RouteHop } from "../core/types.js";

export const METEORA_DLMM_PROGRAM = "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo";
export const METEORA_SWAP_DISC = Uint8Array.from([248, 198, 158, 145, 225, 117, 135, 200]);

const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

export interface MeteoraDlmmKeys {
  lbPair: string;
  binArrayBitmapExtension?: string; // omit -> program id sentinel
  reserveX: string;
  reserveY: string;
  tokenXMint: string;
  tokenYMint: string;
  oracle: string;
  eventAuthority: string;
  /** Bin arrays the swap will cross (order matters), supplied by the caller. */
  binArrays: string[];
}

export function encodeMeteoraSwap(amountIn: bigint, minAmountOut: bigint): Uint8Array {
  const buf = new Uint8Array(8 + 8 + 8);
  buf.set(METEORA_SWAP_DISC, 0);
  const dv = new DataView(buf.buffer);
  dv.setBigUint64(8, amountIn, true);
  dv.setBigUint64(16, minAmountOut, true);
  return buf;
}

const ro = (pubkey: string): AccountMetaLite => ({ pubkey, isSigner: false, isWritable: false });
const w = (pubkey: string): AccountMetaLite => ({ pubkey, isSigner: false, isWritable: true });

export const buildMeteoraDlmm = () => async (hop: RouteHop, ctx: BuildContext): Promise<BuiltSwapIx> => {
  const k = hop.pool.meta?.meteora as MeteoraDlmmKeys | undefined;
  if (!k) throw new Error("meteora builder: pool.meta.meteora keys not provided (unvalidated venue)");

  const userIn = ctx.ataFor(hop.tokenIn);
  const userOut = ctx.ataFor(hop.tokenOut);

  const accounts: AccountMetaLite[] = [
    w(k.lbPair),
    ro(k.binArrayBitmapExtension ?? METEORA_DLMM_PROGRAM),
    w(k.reserveX),
    w(k.reserveY),
    w(userIn),
    w(userOut),
    ro(k.tokenXMint),
    ro(k.tokenYMint),
    w(k.oracle),
    ro(METEORA_DLMM_PROGRAM), // host_fee_in sentinel (none)
    { pubkey: ctx.owner, isSigner: true, isWritable: false },
    ro(TOKEN_PROGRAM),
    ro(TOKEN_PROGRAM),
    ro(k.eventAuthority),
    ro(METEORA_DLMM_PROGRAM),
    ...k.binArrays.map(w), // variable bin arrays
  ];

  return {
    venue: Venue.MeteoraDlmm,
    programId: METEORA_DLMM_PROGRAM,
    accounts,
    data: encodeMeteoraSwap(hop.amountIn, 0n), // aggregate min enforced on-chain
  };
};
