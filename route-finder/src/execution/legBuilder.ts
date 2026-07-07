/**
 * Turns a routed `Route` into a `RouterPlan` — the exact arguments for the
 * on-chain `aggregator_router.route(amount_in, min_amount_out, legs)` plus the
 * flattened `remaining_accounts` it slices.
 *
 * Layout: `[leg0 accounts][leg1 accounts]…[venue program accounts]`. Each leg's
 * `accountOffset/accountLen` index its own contiguous slice; the venue program
 * accounts are appended at the tail so the program's `invoke` info-pool contains
 * them (they are not part of any leg's metas).
 *
 * Note: intermediate hops carry the *planned* amountIn. Fixed-amount multi-hop
 * assumes leg N-1's realized output matches the plan; production multi-hop
 * should make the router read intermediate balances. Single-hop (the current
 * Raydium slice) is unaffected.
 */
import {
  AccountMetaLite,
  BuildContext,
  PlannedLeg,
  RouterPlan,
  Venue,
  VenueBuilder,
  poolVenue,
} from "./types.js";
import { Route } from "../core/types.js";

export async function buildRouterPlan(
  route: Route,
  builders: Partial<Record<Venue, VenueBuilder>>,
  ctx: BuildContext,
  minAmountOut: bigint
): Promise<RouterPlan> {
  const legs: PlannedLeg[] = [];
  const accounts: AccountMetaLite[] = [];
  const programAccounts = new Map<string, AccountMetaLite>();

  for (const step of route.steps) {
    for (const hop of step.hops) {
      const venue = poolVenue(hop.pool);
      const builder = builders[venue];
      if (!builder) throw new Error(`no instruction builder registered for venue ${Venue[venue]}`);

      const ix = await builder(hop, ctx);
      const accountOffset = accounts.length;
      accounts.push(...ix.accounts);
      legs.push({
        venue: ix.venue,
        accountOffset,
        accountLen: ix.accounts.length,
        data: ix.data,
      });
      if (!programAccounts.has(ix.programId)) {
        programAccounts.set(ix.programId, { pubkey: ix.programId, isSigner: false, isWritable: false });
      }
    }
  }

  for (const meta of programAccounts.values()) accounts.push(meta);
  return { amountIn: route.amountIn, minAmountOut, legs, accounts };
}
