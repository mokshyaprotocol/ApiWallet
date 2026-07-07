use anchor_lang::prelude::*;

#[event]
pub struct RouteExecuted {
    pub authority: Pubkey,
    pub output_mint_account: Pubkey,
    pub amount_in: u64,
    pub amount_out: u64,
    pub min_amount_out: u64,
    pub num_legs: u8,
    pub timestamp: i64,
}
