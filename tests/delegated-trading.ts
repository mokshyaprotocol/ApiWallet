/**
 * End-to-end tests for the delegated trading session protocol.
 *
 * Build & run with the mock aggregator so the CPI path is exercised locally:
 *
 *   anchor test -- --features mock-router
 *
 * Under that feature the program's verified aggregator id points at the bundled
 * `mock_router` program (see programs/mock-router). Every check up to and
 * including the `invoke_signed` CPI is real.
 */
import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import {
  PublicKey,
  Keypair,
  LAMPORTS_PER_SOL,
  SystemProgram,
} from "@solana/web3.js";
import { assert, expect } from "chai";
import { DelegatedTrading } from "../target/types/delegated_trading";
import { MockRouter } from "../target/types/mock_router";

const SESSION_SEED = Buffer.from("trading_session");

describe("delegated-trading", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace
    .DelegatedTrading as Program<DelegatedTrading>;
  const mockRouter = anchor.workspace.MockRouter as Program<MockRouter>;
  const ROUTER = mockRouter.programId;

  const connection = provider.connection;

  // Reusable allowlisted mints for the happy path.
  const inputMint = Keypair.generate().publicKey;
  const outputMint = Keypair.generate().publicKey;

  // ---- helpers ------------------------------------------------------------

  const now = () => Math.floor(Date.now() / 1000);
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  function sessionPda(owner: PublicKey, sessionKey: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync(
      [SESSION_SEED, owner.toBuffer(), sessionKey.toBuffer()],
      program.programId
    )[0];
  }

  async function fund(pubkey: PublicKey, sol = 5) {
    const sig = await connection.requestAirdrop(pubkey, sol * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig, "confirmed");
  }

  interface SessionOpts {
    expiresAt?: number;
    maxTrade?: BN;
    dailyLimit?: BN;
    programs?: PublicKey[];
    inputs?: PublicKey[];
    outputs?: PublicKey[];
  }

  async function createSession(
    owner: Keypair,
    sessionKey: PublicKey,
    opts: SessionOpts = {}
  ): Promise<PublicKey> {
    const pda = sessionPda(owner.publicKey, sessionKey);
    await program.methods
      .createSession(
        sessionKey,
        new BN(opts.expiresAt ?? now() + 3600),
        opts.maxTrade ?? new BN(1_000),
        opts.dailyLimit ?? new BN(2_000),
        opts.programs ?? [ROUTER],
        opts.inputs ?? [inputMint],
        opts.outputs ?? [outputMint]
      )
      .accounts({
        owner: owner.publicKey,
        session: pda,
        systemProgram: SystemProgram.programId,
      })
      .signers([owner])
      .rpc();
    return pda;
  }

  /** Encode the mock aggregator's `swap` instruction data. */
  function routeData(amountIn: BN, minOut: BN): Buffer {
    return mockRouter.coder.instruction.encode("swap", {
      amountIn,
      minAmountOut: minOut,
    });
  }

  /**
   * Build an execute_trade call. The session PDA is passed as a *non-signer*
   * remaining account (it signs inside the program via invoke_signed) and is
   * the mock swap's transfer_authority.
   */
  function trade(
    pda: PublicKey,
    sessionKey: PublicKey,
    params: {
      amountIn: BN;
      nonce: BN;
      program?: PublicKey;
      input?: PublicKey;
      output?: PublicKey;
    }
  ) {
    return program.methods
      .executeTrade(
        params.amountIn,
        params.input ?? inputMint,
        params.output ?? outputMint,
        params.nonce,
        routeData(params.amountIn, new BN(0))
      )
      .accounts({
        sessionSigner: sessionKey,
        session: pda,
        routerProgram: params.program ?? ROUTER,
      })
      .remainingAccounts([
        { pubkey: pda, isSigner: false, isWritable: false },
      ]);
  }

  async function expectError(p: Promise<any>, code: string) {
    try {
      await p;
      assert.fail(`expected error ${code} but call succeeded`);
    } catch (e: any) {
      const msg = e.toString() + JSON.stringify(e.error ?? {});
      expect(msg).to.contain(code);
    }
  }

  // -------------------------------------------------------------------------

  it("create session", async () => {
    const owner = Keypair.generate();
    await fund(owner.publicKey);
    const sessionKey = Keypair.generate().publicKey;
    const pda = await createSession(owner, sessionKey);

    const s = await program.account.tradingSession.fetch(pda);
    assert.ok(s.owner.equals(owner.publicKey));
    assert.ok(s.sessionPubkey.equals(sessionKey));
    assert.isFalse(s.revoked);
    assert.equal(s.nonce.toNumber(), 0);
    assert.equal(s.maxTradeAmount.toNumber(), 1_000);
    assert.equal(s.dailyTradeLimit.toNumber(), 2_000);
    assert.ok(s.allowedPrograms[0].equals(ROUTER));
  });

  it("rejects create with expiry in the past", async () => {
    const owner = Keypair.generate();
    await fund(owner.publicKey);
    const sessionKey = Keypair.generate().publicKey;
    await expectError(
      createSession(owner, sessionKey, { expiresAt: now() - 10 }),
      "InvalidExpiry"
    );
  });

  it("rejects create when the router is not in the program allowlist", async () => {
    const owner = Keypair.generate();
    await fund(owner.publicKey);
    const sessionKey = Keypair.generate().publicKey;
    await expectError(
      createSession(owner, sessionKey, {
        programs: [Keypair.generate().publicKey],
      }),
      "ProgramNotAllowed"
    );
  });

  it("update session", async () => {
    const owner = Keypair.generate();
    await fund(owner.publicKey);
    const sessionKey = Keypair.generate().publicKey;
    const pda = await createSession(owner, sessionKey);

    const newExpiry = now() + 7200;
    await program.methods
      .updateSession(
        new BN(newExpiry),
        new BN(500),
        new BN(5_000),
        null,
        null,
        null
      )
      .accounts({ owner: owner.publicKey, session: pda })
      .signers([owner])
      .rpc();

    const s = await program.account.tradingSession.fetch(pda);
    assert.equal(s.expiresAt.toNumber(), newExpiry);
    assert.equal(s.maxTradeAmount.toNumber(), 500);
    assert.equal(s.dailyTradeLimit.toNumber(), 5_000);
  });

  it("update by non-owner is rejected", async () => {
    const owner = Keypair.generate();
    const attacker = Keypair.generate();
    await fund(owner.publicKey);
    await fund(attacker.publicKey);
    const sessionKey = Keypair.generate().publicKey;
    const pda = await createSession(owner, sessionKey);

    await expectError(
      program.methods
        .updateSession(null, new BN(1), null, null, null, null)
        .accounts({ owner: attacker.publicKey, session: pda })
        .signers([attacker])
        .rpc(),
      // has_one/seeds mismatch → constraint error
      "Error"
    );
  });

  it("revoke session", async () => {
    const owner = Keypair.generate();
    await fund(owner.publicKey);
    const sessionKey = Keypair.generate().publicKey;
    const pda = await createSession(owner, sessionKey);

    await program.methods
      .revokeSession()
      .accounts({ owner: owner.publicKey, session: pda })
      .signers([owner])
      .rpc();

    const s = await program.account.tradingSession.fetch(pda);
    assert.isTrue(s.revoked);
  });

  it("revoked session rejects trades", async () => {
    const owner = Keypair.generate();
    await fund(owner.publicKey);
    const sessionKp = Keypair.generate();
    await fund(sessionKp.publicKey);
    const pda = await createSession(owner, sessionKp.publicKey);

    await program.methods
      .revokeSession()
      .accounts({ owner: owner.publicKey, session: pda })
      .signers([owner])
      .rpc();

    await expectError(
      trade(pda, sessionKp.publicKey, {
        amountIn: new BN(100),
        nonce: new BN(0),
      })
        .signers([sessionKp])
        .rpc(),
      "SessionRevoked"
    );
  });

  it("expired session rejects trades", async () => {
    const owner = Keypair.generate();
    await fund(owner.publicKey);
    const sessionKp = Keypair.generate();
    await fund(sessionKp.publicKey);
    // Expire ~2s from now, then wait it out.
    const pda = await createSession(owner, sessionKp.publicKey, {
      expiresAt: now() + 2,
    });
    await sleep(3500);

    await expectError(
      trade(pda, sessionKp.publicKey, {
        amountIn: new BN(100),
        nonce: new BN(0),
      })
        .signers([sessionKp])
        .rpc(),
      "SessionExpired"
    );
  });

  it("invalid signer (not the session key) is rejected", async () => {
    const owner = Keypair.generate();
    await fund(owner.publicKey);
    const sessionKp = Keypair.generate();
    const impostor = Keypair.generate();
    await fund(impostor.publicKey);
    const pda = await createSession(owner, sessionKp.publicKey);

    await expectError(
      trade(pda, impostor.publicKey, {
        amountIn: new BN(100),
        nonce: new BN(0),
      })
        .signers([impostor])
        .rpc(),
      "UnauthorizedSessionKey"
    );
  });

  it("invalid program is rejected", async () => {
    const owner = Keypair.generate();
    await fund(owner.publicKey);
    const sessionKp = Keypair.generate();
    await fund(sessionKp.publicKey);
    const pda = await createSession(owner, sessionKp.publicKey);

    await expectError(
      trade(pda, sessionKp.publicKey, {
        amountIn: new BN(100),
        nonce: new BN(0),
        program: Keypair.generate().publicKey, // not the verified aggregator
      })
        .signers([sessionKp])
        .rpc(),
      "ProgramNotAllowed"
    );
  });

  it("invalid token is rejected", async () => {
    const owner = Keypair.generate();
    await fund(owner.publicKey);
    const sessionKp = Keypair.generate();
    await fund(sessionKp.publicKey);
    const pda = await createSession(owner, sessionKp.publicKey);

    await expectError(
      trade(pda, sessionKp.publicKey, {
        amountIn: new BN(100),
        nonce: new BN(0),
        input: Keypair.generate().publicKey, // not allowlisted
      })
        .signers([sessionKp])
        .rpc(),
      "TokenNotAllowed"
    );
  });

  it("exceeded per-trade limit is rejected", async () => {
    const owner = Keypair.generate();
    await fund(owner.publicKey);
    const sessionKp = Keypair.generate();
    await fund(sessionKp.publicKey);
    const pda = await createSession(owner, sessionKp.publicKey, {
      maxTrade: new BN(100),
      dailyLimit: new BN(1_000),
    });

    await expectError(
      trade(pda, sessionKp.publicKey, {
        amountIn: new BN(101),
        nonce: new BN(0),
      })
        .signers([sessionKp])
        .rpc(),
      "TradeLimitExceeded"
    );
  });

  it("successful routed (mock) trade updates nonce and volume", async () => {
    const owner = Keypair.generate();
    await fund(owner.publicKey);
    const sessionKp = Keypair.generate();
    await fund(sessionKp.publicKey);
    const pda = await createSession(owner, sessionKp.publicKey, {
      maxTrade: new BN(1_000),
      dailyLimit: new BN(2_000),
    });

    await trade(pda, sessionKp.publicKey, {
      amountIn: new BN(750),
      nonce: new BN(0),
    })
      .signers([sessionKp])
      .rpc();

    const s = await program.account.tradingSession.fetch(pda);
    assert.equal(s.nonce.toNumber(), 1);
    assert.equal(s.dailyVolumeUsed.toNumber(), 750);
  });

  it("replay attack prevention (stale nonce rejected)", async () => {
    const owner = Keypair.generate();
    await fund(owner.publicKey);
    const sessionKp = Keypair.generate();
    await fund(sessionKp.publicKey);
    const pda = await createSession(owner, sessionKp.publicKey);

    // First trade at nonce 0 succeeds → nonce becomes 1.
    await trade(pda, sessionKp.publicKey, {
      amountIn: new BN(100),
      nonce: new BN(0),
    })
      .signers([sessionKp])
      .rpc();

    // Replaying the exact same call (nonce 0) must fail.
    await expectError(
      trade(pda, sessionKp.publicKey, {
        amountIn: new BN(100),
        nonce: new BN(0),
      })
        .signers([sessionKp])
        .rpc(),
      "InvalidNonce"
    );
  });

  it("exceeded daily limit is rejected", async () => {
    const owner = Keypair.generate();
    await fund(owner.publicKey);
    const sessionKp = Keypair.generate();
    await fund(sessionKp.publicKey);
    const pda = await createSession(owner, sessionKp.publicKey, {
      maxTrade: new BN(100),
      dailyLimit: new BN(150),
    });

    // First trade of 100 → daily used 100, nonce 1.
    await trade(pda, sessionKp.publicKey, {
      amountIn: new BN(100),
      nonce: new BN(0),
    })
      .signers([sessionKp])
      .rpc();

    // Second trade of 100 → projected 200 > 150 daily cap.
    await expectError(
      trade(pda, sessionKp.publicKey, {
        amountIn: new BN(100),
        nonce: new BN(1),
      })
        .signers([sessionKp])
        .rpc(),
      "DailyLimitExceeded"
    );
  });
});
