//! Events emitted by the program. Off-chain indexers subscribe to these to
//! reconstruct session lifecycle and trade history without replaying state.

use anchor_lang::prelude::*;

#[event]
pub struct SessionCreated {
    pub session: Pubkey,
    pub owner: Pubkey,
    pub session_pubkey: Pubkey,
    pub created_at: i64,
    pub expires_at: i64,
    pub max_trade_amount: u64,
    pub daily_trade_limit: u64,
}

#[event]
pub struct SessionUpdated {
    pub session: Pubkey,
    pub owner: Pubkey,
    pub expires_at: i64,
    pub max_trade_amount: u64,
    pub daily_trade_limit: u64,
}

#[event]
pub struct SessionRevoked {
    pub session: Pubkey,
    pub owner: Pubkey,
    pub revoked_at: i64,
}

#[event]
pub struct TradeExecuted {
    pub session: Pubkey,
    pub session_pubkey: Pubkey,
    pub program_id: Pubkey,
    pub input_mint: Pubkey,
    pub output_mint: Pubkey,
    pub amount_in: u64,
    /// Session nonce *after* this trade — monotonically increasing.
    pub nonce: u64,
    pub daily_volume_used: u64,
    pub timestamp: i64,
}

/// Emitted (via `emit!`) before returning an error so indexers can observe
/// rejected attempts. The transaction still fails and no state changes persist.
#[event]
pub struct TradeRejected {
    pub session: Pubkey,
    pub session_pubkey: Pubkey,
    pub reason: u32,
    pub timestamp: i64,
}
