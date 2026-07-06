//! `update_session` — the owner adjusts limits, expiry, and allowlists.
//!
//! The owner and session key are **never** mutable here: the PDA seeds bind
//! both, so a change would require a different account. Only the tunable policy
//! fields can move.

use crate::errors::TradingError;
use crate::events::SessionUpdated;
use crate::state::{validate_config, TradingSession};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct UpdateSession<'info> {
    pub owner: Signer<'info>,

    #[account(
        mut,
        // `has_one` re-checks the stored owner against the signer, so a
        // different signer with a look-alike PDA cannot mutate this session.
        has_one = owner @ TradingError::InvalidOwner,
        seeds = [
            crate::constants::SESSION_SEED,
            owner.key().as_ref(),
            session.session_pubkey.as_ref(),
        ],
        bump = session.bump,
    )]
    pub session: Account<'info, TradingSession>,
}

/// All fields are optional; `None` leaves the existing value untouched.
#[allow(clippy::too_many_arguments)]
pub fn handler(
    ctx: Context<UpdateSession>,
    expires_at: Option<i64>,
    max_trade_amount: Option<u64>,
    daily_trade_limit: Option<u64>,
    allowed_programs: Option<Vec<Pubkey>>,
    allowed_input_tokens: Option<Vec<Pubkey>>,
    allowed_output_tokens: Option<Vec<Pubkey>>,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let session = &mut ctx.accounts.session;

    // A revoked session is terminal — it cannot be reconfigured back to life.
    require!(!session.revoked, TradingError::SessionRevoked);

    // Compute the candidate values, then validate the whole set atomically so
    // partial updates can never leave the session in an invalid state.
    let new_expires_at = expires_at.unwrap_or(session.expires_at);
    let new_max = max_trade_amount.unwrap_or(session.max_trade_amount);
    let new_daily = daily_trade_limit.unwrap_or(session.daily_trade_limit);
    let new_programs = allowed_programs.unwrap_or_else(|| session.allowed_programs.clone());
    let new_inputs = allowed_input_tokens.unwrap_or_else(|| session.allowed_input_tokens.clone());
    let new_outputs =
        allowed_output_tokens.unwrap_or_else(|| session.allowed_output_tokens.clone());

    validate_config(
        new_expires_at,
        now,
        new_max,
        new_daily,
        &new_programs,
        &new_inputs,
        &new_outputs,
    )?;

    session.expires_at = new_expires_at;
    session.max_trade_amount = new_max;
    session.daily_trade_limit = new_daily;
    session.allowed_programs = new_programs;
    session.allowed_input_tokens = new_inputs;
    session.allowed_output_tokens = new_outputs;

    emit!(SessionUpdated {
        session: session.key(),
        owner: session.owner,
        expires_at: session.expires_at,
        max_trade_amount: session.max_trade_amount,
        daily_trade_limit: session.daily_trade_limit,
    });

    Ok(())
}
