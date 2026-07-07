use anchor_lang::prelude::*;

#[event]
pub struct RouteExecuted {
    pub authority: Pubkey,
    pub output_mint_account: Pubkey,
    pub amount_in: u64,
    /// Gross output from the venues, before fees.
    pub amount_out: u64,
    /// Output delivered to the user after fees (>= min_amount_out).
    pub net_out: u64,
    pub protocol_fee: u64,
    pub integrator_fee: u64,
    pub min_amount_out: u64,
    pub num_legs: u8,
    pub timestamp: i64,
}
