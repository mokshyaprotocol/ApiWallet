//! On-chain account state.

use crate::constants::*;
use crate::errors::TradingError;
use anchor_lang::prelude::*;

/// A delegated trading session.
///
/// The account is a PDA derived from `[SESSION_SEED, owner, session_pubkey]`.
/// It grants a **session key** the ability to execute *only* pre-approved swap
/// operations on behalf of the `owner`, within hard limits. The session key
/// never gains custody: it cannot transfer, close, or re-authorize anything.
#[account]
#[derive(Default, Debug)]
pub struct TradingSession {
    /// The wallet that created and controls the session. Immutable.
    pub owner: Pubkey,
    /// The delegated key permitted to call `execute_trade`. Immutable.
    pub session_pubkey: Pubkey,
    /// Unix timestamp at creation.
    pub created_at: i64,
    /// Unix timestamp after which the session is inert.
    pub expires_at: i64,
    /// When true, the session is permanently disabled.
    pub revoked: bool,
    /// Maximum notional (in input-token base units) per single trade.
    pub max_trade_amount: u64,
    /// Maximum cumulative notional per rolling 24h window.
    pub daily_trade_limit: u64,
    /// Volume consumed in the current daily window.
    pub daily_volume_used: u64,
    /// Start of the current daily window; used to roll `daily_volume_used`.
    pub daily_window_start: i64,
    /// Programs the session key may CPI into (subset check + router floor).
    pub allowed_programs: Vec<Pubkey>,
    /// Permitted input mints.
    pub allowed_input_tokens: Vec<Pubkey>,
    /// Permitted output mints.
    pub allowed_output_tokens: Vec<Pubkey>,
    /// Monotonic counter incremented on every successful trade. Replay guard.
    pub nonce: u64,
    /// PDA bump.
    pub bump: u8,
}

impl TradingSession {
    /// Space for the account, sized for the maximum allowlist lengths so the
    /// account never needs a realloc when an owner grows a list via
    /// `update_session`.
    pub const MAX_SIZE: usize = 8   // discriminator
        + 32                        // owner
        + 32                        // session_pubkey
        + 8                         // created_at
        + 8                         // expires_at
        + 1                         // revoked
        + 8                         // max_trade_amount
        + 8                         // daily_trade_limit
        + 8                         // daily_volume_used
        + 8                         // daily_window_start
        + (4 + 32 * MAX_ALLOWED_PROGRAMS)       // allowed_programs
        + (4 + 32 * MAX_ALLOWED_INPUT_TOKENS)   // allowed_input_tokens
        + (4 + 32 * MAX_ALLOWED_OUTPUT_TOKENS)  // allowed_output_tokens
        + 8                         // nonce
        + 1; // bump

    /// True if `now` is past the expiry.
    pub fn is_expired(&self, now: i64) -> bool {
        now >= self.expires_at
    }

    /// Assert the session is currently usable for trading.
    pub fn assert_active(&self, now: i64) -> Result<()> {
        require!(!self.revoked, TradingError::SessionRevoked);
        require!(!self.is_expired(now), TradingError::SessionExpired);
        Ok(())
    }

    pub fn is_program_allowed(&self, program: &Pubkey) -> bool {
        self.allowed_programs.contains(program)
    }

    pub fn is_input_allowed(&self, mint: &Pubkey) -> bool {
        self.allowed_input_tokens.contains(mint)
    }

    pub fn is_output_allowed(&self, mint: &Pubkey) -> bool {
        self.allowed_output_tokens.contains(mint)
    }

    /// Roll the daily window if `now` has crossed into a new one, resetting the
    /// consumed volume. Idempotent within a window.
    pub fn maybe_roll_daily_window(&mut self, now: i64) {
        if now.saturating_sub(self.daily_window_start) >= DAILY_WINDOW_SECONDS {
            self.daily_window_start = now;
            self.daily_volume_used = 0;
        }
    }

    /// Apply the accounting for a trade of `amount` after all validation has
    /// passed. Rolls the daily window, enforces the daily cap, then bumps the
    /// nonce and the consumed volume — all with checked arithmetic.
    pub fn record_trade(&mut self, amount: u64, now: i64) -> Result<()> {
        self.maybe_roll_daily_window(now);

        let projected = self
            .daily_volume_used
            .checked_add(amount)
            .ok_or(TradingError::Overflow)?;
        require!(
            projected <= self.daily_trade_limit,
            TradingError::DailyLimitExceeded
        );

        self.daily_volume_used = projected;
        self.nonce = self.nonce.checked_add(1).ok_or(TradingError::Overflow)?;
        Ok(())
    }
}

/// Validate a candidate set of allowlists and limits. Shared by
/// `create_session` and `update_session` so both entry points enforce the
/// exact same invariants.
pub fn validate_config(
    expires_at: i64,
    now: i64,
    max_trade_amount: u64,
    daily_trade_limit: u64,
    allowed_programs: &[Pubkey],
    allowed_input_tokens: &[Pubkey],
    allowed_output_tokens: &[Pubkey],
) -> Result<()> {
    require!(expires_at > now, TradingError::InvalidExpiry);
    require!(max_trade_amount > 0, TradingError::InvalidTradeAmount);
    require!(
        daily_trade_limit >= max_trade_amount,
        TradingError::InvalidLimits
    );

    validate_allowlist(allowed_programs, MAX_ALLOWED_PROGRAMS)?;
    validate_allowlist(allowed_input_tokens, MAX_ALLOWED_INPUT_TOKENS)?;
    validate_allowlist(allowed_output_tokens, MAX_ALLOWED_OUTPUT_TOKENS)?;

    // A session must at minimum permit our aggregator router, or it can never
    // trade (it is the only program `execute_trade` will CPI into).
    require!(
        allowed_programs.contains(&ROUTER_PROGRAM_ID),
        TradingError::ProgramNotAllowed
    );

    Ok(())
}

fn validate_allowlist(list: &[Pubkey], max: usize) -> Result<()> {
    require!(!list.is_empty(), TradingError::AllowlistEmpty);
    require!(list.len() <= max, TradingError::AllowlistTooLong);
    // Reject duplicates (O(n^2) is fine for these tiny lists).
    for (i, a) in list.iter().enumerate() {
        for b in list.iter().skip(i + 1) {
            require!(a != b, TradingError::DuplicateAllowlistEntry);
        }
    }
    Ok(())
}
