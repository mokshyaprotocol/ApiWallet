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
}
