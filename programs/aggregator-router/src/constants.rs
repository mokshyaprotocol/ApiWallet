//! Venue registry.
//!
//! The router will only CPI into these known programs — the on-chain allowlist
//! that bounds what a route can ever touch. The off-chain route-finder decides
//! *which* venues and amounts; the program guarantees it can only call these.
//!
//! Adding a venue = add its id here and a `Venue` variant. Ids are the
//! base58-decoded mainnet program addresses (const, no macro dependency).

use anchor_lang::prelude::*;

/// Venue selector encoded in each `SwapLeg`. `repr(u8)` matches the wire byte.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum Venue {
    RaydiumAmmV4 = 0,
    RaydiumClmm = 1,
    RaydiumCpmm = 2,
    MeteoraDlmm = 3,
    MeteoraDynamic = 4,
    PumpFun = 5,
    PumpSwap = 6,
    // Kamino is a lending/liquidity protocol rather than a classic swap venue;
    // reserved pending confirmation of the exact swap interface to integrate.
    Kamino = 7,
}

impl Venue {
    pub fn from_u8(v: u8) -> Result<Venue> {
        Ok(match v {
            0 => Venue::RaydiumAmmV4,
            1 => Venue::RaydiumClmm,
            2 => Venue::RaydiumCpmm,
            3 => Venue::MeteoraDlmm,
            4 => Venue::MeteoraDynamic,
            5 => Venue::PumpFun,
            6 => Venue::PumpSwap,
            7 => Venue::Kamino,
            _ => return err!(crate::errors::RouterError::UnknownVenue),
        })
    }

    /// V-1: restrict a leg to a known *swap* instruction for its venue (by
    /// leading discriminator/tag) — so a leg can't invoke an arbitrary venue
    /// instruction (e.g. an LP withdrawal) even though it's the right program.
    pub fn is_allowed_swap_ix(&self, data: &[u8]) -> bool {
        if data.is_empty() {
            return false;
        }
        // Under the test feature these venues are the SPL Token program and a
        // "swap" is a Transfer (tag 3).
        #[cfg(feature = "localnet-mock")]
        if matches!(self, Venue::RaydiumAmmV4 | Venue::RaydiumClmm | Venue::RaydiumCpmm) {
            return data[0] == 3;
        }
        let disc_in = |allowed: &[[u8; 8]]| data.len() >= 8 && allowed.iter().any(|d| data[0..8] == *d);
        match self {
            // Raydium AMM v4 uses a raw u8 tag: 9 = swapBaseIn, 11 = swapBaseOut.
            Venue::RaydiumAmmV4 => data[0] == 9 || data[0] == 11,
            Venue::RaydiumClmm => disc_in(&[CLMM_SWAP, CLMM_SWAP_V2]),
            Venue::RaydiumCpmm => disc_in(&[CPMM_SWAP_BASE_IN, CPMM_SWAP_BASE_OUT]),
            Venue::MeteoraDlmm => disc_in(&[ANCHOR_SWAP, DLMM_SWAP2]),
            Venue::MeteoraDynamic => disc_in(&[ANCHOR_SWAP]),
            Venue::PumpFun | Venue::PumpSwap => disc_in(&[PUMP_BUY, PUMP_SELL]),
            Venue::Kamino => false,
        }
    }

    /// The program id this venue CPIs into.
    pub fn program_id(&self) -> Result<Pubkey> {
        Ok(match self {
            // Under `localnet-mock` (tests only) the first three venue slots are
            // remapped to the SPL Token program, so each "swap leg" is a real
            // token Transfer — this lets a MULTI-venue route (up to 3 distinct
            // venue selectors) be exercised in an in-process SVM without live
            // DEXs. Production builds never enable it and CPI the real programs.
            #[cfg(feature = "localnet-mock")]
            Venue::RaydiumAmmV4 | Venue::RaydiumClmm | Venue::RaydiumCpmm => TOKEN_PROGRAM,
            #[cfg(not(feature = "localnet-mock"))]
            Venue::RaydiumAmmV4 => RAYDIUM_AMM_V4,
            #[cfg(not(feature = "localnet-mock"))]
            Venue::RaydiumClmm => RAYDIUM_CLMM,
            #[cfg(not(feature = "localnet-mock"))]
            Venue::RaydiumCpmm => RAYDIUM_CPMM,
            Venue::MeteoraDlmm => METEORA_DLMM,
            Venue::MeteoraDynamic => METEORA_DYNAMIC,
            Venue::PumpFun => PUMP_FUN,
            Venue::PumpSwap => PUMP_SWAP,
            Venue::Kamino => return err!(crate::errors::RouterError::VenueNotEnabled),
        })
    }
}

