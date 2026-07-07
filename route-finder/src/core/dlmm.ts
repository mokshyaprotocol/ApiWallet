/**
 * Discrete-bin liquidity (DLMM, Meteora style) swap math.
 *
 * Liquidity is split into bins. Bin `id` has a fixed price P(id) =
 * (1 + binStep/1e4)^id, expressed as token1 (Y) per token0 (X). A swap consumes
 * bins sequentially from the active bin outward, at each bin's fixed price:
 *   - X→Y (selling X): consume Y from the active bin and bins below (lower id),
 *   - Y→X (buying X):  consume X from the active bin and bins above (higher id).
 *
 * PRECISION NOTE: bin prices are irrational powers, so we price each bin with a
 * high-precision `number` and keep amounts as bigint. This is accurate for
 * routing; exact on-chain parity (Meteora's Q64.64 bin prices/rounding) should
 * be validated against mainnet before settlement.
 */
import { DlmmState, Pool } from "./types.js";

const BPS = 10_000n;

/** Price of a bin as token1 (Y) per token0 (X). */
export function binPrice(id: number, binStep: number): number {
  return Math.pow(1 + binStep / 10_000, id);
}

function floorDiv(nom: number): bigint {
  return BigInt(Math.floor(nom));
}

/**
 * Exact-input DLMM quote. `tokenIn === pool.tokenA` means X→Y.
 */
export function dlmmQuote(pool: Pool, tokenIn: string, amountIn: bigint): bigint {
  const s = pool.dlmm as DlmmState;
  if (!s || amountIn <= 0n) return 0n;

  const xForY = tokenIn === pool.tokenA;
  let remaining = (amountIn * (BPS - BigInt(pool.feeBps))) / BPS;
  if (remaining <= 0n) return 0n;

  let out = 0n;
  const bins = xForY
    ? s.bins.filter((b) => b.id <= s.activeId).sort((a, b) => b.id - a.id) // descending
    : s.bins.filter((b) => b.id >= s.activeId).sort((a, b) => a.id - b.id); // ascending

  for (const bin of bins) {
    if (remaining <= 0n) break;
    const price = binPrice(bin.id, s.binStep); // Y per X

    if (xForY) {
      // We give X, take Y. Bin can give up to reserveY. X needed to drain = reserveY / price.
      if (bin.reserveY <= 0n) continue;
      const xToDrain = floorDiv(Number(bin.reserveY) / price);
      if (remaining >= xToDrain && xToDrain > 0n) {
        out += bin.reserveY;
        remaining -= xToDrain;
      } else {
        out += floorDiv(Number(remaining) * price);
        remaining = 0n;
      }
    } else {
      // We give Y, take X. Bin can give up to reserveX. Y needed to drain = reserveX * price.
      if (bin.reserveX <= 0n) continue;
      const yToDrain = floorDiv(Number(bin.reserveX) * price);
      if (remaining >= yToDrain && yToDrain > 0n) {
        out += bin.reserveX;
        remaining -= yToDrain;
      } else {
        out += floorDiv(Number(remaining) / price);
        remaining = 0n;
      }
    }
  }
  return out;
}

export function dlmmSpotPrice(pool: Pool, tokenIn: string): number {
  const s = pool.dlmm as DlmmState;
  if (!s) return 0;
  const p = binPrice(s.activeId, s.binStep); // Y per X
  return tokenIn === pool.tokenA ? p : p === 0 ? 0 : 1 / p;
}
