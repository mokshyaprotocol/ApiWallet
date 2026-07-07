/**
 * Concentrated-liquidity (CLMM) swap math — Uniswap-v3 style, adapted to the
 * Q64.64 sqrt-price convention Raydium CLMM uses.
 *
 * The formulas here are the standard, exact concentrated-liquidity equations:
 * within a tick range liquidity `L` is constant and price moves along the
 * x*y=k curve in sqrt space; crossing an initialized tick updates `L` by its
 * `liquidityNet`. We walk initialized ticks in the swap direction.
 *
 * PRECISION NOTE: this matches the *math*. Bit-exact parity with Raydium's
 * on-chain rounding (and its exact tick→sqrtPrice table) must still be
 * validated against mainnet before using quotes for settlement; for routing
 * selection the high-precision result here is accurate.
 */
import { ClmmState, Pool } from "./types.js";

const Q64 = 64n;
const BPS = 10_000n;

// --- tick -> sqrtPrice (Q64.64) --------------------------------------------
// Uses the well-known Uniswap TickMath magic constants (Q128 intermediate,
// producing Q96) and shifts to Q64. Exact and monotonic.
const MAGIC: bigint[] = [
  0xfffcb933bd6fad37aa2d162d1a594001n,
  0xfff97272373d413259a46990580e213an,
  0xfff2e50f5f656932ef12357cf3c7fdccn,
  0xffe5caca7e10e4e61c3624eaa0941cd0n,
  0xffcb9843d60f6159c9db58835c926644n,
  0xff973b41fa98c081472e6896dfb254c0n,
  0xff2ea16466c96a3843ec78b326b52861n,
  0xfe5dee046a99a2a811c461f1969c3053n,
  0xfcbe86c7900a88aedcffc83b479aa3a4n,
  0xf987a7253ac413176f2b074cf7815e54n,
  0xf3392b0822b70005940c7a398e4b70f3n,
  0xe7159475a2c29b7443b29c7fa6e889d9n,
  0xd097f3bdfd2022b8845ad8f792aa5825n,
  0xa9f746462d870fdf8a65dc1f90e061e5n,
  0x70d869a156d2a1b890bb3df62baf32f7n,
  0x31be135f97d08fd981231505542fcfa6n,
  0x9aa508b5b7a84e1c677de54f3e99bc9n,
  0x5d6af8dedb81196699c329225ee604n,
  0x2216e584f5fa1ea926041bedfe98n,
  0x48a170391f7dc42444e8fa2n,
];

/** sqrt(1.0001^tick) in Q64.64. */
export function getSqrtRatioAtTick(tick: number): bigint {
  const abs = BigInt(Math.abs(tick));
  let ratio =
    (abs & 1n) !== 0n
      ? 0xfffcb933bd6fad37aa2d162d1a594001n
      : 0x100000000000000000000000000000000n; // 1.0 in Q128
  for (let i = 1; i < MAGIC.length; i++) {
    if ((abs & (1n << BigInt(i))) !== 0n) {
      ratio = (ratio * MAGIC[i]) >> 128n;
    }
  }
  if (tick > 0) {
    const MAX = (1n << 256n) - 1n;
    ratio = MAX / ratio;
  }
  // ratio is Q128; convert to Q64 (>> 64), rounding up like Uniswap's >>32 step.
  const q64 = ratio >> 64n;
  return q64 + (ratio % (1n << 64n) === 0n ? 0n : 1n);
}

// --- amount deltas between two sqrt prices (a < b), given L -----------------
function amount0Delta(sqrtA: bigint, sqrtB: bigint, L: bigint): bigint {
  // token0 between prices = L * (sqrtB - sqrtA) / (sqrtA * sqrtB), Q64 scaled.
  if (sqrtA > sqrtB) [sqrtA, sqrtB] = [sqrtB, sqrtA];
  const num = (L << Q64) * (sqrtB - sqrtA);
  return num / (sqrtB * sqrtA);
}
function amount1Delta(sqrtA: bigint, sqrtB: bigint, L: bigint): bigint {
  if (sqrtA > sqrtB) [sqrtA, sqrtB] = [sqrtB, sqrtA];
  return (L * (sqrtB - sqrtA)) >> Q64;
}

