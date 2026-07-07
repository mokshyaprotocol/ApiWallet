/**
 * Kamino — intentionally NOT wired as a swap venue.
 *
 * Kamino is a lending + concentrated-liquidity-vault protocol, not an order-book
 * or AMM you swap against directly. There is no generic "swap on Kamino"
 * instruction equivalent to Raydium/Meteora/Pump. Integrating it meaningfully
 * means one of:
 *   - routing through the underlying DEX pools its vaults sit on (already
 *     covered by the Raydium/Meteora adapters), or
 *   - a purpose-built kLend/kVault interaction (deposit/borrow/leverage), which
 *     is a different product surface than best-price swap routing.
 *
 * Rather than fabricate an unverified interface, this builder fails loudly.
 * Confirm the exact Kamino product/interface to target and we wire it then.
 */
import { BuildContext, BuiltSwapIx } from "../execution/types.js";
import { RouteHop } from "../core/types.js";

export const buildKamino = () => async (_hop: RouteHop, _ctx: BuildContext): Promise<BuiltSwapIx> => {
  throw new Error(
    "Kamino is a lending/liquidity protocol, not a swap venue — no swap builder. " +
      "Confirm the target Kamino interface (kLend / kVault) to integrate."
  );
};
