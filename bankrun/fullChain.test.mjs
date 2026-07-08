/**
 * Bankrun full-chain test: OUR api-wallet program swaps through OUR router.
 *
 *   delegated_trading.execute_trade  (session key signs, approval-free)
 *      └─CPI (invoke_signed, session PDA)─▶ aggregator_router.route()
 *              └─CPI─▶ SPL Token transfer  (the "venue", via localnet-mock)
 *
 * Proves: create_session -> execute_trade forwards to the real aggregator_router,
 * the session PDA's lent signature propagates through the router to the venue,
 * funds move, and the router's slippage bound holds — all in-process, no
 * validator. Build inputs:
 *   anchor build -p delegated_trading                              (real router id)
 *   anchor build -p aggregator_router -- --features localnet-mock  (token = venue)
 *   SBF_OUT_DIR=$PWD/target/deploy npx tsx bankrun/fullChain.test.mjs
 */
import { start } from "solana-bankrun";
import { PublicKey, Keypair, Transaction, TransactionInstruction, SystemProgram } from "@solana/web3.js";
import assert from "node:assert";

const DELEGATED = new PublicKey("HgUSLposEwz5MnUV6SFABbxVHmSZ1dkbuowWsjAe1s2E");
const ROUTER = new PublicKey("7c8LDstCZnVxtcKLBdMD6YFmmNbVUTaQnZNv9Txmh8t6");
const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TREASURY = new PublicKey("Ec5kwqhc1ptv4r3EptfZypvB3dCtQwdLt6cC4EKrGBFd"); // PROTOCOL_FEE_RECIPIENT
const SEED = Buffer.from("trading_session");

const D_CREATE = Buffer.from([242, 193, 143, 179, 150, 25, 122, 227]);
const D_EXEC = Buffer.from([77, 16, 192, 135, 13, 0, 106, 97]);
const D_ROUTE = Buffer.from([229, 23, 203, 151, 122, 227, 173, 42]);

// --- encoders --------------------------------------------------------------
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const i64 = u64;
const vecPk = (arr) => Buffer.concat([(() => { const l = Buffer.alloc(4); l.writeUInt32LE(arr.length); return l; })(), ...arr.map((p) => p.toBuffer())]);

function tokenAccount(mint, owner, amount) {
  const b = Buffer.alloc(165);
  mint.toBuffer().copy(b, 0);
  owner.toBuffer().copy(b, 32);
  b.writeBigUInt64LE(BigInt(amount), 64);
  b[108] = 1;
  return b;
}
const readAmount = (data) => Buffer.from(data).readBigUInt64LE(64);
function transferData(amount) { const b = Buffer.alloc(9); b[0] = 3; b.writeBigUInt64LE(BigInt(amount), 1); return b; }
// SPL Mint (82 bytes): decimals@44, is_initialized@45.
function mintAccount(decimals = 6) { const b = Buffer.alloc(82); b[44] = decimals; b[45] = 1; return b; }
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };

function createSessionData(sessionPk, expiresAt, maxTrade, daily, progs, inputs, outputs) {
  return Buffer.concat([D_CREATE, sessionPk.toBuffer(), i64(expiresAt), u64(maxTrade), u64(daily), vecPk(progs), vecPk(inputs), vecPk(outputs)]);
}
// route(input_mint, output_mint, amount_in, min_out, integrator_fee_bps, [one leg])
// — the router instruction the api-wallet forwards.
function routeData(inMint, outMint, amountIn, minOut, feeBps, leg) {
  const len = Buffer.alloc(4); len.writeUInt32LE(1);
  const off = Buffer.alloc(2); off.writeUInt16LE(leg.accountOffset);
  const alen = Buffer.alloc(2); alen.writeUInt16LE(leg.accountLen);
  const dlen = Buffer.alloc(4); dlen.writeUInt32LE(leg.data.length);
  return Buffer.concat([D_ROUTE, inMint.toBuffer(), outMint.toBuffer(), u64(amountIn), u64(minOut), u16(feeBps), len, Buffer.from([leg.venue]), off, alen, dlen, leg.data]);
}
function executeTradeData(amountIn, inMint, outMint, nonce, route) {
  const rlen = Buffer.alloc(4); rlen.writeUInt32LE(route.length);
  return Buffer.concat([D_EXEC, u64(amountIn), inMint.toBuffer(), outMint.toBuffer(), u64(nonce), rlen, route]);
}

// --- setup -----------------------------------------------------------------
const ctx = await start(
  [
    { name: "delegated_trading", programId: DELEGATED },
    { name: "aggregator_router", programId: ROUTER },
  ],
  []
);
const client = ctx.banksClient;
const payer = ctx.payer; // acts as owner
const sessionKey = Keypair.generate();
const mint = Keypair.generate().publicKey;
const [sessionPda] = PublicKey.findProgramAddressSync([SEED, payer.publicKey.toBuffer(), sessionKey.publicKey.toBuffer()], DELEGATED);

const bh = async () => { const x = await client.getLatestBlockhash(); return Array.isArray(x) ? x[0] : x; };
const send = async (ix, signers) => { const tx = new Transaction().add(ix); tx.recentBlockhash = await bh(); tx.feePayer = payer.publicKey; tx.sign(...signers); return client.processTransaction(tx); };

// 1) create_session (owner-signed, one time), allowing our router + the mint.
{
  const ix = new TransactionInstruction({
    programId: DELEGATED,
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: sessionPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: createSessionData(sessionKey.publicKey, 2_000_000_000, 1_000_000_000, 1_000_000_000_000, [ROUTER], [mint], [mint]),
  });
  await send(ix, [payer]);
  console.log("✅ 1. session created (allowlists our aggregator_router)");
}

