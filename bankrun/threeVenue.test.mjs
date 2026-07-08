/**
 * Three-venue atomic swap in ONE versioned (v0) transaction — the core question:
 * "can we swap across three venues in one txn?"
 *
 * Runs aggregator_router.route() with THREE legs, each a distinct venue selector
 * (Raydium AMM / CLMM / CPMM slots), in a single v0 VersionedTransaction, and
 * verifies all three execute atomically and the aggregate slippage bound holds.
 *
 * Built with the `localnet-mock` feature, those three venue slots map to the SPL
 * Token program, so each leg is a real token Transfer standing in for a DEX swap
 * — proving the router's multi-venue atomic execution + versioned-tx path in an
 * in-process SVM. Real venue legs (Raydium CLMM / Meteora DLMM / PumpSwap) plug
 * into the same route() shape via their SDK builders.
 *
 *   anchor build -p aggregator_router -- --features localnet-mock
 *   SBF_OUT_DIR=$PWD/bankrun/fixtures npx tsx bankrun/threeVenue.test.mjs
 */
import { LiteSVM } from "litesvm";
import { PublicKey, Keypair, TransactionMessage, VersionedTransaction, SystemProgram } from "@solana/web3.js";
import assert from "node:assert";

const ROUTER = new PublicKey("7c8LDstCZnVxtcKLBdMD6YFmmNbVUTaQnZNv9Txmh8t6");
const TOKEN = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ROUTE_DISC = Buffer.from([229, 23, 203, 151, 122, 227, 173, 42]);
const soPath = new URL("../target/deploy/aggregator_router.so", import.meta.url).pathname;

function tokenAcct(mint, owner, amount) {
  const b = Buffer.alloc(165);
  mint.toBuffer().copy(b, 0);
  owner.toBuffer().copy(b, 32);
  b.writeBigUInt64LE(BigInt(amount), 64);
  b[108] = 1;
  return b;
}
function mintAcct(decimals = 6) { const b = Buffer.alloc(82); b[44] = decimals; b[45] = 1; return b; }
const readAmount = (d) => Buffer.from(d).readBigUInt64LE(64);
const transferData = (amt) => { const b = Buffer.alloc(9); b[0] = 3; b.writeBigUInt64LE(BigInt(amt), 1); return b; };

// route(amount_in, min_out, integrator_fee_bps=0, [leg0(venue0), leg1(venue1), leg2(venue2)])
function routeData(mint, amountIn, minOut, legs) {
  const feeBps = Buffer.alloc(2); // integrator_fee_bps = 0
  const head = Buffer.concat([ROUTE_DISC, mint.toBuffer(), mint.toBuffer(), u64(amountIn), u64(minOut), feeBps]);
  const cnt = Buffer.alloc(4); cnt.writeUInt32LE(legs.length);
  const parts = legs.map((l) => {
    const off = Buffer.alloc(2); off.writeUInt16LE(l.offset);
    const len = Buffer.alloc(2); len.writeUInt16LE(l.len);
    const dl = Buffer.alloc(4); dl.writeUInt32LE(l.data.length);
    return Buffer.concat([Buffer.from([l.venue]), off, len, dl, l.data]);
  });
  return Buffer.concat([head, cnt, ...parts]);
}
function u64(n) { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; }

function setup() {
  const svm = new LiteSVM();
  svm.addProgramFromFile(ROUTER, soPath);
  const user = new Keypair();
  svm.setAccount(user.publicKey, { lamports: 5_000_000_000, data: new Uint8Array(0), owner: SystemProgram.programId, executable: false, rentEpoch: 0 });
  const mint = Keypair.generate().publicKey;
  const src = [0, 1, 2].map(() => Keypair.generate().publicKey);
  const dest = Keypair.generate().publicKey;
  svm.setAccount(mint, { lamports: 3_000_000, data: mintAcct(6), owner: TOKEN, executable: false, rentEpoch: 0 });
  src.forEach((s) => svm.setAccount(s, { lamports: 3_000_000, data: tokenAcct(mint, user.publicKey, 100), owner: TOKEN, executable: false, rentEpoch: 0 }));
  svm.setAccount(dest, { lamports: 3_000_000, data: tokenAcct(mint, user.publicKey, 0), owner: TOKEN, executable: false, rentEpoch: 0 });
  return { svm, user, src, dest, mint };
}

const ro = (pk) => ({ pubkey: pk, isSigner: false, isWritable: false });
const w = (pk) => ({ pubkey: pk, isSigner: false, isWritable: true });

function routeIx(user, src, dest, minOut, mint) {
  // remaining_accounts = [src0,dest,user, src1,dest,user, src2,dest,user, TOKEN]
  const remaining = [];
  for (const s of src) remaining.push(w(s), w(dest), { pubkey: user.publicKey, isSigner: true, isWritable: false });
  remaining.push(ro(TOKEN));
  const legs = [0, 1, 2].map((i) => ({ venue: i, offset: i * 3, len: 3, data: transferData(100) }));
  return {
    programId: ROUTER,
    keys: [
      { pubkey: user.publicKey, isSigner: true, isWritable: false }, // authority
      w(src[0]), // input_token_account (one input source; spent=100 <= amount_in)
      ro(mint), // output_mint_account
      w(dest), // output_token_account
      ro(TOKEN), // token_program
      w(dest), // protocol_fee_account (unused: 300 * 20bps floors to 0)
      w(dest), // integrator_fee_account (unused: bps 0)
      ...remaining,
    ],
    data: routeData(mint, 300, minOut, legs),
  };
}

function sendV0(svm, user, ix) {
  const msg = new TransactionMessage({ payerKey: user.publicKey, recentBlockhash: svm.latestBlockhash(), instructions: [ix] }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  tx.sign([user]);
  return svm.sendTransaction(tx);
}

// 1) happy path: 3 venue legs, one v0 tx, require 300 out.
{
  const { svm, user, src, dest, mint } = setup();
  const res = sendV0(svm, user, routeIx(user, src, dest, 300, mint));
  assert.ok(!res.constructor?.name?.includes("Failed"), "3-venue v0 route should succeed");
  const got = readAmount(svm.getAccount(dest).data);
  assert.strictEqual(got, 300n, "dest received all three legs (3x100)");
  console.log("✅ 3 venues in ONE versioned tx: route() executed legs [venue0, venue1, venue2] atomically; dest +300");
}

// 2) slippage: require 301 across the same three legs -> revert.
{
  const { svm, user, src, dest, mint } = setup();
  const res = sendV0(svm, user, routeIx(user, src, dest, 301, mint));
  assert.ok(res.constructor?.name?.includes("Failed"), "should revert when aggregate min_out unmet");
  console.log("✅ aggregate slippage enforced across all three legs (min_out unmet -> atomic revert)");
}

console.log("\n3-venue atomic execution + versioned-tx path validated.");
