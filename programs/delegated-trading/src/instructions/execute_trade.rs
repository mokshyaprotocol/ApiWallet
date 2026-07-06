//! `execute_trade` — the *only* action the session key can perform.
//!
//! ## Security model
//!
//! The single most important guarantee of this program is this: when we CPI
//! into Jupiter we call [`invoke_signed`] lending **only** the
//! [`TradingSession`] PDA's signature. We never sign as the owner and never
//! sign for any other account. Therefore the swap can only move funds whose
//! authority is the session PDA (a program-custodied vault) — it is physically
//! impossible for a crafted route to drain the owner's main wallet, close an
//! arbitrary account, or reassign an authority, because those actions would
//! require a signature we do not provide.
//!
//! On top of that hard floor we layer policy checks: the target program must be
//! Jupiter v6 *and* allowlisted, the input/output mints must be allowlisted, the
//! amount must respect the per-trade and rolling daily caps, and a caller-
//! supplied nonce must match the on-chain nonce (replay protection).

use crate::constants::*;
use crate::errors::TradingError;
use crate::events::{TradeExecuted, TradeRejected};
use crate::state::TradingSession;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::program::invoke_signed;

#[derive(Accounts)]
pub struct ExecuteTrade<'info> {
    /// The delegated session key. Must equal `session.session_pubkey`.
    /// This is the only signer the *user* provides; the owner is absent.
    pub session_signer: Signer<'info>,

    #[account(
        mut,
        seeds = [
            SESSION_SEED,
            session.owner.as_ref(),
            session.session_pubkey.as_ref(),
        ],
        bump = session.bump,
    )]
    pub session: Account<'info, TradingSession>,

    /// CHECK: validated by pubkey equality against `JUPITER_V6_PROGRAM_ID`
    /// below. This is the program we CPI into; it is executable and untrusted
    /// beyond that identity check.
    pub jupiter_program: UncheckedAccount<'info>,
    // All accounts the Jupiter route requires are passed as `remaining_accounts`.
}

/// Emit a rejection event, then return the error. Keeps the failure observable
/// off-chain even though the transaction reverts.
fn reject(session: &Pubkey, signer: &Pubkey, err: TradingError, now: i64) -> Error {
    emit!(TradeRejected {
        session: *session,
        session_pubkey: *signer,
        reason: err as u32,
        timestamp: now,
    });
    err.into()
}

pub fn handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, ExecuteTrade<'info>>,
    amount_in: u64,
    input_mint: Pubkey,
    output_mint: Pubkey,
    expected_nonce: u64,
    route_data: Vec<u8>,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let session_key = ctx.accounts.session.key();
    let signer_key = ctx.accounts.session_signer.key();

    // Snapshot immutable checks first (immutable borrow of `session`).
    {
        let session = &ctx.accounts.session;

        // 1. Signer must be the authorized session key.
        if signer_key != session.session_pubkey {
            return Err(reject(
                &session_key,
                &signer_key,
                TradingError::UnauthorizedSessionKey,
                now,
            ));
        }

        // 2. Session must be active (not revoked, not expired).
        if session.revoked {
            return Err(reject(
                &session_key,
                &signer_key,
                TradingError::SessionRevoked,
                now,
            ));
        }
        if session.is_expired(now) {
            return Err(reject(
                &session_key,
                &signer_key,
                TradingError::SessionExpired,
                now,
            ));
        }

        // 3. Replay guard: the caller must pin the current nonce.
        if expected_nonce != session.nonce {
            return Err(reject(
                &session_key,
                &signer_key,
                TradingError::InvalidNonce,
                now,
            ));
        }

        // 4. Amount bounds.
        if amount_in == 0 {
            return Err(reject(
                &session_key,
                &signer_key,
                TradingError::InvalidTradeAmount,
                now,
            ));
        }
        if amount_in > session.max_trade_amount {
            return Err(reject(
                &session_key,
                &signer_key,
                TradingError::TradeLimitExceeded,
                now,
            ));
        }

        // 5. CPI target must be Jupiter v6 *and* on the owner's allowlist.
        let target_program = ctx.accounts.jupiter_program.key();
        if target_program != JUPITER_V6_PROGRAM_ID {
            return Err(reject(
                &session_key,
                &signer_key,
                TradingError::ProgramNotAllowed,
                now,
            ));
        }
        if !session.is_program_allowed(&target_program) {
            return Err(reject(
                &session_key,
                &signer_key,
                TradingError::ProgramNotAllowed,
                now,
            ));
        }

        // 6. Mint allowlists.
        if !session.is_input_allowed(&input_mint) {
            return Err(reject(
                &session_key,
                &signer_key,
                TradingError::TokenNotAllowed,
                now,
            ));
        }
        if !session.is_output_allowed(&output_mint) {
            return Err(reject(
                &session_key,
                &signer_key,
                TradingError::TokenNotAllowed,
                now,
            ));
        }
    }

    // 7. Apply accounting (mutable borrow). This enforces the daily cap and
    //    advances the nonce so the exact same call can never replay.
    {
        let session = &mut ctx.accounts.session;
        session
            .record_trade(amount_in, now)
            .map_err(|_| reject(&session_key, &signer_key, TradingError::DailyLimitExceeded, now))?;
    }

    // 8. Perform the swap CPI, signing ONLY as the session PDA. Build the
    //    instruction from the untrusted route bytes and the remaining accounts,
    //    preserving each account's signer/writable flags.
    let account_metas: Vec<AccountMeta> = ctx
        .remaining_accounts
        .iter()
        .map(|acc| {
            // The session PDA is the swap's transfer authority. It cannot sign
            // at the transaction level (no private key), so callers pass it as a
            // non-signer; we elevate it to a signer here and satisfy the
            // signature via `invoke_signed`. This is the ONLY account we ever
            // lend a signature to — hence the only funds that can move are those
            // whose authority is this PDA.
            let is_signer = acc.is_signer || *acc.key == session_key;
            if acc.is_writable {
                AccountMeta::new(*acc.key, is_signer)
            } else {
                AccountMeta::new_readonly(*acc.key, is_signer)
            }
        })
        .collect();

    let ix = Instruction {
        program_id: ctx.accounts.jupiter_program.key(),
        accounts: account_metas,
        data: route_data,
    };

    let owner = ctx.accounts.session.owner;
    let session_pubkey = ctx.accounts.session.session_pubkey;
    let bump = ctx.accounts.session.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[
        SESSION_SEED,
        owner.as_ref(),
        session_pubkey.as_ref(),
        &[bump],
    ]];

    invoke_signed(&ix, ctx.remaining_accounts, signer_seeds)?;

    // 9. Success event with the post-trade nonce and daily volume.
    let session = &ctx.accounts.session;
    emit!(TradeExecuted {
        session: session_key,
        session_pubkey: signer_key,
        program_id: ctx.accounts.jupiter_program.key(),
        input_mint,
        output_mint,
        amount_in,
        nonce: session.nonce,
        daily_volume_used: session.daily_volume_used,
        timestamp: now,
    });

    Ok(())
}