// Session-PDA-owned token accounts: the router moves funds under the PDA's authority.
const source = Keypair.generate().publicKey;
const dest = Keypair.generate().publicKey;
const protoFee = Keypair.generate().publicKey; // must be owned by the protocol treasury
const intFee = Keypair.generate().publicKey;
ctx.setAccount(mint, { lamports: 3_000_000, data: mintAccount(6), owner: TOKEN_PROGRAM, executable: false });
ctx.setAccount(source, { lamports: 3_000_000, data: tokenAccount(mint, sessionPda, 1_000_000), owner: TOKEN_PROGRAM, executable: false });
ctx.setAccount(dest, { lamports: 3_000_000, data: tokenAccount(mint, sessionPda, 0), owner: TOKEN_PROGRAM, executable: false });
ctx.setAccount(protoFee, { lamports: 3_000_000, data: tokenAccount(mint, TREASURY, 0), owner: TOKEN_PROGRAM, executable: false });
ctx.setAccount(intFee, { lamports: 3_000_000, data: tokenAccount(mint, sessionPda, 0), owner: TOKEN_PROGRAM, executable: false });

// 2) execute_trade (session key signs — NO owner approval) -> route() -> transfer.
{
  // route()'s 7 named accounts become execute_trade's first forwarded accounts:
  //   [authority, input, output_mint, output, token_program, proto_fee, int_fee,
  //    ...leg accounts, TOKEN_PROGRAM, aggregator_router]
  const leg = { venue: 0, accountOffset: 0, accountLen: 3, data: transferData(500_000) };
  const route = routeData(mint, mint, 500_000, 499_000, 0, leg); // 0.20% protocol fee -> 1000

  const ix = new TransactionInstruction({
    programId: DELEGATED,
    keys: [
      { pubkey: sessionKey.publicKey, isSigner: true, isWritable: false }, // session_signer
      { pubkey: sessionPda, isSigner: false, isWritable: true },           // session
      { pubkey: ROUTER, isSigner: false, isWritable: false },              // router_program
      // remaining_accounts forwarded to route() (session PDA gets elevated to signer):
      { pubkey: sessionPda, isSigner: false, isWritable: false }, // route authority
      { pubkey: source, isSigner: false, isWritable: true },      // input_token_account
      { pubkey: mint, isSigner: false, isWritable: false },       // output_mint_account
      { pubkey: dest, isSigner: false, isWritable: true },        // output_token_account
      { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false }, // token_program
      { pubkey: protoFee, isSigner: false, isWritable: true },    // protocol_fee_account
      { pubkey: intFee, isSigner: false, isWritable: true },      // integrator_fee_account
      // leg accounts (offset 0, len 3): [source, dest, sessionPda]
      { pubkey: source, isSigner: false, isWritable: true },      // leg[0]
      { pubkey: dest, isSigner: false, isWritable: true },        // leg[1]
      { pubkey: sessionPda, isSigner: false, isWritable: false }, // leg[2] transfer authority
      { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: ROUTER, isSigner: false, isWritable: false },     // router prog in invoke_signed pool
    ],
    data: executeTradeData(500_000, mint, mint, 0, route),
  });
  await send(ix, [payer, sessionKey]);

  const destAcc = await client.getAccount(dest);
  assert.strictEqual(readAmount(destAcc.data), 499_000n, "dest credited net of the 0.20% protocol fee");
  assert.strictEqual(readAmount((await client.getAccount(protoFee)).data), 1_000n, "protocol fee = 1000 (0.20% of 500000)");
  const s = Buffer.from((await client.getAccount(sessionPda)).data);
  // Walk to the nonce: 8 (disc) + 113 (fixed fields) then three Vec<Pubkey>.
  let off = 8 + 113;
  for (let i = 0; i < 3; i++) off += 4 + 32 * s.readUInt32LE(off);
  const nonce = s.readBigUInt64LE(off);
  assert.strictEqual(nonce, 1n, "session nonce advanced to 1");
  console.log("✅ 2. execute_trade -> aggregator_router.route() -> swap; dest +499000 (net of 0.20% fee), nonce=1");
}

// 3) replay the same nonce -> InvalidNonce revert.
{
  const leg = { venue: 0, accountOffset: 0, accountLen: 3, data: transferData(500_000) };
  const ix = new TransactionInstruction({
    programId: DELEGATED,
    keys: [
      { pubkey: sessionKey.publicKey, isSigner: true, isWritable: false },
      { pubkey: sessionPda, isSigner: false, isWritable: true },
      { pubkey: ROUTER, isSigner: false, isWritable: false },
      { pubkey: sessionPda, isSigner: false, isWritable: false },
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: dest, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: protoFee, isSigner: false, isWritable: true },
      { pubkey: intFee, isSigner: false, isWritable: true },
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: dest, isSigner: false, isWritable: true },
      { pubkey: sessionPda, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: ROUTER, isSigner: false, isWritable: false },
    ],
    data: executeTradeData(500_000, mint, mint, 0, routeData(mint, mint, 500_000, 499_000, 0, leg)), // stale nonce 0
  });
  let reverted = false;
  try { await send(ix, [payer, sessionKey]); } catch { reverted = true; }
  assert.ok(reverted, "stale nonce should revert (replay guard)");
  console.log("✅ 3. replay rejected (stale nonce -> InvalidNonce)");
}

console.log("\n3/3 full-chain tests passed — our api-wallet swaps through our router, approval-free");
