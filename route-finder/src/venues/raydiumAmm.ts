/**
 * Raydium AMM v4 swap-instruction builder.
 *
 * Produces the exact `swapBaseIn` instruction (tag 9) — 18 accounts + data
 * [9, amountIn u64 LE, minOut u64 LE] — from the pool's on-chain key set
 * (fetched from Raydium's verified `/pools/key/ids` endpoint). Per-leg minOut is
 * left at 0 on purpose: the on-chain router enforces the *aggregate*
 * `min_amount_out` on the real output-balance delta, which is the trustworthy
 * bound. Validate end-to-end against mainnet before executing with funds.
 */
import { BuildContext, BuiltSwapIx, AccountMetaLite, Venue } from "../execution/types.js";
import { RouteHop } from "../core/types.js";

const RAYDIUM_API = "https://api-v3.raydium.io";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const RAYDIUM_AMM_V4 = "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8";

interface RayKeys {
  authority: string;
  openOrders: string;
  targetOrders: string;
  vault: { A: string; B: string };
  mintA: { address: string };
  mintB: { address: string };
  marketProgramId: string;
  marketId: string;
  marketAuthority: string;
  marketBaseVault: string;
  marketQuoteVault: string;
  marketBids: string;
  marketAsks: string;
  marketEventQueue: string;
}

export async function fetchRaydiumKeys(poolId: string, apiBase = RAYDIUM_API): Promise<RayKeys> {
  const res = await fetch(`${apiBase}/pools/key/ids?ids=${poolId}`);
  if (!res.ok) throw new Error(`raydium keys api ${res.status}`);
  const json: any = await res.json();
  const k = json?.data?.[0];
  if (!k) throw new Error(`no keys for pool ${poolId}`);
  return k as RayKeys;
}

function ro(pubkey: string): AccountMetaLite {
  return { pubkey, isSigner: false, isWritable: false };
}
function w(pubkey: string): AccountMetaLite {
  return { pubkey, isSigner: false, isWritable: true };
}

/** Encode Raydium swapBaseIn instruction data. */
export function encodeSwapBaseIn(amountIn: bigint, minAmountOut: bigint): Uint8Array {
  const buf = new Uint8Array(1 + 8 + 8);
  const dv = new DataView(buf.buffer);
  buf[0] = 9; // swapBaseIn
  dv.setBigUint64(1, amountIn, true);
  dv.setBigUint64(9, minAmountOut, true);
  return buf;
}

export const buildRaydiumAmmSwap =
  (apiBase = RAYDIUM_API) =>
  async (hop: RouteHop, ctx: BuildContext): Promise<BuiltSwapIx> => {
    const poolId = (hop.pool.meta?.poolId as string) ?? hop.pool.id;
    const k = await fetchRaydiumKeys(poolId, apiBase);

    const userSource = ctx.ataFor(hop.tokenIn);
    const userDest = ctx.ataFor(hop.tokenOut);

    // Fixed AMM v4 swapBaseIn account order.
    const accounts: AccountMetaLite[] = [
      ro(TOKEN_PROGRAM), // 1
      w(poolId), // 2  amm
      ro(k.authority), // 3  amm authority
      w(k.openOrders), // 4
      w(k.targetOrders), // 5
      w(k.vault.A), // 6  pool coin vault
      w(k.vault.B), // 7  pool pc vault
      ro(k.marketProgramId), // 8  serum program
      w(k.marketId), // 9
      w(k.marketBids), // 10
      w(k.marketAsks), // 11
      w(k.marketEventQueue), // 12
      w(k.marketBaseVault), // 13
      w(k.marketQuoteVault), // 14
      ro(k.marketAuthority), // 15  serum vault signer
      w(userSource), // 16
      w(userDest), // 17
      { pubkey: ctx.owner, isSigner: true, isWritable: false }, // 18 user owner
    ];

    return {
      venue: Venue.RaydiumAmmV4,
      programId: RAYDIUM_AMM_V4,
      accounts,
      data: encodeSwapBaseIn(hop.amountIn, 0n), // aggregate min enforced on-chain
    };
  };
