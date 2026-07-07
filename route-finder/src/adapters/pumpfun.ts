/**
 * Pump.fun adapter — decodes the on-chain bonding-curve account directly.
 * Derives the curve PDA (`["bonding-curve", mint]`), reads its reserves, and
 * normalizes to a constant-product Pool over virtual reserves. Graduated
 * (`complete`) tokens have migrated to PumpSwap (separate adapter, roadmap).
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { Pool } from "../core/types.js";
import { bondingCurveToPool, BondingCurveState } from "../core/bondingCurve.js";
import { DexAdapter } from "./types.js";

export const PUMP_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
export const WSOL_MINT = "So11111111111111111111111111111111111111112";

export class PumpFunAdapter implements DexAdapter {
  readonly id = "pumpfun";
  constructor(private readonly connection: Connection) {}

  async getPoolsForPair(mintA: string, mintB: string): Promise<Pool[]> {
    let tokenMint: string | null = null;
    if (mintA === WSOL_MINT) tokenMint = mintB;
    else if (mintB === WSOL_MINT) tokenMint = mintA;
    if (!tokenMint) return [];
    const state = await this.fetchCurve(tokenMint);
    return state ? [bondingCurveToPool(state)] : [];
  }

  private async fetchCurve(tokenMint: string): Promise<BondingCurveState | null> {
    const mint = new PublicKey(tokenMint);
    const [curve] = PublicKey.findProgramAddressSync(
      [Buffer.from("bonding-curve"), mint.toBuffer()],
      PUMP_PROGRAM
    );
    const info = await this.connection.getAccountInfo(curve);
    if (!info) return null;
    const b = info.data;
    const virtualTokenReserves = b.readBigUInt64LE(8);
    const virtualSolReserves = b.readBigUInt64LE(16);
    const realTokenReserves = b.readBigUInt64LE(24);
    const realSolReserves = b.readBigUInt64LE(32);
    const complete = b[48] === 1;
    if (complete) return null;
    return {
      poolId: curve.toBase58(),
      tokenMint,
      solMint: WSOL_MINT,
      virtualSolReserves,
      virtualTokenReserves,
      realSolReserves,
      realTokenReserves,
    };
  }
}
