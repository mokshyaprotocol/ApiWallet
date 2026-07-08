/**
 * Encode the on-chain `aggregator_router.route(input_mint, output_mint,
 * amount_in, min_amount_out, integrator_fee_bps, legs)` instruction from a
 * RouterPlan, and assemble it as a web3.js instruction.
 *
 * The route() account list is
 *   [authority, input_token_account, output_token_account, token_program,
 *    protocol_fee_account, integrator_fee_account, ...plan.accounts]
 * — the plan's `accountOffset` values index into the remaining accounts (the
 * part after the six named accounts), matching the program.
 */
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { RouterPlan } from "./types.js";

// sha256("global:route")[:8]
export const ROUTE_DISCRIMINATOR = Uint8Array.from([229, 23, 203, 151, 122, 227, 173, 42]);

function u64le(n: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n);
  return b;
}

export interface RouteAccounts {
  routerProgramId: PublicKey;
  authority: PublicKey; // signer (user or session PDA)
  inputTokenAccount: PublicKey; // input spent from here; mint + amount bound
  outputTokenAccount: PublicKey; // slippage measured here
  inputMint: PublicKey;
  outputMint: PublicKey;
  tokenProgram: PublicKey; // SPL Token program for fee transfers
  protocolFeeAccount: PublicKey; // output-mint token account owned by our treasury
  integratorFeeAccount: PublicKey; // integrator's output-mint token account
}

/** Borsh-encode route() args. */
export function encodeRouteData(plan: RouterPlan, a: RouteAccounts, integratorFeeBps = 0): Buffer {
  const feeBps = Buffer.alloc(2);
  feeBps.writeUInt16LE(integratorFeeBps);
  const head = Buffer.concat([
    Buffer.from(ROUTE_DISCRIMINATOR),
    a.inputMint.toBuffer(),
    a.outputMint.toBuffer(),
    u64le(plan.amountIn),
    u64le(plan.minAmountOut),
    feeBps,
  ]);
  const legCount = Buffer.alloc(4);
  legCount.writeUInt32LE(plan.legs.length);
  const legs = plan.legs.map((leg) => {
    const venue = Buffer.from([leg.venue]);
    const off = Buffer.alloc(2); off.writeUInt16LE(leg.accountOffset);
    const len = Buffer.alloc(2); len.writeUInt16LE(leg.accountLen);
    const dlen = Buffer.alloc(4); dlen.writeUInt32LE(leg.data.length);
    return Buffer.concat([venue, off, len, dlen, Buffer.from(leg.data)]);
  });
  return Buffer.concat([head, legCount, ...legs]);
}

/** Build the route() TransactionInstruction from a plan. */
export function buildRouteInstruction(
  plan: RouterPlan,
  a: RouteAccounts,
  integratorFeeBps = 0
): TransactionInstruction {
  const keys = [
    { pubkey: a.authority, isSigner: true, isWritable: false },
    { pubkey: a.inputTokenAccount, isSigner: false, isWritable: true },
    { pubkey: a.outputTokenAccount, isSigner: false, isWritable: true },
    { pubkey: a.tokenProgram, isSigner: false, isWritable: false },
    { pubkey: a.protocolFeeAccount, isSigner: false, isWritable: true },
    { pubkey: a.integratorFeeAccount, isSigner: false, isWritable: true },
    ...plan.accounts.map((m) => ({
      pubkey: new PublicKey(m.pubkey),
      isSigner: m.isSigner,
      isWritable: m.isWritable,
    })),
  ];
  return new TransactionInstruction({ programId: a.routerProgramId, keys, data: encodeRouteData(plan, a, integratorFeeBps) });
}

/** Unique non-signer addresses in a plan — the candidates for an Address Lookup Table. */
export function lookupAddressesForPlan(plan: RouterPlan, a: RouteAccounts): PublicKey[] {
  const seen = new Set<string>();
  const out: PublicKey[] = [];
  const add = (pk: string, isSigner: boolean) => {
    if (isSigner || seen.has(pk)) return;
    seen.add(pk);
    out.push(new PublicKey(pk));
  };
  add(a.inputTokenAccount.toBase58(), false);
  add(a.outputTokenAccount.toBase58(), false);
  add(a.routerProgramId.toBase58(), false);
  add(a.tokenProgram.toBase58(), false);
  add(a.protocolFeeAccount.toBase58(), false);
  add(a.integratorFeeAccount.toBase58(), false);
  for (const m of plan.accounts) add(m.pubkey, m.isSigner);
  return out;
}
