//! # Aggregator Router
//!
//! The on-chain execution half of an agent-native DEX aggregator. It takes a
//! route computed off-chain and executes it **atomically** across venues
//! (Raydium AMM/CLMM/CPMM, Meteora DLMM/Dynamic, Pump.fun/PumpSwap; Kamino
//! reserved), enforcing a venue allowlist and a real-balance slippage bound.
//!
//! Route-finding (which pools, how to split, multi-hop) is intentionally NOT
//! here — that runs off-chain and feeds this program a plan. See `route.rs`.
//!
//! ## Integration with the api-wallet
//! This program is designed to be the single program an api-wallet
//! `TradingSession` allowlists: `execute_trade` CPIs into `route`, so an AI
//! agent gets best-price, multi-venue execution with the same approval-free,
//! non-custodial guarantees.

use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod events;
pub mod instructions;

use instructions::*;

declare_id!("7c8LDstCZnVxtcKLBdMD6YFmmNbVUTaQnZNv9Txmh8t6");

#[program]
pub mod aggregator_router {
    use super::*;

    /// Execute a pre-computed route. `legs` is the ordered plan; a fixed protocol
    /// fee plus an `integrator_fee_bps` (third-party, capped) are skimmed from the
    /// output, and `min_amount_out` is enforced on the net (post-fee) amount.
    pub fn route(
        ctx: Context<Route>,
        amount_in: u64,
        min_amount_out: u64,
        integrator_fee_bps: u16,
        legs: Vec<SwapLeg>,
    ) -> Result<()> {
        instructions::route::handler(ctx, amount_in, min_amount_out, integrator_fee_bps, legs)
    }
}
