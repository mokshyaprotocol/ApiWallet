import { PublicKey } from "@solana/web3.js";

/** Devnet RPC. Override with NEXT_PUBLIC_RPC_URL to use a paid endpoint. */
export const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL ?? "https://api.devnet.solana.com";

/** The delegated-trading program (deployed on devnet). */
export const PROGRAM_ID = new PublicKey(
  "HgUSLposEwz5MnUV6SFABbxVHmSZ1dkbuowWsjAe1s2E"
);

/**
 * Aggregator the session routes swaps through.
 *
 * Jupiter runs ONLY on mainnet-beta, so on devnet we point at the bundled mock
 * aggregator (proves the approval-free flow end-to-end). On mainnet, switch
 * this to the real Jupiter v6 id and build the program without the
 * `mock-jupiter` feature.
 */
export const MOCK_JUPITER_ID = new PublicKey(
  "4oVmoU4zT21MVgFdTp5N5AayCvMsXZDGE5Xq7QZQvjrN"
);
export const JUPITER_V6_ID = new PublicKey(
  "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"
);
export const IS_DEVNET = true;
export const AGGREGATOR_ID = IS_DEVNET ? MOCK_JUPITER_ID : JUPITER_V6_ID;

/** PDA seed — must match `constants::SESSION_SEED` in the program. */
export const SESSION_SEED = Buffer.from("trading_session");

/** Anchor 8-byte discriminator for the mock aggregator's `swap` instruction. */
export const MOCK_SWAP_DISCRIMINATOR = Uint8Array.from([
  248, 198, 158, 145, 225, 117, 135, 200,
]);

/** A small SOL top-up (lamports) sent to the session key so it can pay fees. */
export const SESSION_FEE_TOPUP = 50_000_000; // 0.05 SOL

/** Tradable tokens for the demo (devnet mints). */
export interface TokenInfo {
  symbol: string;
  mint: PublicKey;
  decimals: number;
}

export const TOKENS: TokenInfo[] = [
  {
    symbol: "SOL",
    mint: new PublicKey("So11111111111111111111111111111111111111112"),
    decimals: 9,
  },
  {
    symbol: "USDC",
    mint: new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"),
    decimals: 6,
  },
];

export function tokenBySymbol(sym: string): TokenInfo {
  const t = TOKENS.find((t) => t.symbol === sym);
  if (!t) throw new Error(`unknown token ${sym}`);
  return t;
}

/** LocalStorage key prefix for a per-owner session keypair. */
export const SESSION_STORAGE_PREFIX = "apiwallet.session.";
