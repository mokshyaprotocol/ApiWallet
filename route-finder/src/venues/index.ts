export * from "./raydiumAmm.js";

import { Venue, VenueBuilder } from "../execution/types.js";
import { buildRaydiumAmmSwap } from "./raydiumAmm.js";

/**
 * Default venue-builder registry. Raydium AMM v4 is the first vertical slice;
 * the remaining venues are wired on-chain (allowlisted) and pending their
 * instruction builders.
 */
export function defaultBuilders(apiBase?: string): Partial<Record<Venue, VenueBuilder>> {
  return {
    [Venue.RaydiumAmmV4]: buildRaydiumAmmSwap(apiBase),
  };
}
