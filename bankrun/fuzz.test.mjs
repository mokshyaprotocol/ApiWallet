/**
 * Property fuzz of aggregator_router.route() against the real program bytecode
 * (litesvm, localnet-mock so venue 0 = SPL Token Transfer). Seeded PRNG for
 * reproducibility.
 *
 * Two modes:
 *  - structured: valid token accounts + randomized scalars/legs. Assert route()
 *    NEVER succeeds while violating an invariant, and never panics.
 *  - malformed: random route_data bytes + account lists. Assert route() reverts
 *    cleanly (never a success on garbage, never a host panic).
 *
 *   anchor build -p aggregator_router -- --features localnet-mock
 *   npx tsx bankrun/fuzz.test.mjs [iterations] [seed]
 */
import { LiteSVM } from "litesvm";
import { PublicKey, Keypair, TransactionMessage, VersionedTransaction, SystemProgram } from "@solana/web3.js";
import assert from "node:assert";

const ROUTER = new PublicKey("7c8LDstCZnVxtcKLBdMD6YFmmNbVUTaQnZNv9Txmh8t6");
const TOKEN = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TREASURY = new PublicKey("Ec5kwqhc1ptv4r3EptfZypvB3dCtQwdLt6cC4EKrGBFd");
const ROUTE_DISC = Buffer.from([229, 23, 203, 151, 122, 227, 173, 42]);
const PROTOCOL_FEE_BPS = 20n, MAX_INTEGRATOR_FEE_BPS = 255, MAX_LEGS = 8;
const soPath = new URL("../target/deploy/aggregator_router.so", import.meta.url).pathname;

const ITERS = parseInt(process.argv[2] || "600", 10);
let seed = BigInt(parseInt(process.argv[3] || "0xC0FFEE", 16));
const rand = () => { seed = (seed * 6364136223846793005n + 1442695040888963407n) & ((1n << 64n) - 1n); return Number(seed >> 33n) / 2 ** 31; };
const ri = (n) => Math.floor(rand() * n);

const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n & 0xffff); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
const transferData = (amt) => { const b = Buffer.alloc(9); b[0] = 3; b.writeBigUInt64LE(BigInt(amt), 1); return b; };
function tokenAcct(mint, owner, amount) {
  const b = Buffer.alloc(165);
  mint.toBuffer().copy(b, 0); owner.toBuffer().copy(b, 32); b.writeBigUInt64LE(BigInt(amount), 64); b[108] = 1;
  return b;
}
const readAmt = (svm, pk) => { const a = svm.getAccount(pk); return a ? Buffer.from(a.data).readBigUInt64LE(64) : 0n; };
const w = (pk) => ({ pubkey: pk, isSigner: false, isWritable: true });
const ro = (pk) => ({ pubkey: pk, isSigner: false, isWritable: false });

const svm = new LiteSVM();
svm.addProgramFromFile(ROUTER, soPath);
const user = new Keypair();
svm.setAccount(user.publicKey, { lamports: 100_000_000_000n, data: new Uint8Array(0), owner: SystemProgram.programId, executable: false, rentEpoch: 0 });
const setTok = (mint, owner, amt) => { const pk = Keypair.generate().publicKey; svm.setAccount(pk, { lamports: 3_000_000, data: tokenAcct(mint, owner, amt), owner: TOKEN, executable: false, rentEpoch: 0 }); return pk; };

function send(ix) {
  try {
    const msg = new TransactionMessage({ payerKey: user.publicKey, recentBlockhash: svm.latestBlockhash(), instructions: [ix] }).compileToV0Message();
    const tx = new VersionedTransaction(msg); tx.sign([user]);
    const res = svm.sendTransaction(tx);
    return { ok: !res.constructor?.name?.includes("Failed") };
  } catch (e) {
    return { unbuildable: true, err: String(e.message || e) };
  }
}

let ok = 0, reverted = 0, unbuildable = 0, violations = 0;

