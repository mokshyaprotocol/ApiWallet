/**
 * Versioned (v0) transaction assembly with Address Lookup Table support.
 *
 * A multi-venue route touches 50-70 accounts, over the ~35 a legacy transaction
 * holds. Compiling the route() instruction into a v0 message against one or more
 * Address Lookup Tables compresses those account keys (each becomes a 1-byte
 * table index instead of a 32-byte key), so a 3-venue swap fits in one tx.
 */
import {
  AddressLookupTableAccount,
  AddressLookupTableProgram,
  Blockhash,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { RouterPlan } from "./types.js";
import { buildRouteInstruction, lookupAddressesForPlan, RouteAccounts } from "./routerInstruction.js";

export interface V0Options {
  payer: PublicKey;
  recentBlockhash: Blockhash;
  lookupTables?: AddressLookupTableAccount[];
  /** Extra instructions to prepend (e.g. ComputeBudget). */
  preInstructions?: TransactionInstruction[];
  /** Third-party integrator fee, basis points (0 = none). */
  integratorFeeBps?: number;
}

/** Compile the route() call into a v0 VersionedTransaction, using any LUTs given. */
export function buildRouteV0Transaction(
  plan: RouterPlan,
  accounts: RouteAccounts,
  opts: V0Options
): VersionedTransaction {
  const routeIx = buildRouteInstruction(plan, accounts, opts.integratorFeeBps ?? 0);
  const message = new TransactionMessage({
    payerKey: opts.payer,
    recentBlockhash: opts.recentBlockhash,
    instructions: [...(opts.preInstructions ?? []), routeIx],
  }).compileToV0Message(opts.lookupTables ?? []);
  return new VersionedTransaction(message);
}

/**
 * Instructions to create an Address Lookup Table and extend it with a plan's
 * addresses (submit these first, in their own tx, then use the LUT). Returns the
 * derived table address too. `recentSlot` must be a recent slot.
 */
export function createLookupTableForPlan(
  plan: RouterPlan,
  accounts: RouteAccounts,
  authority: PublicKey,
  payer: PublicKey,
  recentSlot: number
): { lookupTableAddress: PublicKey; instructions: TransactionInstruction[] } {
  const [createIx, lookupTableAddress] = AddressLookupTableProgram.createLookupTable({
    authority,
    payer,
    recentSlot,
  });
  const addresses = lookupAddressesForPlan(plan, accounts);
  // extendLookupTable caps ~30 addresses per ix; chunk if needed.
  const chunks: PublicKey[][] = [];
  for (let i = 0; i < addresses.length; i += 30) chunks.push(addresses.slice(i, i + 30));
  const extendIxs = chunks.map((addrs) =>
    AddressLookupTableProgram.extendLookupTable({ payer, authority, lookupTable: lookupTableAddress, addresses: addrs })
  );
  return { lookupTableAddress, instructions: [createIx, ...extendIxs] };
}

/** Build an in-memory AddressLookupTableAccount (for tests / when the LUT is known). */
export function makeLookupTableAccount(key: PublicKey, addresses: PublicKey[]): AddressLookupTableAccount {
  return new AddressLookupTableAccount({
    key,
    state: {
      deactivationSlot: 2n ** 64n - 1n,
      lastExtendedSlot: 0,
      lastExtendedSlotStartIndex: 0,
      authority: undefined,
      addresses,
    },
  });
}
