/**
 * Fee-model validation (Jupiter/DFlow-style) for aggregator_router.route().
 *
 * A route with a single token-transfer leg (localnet-mock) of 10,000 units, with
 * PROTOCOL_FEE_BPS=20 (0.20%, ours) and integrator_fee_bps=50 (0.50%, third
 * party). Expect: protocol_fee=20 -> treasury account, integrator_fee=50 ->
 * integrator account, net=9,930 -> user; min_amount_out enforced on the net.
 * Also checks the protocol-fee-recipient guard and the integrator-fee cap.
 *
 *   anchor build -p aggregator_router -- --features localnet-mock
 *   npx tsx bankrun/feeRoute.test.mjs
 */
import { LiteSVM } from "litesvm";
import { PublicKey, Keypair, TransactionMessage, VersionedTransaction, SystemProgram } from "@solana/web3.js";
import assert from "node:assert";

const ROUTER = new PublicKey("7c8LDstCZnVxtcKLBdMD6YFmmNbVUTaQnZNv9Txmh8t6");
const TOKEN = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TREASURY = new PublicKey("Ec5kwqhc1ptv4r3EptfZypvB3dCtQwdLt6cC4EKrGBFd"); // PROTOCOL_FEE_RECIPIENT
const ROUTE_DISC = Buffer.from([229, 23, 203, 151, 122, 227, 173, 42]);
const soPath = new URL("../target/deploy/aggregator_router.so", import.meta.url).pathname;

const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
function tokenAcct(mint, owner, amount) {
  const b = Buffer.alloc(165);
  new PublicKey(mint).toBuffer().copy(b, 0);
  new PublicKey(owner).toBuffer().copy(b, 32);
  b.writeBigUInt64LE(BigInt(amount), 64);
  b[108] = 1;
  return b;
}
const readAmt = (d) => Buffer.from(d).readBigUInt64LE(64);
const transferData = (amt) => { const b = Buffer.alloc(9); b[0] = 3; b.writeBigUInt64LE(BigInt(amt), 1); return b; };

function routeData(inMint, outMint, amountIn, minOut, integratorFeeBps, legAmt) {
  const leg = Buffer.concat([Buffer.from([0]), u16(0), u16(3), (() => { const l = Buffer.alloc(4); l.writeUInt32LE(9); return l; })(), transferData(legAmt)]);
  const cnt = Buffer.alloc(4); cnt.writeUInt32LE(1);
  return Buffer.concat([ROUTE_DISC, inMint.toBuffer(), outMint.toBuffer(), u64(amountIn), u64(minOut), u16(integratorFeeBps), cnt, leg]);
}

