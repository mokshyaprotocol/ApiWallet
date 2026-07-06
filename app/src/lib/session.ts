import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { AnchorProvider, BN, Program } from "@coral-xyz/anchor";
import { IDL } from "./idl";
import {
  AGGREGATOR_ID,
  MOCK_SWAP_DISCRIMINATOR,
  PROGRAM_ID,
  SESSION_FEE_TOPUP,
  SESSION_SEED,
  SESSION_STORAGE_PREFIX,
} from "./constants";

/** A minimal wallet shape (Phantom via wallet-adapter satisfies this). */
export interface SignerWallet {
  publicKey: PublicKey;
  signTransaction: (tx: Transaction) => Promise<Transaction>;
  signAllTransactions?: (txs: Transaction[]) => Promise<Transaction[]>;
}

/** Derive the session PDA — mirrors the on-chain seeds. */
export function deriveSessionPda(
  owner: PublicKey,
  sessionPubkey: PublicKey
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [SESSION_SEED, owner.toBuffer(), sessionPubkey.toBuffer()],
    PROGRAM_ID
  )[0];
}

/**
 * Load (or lazily create) the ephemeral session keypair for this owner.
 * It lives in localStorage — its whole purpose is to sign trades locally so
 * Phantom never has to pop up per trade. It is NOT the owner's key and holds
 * no custody: on-chain it can only call `execute_trade`.
 */
export function loadOrCreateSessionKeypair(owner: PublicKey): Keypair {
  const key = SESSION_STORAGE_PREFIX + owner.toBase58();
  const stored = typeof window !== "undefined" && localStorage.getItem(key);
  if (stored) {
    try {
      return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(stored)));
    } catch {
      /* fall through and regenerate */
    }
  }
  const kp = Keypair.generate();
  if (typeof window !== "undefined") {
    localStorage.setItem(key, JSON.stringify(Array.from(kp.secretKey)));
  }
  return kp;
}

export function clearSessionKeypair(owner: PublicKey) {
  if (typeof window !== "undefined") {
    localStorage.removeItem(SESSION_STORAGE_PREFIX + owner.toBase58());
  }
}

function buildProgram(connection: Connection, wallet: SignerWallet): Program {
  const provider = new AnchorProvider(
    connection,
    wallet as any,
    { commitment: "confirmed" }
  );
  return new Program(IDL, PROGRAM_ID, provider);
}

/** Encode the mock aggregator's `swap` instruction data (route_data). */
function encodeMockRoute(amountIn: BN, minOut: BN): Buffer {
  const buf = Buffer.alloc(8 + 8 + 8);
  Buffer.from(MOCK_SWAP_DISCRIMINATOR).copy(buf, 0);
  amountIn.toArrayLike(Buffer, "le", 8).copy(buf, 8);
  minOut.toArrayLike(Buffer, "le", 8).copy(buf, 16);
  return buf;
}

export interface CreateSessionParams {
  connection: Connection;
  wallet: SignerWallet; // owner (Phantom)
  sessionKp: Keypair;
  expiresInSecs: number;
  maxTradeAmount: BN;
  dailyTradeLimit: BN;
  allowedPrograms: PublicKey[];
  allowedInputTokens: PublicKey[];
  allowedOutputTokens: PublicKey[];
}

/**
 * Create the session. This is the ONLY step that needs a Phantom approval.
 * We bundle a small SOL top-up to the session key (so it can pay trade fees)
 * into the same transaction — one approval covers both.
 */
