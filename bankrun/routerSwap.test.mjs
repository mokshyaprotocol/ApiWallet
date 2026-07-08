/**
 * Bankrun integration test: aggregator_router.route() executes a real
 * token-moving swap and enforces slippage — in an in-process SVM, no validator.
 *
 * Built with the `localnet-mock` feature, the first venue slot maps to the SPL
 * Token program, so a "swap leg" is a real token Transfer. This exercises the
 * router's full execution path: allowlist -> per-leg CPI -> output-balance-delta
 * slippage check.
 *
 *   anchor build -p aggregator_router -- --features localnet-mock
 *   SBF_OUT_DIR=$PWD/target/deploy npx tsx bankrun/routerSwap.test.mjs
 */
import { start } from "solana-bankrun";
import { PublicKey, Keypair, Transaction, TransactionInstruction } from "@solana/web3.js";
import assert from "node:assert";

const ROUTER = new PublicKey("7c8LDstCZnVxtcKLBdMD6YFmmNbVUTaQnZNv9Txmh8t6");
const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TREASURY = new PublicKey("Ec5kwqhc1ptv4r3EptfZypvB3dCtQwdLt6cC4EKrGBFd"); // PROTOCOL_FEE_RECIPIENT
const ROUTE_DISC = Buffer.from([229, 23, 203, 151, 122, 227, 173, 42]);

// --- helpers ---------------------------------------------------------------
function tokenAccount(mint, owner, amount) {
  const b = Buffer.alloc(165);
  mint.toBuffer().copy(b, 0);
  owner.toBuffer().copy(b, 32);
  b.writeBigUInt64LE(BigInt(amount), 64);
  b[108] = 1; // state = Initialized
  return b;
}
// SPL Mint (82 bytes): decimals@44, is_initialized@45.
function mintAccount(decimals = 6) { const b = Buffer.alloc(82); b[44] = decimals; b[45] = 1; return b; }
function readAmount(data) {
  return Buffer.from(data).readBigUInt64LE(64);
}
// SPL Token Transfer instruction data: tag 3 + amount u64
function transferData(amount) {
  const b = Buffer.alloc(9);
  b[0] = 3;
  b.writeBigUInt64LE(BigInt(amount), 1);
  return b;
}
// Borsh-encode route(input_mint, output_mint, amount_in, min_amount_out,
// integrator_fee_bps, [one leg]).
function routeData(mint, amountIn, minOut, leg) {
  const legData = leg.data;
  const b = Buffer.alloc(8 + 32 + 32 + 8 + 8 + 2 + 4 + (1 + 2 + 2 + 4 + legData.length));
  let o = 0;
  ROUTE_DISC.copy(b, o); o += 8;
  mint.toBuffer().copy(b, o); o += 32;    // input_mint
  mint.toBuffer().copy(b, o); o += 32;    // output_mint
  b.writeBigUInt64LE(BigInt(amountIn), o); o += 8;
  b.writeBigUInt64LE(BigInt(minOut), o); o += 8;
  b.writeUInt16LE(0, o); o += 2;          // integrator_fee_bps = 0
  b.writeUInt32LE(1, o); o += 4;          // legs vec len = 1
  b.writeUInt8(leg.venue, o); o += 1;
  b.writeUInt16LE(leg.accountOffset, o); o += 2;
  b.writeUInt16LE(leg.accountLen, o); o += 2;
  b.writeUInt32LE(legData.length, o); o += 4;
  legData.copy(b, o); o += legData.length;
  return b;
}

const ctx = await start([{ name: "aggregator_router", programId: ROUTER }], []);
const client = ctx.banksClient;
const payer = ctx.payer;
const mint = Keypair.generate().publicKey;
ctx.setAccount(mint, { lamports: 3_000_000, data: mintAccount(6), owner: TOKEN_PROGRAM, executable: false });

async function freshBlockhash() {
  const bh = await client.getLatestBlockhash();
  return Array.isArray(bh) ? bh[0] : bh;
}

