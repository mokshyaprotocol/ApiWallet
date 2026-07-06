//! Error codes surfaced by the delegated trading program.

use anchor_lang::prelude::*;

#[error_code]
pub enum TradingError {
    #[msg("The trading session has expired")]
    SessionExpired,

    #[msg("The trading session has been revoked")]
    SessionRevoked,

    #[msg("The provided signer is not the authorized session key")]
    UnauthorizedSessionKey,

    #[msg("The target program is not in the session allowlist")]
    ProgramNotAllowed,

    #[msg("The input or output token is not in the session allowlist")]
    TokenNotAllowed,

    #[msg("Trade amount exceeds the per-trade maximum")]
    TradeLimitExceeded,

    #[msg("Trade would exceed the rolling daily volume limit")]
    DailyLimitExceeded,

    #[msg("The instruction or CPI target is not permitted for this session")]
    InvalidInstruction,

    #[msg("Only the session owner may perform this action")]
    InvalidOwner,

    #[msg("Arithmetic overflow")]
    Overflow,

    // --- Additional guards required for a safe implementation ---
    #[msg("Trade amount must be greater than zero")]
    InvalidTradeAmount,

    #[msg("Expiry must be in the future")]
    InvalidExpiry,

    #[msg("An allowlist exceeds its maximum permitted length")]
    AllowlistTooLong,

    #[msg("An allowlist must not be empty")]
    AllowlistEmpty,

    #[msg("The daily trade limit must be greater than or equal to the max trade amount")]
    InvalidLimits,

    #[msg("Provided nonce does not match the session nonce (possible replay)")]
    InvalidNonce,

    #[msg("Duplicate entry in an allowlist")]
    DuplicateAllowlistEntry,

    #[msg("Missing a required account for the CPI")]
    MissingAccount,
}
