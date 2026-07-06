//! `create_session` — an owner mints a new delegated trading session.

use crate::constants::*;
use crate::events::SessionCreated;
use crate::state::{validate_config, TradingSession};
use anchor_lang::prelude::*;

#[derive(Accounts)]
#[instruction(session_pubkey: Pubkey)]
pub struct CreateSession<'info> {
    /// The owner. Pays for and signs creation; becomes the immutable authority.
    #[account(mut)]
    pub owner: Signer<'info>,

    /// The session PDA, unique per `(owner, session_pubkey)`.
    #[account(
        init,
        payer = owner,
        space = TradingSession::MAX_SIZE,
        seeds = [SESSION_SEED, owner.key().as_ref(), session_pubkey.as_ref()],
        bump
    )]
    pub session: Account<'info, TradingSession>,

    pub system_program: Program<'info, System>,
}

#[allow(clippy::too_many_arguments)]
pub fn handler(
    ctx: Context<CreateSession>,
    session_pubkey: Pubkey,
    expires_at: i64,
    max_trade_amount: u64,
    daily_trade_limit: u64,
    allowed_programs: Vec<Pubkey>,
    allowed_input_tokens: Vec<Pubkey>,
    allowed_output_tokens: Vec<Pubkey>,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;

    // Enforce every configuration invariant up front.
    validate_config(
        expires_at,
        now,
        max_trade_amount,
        daily_trade_limit,
        &allowed_programs,
        &allowed_input_tokens,
        &allowed_output_tokens,
    )?;

    let session = &mut ctx.accounts.session;
    session.owner = ctx.accounts.owner.key();
    session.session_pubkey = session_pubkey;
    session.created_at = now;
    session.expires_at = expires_at;
    session.revoked = false;
    session.max_trade_amount = max_trade_amount;
    session.daily_trade_limit = daily_trade_limit;
    session.daily_volume_used = 0;
    session.daily_window_start = now;
    session.allowed_programs = allowed_programs;
    session.allowed_input_tokens = allowed_input_tokens;
    session.allowed_output_tokens = allowed_output_tokens;
    session.nonce = 0;
    session.bump = ctx.bumps.session;

    emit!(SessionCreated {
        session: session.key(),
        owner: session.owner,
        session_pubkey: session.session_pubkey,
        created_at: session.created_at,
        expires_at: session.expires_at,
        max_trade_amount: session.max_trade_amount,
        daily_trade_limit: session.daily_trade_limit,
    });

    Ok(())
}
