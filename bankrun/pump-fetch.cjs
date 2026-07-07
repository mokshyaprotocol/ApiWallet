/**
 * Build a Pump.fun buyV2 via @pump-fun/pump-sdk for a fresh user + a live
 * pre-graduation mint, dump the pump + fee programs, and clone every referenced
 * mainnet account. Writes fixtures for the bankrun test to replay.
 *   RPC_URL=... node bankrun/pump-fetch.cjs
 */
const s = require("@pump-fun/pump-sdk");
const { Connection, PublicKey, Keypair } = require("@solana/web3.js");
const BN = require("bn.js");
const bs58 = require("bs58").default ?? require("bs58");
const fs = require("fs");
const path = require("path");
const FIX = path.join(__dirname, "fixtures");

const PUMP = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const FEE = new PublicKey("pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ");
const ATA_PROG = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const T22 = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
const BUY = [102, 6, 61, 18, 1, 218, 235, 234];

async function dumpProgram(c, programId, outfile) {
  const prog = await c.getAccountInfo(programId);
  const pdAddr = new PublicKey(prog.data.subarray(4, 36));
  const pd = await c.getAccountInfo(pdAddr);
  fs.writeFileSync(outfile, pd.data.subarray(45));
  return pd.data.length - 45;
}

(async () => {
  const c = new Connection(process.env.RPC_URL, "confirmed");
  const online = new s.OnlinePumpSdk(c);

  // 1) live pre-graduation mint
  const sigs = await c.getSignaturesForAddress(PUMP, { limit: 60 });
  let mint = null;
  outer: for (const sg of sigs) {
    const tx = await c.getTransaction(sg.signature, { maxSupportedTransactionVersion: 0 });
    if (!tx || tx.meta?.err) continue;
    const m = tx.transaction.message;
    const keys = (m.staticAccountKeys ?? m.accountKeys).map((k) => k.toBase58());
    const ld = tx.meta?.loadedAddresses;
    const all = [...keys, ...(ld?.writable ?? []).map((k) => k.toBase58()), ...(ld?.readonly ?? []).map((k) => k.toBase58())];
    const cands = [];
    (m.compiledInstructions ?? m.instructions).forEach((ix) => cands.push({ ix, acc: ix.accountKeyIndexes ?? ix.accounts }));
    for (const inner of tx.meta?.innerInstructions ?? []) for (const ix of inner.instructions) cands.push({ ix, acc: ix.accounts });
    for (const { ix, acc } of cands) {
      if (all[ix.programIdIndex] !== PUMP.toBase58()) continue;
      const raw = ix.data;
      const data = raw instanceof Uint8Array ? Buffer.from(raw) : Buffer.from(bs58.decode(raw));
      if (!BUY.every((b, i) => data[i] === b)) continue;
      const cand = new PublicKey(all[acc[2]]);
      const bc = await online.fetchBondingCurve(cand).catch(() => null);
      if (bc && !bc.complete) { mint = cand; break outer; }
    }
  }
  if (!mint) throw new Error("no live pre-grad mint");
  console.log("mint:", mint.toBase58());

  // 2) build buyV2 for a fresh user
  const user = Keypair.generate();
  const [global, feeConfig, buyState, mintAcc] = await Promise.all([
    online.fetchGlobal(), online.fetchFeeConfig().catch(() => null),
    online.fetchBuyState(mint, user.publicKey), c.getAccountInfo(mint),
  ]);
  const tokenProgram = new PublicKey(mintAcc.owner.toBase58());
  const solAmount = new BN(10_000_000);
  const amount = s.getBuyTokenAmountFromSolAmount({ global, feeConfig, mintSupply: buyState.bondingCurve.tokenTotalSupply, bondingCurve: buyState.bondingCurve, amount: solAmount });
  const ixs = await s.PUMP_SDK.buyV2Instructions({ global, feeConfig, bondingCurveAccountInfo: buyState.bondingCurveAccountInfo, bondingCurve: buyState.bondingCurve, associatedUserAccountInfo: buyState.associatedUserAccountInfo, mint, user: user.publicKey, amount, quoteAmount: solAmount, slippage: 20, tokenProgram });
  console.log("SDK quote tokens:", amount.toString(), "| #ix:", ixs.length);

  // 3) dump programs
  console.log("pump .so:", await dumpProgram(c, PUMP, `${FIX}/pump.so`), "| fee .so:", await dumpProgram(c, FEE, `${FIX}/pump_fee.so`));

  // 4) clone every referenced non-program account that exists
  const skip = new Set([PUMP, FEE, ATA_PROG, T22, tokenProgram,
    new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
    new PublicKey("11111111111111111111111111111111"),
  ].map((p) => p.toBase58()));
  const allKeys = [...new Set(ixs.flatMap((ix) => ix.keys.map((k) => k.pubkey.toBase58())))];
  const accounts = [];
  for (const pk of allKeys) {
    if (skip.has(pk) || pk === user.publicKey.toBase58()) continue;
    const info = await c.getAccountInfo(new PublicKey(pk));
    if (!info || info.executable) continue; // skip missing (created by tx) + programs
    accounts.push({ pubkey: pk, owner: info.owner.toBase58(), lamports: info.lamports, executable: false, data: info.data.toString("base64") });
  }
  // Clone pump + fee programs as full upgradeable-program accounts (program +
  // programdata) so program-test registers them like a mainnet fork — avoids
  // its name-loading limitation for programs that own cloned accounts.
  for (const pid of [PUMP, FEE]) {
    const prog = await c.getAccountInfo(pid);
    accounts.push({ pubkey: pid.toBase58(), owner: prog.owner.toBase58(), lamports: prog.lamports, executable: true, data: prog.data.toString("base64") });
    const pdAddr = new PublicKey(prog.data.subarray(4, 36));
    const pd = await c.getAccountInfo(pdAddr);
    accounts.push({ pubkey: pdAddr.toBase58(), owner: pd.owner.toBase58(), lamports: pd.lamports, executable: false, data: pd.data.toString("base64") });
  }

  const serIx = (ix) => ({ programId: ix.programId.toBase58(), keys: ix.keys.map((k) => ({ pubkey: k.pubkey.toBase58(), isSigner: k.isSigner, isWritable: k.isWritable })), data: Buffer.from(ix.data).toString("base64") });
  fs.writeFileSync(`${FIX}/pump-accounts.json`, JSON.stringify(accounts));
  fs.writeFileSync(`${FIX}/pump-quote.json`, JSON.stringify({
    mint: mint.toBase58(), tokenProgram: tokenProgram.toBase58(),
    userSecret: Array.from(user.secretKey), expectedTokens: amount.toString(),
    solAmount: solAmount.toString(), instructions: ixs.map(serIx),
  }, null, 2));
  console.log("cloned", accounts.length, "accounts -> fixtures");
})();
