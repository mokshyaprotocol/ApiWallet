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

/// The canonical Jupiter v6 aggregator program id on mainnet-beta.
///
/// `execute_trade` refuses to CPI into anything else, regardless of what an
/// owner puts in `allowed_programs`. The allowlist narrows the surface; this
/// constant is the hard floor.
///
/// Under the `mock-jupiter` feature (used only by the test suite) this points
/// at the bundled mock aggregator so the CPI path can be exercised on a local
/// validator without a mainnet fork. Production builds never enable it.
// Byte arrays are the base58-decoded program ids. Using `Pubkey::new_from_array`
// (a const fn) keeps this a compile-time constant without depending on the
// `pubkey!` macro's crate-path resolution.
//
// JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4
#[cfg(not(feature = "mock-jupiter"))]
pub const JUPITER_V6_PROGRAM_ID: Pubkey = Pubkey::new_from_array([
    4, 121, 213, 91, 242, 49, 192, 110, 238, 116, 197, 110, 206, 104, 21, 7, 253, 177, 178, 222,
    163, 244, 142, 81, 2, 177, 205, 162, 86, 188, 19, 143,
]);

// 4oVmoU4zT21MVgFdTp5N5AayCvMsXZDGE5Xq7QZQvjrN (bundled mock aggregator)
#[cfg(feature = "mock-jupiter")]
pub const JUPITER_V6_PROGRAM_ID: Pubkey = Pubkey::new_from_array([
    56, 124, 79, 163, 167, 153, 88, 181, 30, 35, 135, 48, 198, 229, 93, 143, 3, 165, 205, 62, 239,
    116, 101, 151, 219, 67, 66, 92, 228, 178, 48, 143,
]);
