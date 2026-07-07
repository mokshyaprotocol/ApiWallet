/**
 * Pump.fun buyV2 validation on CLONED mainnet state using litesvm (v1 API).
 *
 * pump-fetch.cjs used @pump-fun/pump-sdk to build a real buyV2 (ATA-create + the
 * 27-account buy) for a fresh user on a live pre-graduation mint, dumped the
 * pump + fee programs, and cloned every referenced account. Here we load the
 * programs + accounts into litesvm (no BanksServer deadline — needed for the
 * 10 MB pump program), inject the funded user, run the SDK's instructions, and
 * assert the user receives the SDK-quoted token amount.
 *
 *   RPC_URL=... node bankrun/pump-fetch.cjs
 *   npx tsx bankrun/pumpSwap.test.mjs
 */
import { LiteSVM } from "litesvm";
import { PublicKey, Keypair, Transaction, TransactionInstruction, SystemProgram } from "@solana/web3.js";
import fs from "node:fs";
import assert from "node:assert";

const PUMP = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const FEE = new PublicKey("pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ");
const ATA_PROG = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const BPF_UPGRADEABLE = "BPFLoaderUpgradeab1e11111111111111111111111";

const dir = new URL("./fixtures/", import.meta.url);
const p = (f) => new URL(f, dir).pathname;
const q = JSON.parse(fs.readFileSync(new URL("pump-quote.json", dir)));
const cloned = JSON.parse(fs.readFileSync(new URL("pump-accounts.json", dir)));

const user = Keypair.fromSecretKey(Uint8Array.from(q.userSecret));
const mint = new PublicKey(q.mint);
const tokenProgram = new PublicKey(q.tokenProgram);
const readAmount = (d) => Buffer.from(d).readBigUInt64LE(64);

const svm = new LiteSVM();
svm.addProgramFromFile(PUMP, p("pump.so"));
svm.addProgramFromFile(FEE, p("pump_fee.so"));

// cloned data accounts (skip program + programdata; loaded via file above)
for (const a of cloned) {
  if (a.executable || a.owner === BPF_UPGRADEABLE) continue;
  svm.setAccount(new PublicKey(a.pubkey), {
    lamports: a.lamports, data: Buffer.from(a.data, "base64"),
    owner: new PublicKey(a.owner), executable: false, rentEpoch: 0,
  });
}
svm.setAccount(user.publicKey, { lamports: 2_000_000_000, data: new Uint8Array(0), owner: SystemProgram.programId, executable: false, rentEpoch: 0 });

const ixs = q.instructions.map((ix) => new TransactionInstruction({
  programId: new PublicKey(ix.programId),
  keys: ix.keys.map((k) => ({ pubkey: new PublicKey(k.pubkey), isSigner: k.isSigner, isWritable: k.isWritable })),
  data: Buffer.from(ix.data, "base64"),
}));

const tx = new Transaction().add(...ixs);
tx.recentBlockhash = svm.latestBlockhash();
tx.feePayer = user.publicKey;
tx.sign(user);

const res = svm.sendTransaction(tx);
if (res.constructor?.name?.includes("Failed")) {
  console.log("buyV2 FAILED");
  try { console.log((res.meta().logs() ?? []).slice(-12).join("\n")); } catch { console.log(String(res)); }
  process.exit(1);
}

const [userAta] = PublicKey.findProgramAddressSync(
  [user.publicKey.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()], ATA_PROG
);
const acct = svm.getAccount(userAta);
const got = acct ? readAmount(acct.data) : 0n;
const expected = BigInt(q.expectedTokens);
const diffPct = Number(got - expected) * 100 / Number(expected);
console.log("mint          :", q.mint);
console.log("SDK buyV2      :", q.instructions.length, "ix, buy has", q.instructions.at(-1).keys.length, "accounts");
console.log("user received :", got.toString(), "tokens");
console.log("SDK quote      :", expected.toString(), "tokens");
console.log("diff          :", diffPct.toFixed(4) + "%");
assert.ok(got > 0n, "user received tokens");
assert.ok(Math.abs(diffPct) < 0.01, "received matches SDK quote");
console.log("\n✅ Pump.fun buyV2 executed on cloned mainnet state (via @pump-fun/pump-sdk); user credited the quoted amount");
