//! `route` — execute a pre-computed swap route atomically across venues, with a
//! Jupiter/DFlow-style fee model.
//!
//! ## Model
//!
//! The off-chain route-finder decides the plan: an ordered list of `SwapLeg`s
//! (a leg = one CPI into one venue). Sequential legs are multi-hop; several legs
//! producing the same output token are a split. Each leg carries `venue` (the
//! allowlisted CPI target), `account_offset`/`account_len` (its slice of
//! `remaining_accounts`), and `data` (the venue swap bytes).
//!
//! ## Fees (skimmed from the output token, like Jupiter `platformFeeBps` / DFlow)
//!
//! * **Integrator fee** — a third party integrating the router sets
//!   `integrator_fee_bps` (capped at [`MAX_INTEGRATOR_FEE_BPS`]) and provides
//!   `integrator_fee_account`; the fee is sent there.
//! * **Protocol fee** — a fixed [`PROTOCOL_FEE_BPS`] is skimmed to
//!   `protocol_fee_account`, which MUST be owned by [`PROTOCOL_FEE_RECIPIENT`]
//!   so an integrator can't redirect our cut.
//!
//! `min_amount_out` is enforced on the NET output (after both fees).
//!
//! ## Guarantees enforced regardless of the route-finder
//! 1. Allowlist — legs can only CPI known venue programs.
//! 2. Slippage — enforced on the real net balance delta.
//! 3. Signature scope — the router lends no signature of its own.

use crate::constants::*;
use crate::errors::RouterError;
use crate::events::RouteExecuted;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::program::invoke;

/// Hard cap on legs per route — bounds compute and account fan-out.
pub const MAX_LEGS: usize = 8;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct SwapLeg {
    pub venue: u8,
    pub account_offset: u16,
    pub account_len: u16,
    pub data: Vec<u8>,
}

#[derive(Accounts)]
pub struct Route<'info> {
    /// Whoever authorizes the swap (user, or the api-wallet session PDA via
    /// `execute_trade`). Also the token authority for the fee transfers.
    pub authority: Signer<'info>,

    /// CHECK: SPL token account the input is spent from; router reads its mint
    /// (offset 0) and `amount` delta to bind `input_mint` and cap `amount_in`.
    #[account(mut)]
    pub input_token_account: UncheckedAccount<'info>,

    /// CHECK: the output token's mint account. Verified to equal `output_mint`;
    /// its `decimals` are used for `transferChecked` fee transfers (so
    /// Token-2022 fee-extension mints work). Read-only.
    pub output_mint_account: UncheckedAccount<'info>,

    /// CHECK: SPL token account for the output token; router reads its `amount`
    /// (offset 64) before/after and skims fees out of it. Mut: venues + fee
    /// transfers write to it.
    #[account(mut)]
    pub output_token_account: UncheckedAccount<'info>,

    /// CHECK: SPL Token program used for the fee transfers.
    pub token_program: UncheckedAccount<'info>,

    /// CHECK: protocol fee destination (output-mint token account). Verified to
    /// be owned by `PROTOCOL_FEE_RECIPIENT` before any transfer.
    #[account(mut)]
    pub protocol_fee_account: UncheckedAccount<'info>,

    /// CHECK: integrator fee destination (output-mint token account). Only used
    /// when `integrator_fee_bps > 0`.
    #[account(mut)]
    pub integrator_fee_account: UncheckedAccount<'info>,
    // Venue accounts follow as `remaining_accounts`, sliced per leg.
}

/// SPL-token `amount` (u64 LE at offset 64).
fn read_token_amount(ai: &AccountInfo) -> Result<u64> {
    let data = ai.try_borrow_data()?;
    require!(data.len() >= 72, RouterError::BadTokenAccount);
    let mut b = [0u8; 8];
    b.copy_from_slice(&data[64..72]);
    Ok(u64::from_le_bytes(b))
}

/// SPL-token `owner` (Pubkey at offset 32).
fn read_token_owner(ai: &AccountInfo) -> Result<Pubkey> {
    let data = ai.try_borrow_data()?;
    require!(data.len() >= 64, RouterError::BadTokenAccount);
    Ok(Pubkey::try_from(&data[32..64]).map_err(|_| RouterError::BadTokenAccount)?)
}

