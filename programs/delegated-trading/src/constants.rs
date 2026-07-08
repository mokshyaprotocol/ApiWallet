//! Protocol-wide constants.
//!
//! These bound the on-chain footprint of a [`crate::state::TradingSession`] and
//! pin the set of external programs the session key is ever allowed to reach.

use anchor_lang::prelude::*;

/// Seed prefix for the [`crate::state::TradingSession`] PDA.
///
/// The full seed set is `[SESSION_SEED, owner, session_pubkey]`, which makes a
/// session unique per `(owner, session key)` pair. An owner may therefore run
/// several concurrent sessions with different keys and different limits.
pub const SESSION_SEED: &[u8] = b"trading_session";

/// Maximum number of programs an owner may allowlist for a single session.
///
/// Kept small on purpose: the session key can only ever CPI into programs on
/// this list, so a short, explicit list is the security boundary.
pub const MAX_ALLOWED_PROGRAMS: usize = 8;

/// Maximum number of input mints an owner may allowlist for a session.
pub const MAX_ALLOWED_INPUT_TOKENS: usize = 16;

/// Maximum number of output mints an owner may allowlist for a session.
pub const MAX_ALLOWED_OUTPUT_TOKENS: usize = 16;

/// Length of a rolling daily window, in seconds (24h).
pub const DAILY_WINDOW_SECONDS: i64 = 86_400;

/// Anchor discriminator of `aggregator_router::route` (sha256("global:route")[:8]).
/// `execute_trade` requires the forwarded route_data to start with this so it
/// can bind the route's declared mints/amount to the session's checks.
pub const ROUTE_DISCRIMINATOR: [u8; 8] = [229, 23, 203, 151, 122, 227, 173, 42];

/// The only program `execute_trade` will CPI into: our own on-chain
/// `aggregator_router`. It refuses to call anything else, regardless of what an
/// owner puts in `allowed_programs` — the allowlist narrows the surface, this
/// constant is the hard floor. Routing across Raydium/Meteora/Pump happens
/// *inside* the router, so the session never touches a third-party aggregator.
///
/// Under the `mock-router` feature (test suite only) this points at the bundled
/// mock program so the CPI path can be exercised on a local validator without
/// mainnet liquidity. Production builds never enable it.
// Byte arrays are the base58-decoded program ids. `Pubkey::new_from_array`
// (const fn) keeps this a compile-time constant without the `pubkey!` macro.
//
// 7c8LDstCZnVxtcKLBdMD6YFmmNbVUTaQnZNv9Txmh8t6 (aggregator_router)
#[cfg(not(feature = "mock-router"))]
pub const ROUTER_PROGRAM_ID: Pubkey = Pubkey::new_from_array([
    98, 37, 189, 81, 251, 21, 17, 42, 249, 57, 183, 138, 53, 51, 250, 44, 201, 135, 134, 162, 108,
    249, 9, 249, 157, 95, 159, 170, 11, 108, 231, 111,
]);

// 4oVmoU4zT21MVgFdTp5N5AayCvMsXZDGE5Xq7QZQvjrN (bundled mock CPI target)
#[cfg(feature = "mock-router")]
pub const ROUTER_PROGRAM_ID: Pubkey = Pubkey::new_from_array([
    56, 124, 79, 163, 167, 153, 88, 181, 30, 35, 135, 48, 198, 229, 93, 143, 3, 165, 205, 62, 239,
    116, 101, 151, 219, 67, 66, 92, 228, 178, 48, 143,
]);
