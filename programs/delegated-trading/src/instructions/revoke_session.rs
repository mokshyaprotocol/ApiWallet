//! `revoke_session` — the owner permanently disables a session.
//!
//! Revocation is a one-way latch. We intentionally do **not** close the account
//! so the historical record (nonce, volume, owner) remains queryable and the
//! same PDA can never be silently re-created with different terms.

use crate::errors::TradingError;
use crate::events::SessionRevoked;
use crate::state::TradingSession;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct RevokeSession<'info> {
    pub owner: Signer<'info>,

    #[account(
        mut,
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

pub fn handler(ctx: Context<RevokeSession>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let session = &mut ctx.accounts.session;

    // Idempotency guard: revoking twice is a no-op error rather than silent.
    require!(!session.revoked, TradingError::SessionRevoked);

    session.revoked = true;

    emit!(SessionRevoked {
        session: session.key(),
        owner: session.owner,
        revoked_at: now,
    });

    Ok(())
}