/// SPL-token `mint` (Pubkey at offset 0).
fn read_token_mint(ai: &AccountInfo) -> Result<Pubkey> {
    let data = ai.try_borrow_data()?;
    require!(data.len() >= 32, RouterError::BadTokenAccount);
    Ok(Pubkey::try_from(&data[0..32]).map_err(|_| RouterError::BadTokenAccount)?)
}

/// SPL mint `decimals` (u8 at offset 44). Shared by classic + Token-2022 base.
fn read_mint_decimals(ai: &AccountInfo) -> Result<u8> {
    let data = ai.try_borrow_data()?;
    require!(data.len() >= 45, RouterError::BadTokenAccount);
    Ok(data[44])
}

fn fee_amount(gross: u64, bps: u16) -> u64 {
    ((gross as u128 * bps as u128) / BPS_DENOMINATOR as u128) as u64
}

/// CPI an SPL-Token `TransferChecked` (tag 12) of `amount` from `source` to
/// `dest`, signed by `authority`. Using the checked variant (with the mint +
/// decimals) makes fee transfers work for Token-2022 fee-extension mints, where
/// the plain `Transfer` is disabled.
#[allow(clippy::too_many_arguments)]
fn transfer_checked<'info>(
    token_program: &AccountInfo<'info>,
    source: &AccountInfo<'info>,
    mint: &AccountInfo<'info>,
    dest: &AccountInfo<'info>,
    authority: &AccountInfo<'info>,
    amount: u64,
    decimals: u8,
) -> Result<()> {
    let mut data = Vec::with_capacity(10);
    data.push(12u8); // TransferChecked
    data.extend_from_slice(&amount.to_le_bytes());
    data.push(decimals);
    let ix = Instruction {
        program_id: *token_program.key,
        accounts: vec![
            AccountMeta::new(*source.key, false),
            AccountMeta::new_readonly(*mint.key, false),
            AccountMeta::new(*dest.key, false),
            AccountMeta::new_readonly(*authority.key, true),
        ],
        data,
    };
    invoke(&ix, &[source.clone(), mint.clone(), dest.clone(), authority.clone(), token_program.clone()])?;
    Ok(())
}

