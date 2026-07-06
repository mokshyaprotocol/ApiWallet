//! Test-only mock of the Jupiter v6 aggregator.
//!
//! Its sole job is to prove that `delegated_trading::execute_trade` reaches the
//! CPI and that it does so **signed by the TradingSession PDA**. The `swap`
//! instruction therefore requires its `transfer_authority` account to be a
//! signer — exactly the property that guarantees only PDA-custodied funds can
//! move. If `execute_trade` failed to `invoke_signed`, this program would abort
//! with `MissingRequiredSignature`.
//!
//! This crate is never deployed to mainnet.

use anchor_lang::prelude::*;

declare_id!("4oVmoU4zT21MVgFdTp5N5AayCvMsXZDGE5Xq7QZQvjrN");

#[program]
pub mod mock_jupiter {
    use super::*;

    /// Simulate a swap. Records nothing; just asserts the transfer authority
    /// signed and echoes the amounts to the log.
    pub fn swap(ctx: Context<Swap>, amount_in: u64, min_amount_out: u64) -> Result<()> {
        msg!(
            "mock jupiter swap: authority={} amount_in={} min_out={}",
            ctx.accounts.transfer_authority.key(),
            amount_in,
            min_amount_out
        );
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Swap<'info> {
    /// The user_transfer_authority. MUST be a signer — this is the mock's
    /// stand-in for "funds only move under the caller's authority".
    pub transfer_authority: Signer<'info>,
}
