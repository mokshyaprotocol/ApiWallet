"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import {
  createSession,
  executeTrade,
  fetchSession,
  loadOrCreateSessionKeypair,
  SessionState,
  SignerWallet,
} from "@/lib/session";
import { AGGREGATOR_ID, IS_DEVNET, TOKENS, tokenBySymbol } from "@/lib/constants";

const WalletButton = dynamic(
  () =>
    import("@solana/wallet-adapter-react-ui").then((m) => m.WalletMultiButton),
  { ssr: false }
);

// Session policy defaults (base units).
const MAX_TRADE = new BN("1000000000000"); // 1,000 tokens @ 9dp
const DAILY_LIMIT = new BN("100000000000000");
const EXPIRES_IN = 60 * 60; // 1 hour

function explorer(sig: string) {
  return `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
}

export default function Home() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [session, setSession] = useState<SessionState | null>(null);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("1");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [lastSig, setLastSig] = useState<string | null>(null);

  // A wallet-adapter-backed SignerWallet, or null until connected.
  const signer: SignerWallet | null = useMemo(() => {
    if (!wallet.publicKey || !wallet.signTransaction) return null;
    return {
      publicKey: wallet.publicKey,
      signTransaction: wallet.signTransaction.bind(wallet),
      signAllTransactions: wallet.signAllTransactions?.bind(wallet),
    };
  }, [wallet.publicKey, wallet.signTransaction, wallet.signAllTransactions]);

  const sessionKp = useMemo(
    () => (wallet.publicKey ? loadOrCreateSessionKeypair(wallet.publicKey) : null),
    [wallet.publicKey]
  );

  const refresh = useCallback(async () => {
    if (!signer || !sessionKp) return;
    try {
      const s = await fetchSession(connection, signer, sessionKp.publicKey);
      setSession(s);
    } catch (e: any) {
      setStatus(`Could not load session: ${e.message ?? e}`);
    }
  }, [connection, signer, sessionKp]);

  useEffect(() => {
    if (signer) refresh();
    else setSession(null);
  }, [signer, refresh]);

  const onCreate = async () => {
    if (!signer || !sessionKp) return;
    setBusy(true);
    setStatus("Approve once in Phantom to open the session…");
    try {
      const mints = TOKENS.map((t) => t.mint);
      const sig = await createSession({
        connection,
        wallet: signer,
        sessionKp,
        expiresInSecs: EXPIRES_IN,
        maxTradeAmount: MAX_TRADE,
        dailyTradeLimit: DAILY_LIMIT,
        allowedPrograms: [AGGREGATOR_ID],
        allowedInputTokens: mints,
        allowedOutputTokens: mints,
      });
      setLastSig(sig);
      setStatus("Session opened. Trades from now on need no approval.");
      await refresh();
    } catch (e: any) {
      setStatus(`Create failed: ${e.message ?? e}`);
    } finally {
      setBusy(false);
    }
  };

  const onTrade = async () => {
    if (!signer || !sessionKp || !session) return;
    setBusy(true);
    setStatus("Executing trade (no wallet popup)…");
    try {
      // Buy = USDC -> SOL, Sell = SOL -> USDC.
      const inTok = side === "buy" ? tokenBySymbol("USDC") : tokenBySymbol("SOL");
      const outTok =
        side === "buy" ? tokenBySymbol("SOL") : tokenBySymbol("USDC");
      const amt = new BN(
        Math.floor(parseFloat(amount || "0") * 10 ** inTok.decimals)
      );
      const sig = await executeTrade({
        connection,
        wallet: signer,
        sessionKp,
        amountIn: amt,
        inputMint: inTok.mint,
        outputMint: outTok.mint,
        expectedNonce: session.nonce,
      });
      setLastSig(sig);
      setStatus(
        `Traded ${amount} ${inTok.symbol} → ${outTok.symbol} with no approval.`
      );
      await refresh();
    } catch (e: any) {
      setStatus(`Trade failed: ${e.message ?? e}`);
    } finally {
      setBusy(false);
    }
  };

  const sessionActive =
    session && !session.revoked && session.expiresAt * 1000 > Date.now();

  return (
    <div className="wrap">
      <div className="brand">
        <div>
          <h1>ApiWallet</h1>
          <div className="tag">Approval-free trading · Solana devnet</div>
        </div>
        <WalletButton />
      </div>

      {IS_DEVNET && (
        <div className="notice">
          Jupiter only runs on mainnet, so this devnet demo routes swaps through
          the bundled <b>mock aggregator</b> — it proves the delegated,
          no-popup trade flow end to end. The same UI uses real Jupiter on
          mainnet.
        </div>
      )}

      {!signer ? (
        <div className="card">
          <div className="center">Connect Phantom to begin.</div>
        </div>
      ) : !sessionActive ? (
        <div className="card">
          <h2>Open a trading session</h2>
          <div className="kv">
            <span>What this does</span>
          </div>
          <p style={{ color: "var(--muted)", fontSize: 13, lineHeight: 1.6 }}>
            Delegates a limited, revocable trading key to your browser. You
            approve <b>once</b>. After that, buys and sells are signed locally by
            the session key — Phantom never pops up again. The session key can{" "}
            <b>only</b> swap within your limits; it can never move or withdraw
            your funds.
          </p>
          <button className="btn" onClick={onCreate} disabled={busy}>
            {busy ? "Opening…" : "Approve once & open session"}
          </button>
        </div>
      ) : (
        <>
          <div className="card">
            <div className="seg" style={{ marginBottom: 16 }}>
              <button
                className={side === "buy" ? "active" : ""}
                onClick={() => setSide("buy")}
              >
                Buy SOL
              </button>
              <button
                className={side === "sell" ? "active" : ""}
                onClick={() => setSide("sell")}
              >
                Sell SOL
              </button>
            </div>

            <label className="lbl">
              Amount ({side === "buy" ? "USDC" : "SOL"})
            </label>
            <input
              className="field"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.0"
            />

            <div style={{ height: 16 }} />
            <button
              className={`btn ${side}`}
              onClick={onTrade}
              disabled={busy || !amount}
            >
              {busy
                ? "Trading…"
                : `${side === "buy" ? "Buy" : "Sell"} — no approval`}
            </button>
          </div>

          <div className="card">
            <h2>Session</h2>
            <div className="kv">
              <span>Status</span>
              <span className="pill ok">active · no popup</span>
            </div>
            <div className="kv">
              <span>Session key</span>
              <b className="mono">
                {shorten(session!.sessionPubkey.toBase58())}
              </b>
            </div>
            <div className="kv">
              <span>Trades executed (nonce)</span>
              <b>{session!.nonce.toString()}</b>
            </div>
            <div className="kv">
              <span>Daily volume used</span>
              <b>{session!.dailyVolumeUsed.toString()}</b>
            </div>
            <div className="kv">
              <span>Expires</span>
              <b>{new Date(session!.expiresAt * 1000).toLocaleTimeString()}</b>
            </div>
          </div>
        </>
      )}

      {status && (
        <div className="log">
          {status}
          {lastSig && (
            <>
              {" "}
              <a href={explorer(lastSig)} target="_blank" rel="noreferrer">
                view tx ↗
              </a>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function shorten(s: string) {
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}
