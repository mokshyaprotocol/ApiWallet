/**
 * PumpSwap AMM (post-graduation Pump.fun) swap-instruction builder.
 *
 * ⚠️ VALIDATION STATUS: the instruction *data* encoders below are exact
 * (verified anchor discriminators + arg layout, unit-tested). The *account
 * layout* follows PumpSwap's documented order but has NOT been validated
 * against mainnet in this repo — verify with a simulated tx before executing
 * with funds. No adapter currently populates the required keys, so this builder
 * only runs when a caller supplies `PumpSwapKeys` via `pool.meta.pumpSwap`.
 */
import { BuildContext, BuiltSwapIx, AccountMetaLite, Venue } from "../execution/types.js";
import { RouteHop } from "../core/types.js";

export const PUMP_SWAP_PROGRAM = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";
export const PUMP_BUY_DISC = Uint8Array.from([102, 6, 61, 18, 1, 218, 235, 234]);
export const PUMP_SELL_DISC = Uint8Array.from([51, 230, 133, 164, 1, 127, 131, 173]);

const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";

export interface PumpSwapKeys {
  pool: string;
  globalConfig: string;
  baseMint: string;
  quoteMint: string;
  poolBaseTokenAccount: string;
  poolQuoteTokenAccount: string;
  protocolFeeRecipient: string;
  protocolFeeRecipientTokenAccount: string;
  eventAuthority: string;
}

function encode(disc: Uint8Array, a: bigint, b: bigint): Uint8Array {
  const buf = new Uint8Array(8 + 8 + 8);
  buf.set(disc, 0);
  const dv = new DataView(buf.buffer);
  dv.setBigUint64(8, a, true);
  dv.setBigUint64(16, b, true);
  return buf;
}
/** buy: (base_amount_out, max_quote_amount_in) */
export function encodePumpBuy(baseAmountOut: bigint, maxQuoteIn: bigint): Uint8Array {
  return encode(PUMP_BUY_DISC, baseAmountOut, maxQuoteIn);
}
/** sell: (base_amount_in, min_quote_amount_out) */
export function encodePumpSell(baseAmountIn: bigint, minQuoteOut: bigint): Uint8Array {
  return encode(PUMP_SELL_DISC, baseAmountIn, minQuoteOut);
}

const ro = (pubkey: string): AccountMetaLite => ({ pubkey, isSigner: false, isWritable: false });
const w = (pubkey: string): AccountMetaLite => ({ pubkey, isSigner: false, isWritable: true });

export const buildPumpSwap = () => async (hop: RouteHop, ctx: BuildContext): Promise<BuiltSwapIx> => {
  const k = hop.pool.meta?.pumpSwap as PumpSwapKeys | undefined;
  if (!k) throw new Error("pumpSwap builder: pool.meta.pumpSwap keys not provided (unvalidated venue)");

  // Direction: buying base (quote in) vs selling base (base in).
  const buyingBase = hop.tokenOut === k.baseMint;
  const userBase = ctx.ataFor(k.baseMint);
  const userQuote = ctx.ataFor(k.quoteMint);

  const accounts: AccountMetaLite[] = [
    w(k.pool),
    { pubkey: ctx.owner, isSigner: true, isWritable: true },
    ro(k.globalConfig),
    ro(k.baseMint),
    ro(k.quoteMint),
    w(userBase),
    w(userQuote),
    w(k.poolBaseTokenAccount),
    w(k.poolQuoteTokenAccount),
    ro(k.protocolFeeRecipient),
    w(k.protocolFeeRecipientTokenAccount),
    ro(TOKEN_PROGRAM),
    ro(TOKEN_PROGRAM),
    ro(SYSTEM_PROGRAM),
    ro(ATA_PROGRAM),
    ro(k.eventAuthority),
    ro(PUMP_SWAP_PROGRAM),
  ];

  // Per-leg limits are 0/max; the on-chain router enforces the aggregate bound.
  const data = buyingBase
    ? encodePumpBuy(hop.amountOut, hop.amountIn)
    : encodePumpSell(hop.amountIn, 0n);

  return { venue: Venue.PumpSwap, programId: PUMP_SWAP_PROGRAM, accounts, data };
};
