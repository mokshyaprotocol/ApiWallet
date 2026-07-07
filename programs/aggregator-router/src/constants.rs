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

    /// The program id this venue CPIs into.
    pub fn program_id(&self) -> Result<Pubkey> {
        Ok(match self {
            Venue::RaydiumAmmV4 => RAYDIUM_AMM_V4,
            Venue::RaydiumClmm => RAYDIUM_CLMM,
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
