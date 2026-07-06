/**
 * Devnet smoke test: proves the approval-free trade flow against the DEPLOYED
 * programs. create_session is signed by the owner (once); execute_trade is
 * signed ONLY by the ephemeral session key — no owner signature at all.
 *
 *   node scripts/smoke-devnet.js
 */
const anchor = require("@coral-xyz/anchor");
const {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
} = require("@solana/web3.js");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { BN } = anchor;

const PROGRAM_ID = new PublicKey("HgUSLposEwz5MnUV6SFABbxVHmSZ1dkbuowWsjAe1s2E");
const MOCK_JUPITER = new PublicKey("4oVmoU4zT21MVgFdTp5N5AayCvMsXZDGE5Xq7QZQvjrN");
const SESSION_SEED = Buffer.from("trading_session");
const MOCK_SWAP_DISC = Buffer.from([248, 198, 158, 145, 225, 117, 135, 200]);
const SOL = new PublicKey("So11111111111111111111111111111111111111112");
const USDC = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");

const IDL = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "..", "target", "idl", "delegated_trading.json"),
    "utf8"
  )
);

function link(sig) {
  return `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
}
function routeData(amountIn) {
  const b = Buffer.alloc(24);
  MOCK_SWAP_DISC.copy(b, 0);
  amountIn.toArrayLike(Buffer, "le", 8).copy(b, 8);
  new BN(0).toArrayLike(Buffer, "le", 8).copy(b, 16);
  return b;
}

(async () => {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const owner = Keypair.fromSecretKey(
    Uint8Array.from(
      JSON.parse(fs.readFileSync(path.join(os.homedir(), ".config/solana/id.json")))
    )
  );
  const sessionKp = Keypair.generate();
  console.log("owner       :", owner.publicKey.toBase58());
  console.log("session key :", sessionKp.publicKey.toBase58());

  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(owner),
    { commitment: "confirmed" }
  );
  const program = new anchor.Program(IDL, PROGRAM_ID, provider);
  const [pda] = PublicKey.findProgramAddressSync(
    [SESSION_SEED, owner.publicKey.toBuffer(), sessionKp.publicKey.toBuffer()],
    PROGRAM_ID
  );
  console.log("session PDA :", pda.toBase58());

  // 1) create_session (+ top up the session key) — the ONE owner-signed step.
  const now = Math.floor(Date.now() / 1000);
  const mints = [SOL, USDC];
  const createIx = await program.methods
    .createSession(
      sessionKp.publicKey,
      new BN(now + 3600),
      new BN("1000000000000"),
      new BN("100000000000000"),
      [MOCK_JUPITER],
      mints,
      mints
    )
    .accounts({ owner: owner.publicKey, session: pda, systemProgram: SystemProgram.programId })
    .instruction();
  const topup = SystemProgram.transfer({
    fromPubkey: owner.publicKey,
    toPubkey: sessionKp.publicKey,
    lamports: 0.03 * LAMPORTS_PER_SOL,
  });
  const tx1 = new Transaction().add(createIx, topup);
  tx1.feePayer = owner.publicKey;
  tx1.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx1.sign(owner);
  const sig1 = await connection.sendRawTransaction(tx1.serialize());
  await connection.confirmTransaction(sig1, "confirmed");
  console.log("\n[1] session created (owner approval):", link(sig1));

  // 2) execute_trade — signed ONLY by the session key. No owner signature.
  const acc = await program.account.tradingSession.fetch(pda);
  const amountIn = new BN(Math.floor(0.1 * 1e9)); // 0.1 SOL
  const tradeIx = await program.methods
    .executeTrade(amountIn, SOL, USDC, acc.nonce, routeData(amountIn))
    .accounts({ sessionSigner: sessionKp.publicKey, session: pda, jupiterProgram: MOCK_JUPITER })
    .remainingAccounts([{ pubkey: pda, isSigner: false, isWritable: false }])
    .instruction();
  const tx2 = new Transaction().add(tradeIx);
  tx2.feePayer = sessionKp.publicKey; // session key pays — owner not involved
  tx2.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx2.sign(sessionKp);
  console.log("    tx2 signers:", tx2.signatures.map((s) => s.publicKey.toBase58()));
  const sig2 = await connection.sendRawTransaction(tx2.serialize());
  await connection.confirmTransaction(sig2, "confirmed");
  console.log("[2] trade executed (NO owner approval):", link(sig2));

  const after = await program.account.tradingSession.fetch(pda);
  console.log("\nnonce:", acc.nonce.toString(), "->", after.nonce.toString());
  console.log("daily volume used:", after.dailyVolumeUsed.toString());
  console.log("\n✅ approval-free trade confirmed on devnet");
})().catch((e) => {
  console.error("SMOKE TEST FAILED:", e.message || e);
  if (e.logs) console.error(e.logs.join("\n"));
  process.exit(1);
});
