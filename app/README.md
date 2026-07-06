# ApiWallet — Approval-Free Trading (Next.js)

A minimal Vercel-ready app demonstrating the delegated trading session protocol:
connect Phantom, approve **once** to open a session, then buy/sell tokens with
**no wallet popup per trade**.

## How the "no approval" flow works

1. **Connect Phantom** (the owner wallet).
2. **Open a session** — the app generates an ephemeral *session key* in your
   browser (stored in `localStorage`) and calls `create_session` on-chain,
   delegating limited trading authority to it. This is the **only** Phantom
   approval. The same transaction tops the session key up with a little SOL for
   fees.
3. **Trade** — each buy/sell is `execute_trade`, signed locally by the session
   key. Phantom is never invoked, so there is no popup. On-chain the session key
   can **only** swap within your limits — it can never move or withdraw funds.

## Devnet note

Jupiter (program + quote API) only runs on **mainnet-beta**. This devnet demo
therefore routes swaps through the bundled **mock aggregator** so the delegated
flow is fully exercisable. Point `AGGREGATOR_ID` at real Jupiter and flip
`IS_DEVNET` in `src/lib/constants.ts` for mainnet.

## Run locally

```bash
npm install
npm run dev
# open http://localhost:3000 with Phantom set to Devnet
```

## Deploy to Vercel

Set the project **root directory** to `app/`. No env vars are required (defaults
to public devnet RPC); optionally set `NEXT_PUBLIC_RPC_URL` to a private
endpoint.

## Config

`src/lib/constants.ts` — program id, aggregator id, tradable tokens, session
top-up amount, RPC.
