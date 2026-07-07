/**
 * Meteora DLMM swap-instruction builder — `swap2`.
 *
 * The account layout and discriminator below were reverse-engineered from a
 * live mainnet `swap2` transaction (the current default; the older `swap` is
 * deprecated). 17 fixed accounts + a variable number of bin-array accounts.
 *
 * ⚠️ VALIDATION STATUS: layout matches a live tx and the data encoder is exact,
 * but this repo has not yet run a predicted-vs-simulated check for Meteora (the
 * bin-array selection for a given swap size and DLMM state decoding are best
 * done via `@meteora-ag/dlmm`; see VENUES.md). Treat as layout-accurate but
 * not-yet-sim-validated. Keys + bin arrays are supplied by the caller.
 */
import { BuildContext, BuiltSwapIx, AccountMetaLite, Venue } from "../execution/types.js";
import { RouteHop } from "../core/types.js";

export const METEORA_DLMM_PROGRAM = "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo";
// sha256("global:swap2")[:8] — verified present in live mainnet swaps.
export const METEORA_SWAP2_DISC = Uint8Array.from([65, 75, 63, 76, 235, 91, 91, 136]);

const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";

export interface MeteoraDlmmKeys {
  lbPair: string;
  binArrayBitmapExtension?: string; // omit -> program id sentinel
  reserveX: string;
  reserveY: string;
  tokenXMint: string;
  tokenYMint: string;
  oracle: string;
  eventAuthority: string;
  /** Token programs per side (classic or Token-2022). Default classic. */
  tokenXProgram?: string;
  tokenYProgram?: string;
  hostFeeIn?: string; // omit -> program id sentinel (no host fee)
  /** Bin arrays the swap will cross (order matters), from the DLMM SDK. */
  binArrays: string[];
}

/** data = disc + amountIn(u64) + minAmountOut(u64) + empty RemainingAccountsInfo (vec len 0). */
export function encodeMeteoraSwap2(amountIn: bigint, minAmountOut: bigint): Uint8Array {
  const buf = new Uint8Array(8 + 8 + 8 + 4);
  buf.set(METEORA_SWAP2_DISC, 0);
  const dv = new DataView(buf.buffer);
  dv.setBigUint64(8, amountIn, true);
  dv.setBigUint64(16, minAmountOut, true);
  dv.setUint32(24, 0, true); // remaining_accounts_info: empty Vec
  return buf;
}

const ro = (pubkey: string): AccountMetaLite => ({ pubkey, isSigner: false, isWritable: false });
const w = (pubkey: string): AccountMetaLite => ({ pubkey, isSigner: false, isWritable: true });

export const buildMeteoraDlmm = () => async (hop: RouteHop, ctx: BuildContext): Promise<BuiltSwapIx> => {
  const k = hop.pool.meta?.meteora as MeteoraDlmmKeys | undefined;
  if (!k) throw new Error("meteora builder: pool.meta.meteora keys not provided");

  const userIn = ctx.ataFor(hop.tokenIn);
  const userOut = ctx.ataFor(hop.tokenOut);

  // swap2 layout (verified from a live mainnet tx).
  const accounts: AccountMetaLite[] = [
    w(k.lbPair), // 0
    ro(k.binArrayBitmapExtension ?? METEORA_DLMM_PROGRAM), // 1
    w(k.reserveX), // 2
    w(k.reserveY), // 3
    w(userIn), // 4
    w(userOut), // 5
    ro(k.tokenXMint), // 6
    ro(k.tokenYMint), // 7
    w(k.oracle), // 8
    ro(k.hostFeeIn ?? METEORA_DLMM_PROGRAM), // 9
    { pubkey: ctx.owner, isSigner: true, isWritable: false }, // 10 user
    ro(k.tokenXProgram ?? TOKEN_PROGRAM), // 11
    ro(k.tokenYProgram ?? TOKEN_PROGRAM), // 12
    ro(MEMO_PROGRAM), // 13
    ro(k.eventAuthority), // 14
    ro(METEORA_DLMM_PROGRAM), // 15
    ...k.binArrays.map(w), // 16+ bin arrays
  ];

  return {
    venue: Venue.MeteoraDlmm,
    programId: METEORA_DLMM_PROGRAM,
    accounts,
    data: encodeMeteoraSwap2(hop.amountIn, 0n), // aggregate min enforced by the router
  };
};
