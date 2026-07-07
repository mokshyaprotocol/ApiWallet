// Bankrun smoke: load aggregator_router.so and confirm route() executes
// (empty legs -> EmptyRoute error). Proves the SVM + our program work here.
import { start } from "solana-bankrun";
import { PublicKey, Keypair, Transaction, TransactionInstruction, SystemProgram } from "@solana/web3.js";

const ROUTER = new PublicKey("7c8LDstCZnVxtcKLBdMD6YFmmNbVUTaQnZNv9Txmh8t6");
const ROUTE_DISC = Buffer.from([229, 23, 203, 151, 122, 227, 173, 42]);

// route(amount_in u64, min_amount_out u64, legs Vec<SwapLeg>) with empty legs
function emptyRouteData() {
  const b = Buffer.alloc(8 + 8 + 8 + 4);
  ROUTE_DISC.copy(b, 0);
  b.writeBigUInt64LE(1000n, 8); // amount_in
  b.writeBigUInt64LE(0n, 16); // min_amount_out
  b.writeUInt32LE(0, 24); // legs vec length = 0
  return b;
}

const ctx = await start([{ name: "aggregator_router", programId: ROUTER }], []);
const client = ctx.banksClient;
const payer = ctx.payer;
const dummyOut = Keypair.generate().publicKey;

const ix = new TransactionInstruction({
  programId: ROUTER,
  keys: [
    { pubkey: payer.publicKey, isSigner: true, isWritable: false },
    { pubkey: dummyOut, isSigner: false, isWritable: true },
  ],
  data: emptyRouteData(),
});
const tx = new Transaction().add(ix);
tx.recentBlockhash = ctx.lastBlockhash;
tx.feePayer = payer.publicKey;
tx.sign(payer);

try {
  await client.processTransaction(tx);
  console.log("UNEXPECTED: tx succeeded");
} catch (e) {
  const msg = String(e.message ?? e);
  console.log("route() reverted as expected:", msg.split("\n")[0]);
  console.log(/EmptyRoute|0x1771|custom program error/i.test(msg) ? "✅ program executed (EmptyRoute path)" : "⚠️ unexpected error: " + msg);
}
