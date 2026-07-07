/**
 * Execution-plan types. These mirror the on-chain `aggregator_router` program
 * exactly: `Venue` values equal the program's `Venue` enum discriminants, and a
 * `RouterPlan` is the argument set for its `route(amount_in, min_amount_out,
 * legs)` instruction plus the flattened `remaining_accounts` to pass.
 */
import { Pool, RouteHop } from "../core/types.js";

/** MUST match `constants::Venue` in the router program. */
export enum Venue {
  RaydiumAmmV4 = 0,
  RaydiumClmm = 1,
  RaydiumCpmm = 2,
  MeteoraDlmm = 3,
  MeteoraDynamic = 4,
  PumpFun = 5,
  PumpSwap = 6,
  Kamino = 7,
}

export interface AccountMetaLite {
  pubkey: string;
  isSigner: boolean;
  isWritable: boolean;
}

/** One venue swap instruction, pre-flatten. */
export interface BuiltSwapIx {
  venue: Venue;
  /** The venue program id (appended to the account pool so `invoke` finds it). */
  programId: string;
  /** Account metas for the venue instruction (NOT including the program). */
  accounts: AccountMetaLite[];
  /** Raw venue instruction data. */
  data: Uint8Array;
}

/** A leg as the on-chain program consumes it (slice into remaining_accounts). */
export interface PlannedLeg {
  venue: number;
  accountOffset: number;
  accountLen: number;
  data: Uint8Array;
}

/** Full argument set for `aggregator_router.route(...)`. */
export interface RouterPlan {
  amountIn: bigint;
  minAmountOut: bigint;
  legs: PlannedLeg[];
  /** Flattened remaining_accounts, in the exact order the program slices. */
  accounts: AccountMetaLite[];
}

/** Context a venue builder needs to assemble a user-specific swap instruction. */
export interface BuildContext {
  /** The trading authority (user wallet, or api-wallet session PDA). */
  owner: string;
  /** Resolve the owner's token account for a mint (usually its ATA). */
  ataFor: (mint: string) => string;
  /** Raydium/other REST base override (optional). */
  apiBase?: string;
}

/** A venue builder turns a routed hop into a concrete swap instruction. */
export type VenueBuilder = (hop: RouteHop, ctx: BuildContext) => Promise<BuiltSwapIx>;

export function poolVenue(pool: Pool): Venue {
  switch (pool.dex) {
    case "raydium-amm":
      return Venue.RaydiumAmmV4;
    case "raydium-clmm":
      return Venue.RaydiumClmm;
    case "raydium-cpmm":
      return Venue.RaydiumCpmm;
    case "meteora-dlmm":
      return Venue.MeteoraDlmm;
    case "meteora-dynamic":
      return Venue.MeteoraDynamic;
    case "pumpfun":
      return Venue.PumpFun;
    case "pumpswap":
      return Venue.PumpSwap;
    default:
      throw new Error(`no venue mapping for dex ${pool.dex}`);
  }
}