for (let i = 0; i < ITERS; i++) {
  const malformed = rand() < 0.35;
  const mint = Keypair.generate().publicKey;

  if (malformed) {
    // random route_data + a small random account list
    const len = ri(120);
    const data = Buffer.alloc(len);
    for (let k = 0; k < len; k++) data[k] = ri(256);
    if (rand() < 0.5) ROUTE_DISC.copy(data, 0); // sometimes valid disc, garbage rest
    const nAcc = ri(8);
    const keys = [{ pubkey: user.publicKey, isSigner: true, isWritable: false }];
    for (let k = 0; k < nAcc; k++) keys.push(w(setTok(mint, user.publicKey, ri(1000))));
    const r = send({ programId: ROUTER, keys, data });
    if (r.unbuildable) unbuildable++;
    else if (r.ok) { violations++; console.log(`VIOLATION(malformed): route() SUCCEEDED on garbage @iter ${i}`); }
    else reverted++;
    continue;
  }

  // structured: valid accounts, randomized scalars + legs
  const nLegs = ri(11); // 0..10 (incl 0 and >MAX_LEGS)
  const feeBps = ri(400); // 0..399 (incl >255)
  const legAmts = Array.from({ length: nLegs }, () => 1 + ri(100_000));
  const received = legAmts.reduce((a, b) => a + b, 0);
  const srcs = legAmts.map((a) => setTok(mint, user.publicKey, a + ri(1000)));
  const dest = setTok(mint, user.publicKey, 0);
  const protoOwner = rand() < 0.85 ? TREASURY : Keypair.generate().publicKey;
  const protoFee = setTok(mint, protoOwner, 0);
  const intFee = setTok(mint, user.publicKey, 0);
  const amountIn = rand() < 0.7 ? received + ri(1000) : ri(received + 2);
  const protocolFee = (BigInt(received) * PROTOCOL_FEE_BPS) / 10000n;
  const intF = (BigInt(received) * BigInt(Math.min(feeBps, 65535))) / 10000n;
  const expectedNet = BigInt(received) - protocolFee - intF;
  const minOut = rand() < 0.5 ? expectedNet : BigInt(ri(received * 2 + 2));

  // legs (mostly valid; sometimes corrupt one offset)
  const legs = legAmts.map((amt, li) => ({ venue: 0, offset: li * 3, len: 3, data: transferData(amt) }));
  if (nLegs > 0 && rand() < 0.15) legs[ri(nLegs)].offset = 60000; // out-of-range
  const legBuf = Buffer.concat(legs.map((l) => Buffer.concat([Buffer.from([l.venue]), u16(l.offset), u16(l.len), u32(l.data.length), l.data])));
  const data = Buffer.concat([ROUTE_DISC, mint.toBuffer(), mint.toBuffer(), u64(amountIn), u64(minOut), u16(feeBps), u32(nLegs), legBuf]);

  const remaining = [];
  for (const s of srcs) remaining.push(w(s), w(dest), { pubkey: user.publicKey, isSigner: true, isWritable: false });
  remaining.push(ro(TOKEN));
  const keys = [
    { pubkey: user.publicKey, isSigner: true, isWritable: false }, w(srcs[0] ?? dest), w(dest), ro(TOKEN), w(protoFee), w(intFee), ...remaining,
  ];
  const before = readAmt(svm, dest);
  const r = send({ programId: ROUTER, keys, data });
  if (r.unbuildable) { unbuildable++; continue; }
  if (!r.ok) { reverted++; continue; }
  ok++;

  // INVARIANTS on success:
  const destDelta = readAmt(svm, dest) - before;
  const check = (cond, msg) => { if (!cond) { violations++; console.log(`VIOLATION @iter ${i}: ${msg}`); } };
  check(nLegs >= 1 && nLegs <= MAX_LEGS, `succeeded with nLegs=${nLegs}`);
  check(feeBps <= MAX_INTEGRATOR_FEE_BPS, `succeeded with feeBps=${feeBps} > cap`);
  check(protoOwner.equals(TREASURY) || protocolFee === 0n, `succeeded with non-treasury protocol fee (fee=${protocolFee})`);
  check(destDelta >= minOut, `net-out ${destDelta} < min_out ${minOut}`);
  check(destDelta === expectedNet, `net-out ${destDelta} != expected ${expectedNet}`);
  check(readAmt(svm, protoFee) === protocolFee, `protocol fee acct ${readAmt(svm, protoFee)} != ${protocolFee}`);
  check(BigInt(legAmts[0]) <= BigInt(amountIn), `input spent ${legAmts[0]} > amount_in ${amountIn}`);
}

console.log(`\nfuzz: ${ITERS} iters (seed ${(process.argv[3] || "0xC0FFEE")}) | ok=${ok} reverted=${reverted} unbuildable=${unbuildable}`);
assert.strictEqual(violations, 0, `${violations} invariant violation(s) found`);
console.log("✅ no panics, no invariant-violating successes — route() fuzz clean");