export async function createSession(p: CreateSessionParams): Promise<string> {
  const program = buildProgram(p.connection, p.wallet);
  const owner = p.wallet.publicKey;
  const pda = deriveSessionPda(owner, p.sessionKp.publicKey);
  const now = Math.floor(Date.now() / 1000);

  const createIx: TransactionInstruction = await program.methods
    .createSession(
      p.sessionKp.publicKey,
      new BN(now + p.expiresInSecs),
      p.maxTradeAmount,
      p.dailyTradeLimit,
      p.allowedPrograms,
      p.allowedInputTokens,
      p.allowedOutputTokens
    )
    .accounts({
      owner,
      session: pda,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  const topupIx = SystemProgram.transfer({
    fromPubkey: owner,
    toPubkey: p.sessionKp.publicKey,
    lamports: SESSION_FEE_TOPUP,
  });

  const tx = new Transaction().add(createIx, topupIx);
  tx.feePayer = owner;
  tx.recentBlockhash = (
    await p.connection.getLatestBlockhash("confirmed")
  ).blockhash;

  const signed = await p.wallet.signTransaction(tx); // <-- single Phantom prompt
  const sig = await p.connection.sendRawTransaction(signed.serialize());
  await p.connection.confirmTransaction(sig, "confirmed");
  return sig;
}

export interface SessionState {
  pda: PublicKey;
  owner: PublicKey;
  sessionPubkey: PublicKey;
  expiresAt: number;
  revoked: boolean;
  maxTradeAmount: BN;
  dailyTradeLimit: BN;
  dailyVolumeUsed: BN;
  nonce: BN;
}

/** Fetch on-chain session state; returns null if it doesn't exist yet. */
export async function fetchSession(
  connection: Connection,
  wallet: SignerWallet,
  sessionPubkey: PublicKey
): Promise<SessionState | null> {
  const program = buildProgram(connection, wallet);
  const pda = deriveSessionPda(wallet.publicKey, sessionPubkey);
  const acc = await (program.account as any).tradingSession.fetchNullable(pda);
  if (!acc) return null;
  return {
    pda,
    owner: acc.owner,
    sessionPubkey: acc.sessionPubkey,
    expiresAt: acc.expiresAt.toNumber(),
    revoked: acc.revoked,
    maxTradeAmount: acc.maxTradeAmount,
    dailyTradeLimit: acc.dailyTradeLimit,
    dailyVolumeUsed: acc.dailyVolumeUsed,
    nonce: acc.nonce,
  };
}

export interface ExecuteTradeParams {
  connection: Connection;
  wallet: SignerWallet; // used only to build the instruction (no signing)
  sessionKp: Keypair; // signs the trade locally — NO Phantom prompt
  amountIn: BN;
  inputMint: PublicKey;
  outputMint: PublicKey;
  expectedNonce: BN;
}

/**
 * Execute a trade. Signed entirely by the session key, so Phantom is never
 * involved — no approval popup. Returns the tx signature.
 */
export async function executeTrade(p: ExecuteTradeParams): Promise<string> {
  const program = buildProgram(p.connection, p.wallet);
  const pda = deriveSessionPda(p.wallet.publicKey, p.sessionKp.publicKey);
  const routeData = encodeMockRoute(p.amountIn, new BN(0));

  const ix: TransactionInstruction = await program.methods
    .executeTrade(
      p.amountIn,
      p.inputMint,
      p.outputMint,
      p.expectedNonce,
      routeData
    )
    .accounts({
      sessionSigner: p.sessionKp.publicKey,
      session: pda,
      jupiterProgram: AGGREGATOR_ID,
    })
    // The session PDA is the swap's transfer authority; the program elevates it
    // to a signer inside `invoke_signed`, so we pass it as a non-signer here.
    .remainingAccounts([{ pubkey: pda, isSigner: false, isWritable: false }])
    .instruction();

  const tx = new Transaction().add(ix);
  tx.feePayer = p.sessionKp.publicKey;
  tx.recentBlockhash = (
    await p.connection.getLatestBlockhash("confirmed")
  ).blockhash;
  tx.sign(p.sessionKp); // local signature only

  const sig = await p.connection.sendRawTransaction(tx.serialize());
  await p.connection.confirmTransaction(sig, "confirmed");
  return sig;
}
