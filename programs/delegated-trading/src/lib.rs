//! # Delegated Trading Session Protocol
//!
//! A Solana program that lets a wallet (`owner`) grant a **session key** the
//! ability to execute a narrow, pre-approved set of swaps on its behalf —
//! without ever exposing the owner's private key and without ever granting
//! custody.
//!
//! ## What a session key can do
//! * Exactly one action: [`execute_trade`], which routes a swap through our own
//!   `aggregator_router` (best-price execution across Raydium/Meteora/Pump),
//!   respecting the session's allowlists and volume limits.
//!
//! ## What a session key can *never* do
//! * `SystemProgram::Transfer`, SPL token transfers, closing accounts, changing
//!   authorities, arbitrary CPI, or withdrawing SOL/tokens.
//!
//! These are not merely "not implemented" — they are structurally impossible:
//! the program only ever lends the session PDA's signature to a CPI, and only
//! to the verified aggregator router. See [`instructions::execute_trade`] for
//! the full argument.
//!
//! ## Lifecycle (owner-only)
//! [`create_session`] → [`update_session`]* → [`revoke_session`].

use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("HgUSLposEwz5MnUV6SFABbxVHmSZ1dkbuowWsjAe1s2E");

#[program]
pub mod delegated_trading {
    use super::*;

    /// Create a new delegated trading session. Signer must be the owner.
    #[allow(clippy::too_many_arguments)]
    pub fn create_session(
        ctx: Context<CreateSession>,
        session_pubkey: Pubkey,
        expires_at: i64,
        max_trade_amount: u64,
        daily_trade_limit: u64,
        allowed_programs: Vec<Pubkey>,
        allowed_input_tokens: Vec<Pubkey>,
        allowed_output_tokens: Vec<Pubkey>,
    ) -> Result<()> {
        create_session::handler(
            ctx,
            session_pubkey,
            expires_at,
            max_trade_amount,
            daily_trade_limit,
            allowed_programs,
            allowed_input_tokens,
            allowed_output_tokens,
        )
    }

    /// Update tunable session policy (limits, expiry, allowlists). Owner only.
    /// Owner and session key are immutable (bound by the PDA seeds).
    #[allow(clippy::too_many_arguments)]
    pub fn update_session(
        ctx: Context<UpdateSession>,
        expires_at: Option<i64>,
        max_trade_amount: Option<u64>,
        daily_trade_limit: Option<u64>,
        allowed_programs: Option<Vec<Pubkey>>,
        allowed_input_tokens: Option<Vec<Pubkey>>,
        allowed_output_tokens: Option<Vec<Pubkey>>,
    ) -> Result<()> {
        update_session::handler(
            ctx,
            expires_at,
            max_trade_amount,
            daily_trade_limit,
            allowed_programs,
            allowed_input_tokens,
            allowed_output_tokens,
        )
    }

    /// Permanently revoke a session. Owner only. One-way latch.
    pub fn revoke_session(ctx: Context<RevokeSession>) -> Result<()> {
        revoke_session::handler(ctx)
    }

    /// Execute an approved swap via the aggregator router. Signer must be the session key.
    /// The only instruction the session key is authorized to call.
    pub fn execute_trade<'info>(
        ctx: Context<'_, '_, 'info, 'info, ExecuteTrade<'info>>,
        amount_in: u64,
        input_mint: Pubkey,
        output_mint: Pubkey,
        expected_nonce: u64,
        route_data: Vec<u8>,
    ) -> Result<()> {
        execute_trade::handler(
            ctx,
            amount_in,
            input_mint,
            output_mint,
            expected_nonce,
            route_data,
        )
    }
}
