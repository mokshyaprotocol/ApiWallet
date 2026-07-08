//! Test-only mock CPI target — stands in for `aggregator_router` in the
//! `delegated_trading` test suite.
//!
//! Its sole job is to prove that `delegated_trading::execute_trade` reaches the
//! CPI and that it does so **signed by the TradingSession PDA**. It mirrors the
//! real router's `route(...)` signature (so `execute_trade`'s route_data binding
//! — discriminator + input_mint + output_mint + amount_in — matches) and
//! requires its `transfer_authority` account to be a signer. If `execute_trade`
//! failed to `invoke_signed`, this program would abort with
//! `MissingRequiredSignature`.
//!
//! This crate is never deployed to mainnet.

use anchor_lang::prelude::*;

declare_id!("4oVmoU4zT21MVgFdTp5N5AayCvMsXZDGE5Xq7QZQvjrN");

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct SwapLeg {
    pub venue: u8,
    pub account_offset: u16,
    pub account_len: u16,
    pub data: Vec<u8>,
}

#[program]
pub mod mock_router {
    use super::*;

    /// Same shape as `aggregator_router::route`. Records nothing; just asserts
    /// the transfer authority signed and echoes the params.
    #[allow(clippy::too_many_arguments)]
    pub fn route(
        ctx: Context<Route>,
        input_mint: Pubkey,
        output_mint: Pubkey,
        amount_in: u64,
        min_amount_out: u64,
        integrator_fee_bps: u16,
        _legs: Vec<SwapLeg>,
    ) -> Result<()> {
        msg!(
            "mock route: authority={} in={} out={} amount_in={} min_out={} feeBps={}",
            ctx.accounts.transfer_authority.key(),
            input_mint,
            output_mint,
            amount_in,
            min_amount_out,
            integrator_fee_bps
        );
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Route<'info> {
    /// The user_transfer_authority. MUST be a signer — this is the mock's
    /// stand-in for "funds only move under the caller's authority".
    pub transfer_authority: Signer<'info>,
}