// next sqrtP after adding token0 (price decreases): zeroForOne
function nextSqrtFromAmount0(sqrtP: bigint, L: bigint, amount0: bigint): bigint {
  const numerator = (L << Q64) * sqrtP;
  const denom = (L << Q64) + amount0 * sqrtP;
  return numerator / denom;
}
// next sqrtP after adding token1 (price increases): oneForZero
function nextSqrtFromAmount1(sqrtP: bigint, L: bigint, amount1: bigint): bigint {
  return sqrtP + (amount1 << Q64) / L;
}

/**
 * Exact-input CLMM quote. `tokenIn === pool.tokenA` is zeroForOne (price down).
 * Walks initialized ticks in the swap direction, updating L on each cross.
 */
export function clmmQuote(pool: Pool, tokenIn: string, amountIn: bigint): bigint {
  const s = pool.clmm as ClmmState;
  if (!s || amountIn <= 0n || s.liquidity <= 0n) return 0n;

  const zeroForOne = tokenIn === pool.tokenA;
  let remaining = (amountIn * (BPS - BigInt(pool.feeBps))) / BPS;
  if (remaining <= 0n) return 0n;

  let sqrtP = s.sqrtPriceX64;
  let L = s.liquidity;
  let out = 0n;

  // Boundary ticks in the direction of travel.
  const boundaries = zeroForOne
    ? s.ticks.filter((t) => t.tickIndex <= s.tickCurrent).sort((a, b) => b.tickIndex - a.tickIndex)
    : s.ticks.filter((t) => t.tickIndex > s.tickCurrent).sort((a, b) => a.tickIndex - b.tickIndex);

  for (const tick of boundaries) {
    if (remaining <= 0n || L <= 0n) break;
    const sqrtTarget = getSqrtRatioAtTick(tick.tickIndex);

    if (zeroForOne) {
      const maxIn = amount0Delta(sqrtTarget, sqrtP, L);
      if (remaining >= maxIn && maxIn > 0n) {
        out += amount1Delta(sqrtTarget, sqrtP, L);
        remaining -= maxIn;
        sqrtP = sqrtTarget;
        L -= tick.liquidityNet; // crossing down subtracts net
      } else {
        const sqrtNext = nextSqrtFromAmount0(sqrtP, L, remaining);
        out += amount1Delta(sqrtNext, sqrtP, L);
        remaining = 0n;
        break;
      }
    } else {
      const maxIn = amount1Delta(sqrtP, sqrtTarget, L);
      if (remaining >= maxIn && maxIn > 0n) {
        out += amount0Delta(sqrtP, sqrtTarget, L);
        remaining -= maxIn;
        sqrtP = sqrtTarget;
        L += tick.liquidityNet; // crossing up adds net
      } else {
        const sqrtNext = nextSqrtFromAmount1(sqrtP, L, remaining);
        out += amount0Delta(sqrtP, sqrtNext, L);
        remaining = 0n;
        break;
      }
    }
  }

  // Remaining liquidity in the final range (no more initialized ticks).
  if (remaining > 0n && L > 0n) {
    if (zeroForOne) {
      const sqrtNext = nextSqrtFromAmount0(sqrtP, L, remaining);
      out += amount1Delta(sqrtNext, sqrtP, L);
    } else {
      const sqrtNext = nextSqrtFromAmount1(sqrtP, L, remaining);
      out += amount0Delta(sqrtP, sqrtNext, L);
    }
  }
  return out;
}

/** Spot price of tokenOut per tokenIn from the current sqrt price. */
export function clmmSpotPrice(pool: Pool, tokenIn: string): number {
  const s = pool.clmm as ClmmState;
  if (!s) return 0;
  const sqrt = Number(s.sqrtPriceX64) / 2 ** 64;
  const price1per0 = sqrt * sqrt; // token1 per token0
  return tokenIn === pool.tokenA ? price1per0 : price1per0 === 0 ? 0 : 1 / price1per0;
}