/** Build & attempt a route() that transfers `transferAmt`, requiring `minOut`. */
async function runSwap({ fund, transferAmt, minOut }) {
  const source = Keypair.generate().publicKey;
  const dest = Keypair.generate().publicKey;
  const protoFee = Keypair.generate().publicKey;
  const intFee = Keypair.generate().publicKey;
  ctx.setAccount(source, {
    lamports: 3_000_000, data: tokenAccount(mint, payer.publicKey, fund),
    owner: TOKEN_PROGRAM, executable: false,
  });
  ctx.setAccount(dest, {
    lamports: 3_000_000, data: tokenAccount(mint, payer.publicKey, 0),
    owner: TOKEN_PROGRAM, executable: false,
  });
  ctx.setAccount(protoFee, { lamports: 3_000_000, data: tokenAccount(mint, TREASURY, 0), owner: TOKEN_PROGRAM, executable: false });
  ctx.setAccount(intFee, { lamports: 3_000_000, data: tokenAccount(mint, payer.publicKey, 0), owner: TOKEN_PROGRAM, executable: false });

  const leg = { venue: 0, accountOffset: 0, accountLen: 3, data: transferData(transferAmt) };
  const ix = new TransactionInstruction({
    programId: ROUTER,
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: false }, // authority
      { pubkey: source, isSigner: false, isWritable: true },          // input_token_account
      { pubkey: mint, isSigner: false, isWritable: false },           // output_mint_account
      { pubkey: dest, isSigner: false, isWritable: true },            // output_token_account
      { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },  // token_program
      { pubkey: protoFee, isSigner: false, isWritable: true },        // protocol_fee_account
      { pubkey: intFee, isSigner: false, isWritable: true },          // integrator_fee_account
      // remaining_accounts (leg slice = [source, dest, authority]) + token program
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: dest, isSigner: false, isWritable: true },
      { pubkey: payer.publicKey, isSigner: true, isWritable: false },
      { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
    ],
    data: routeData(mint, transferAmt, minOut, leg),
  });
  const tx = new Transaction().add(ix);
  tx.recentBlockhash = await freshBlockhash();
  tx.feePayer = payer.publicKey;
  tx.sign(payer);
  await client.processTransaction(tx);
  return dest;
}

let passed = 0;

// 1) Happy path: transfer 500k, require net 499k -> succeeds, dest credited net
//    of the 0.20% protocol fee (1000).
{
  const dest = await runSwap({ fund: 1_000_000, transferAmt: 500_000, minOut: 499_000 });
  const acc = await client.getAccount(dest);
  assert.strictEqual(readAmount(acc.data), 499_000n, "dest should hold 499k (net of 0.20% fee)");
  console.log("✅ 1. route() executed a token swap; dest credited 499000 (net of 0.20% protocol fee)");
  passed++;
}

// 2) Slippage: require more than the swap delivers -> SlippageExceeded revert.
{
  let reverted = false;
  try {
    await runSwap({ fund: 1_000_000, transferAmt: 400_000, minOut: 500_000 });
  } catch (e) {
    reverted = /SlippageExceeded|0x1776|custom program error/i.test(String(e.message ?? e));
  }
  assert.ok(reverted, "should revert when min_amount_out is not met");
  console.log("✅ 2. slippage enforced (min_amount_out not met -> revert)");
  passed++;
}

// 3) Unknown/disabled venue -> revert (Kamino = 7 is reserved).
{
  let reverted = false;
  const source = Keypair.generate().publicKey;
  const dest = Keypair.generate().publicKey;
  const protoFee = Keypair.generate().publicKey;
  const intFee = Keypair.generate().publicKey;
  ctx.setAccount(source, { lamports: 3_000_000, data: tokenAccount(mint, payer.publicKey, 1_000_000), owner: TOKEN_PROGRAM, executable: false });
  ctx.setAccount(dest, { lamports: 3_000_000, data: tokenAccount(mint, payer.publicKey, 0), owner: TOKEN_PROGRAM, executable: false });
  ctx.setAccount(protoFee, { lamports: 3_000_000, data: tokenAccount(mint, TREASURY, 0), owner: TOKEN_PROGRAM, executable: false });
  ctx.setAccount(intFee, { lamports: 3_000_000, data: tokenAccount(mint, payer.publicKey, 0), owner: TOKEN_PROGRAM, executable: false });
  const leg = { venue: 7, accountOffset: 0, accountLen: 3, data: transferData(500_000) };
  const ix = new TransactionInstruction({
    programId: ROUTER,
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: false },
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: dest, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: protoFee, isSigner: false, isWritable: true },
      { pubkey: intFee, isSigner: false, isWritable: true },
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: dest, isSigner: false, isWritable: true },
      { pubkey: payer.publicKey, isSigner: true, isWritable: false },
      { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
    ],
    data: routeData(mint, 500_000, 499_000, leg),
  });
  const tx = new Transaction().add(ix);
  tx.recentBlockhash = await freshBlockhash();
  tx.feePayer = payer.publicKey;
  tx.sign(payer);
  try { await client.processTransaction(tx); } catch (e) { reverted = true; }
  assert.ok(reverted, "reserved venue should revert");
  console.log("✅ 3. reserved venue (Kamino) rejected");
  passed++;
}

console.log(`\n${passed}/3 router-swap tests passed`);
