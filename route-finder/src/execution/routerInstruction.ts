/**
 * Encode the on-chain `aggregator_router.route(amount_in, min_amount_out, legs)`
 * instruction from a RouterPlan, and assemble it as a web3.js instruction.
 *
 * The route() account list is [authority, output_token_account, ...plan.accounts]
 * — the plan's `accountOffset` values index into the remaining accounts (the part
 * after the two named accounts), matching the program.
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

/** Borsh-encode route() args: amount_in, min_amount_out, Vec<SwapLeg>. */
export function encodeRouteData(plan: RouterPlan): Buffer {
  const head = Buffer.concat([Buffer.from(ROUTE_DISCRIMINATOR), u64le(plan.amountIn), u64le(plan.minAmountOut)]);
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

export interface RouteAccounts {
  routerProgramId: PublicKey;
  authority: PublicKey; // signer (user or session PDA)
  outputTokenAccount: PublicKey; // slippage measured here
}

/** Build the route() TransactionInstruction from a plan. */
export function buildRouteInstruction(plan: RouterPlan, a: RouteAccounts): TransactionInstruction {
  const keys = [
    { pubkey: a.authority, isSigner: true, isWritable: false },
    { pubkey: a.outputTokenAccount, isSigner: false, isWritable: true },
    ...plan.accounts.map((m) => ({
      pubkey: new PublicKey(m.pubkey),
      isSigner: m.isSigner,
      isWritable: m.isWritable,
    })),
  ];
  return new TransactionInstruction({ programId: a.routerProgramId, keys, data: encodeRouteData(plan) });
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
  add(a.outputTokenAccount.toBase58(), false);
  add(a.routerProgramId.toBase58(), false);
  for (const m of plan.accounts) add(m.pubkey, m.isSigner);
  return out;
}