pub fn handler(
    ctx: Context<Route>,
    input_mint: Pubkey,
    output_mint: Pubkey,
    amount_in: u64,
    min_amount_out: u64,
    integrator_fee_bps: u16,
    legs: Vec<SwapLeg>,
) -> Result<()> {
    require!(!legs.is_empty(), RouterError::EmptyRoute);
    require!(legs.len() <= MAX_LEGS, RouterError::TooManyLegs);
    require!(amount_in > 0, RouterError::ZeroAmount);
    require!(integrator_fee_bps <= MAX_INTEGRATOR_FEE_BPS, RouterError::IntegratorFeeTooHigh);

    let infos = ctx.remaining_accounts;
    let input_ai = ctx.accounts.input_token_account.to_account_info();
    let output_ai = ctx.accounts.output_token_account.to_account_info();

    // Bind the swap to the declared mints (so the caller's limits/allowlists,
    // which are enforced against these mints upstream, actually govern the swap).
    require!(read_token_mint(&input_ai)? == input_mint, RouterError::InputMintMismatch);
    require!(read_token_mint(&output_ai)? == output_mint, RouterError::OutputMintMismatch);
    let mint_ai = ctx.accounts.output_mint_account.to_account_info();
    require!(mint_ai.key() == output_mint, RouterError::OutputMintMismatch);

    // SECURITY: input and output must be the authority's own token accounts.
    // Enforce this explicitly (not just implicitly via the fee transfer, which
    // is skipped when the fee rounds to 0) — otherwise a caller could route the
    // output to a foreign account (exfiltrating the swapped funds).
    let authority_key = ctx.accounts.authority.key();
    require!(read_token_owner(&input_ai)? == authority_key, RouterError::BadTokenOwner);
    require!(read_token_owner(&output_ai)? == authority_key, RouterError::BadTokenOwner);

    let input_before = read_token_amount(&input_ai)?;
    let before = read_token_amount(&output_ai)?;

    // Execute each leg as a CPI into its (allowlisted) venue.
    for leg in legs.iter() {
        let venue = Venue::from_u8(leg.venue)?;
        // V-1: only allow known *swap* instructions for the venue.
        require!(venue.is_allowed_swap_ix(&leg.data), RouterError::DisallowedInstruction);
        let program_id = venue.program_id()?;
        let start = leg.account_offset as usize;
        let end = start.checked_add(leg.account_len as usize).ok_or(RouterError::Overflow)?;
        require!(end <= infos.len(), RouterError::AccountRangeOutOfBounds);
        let metas: Vec<AccountMeta> = infos[start..end]
            .iter()
            .map(|ai| AccountMeta { pubkey: *ai.key, is_signer: ai.is_signer, is_writable: ai.is_writable })
            .collect();
        invoke(&Instruction { program_id, accounts: metas, data: leg.data.clone() }, infos)?;
    }

    // Cap the input actually spent — binds the caller's per-trade amount limit
    // to the real swap, not just a claimed number.
    let input_after = read_token_amount(&input_ai)?;
    let spent = input_before.checked_sub(input_after).ok_or(RouterError::Overflow)?;
    require!(spent <= amount_in, RouterError::InputExceedsMax);

    // Gross output delta.
    let after = read_token_amount(&output_ai)?;
    let received = after.checked_sub(before).ok_or(RouterError::Overflow)?;

    // --- fees (skimmed from output; min_amount_out enforced on the net) ---
    let protocol_fee = fee_amount(received, PROTOCOL_FEE_BPS);
    let integrator_fee = fee_amount(received, integrator_fee_bps);
    require!(
        protocol_fee.saturating_add(integrator_fee) <= received,
        RouterError::FeeExceedsOutput
    );

    let authority_ai = ctx.accounts.authority.to_account_info();
    let token_program_ai = ctx.accounts.token_program.to_account_info();

    // SECURITY: the fee transfers CPI `token_program` with the authority's
    // signature over the output account. `token_program` MUST be a real SPL
    // Token program AND the program that owns the output account — otherwise a
    // caller could pass a malicious program and have it drain the output under
    // the authority's signature. (`output_ai.owner` is the token program that
    // owns the account.)
    let tp = token_program_ai.key();
    require!(tp == TOKEN_PROGRAM || tp == TOKEN_2022_PROGRAM, RouterError::UnexpectedTokenProgram);
    require!(tp == *output_ai.owner, RouterError::UnexpectedTokenProgram);
    let decimals = read_mint_decimals(&mint_ai)?;

    if protocol_fee > 0 {
        let dest = ctx.accounts.protocol_fee_account.to_account_info();
        require!(
            read_token_owner(&dest)? == PROTOCOL_FEE_RECIPIENT,
            RouterError::BadProtocolFeeRecipient
        );
        transfer_checked(&token_program_ai, &output_ai, &mint_ai, &dest, &authority_ai, protocol_fee, decimals)?;
    }
    if integrator_fee > 0 {
        let dest = ctx.accounts.integrator_fee_account.to_account_info();
        transfer_checked(&token_program_ai, &output_ai, &mint_ai, &dest, &authority_ai, integrator_fee, decimals)?;
    }

    // SECURITY (defense in depth): enforce min_amount_out on the ACTUAL output
    // retained after fees — re-read the balance rather than trusting the
    // computed net. This catches any case where a fee transfer moved more than
    // intended, independent of the token_program checks above.
    let final_after = read_token_amount(&output_ai)?;
    let net_out = final_after.checked_sub(before).ok_or(RouterError::Overflow)?;
    require!(net_out >= min_amount_out, RouterError::SlippageExceeded);

    emit!(RouteExecuted {
        authority: ctx.accounts.authority.key(),
        output_mint_account: output_ai.key(),
        amount_in,
        amount_out: received,
        net_out,
        protocol_fee,
        integrator_fee,
        min_amount_out,
        num_legs: legs.len() as u8,
        timestamp: Clock::get()?.unix_timestamp,
    });
    Ok(())
}