function scenario({ integratorFeeBps, minOut, protocolOwner = TREASURY, tokenProgram = TOKEN, amountIn = 10_000, routeInMint, legAmt = 10_000, destOwner }) {
  const svm = new LiteSVM();
  svm.addProgramFromFile(ROUTER, soPath);
  const user = new Keypair();
  svm.setAccount(user.publicKey, { lamports: 5_000_000_000, data: new Uint8Array(0), owner: SystemProgram.programId, executable: false, rentEpoch: 0 });
  const mint = Keypair.generate().publicKey;
  const src = Keypair.generate().publicKey, dest = Keypair.generate().publicKey;
  const protoFee = Keypair.generate().publicKey, intFee = Keypair.generate().publicKey;
  const set = (pk, owner, amt) => svm.setAccount(pk, { lamports: 3_000_000, data: tokenAcct(mint, owner, amt), owner: TOKEN, executable: false, rentEpoch: 0 });
  set(src, user.publicKey, 10_000);
  set(dest, destOwner ?? user.publicKey, 0);
  set(protoFee, protocolOwner, 0);
  set(intFee, user.publicKey, 0);

  const w = (pk) => ({ pubkey: pk, isSigner: false, isWritable: true });
  const ro = (pk) => ({ pubkey: pk, isSigner: false, isWritable: false });
  const keys = [
    { pubkey: user.publicKey, isSigner: true, isWritable: false }, // authority
    w(src),         // input_token_account (input spent from here)
    w(dest),        // output_token_account
    ro(tokenProgram), // token_program
    w(protoFee),    // protocol_fee_account
    w(intFee),      // integrator_fee_account
    // remaining: leg [src, dest, authority] + token program
    w(src), w(dest), { pubkey: user.publicKey, isSigner: true, isWritable: false }, ro(TOKEN),
  ];
  const inMint = routeInMint ?? new PublicKey(mint);
  const ix = { programId: ROUTER, keys, data: routeData(inMint, new PublicKey(mint), amountIn, minOut, integratorFeeBps, legAmt) };
  const msg = new TransactionMessage({ payerKey: user.publicKey, recentBlockhash: svm.latestBlockhash(), instructions: [ix] }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  tx.sign([user]);
  const res = svm.sendTransaction(tx);
  return { svm, res, dest, protoFee, intFee };
}

// 1) happy path: protocol 20 + integrator 50, net 9930.
{
  const { svm, res, dest, protoFee, intFee } = scenario({ integratorFeeBps: 50, minOut: 9_930 });
  assert.ok(!res.constructor?.name?.includes("Failed"), "fee route should succeed");
  assert.strictEqual(readAmt(svm.getAccount(dest).data), 9_930n, "user net = 9930");
  assert.strictEqual(readAmt(svm.getAccount(protoFee).data), 20n, "protocol fee = 20 (0.20%)");
  assert.strictEqual(readAmt(svm.getAccount(intFee).data), 50n, "integrator fee = 50 (0.50%)");
  console.log("✅ 1. fees split correctly: protocol 20 + integrator 50 + net 9930 (10000 gross)");
}

// 2) min_amount_out enforced on the NET (after fees): require 9931 -> revert.
{
  const { res } = scenario({ integratorFeeBps: 50, minOut: 9_931 });
  assert.ok(res.constructor?.name?.includes("Failed"), "should revert: net (9930) < min_out (9931)");
  console.log("✅ 2. min_amount_out enforced on the post-fee net amount");
}

// 3) protocol fee account must be owned by the treasury.
{
  const { res } = scenario({ integratorFeeBps: 0, minOut: 0, protocolOwner: Keypair.generate().publicKey });
  assert.ok(res.constructor?.name?.includes("Failed"), "should revert: bad protocol fee recipient");
  console.log("✅ 3. protocol fee account must be treasury-owned (integrator can't redirect our cut)");
}

// 4) integrator fee capped at 255 bps.
{
  const { res } = scenario({ integratorFeeBps: 256, minOut: 0 });
  assert.ok(res.constructor?.name?.includes("Failed"), "should revert: integrator fee > 255 bps");
  console.log("✅ 4. integrator fee capped (>255 bps rejected)");
}

// 5) SECURITY: a malicious token_program is rejected (can't drain via fee CPI).
{
  const { res } = scenario({ integratorFeeBps: 50, minOut: 9_930, tokenProgram: Keypair.generate().publicKey });
  assert.ok(res.constructor?.name?.includes("Failed"), "should revert: token_program not a real SPL Token program");
  console.log("✅ 5. malicious token_program rejected (fee-transfer CPI target locked to SPL Token / output owner)");
}

// 6) M-1: declared input_mint must match the input account's real mint.
{
  const { res } = scenario({ integratorFeeBps: 0, minOut: 0, routeInMint: Keypair.generate().publicKey });
  assert.ok(res.constructor?.name?.includes("Failed"), "should revert: input_mint mismatch");
  console.log("✅ 6. input_mint bound to the input account's real mint (mismatch rejected)");
}

// 7) M-1: input actually spent must not exceed amount_in (per-trade cap).
{
  const { res } = scenario({ integratorFeeBps: 0, minOut: 0, amountIn: 9_999, legAmt: 10_000 });
  assert.ok(res.constructor?.name?.includes("Failed"), "should revert: input spent > amount_in");
  console.log("✅ 7. input spent capped at amount_in (over-cap swap rejected)");
}

// 8) V-4: output must be the authority's own account — even for a tiny swap
//    where the fee rounds to 0 (no fee transfer), foreign output is rejected.
{
  const { res } = scenario({ integratorFeeBps: 0, minOut: 0, amountIn: 400, legAmt: 400, destOwner: Keypair.generate().publicKey });
  assert.ok(res.constructor?.name?.includes("Failed"), "should revert: output account not owned by authority");
  console.log("✅ 8. output must be authority-owned (foreign-account exfiltration rejected, fee-independent)");
}

console.log("\nFee model + M-1 + token_program + output-owner (V-4) security fixes validated.");
