//! `route` — execute a pre-computed swap route atomically across venues.
//!
//! ## Model
//!
//! The off-chain route-finder decides the plan: an ordered list of `SwapLeg`s
//! (a leg = one CPI into one venue). Sequential legs are multi-hop; several legs
//! producing the same output token are a split. Each leg carries:
//!   - `venue`: selects the CPI target program from the on-chain allowlist,
//!   - `account_offset`/`account_len`: the slice of `remaining_accounts` that
//!     venue's instruction needs (built off-chain),
//!   - `data`: the venue's raw instruction bytes (built off-chain).
//!
//! ## Guarantees the *program* enforces (independent of the route-finder)
//!
//! 1. **Allowlist** — a leg can only CPI into a known venue program (the `Venue`
//!    enum). Nothing else is reachable.
//! 2. **Slippage** — the output token account must increase by at least
//!    `min_amount_out`, measured as a real balance delta *after* all legs. This
//!    holds even if a venue misbehaves or the caller is sandwiched.
//! 3. **Signature scope** — the router lends no signatures of its own; account
//!    signer flags are forwarded as-is, so the authority that signed this
//!    instruction (a user, or the api-wallet session PDA via `execute_trade`) is
//!    the only signer the venues receive.

use crate::constants::Venue;
use crate::errors::RouterError;
use crate::events::RouteExecuted;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::program::invoke;

/// Hard cap on legs per route — bounds compute and account fan-out.
pub const MAX_LEGS: usize = 8;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct SwapLeg {
    /// Venue selector (see `Venue`).
    pub venue: u8,
    /// Start index into `remaining_accounts` for this leg's accounts.
    pub account_offset: u16,
    /// Number of accounts this leg consumes.
    pub account_len: u16,
    /// Raw instruction data for the venue's swap, built off-chain.
    pub data: Vec<u8>,
}

#[derive(Accounts)]
pub struct Route<'info> {
    /// Whoever authorizes the swap. Either a user (direct call) or the
    /// api-wallet session PDA (when invoked via `execute_trade`). The router
    /// forwards its signer privilege to the venues but never adds its own.
    pub authority: Signer<'info>,

    /// CHECK: an SPL token account for the route's output token. The router
    /// only reads its `amount` (offset 64) before/after to enforce slippage; it
    /// does not assume ownership of it. Marked mut because venues write to it.
    #[account(mut)]
    pub output_token_account: UncheckedAccount<'info>,
    // All venue accounts follow as `remaining_accounts`, sliced per leg.
}

/// Read the SPL-token `amount` field (u64 LE at offset 64).
fn read_token_amount(ai: &AccountInfo) -> Result<u64> {
    let data = ai.try_borrow_data()?;
    require!(data.len() >= 72, RouterError::BadTokenAccount);
    let mut b = [0u8; 8];
    b.copy_from_slice(&data[64..72]);
    Ok(u64::from_le_bytes(b))
}

pub fn handler(ctx: Context<Route>, amount_in: u64, min_amount_out: u64, legs: Vec<SwapLeg>) -> Result<()> {
    require!(!legs.is_empty(), RouterError::EmptyRoute);
    require!(legs.len() <= MAX_LEGS, RouterError::TooManyLegs);
    require!(amount_in > 0, RouterError::ZeroAmount);

    let infos = ctx.remaining_accounts;
    let output_ai = ctx.accounts.output_token_account.to_account_info();

    // Snapshot output balance before any leg runs.
    let before = read_token_amount(&output_ai)?;

    // Execute each leg as a CPI into its (allowlisted) venue.
    for leg in legs.iter() {
        let venue = Venue::from_u8(leg.venue)?;
        let program_id = venue.program_id()?;

        let start = leg.account_offset as usize;
        let end = start
            .checked_add(leg.account_len as usize)
            .ok_or(RouterError::Overflow)?;
        require!(end <= infos.len(), RouterError::AccountRangeOutOfBounds);

        let slice = &infos[start..end];
        let metas: Vec<AccountMeta> = slice
            .iter()
            .map(|ai| AccountMeta {
                pubkey: *ai.key,
                is_signer: ai.is_signer,
                is_writable: ai.is_writable,
            })
            .collect();

        let ix = Instruction {
            program_id,
            accounts: metas,
            data: leg.data.clone(),
        };

        // Pass the full remaining-accounts pool as the info set; it is a
        // superset of the leg's accounts and contains the venue program.
        invoke(&ix, infos)?;
    }

    // Enforce slippage on the real balance delta — the router's core promise.
    let after = read_token_amount(&output_ai)?;
    let received = after.checked_sub(before).ok_or(RouterError::Overflow)?;
    require!(received >= min_amount_out, RouterError::SlippageExceeded);

    emit!(RouteExecuted {
        authority: ctx.accounts.authority.key(),
        output_mint_account: output_ai.key(),
        amount_in,
        amount_out: received,
        min_amount_out,
        num_legs: legs.len() as u8,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}
