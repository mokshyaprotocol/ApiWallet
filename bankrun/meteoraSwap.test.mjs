/**
 * Meteora DLMM swap2 validation in bankrun against CLONED mainnet state.
 *
 * We dumped the Meteora program .so and cloned a live SOL/USDT pool's accounts
 * (lbPair, reserves, oracle, bin array, mints) from mainnet, then inject our own
 * funded token accounts. Running our swap2 instruction and comparing the output
 * to the DLMM SDK's quote validates BOTH the account layout and that the swap
 * actually executes. (No validator, no funds.)
 *
 *   node route-finder/mfetch.cjs      # refresh fixtures (needs RPC_URL)
 *   SBF_OUT_DIR=$PWD/bankrun/fixtures npx tsx bankrun/meteoraSwap.test.mjs
 */
import { start } from "solana-bankrun";
import { PublicKey, Keypair, Transaction, TransactionInstruction } from "@solana/web3.js";
import fs from "node:fs";
import assert from "node:assert";

const METEORA = new PublicKey("LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo");
const TOKEN = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const MEMO = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const SWAP2_DISC = Buffer.from([65, 75, 63, 76, 235, 91, 91, 136]);

const dir = new URL("./fixtures/", import.meta.url);
const q = JSON.parse(fs.readFileSync(new URL("meteora-quote.json", dir)));
const cloned = JSON.parse(fs.readFileSync(new URL("meteora-accounts.json", dir)));

function tokenAcct(mint, owner, amount) {
  const b = Buffer.alloc(165);
  new PublicKey(mint).toBuffer().copy(b, 0);
  owner.toBuffer().copy(b, 32);
  b.writeBigUInt64LE(BigInt(amount), 64);
  b[108] = 1; // initialized
  return b;
}
const readAmount = (d) => Buffer.from(d).readBigUInt64LE(64);

// Load the cloned mainnet accounts into the SVM.
const accountsForStart = cloned.map((a) => ({
  address: new PublicKey(a.pubkey),
  info: {
    lamports: a.lamports,
    data: Buffer.from(a.data, "base64"),
    owner: new PublicKey(a.owner),
    executable: a.executable,
  },
}));

const ctx = await start([{ name: "meteora_dlmm", programId: METEORA }], accountsForStart);
const client = ctx.banksClient;
const user = ctx.payer;

// Inject our funded token accounts (input funded, output empty).
const userIn = Keypair.generate().publicKey; // wSOL (token X)
const userOut = Keypair.generate().publicKey; // USDT (token Y)
ctx.setAccount(userIn, { lamports: 3_000_000, data: tokenAcct(q.tokenXMint, user.publicKey, q.amountIn), owner: TOKEN, executable: false });
ctx.setAccount(userOut, { lamports: 3_000_000, data: tokenAcct(q.tokenYMint, user.publicKey, 0), owner: TOKEN, executable: false });

// Build swap2 (X->Y) with the reverse-engineered layout.
function swap2Data(amountIn, minOut) {
  const b = Buffer.alloc(8 + 8 + 8 + 4);
  SWAP2_DISC.copy(b, 0);
  b.writeBigUInt64LE(BigInt(amountIn), 8);
  b.writeBigUInt64LE(BigInt(minOut), 16);
  b.writeUInt32LE(0, 24); // empty RemainingAccountsInfo
  return b;
}
const ro = (pubkey) => ({ pubkey: new PublicKey(pubkey), isSigner: false, isWritable: false });
const w = (pubkey) => ({ pubkey: new PublicKey(pubkey), isSigner: false, isWritable: true });

const keys = [
  w(q.lbPair),
  ro(METEORA), // binArrayBitmapExtension (none)
  w(q.reserveX),
  w(q.reserveY),
  { pubkey: userIn, isSigner: false, isWritable: true },
  { pubkey: userOut, isSigner: false, isWritable: true },
  ro(q.tokenXMint),
  ro(q.tokenYMint),
  w(q.oracle),
  ro(METEORA), // hostFeeIn (none)
  { pubkey: user.publicKey, isSigner: true, isWritable: false },
  ro(TOKEN),
  ro(TOKEN),
  { pubkey: MEMO, isSigner: false, isWritable: false },
  ro(q.eventAuthority),
  ro(METEORA),
  ...q.binArrays.map(w),
];

const ix = new TransactionInstruction({ programId: METEORA, keys, data: swap2Data(q.amountIn, 0) });
const tx = new Transaction().add(ix);
tx.recentBlockhash = ctx.lastBlockhash;
tx.feePayer = user.publicKey;
tx.sign(user);

try {
  await client.processTransaction(tx);
} catch (e) {
  console.log("swap2 FAILED:", String(e.message ?? e).split("\n")[0]);
  process.exit(1);
}

const out = readAmount((await client.getAccount(userOut)).data);
const expected = BigInt(q.expectedOut);
const diffPct = (Number(out - expected) / Number(expected)) * 100;
console.log(`in: ${Number(q.amountIn) / 1e9} SOL`);
console.log(`swap2 out   : ${(Number(out) / 1e6).toFixed(6)} USDT`);
console.log(`SDK quote   : ${(Number(expected) / 1e6).toFixed(6)} USDT`);
console.log(`diff        : ${diffPct.toFixed(4)}%`);
assert.ok(out > 0n, "swap produced output");
assert.ok(Math.abs(diffPct) < 1, "swap2 output matches SDK quote within 1%");
console.log("\n✅ Meteora DLMM swap2 executed on cloned mainnet state; output matches SDK quote");
