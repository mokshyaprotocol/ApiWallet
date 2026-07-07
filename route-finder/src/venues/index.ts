export * from "./raydiumAmm.js";
export * from "./pumpSwap.js";
export * from "./meteoraDlmm.js";
export * from "./kamino.js";

import { Venue, VenueBuilder } from "../execution/types.js";
import { buildRaydiumAmmSwap } from "./raydiumAmm.js";
import { buildPumpSwap } from "./pumpSwap.js";
import { buildMeteoraDlmm } from "./meteoraDlmm.js";

/**
 * Venue-builder registry.
 *
 * - Raydium AMM v4: instruction fully assembled from the live pool-keys API.
 * - PumpSwap, Meteora DLMM: exact data encoders + documented account layouts,
 *   flagged UNVALIDATED — enable per-venue once validated on mainnet and once a
 *   key-fetching adapter populates `pool.meta`.
 * - Kamino: not a swap venue (see kamino.ts).
 *
 * Pass `includeUnvalidated: true` to register the flagged builders.
 */
export function defaultBuilders(opts?: {
  apiBase?: string;
  includeUnvalidated?: boolean;
}): Partial<Record<Venue, VenueBuilder>> {
  const builders: Partial<Record<Venue, VenueBuilder>> = {
    [Venue.RaydiumAmmV4]: buildRaydiumAmmSwap(opts?.apiBase),
  };
  if (opts?.includeUnvalidated) {
    builders[Venue.PumpSwap] = buildPumpSwap();
    builders[Venue.MeteoraDlmm] = buildMeteoraDlmm();
  }
  return builders;
}
