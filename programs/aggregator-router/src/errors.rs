use anchor_lang::prelude::*;

#[error_code]
pub enum RouterError {
    #[msg("Unknown venue selector")]
    UnknownVenue,
    #[msg("Venue is reserved / not yet enabled")]
    VenueNotEnabled,
    #[msg("A leg references accounts outside the provided remaining_accounts")]
    AccountRangeOutOfBounds,
    #[msg("The CPI target program id does not match the declared venue")]
    VenueProgramMismatch,
    #[msg("No swap legs were provided")]
    EmptyRoute,
    #[msg("Output increased by less than min_amount_out (slippage)")]
    SlippageExceeded,
    #[msg("Output token account is not owned by the authority")]
    BadOutputOwner,
    #[msg("Could not read the output token account balance")]
    BadTokenAccount,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("amount_in must be greater than zero")]
    ZeroAmount,
    #[msg("Too many legs for one route")]
    TooManyLegs,
    #[msg("Integrator fee exceeds the maximum allowed bps")]
    IntegratorFeeTooHigh,
    #[msg("A fee is set but its fee account or the token program was not provided")]
    MissingFeeAccount,
    #[msg("The protocol fee account is not owned by the protocol treasury")]
    BadProtocolFeeRecipient,
    #[msg("Fee exceeds the swap output")]
    FeeExceedsOutput,
    #[msg("token_program is not a valid SPL Token program owning the output account")]
    UnexpectedTokenProgram,
    #[msg("input_token_account mint does not match the declared input_mint")]
    InputMintMismatch,
    #[msg("output_token_account mint does not match the declared output_mint")]
    OutputMintMismatch,
    #[msg("input spent exceeds amount_in")]
    InputExceedsMax,
    #[msg("input/output token account is not owned by the authority")]
    BadTokenOwner,
}
