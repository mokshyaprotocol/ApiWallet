/**
 * Mainnet simulation harness — validates a built plan WITHOUT funds or signing.
 *
 * Trick: `simulateTransaction({ sigVerify: false, replaceRecentBlockhash: true })`
 * skips signature verification, so we can build a swap that "spends" from a real
 * on-chain holder's token account (marking its true owner as the signer) and
 * observe the swap execute in the simulated ledger. Reading the destination
 * account's post-simulation balance gives the *actual* output amount, which we
 * compare against the router's prediction. This validates both the venue
 * account layout (a wrong layout errors) and the swap math (predicted vs actual).
 */
import {
  Connection,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  ComputeBudgetProgram,
  AccountMeta,
} from "@solana/web3.js";
import { PlannedLeg, RouterPlan, Venue } from "../execution/types.js";

const VENUE_PROGRAM: Record<number, string> = {
  [Venue.RaydiumAmmV4]: "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8",
  [Venue.RaydiumClmm]: "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK",
  [Venue.RaydiumCpmm]: "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C",
  [Venue.MeteoraDlmm]: "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo",
  [Venue.PumpSwap]: "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA",
};

/** SPL token account `amount` (u64 LE at offset 64). */
export function readTokenAmount(data: Buffer | Uint8Array): bigint {
  const b = Buffer.from(data);
  return b.readBigUInt64LE(64);
}

export interface FundedHolder {
  tokenAccount: PublicKey;
  owner: PublicKey;
  amount: bigint;
}

/** Find a real, well-funded token account for `mint` and its true owner. */
export async function findFundedHolder(
  connection: Connection,
  mint: string,
  exclude: string[] = []
): Promise<FundedHolder> {
  const largest = await connection.getTokenLargestAccounts(new PublicKey(mint));
  for (const acc of largest.value) {
    if (exclude.includes(acc.address.toBase58())) continue;
    const info = await connection.getAccountInfo(acc.address);
    if (!info) continue;
    const owner = new PublicKey(info.data.subarray(32, 64));
    const amount = readTokenAmount(info.data);
    if (amount > 0n) return { tokenAccount: acc.address, owner, amount };
  }
  throw new Error(`no funded holder found for mint ${mint}`);
}

function toWeb3Meta(a: { pubkey: string; isSigner: boolean; isWritable: boolean }): AccountMeta {
  return { pubkey: new PublicKey(a.pubkey), isSigner: a.isSigner, isWritable: a.isWritable };
}

/** Reconstruct one venue swap instruction from a planned leg. */
function legToInstruction(plan: RouterPlan, leg: PlannedLeg): TransactionInstruction {
  const programId = VENUE_PROGRAM[leg.venue];
  if (!programId) throw new Error(`no program id for venue ${leg.venue}`);
  const keys = plan.accounts
    .slice(leg.accountOffset, leg.accountOffset + leg.accountLen)
    .map(toWeb3Meta);
  return new TransactionInstruction({
    programId: new PublicKey(programId),
    keys,
    data: Buffer.from(leg.data),
  });
}

export interface SimResult {
  ok: boolean;
  err: unknown;
  logs: string[] | null;
  actualOut: bigint | null;
  computeUnits: number | null;
}

/**
 * Simulate a plan's venue instructions directly against mainnet and read the
 * output-token balance delta on `destAccount`.
 */
export async function simulatePlan(
  connection: Connection,
  plan: RouterPlan,
  authority: PublicKey,
  destAccount: PublicKey,
  computeUnitLimit = 600_000
): Promise<SimResult> {
  const before = await connection.getAccountInfo(destAccount);
  const beforeAmount = before ? readTokenAmount(before.data) : 0n;

  const ixs: TransactionInstruction[] = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnitLimit }),
    ...plan.legs.map((leg) => legToInstruction(plan, leg)),
  ];

  const { blockhash } = await connection.getLatestBlockhash();
  const msg = new TransactionMessage({
    payerKey: authority,
    recentBlockhash: blockhash,
    instructions: ixs,
  }).compileToV0Message();
  const vtx = new VersionedTransaction(msg);

  const sim = await connection.simulateTransaction(vtx, {
    sigVerify: false,
    replaceRecentBlockhash: true,
    accounts: { encoding: "base64", addresses: [destAccount.toBase58()] },
  });

  const v = sim.value;
  let actualOut: bigint | null = null;
  if (!v.err && v.accounts && v.accounts[0]) {
    const data = Buffer.from(v.accounts[0].data[0], "base64");
    actualOut = readTokenAmount(data) - beforeAmount;
  }
  return {
    ok: !v.err,
    err: v.err,
    logs: v.logs ?? null,
    actualOut,
    computeUnits: v.unitsConsumed ?? null,
  };
}