// 675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8
pub const RAYDIUM_AMM_V4: Pubkey = pk("675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8");
// CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK
pub const RAYDIUM_CLMM: Pubkey = pk("CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK");
// CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C
pub const RAYDIUM_CPMM: Pubkey = pk("CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C");
// LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo
pub const METEORA_DLMM: Pubkey = pk("LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo");
// Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB
pub const METEORA_DYNAMIC: Pubkey = pk("Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB");
// 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P
pub const PUMP_FUN: Pubkey = pk("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
// pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA
pub const PUMP_SWAP: Pubkey = pk("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA");

/// SPL Token program (classic). Both classic and Token-2022 output accounts
/// share the same `amount` layout at offset 64, which is all the router reads.
pub const TOKEN_PROGRAM: Pubkey = pk("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
/// SPL Token-2022 program.
pub const TOKEN_2022_PROGRAM: Pubkey = pk("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

// ---- Fee model (Jupiter/DFlow-style integrator fee + our protocol fee) ------

/// Max integrator fee, in basis points. Mirrors Jupiter's historical `u8`
/// `platformFeeBps` ceiling (255 bps = 2.55%). Third parties integrating the
/// router set any value up to this, sent to their own fee account.
pub const MAX_INTEGRATOR_FEE_BPS: u16 = 255;

/// Our protocol fee, in basis points (0.20%, matching Jupiter's docs example).
/// Always skimmed to a `protocol_fee_account` owned by [`PROTOCOL_FEE_RECIPIENT`].
/// Set to 0 to disable. This is the "fee for us".
pub const PROTOCOL_FEE_BPS: u16 = 20;

/// Treasury that must own the protocol fee account — so an integrator can't
/// redirect our cut. (Owner of the fee token account, per-mint ATA.)
/// Ec5kwqhc1ptv4r3EptfZypvB3dCtQwdLt6cC4EKrGBFd
pub const PROTOCOL_FEE_RECIPIENT: Pubkey = Pubkey::new_from_array([
    202, 36, 163, 76, 152, 197, 72, 164, 154, 66, 41, 24, 35, 9, 68, 243, 228, 20, 106, 218, 13,
    235, 65, 150, 91, 21, 180, 237, 174, 143, 122, 32,
]);

pub const BPS_DENOMINATOR: u64 = 10_000;

// V-1: allowed swap-instruction discriminators per venue (anchor sha256("global:<name>")[:8]).
const ANCHOR_SWAP: [u8; 8] = [248, 198, 158, 145, 225, 117, 135, 200]; // "swap" (CLMM/DLMM/dynamic)
const CLMM_SWAP: [u8; 8] = ANCHOR_SWAP;
const CLMM_SWAP_V2: [u8; 8] = [114, 113, 45, 226, 179, 239, 106, 225]; // "swapV2"
const CPMM_SWAP_BASE_IN: [u8; 8] = [143, 190, 90, 218, 196, 30, 51, 222]; // "swap_base_input"
const CPMM_SWAP_BASE_OUT: [u8; 8] = [55, 217, 98, 86, 163, 74, 180, 173]; // "swap_base_output"
const DLMM_SWAP2: [u8; 8] = [65, 75, 63, 76, 235, 91, 91, 136]; // "swap2"
const PUMP_BUY: [u8; 8] = [102, 6, 61, 18, 1, 218, 235, 234]; // "buy"
const PUMP_SELL: [u8; 8] = [51, 230, 133, 164, 1, 127, 131, 173]; // "sell"

/// Compile-time base58 → Pubkey (const `pubkey!` alternative that avoids the
/// macro's crate-path resolution issues under this toolchain).
const fn pk(s: &str) -> Pubkey {
    Pubkey::new_from_array(bs58_const::decode_32(s))
}

/// Minimal const base58 decoder for 32-byte keys.
mod bs58_const {
    const ALPHABET: &[u8; 58] =
        b"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

    const fn char_index(c: u8) -> u8 {
        let mut i = 0;
        while i < 58 {
            if ALPHABET[i] == c {
                return i as u8;
            }
            i += 1;
        }
        panic!("invalid base58 character");
    }

    /// Decode a base58 string known to represent exactly 32 bytes.
    pub const fn decode_32(s: &str) -> [u8; 32] {
        let input = s.as_bytes();
        let mut bytes = [0u8; 32];
        let mut i = 0;
        while i < input.len() {
            let mut carry = char_index(input[i]) as u32;
            let mut j = 32;
            while j > 0 {
                j -= 1;
                carry += 58 * bytes[j] as u32;
                bytes[j] = (carry & 0xff) as u8;
                carry >>= 8;
            }
            // carry must be fully absorbed for a 32-byte value.
            if carry != 0 {
                panic!("base58 value overflows 32 bytes");
            }
            i += 1;
        }
        bytes
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn venue_ids_decode_correctly() {
        let cases = [
            (RAYDIUM_AMM_V4, "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8"),
            (RAYDIUM_CLMM, "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK"),
            (RAYDIUM_CPMM, "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C"),
            (METEORA_DLMM, "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo"),
            (METEORA_DYNAMIC, "Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB"),
            (PUMP_FUN, "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"),
            (PUMP_SWAP, "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA"),
            (TOKEN_PROGRAM, "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
        ];
        for (got, want) in cases {
            assert_eq!(got.to_string(), want, "mismatch for {}", want);
        }
    }
}
