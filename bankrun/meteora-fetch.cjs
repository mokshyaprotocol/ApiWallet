const { Connection, PublicKey } = require("@solana/web3.js");
const BN = require("bn.js");
const fs = require("fs");
const pkg = require("@meteora-ag/dlmm");
const DLMM = pkg.default ?? pkg;
const path = require("path"); const FIX = path.join(__dirname, "fixtures");

(async () => {
  const c = new Connection(process.env.RPC_URL, "confirmed");
  const P = {
    lbPair: "5qGyUHsRQoX2V1CGXw4GktB6vgq6AHo9Ugxp6T7iiNph",
    reserveX: "EhW2JQf7GXfn8Rhm6KYGm8UfgMDTg4MY4mzSuqNkUewY",
    reserveY: "4Cbk8HooqzRZuwmYJFAUMxPZ9VUoxvNrkrbNcGeEindZ",
    tokenXMint: "So11111111111111111111111111111111111111112",
    tokenYMint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
    oracle: "F1N6nPwnMUfX9AicdTVAaVdP3a1MwzTwfxqyUD72Eh2t",
    eventAuthority: "D1ZN9Wj1fRSUQfCjhvnu1hqDMT7hzjzBBpi12nVniYD6",
  };
  const METEORA = new PublicKey("LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo");

  // 1) dump program .so from its ProgramData account
  const prog = await c.getAccountInfo(METEORA);
  const pdAddr = new PublicKey(prog.data.subarray(4, 36));
  const pd = await c.getAccountInfo(pdAddr);
  fs.writeFileSync(`${FIX}/meteora_dlmm.so`, pd.data.subarray(45));
  console.log("dumped .so bytes:", pd.data.length - 45);

  // 2) SDK: quote + the bin arrays this swap needs
  const pool = await DLMM.create(c, new PublicKey(P.lbPair));
  const amountIn = new BN(10_000_000); // 0.01 SOL, X->Y
  const binArrays = await pool.getBinArrayForSwap(true, 4);
  const q = pool.swapQuote(amountIn, true, new BN(50), binArrays);
  const binArrayPubs = binArrays.map((b) => b.publicKey.toBase58());
  console.log("SDK quote out (USDT base units):", q.outAmount.toString(), "binArrays:", binArrayPubs.length);

  // 3) clone all needed accounts
  const toClone = [...Object.values(P), ...binArrayPubs];
  const accounts = [];
  for (const pk of [...new Set(toClone)]) {
    const info = await c.getAccountInfo(new PublicKey(pk));
    if (!info) { console.log("MISSING", pk); continue; }
    accounts.push({
      pubkey: pk, owner: info.owner.toBase58(), lamports: info.lamports,
      executable: info.executable, data: info.data.toString("base64"),
    });
  }
  fs.writeFileSync(`${FIX}/meteora-accounts.json`, JSON.stringify(accounts));
  fs.writeFileSync(`${FIX}/meteora-quote.json`, JSON.stringify({
    ...P, amountIn: amountIn.toString(), swapForY: true,
    expectedOut: q.outAmount.toString(), minOut: q.minOutAmount.toString(),
    binArrays: binArrayPubs, xDecimals: 9, yDecimals: 6,
  }, null, 2));
  console.log("cloned", accounts.length, "accounts -> fixtures");
})();
