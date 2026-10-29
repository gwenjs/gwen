//! ABI fingerprint stamped into the core binary.
//!
//! One string feeds the `gwen.fingerprint` custom section and
//! [`gwen_abi_fingerprint`].

use wasm_bindgen::prelude::wasm_bindgen;

/// Decimal text of the ABI number. Parsed into [`GWEN_CORE_ABI_VERSION`].
#[macro_export]
macro_rules! gwen_core_abi {
    () => {
        "2"
    };
}

/// Decimal `u32`, or `None` on an empty string, a non-digit, or an overflow.
pub const fn try_parse_u32(s: &str) -> Option<u32> {
    let bytes = s.as_bytes();
    if bytes.is_empty() {
        return None;
    }
    let mut n = 0u32;
    let mut i = 0;
    while i < bytes.len() {
        let digit = bytes[i].wrapping_sub(b'0');
        if digit > 9 {
            return None;
        }
        let next = match n.checked_mul(10) {
            Some(shifted) => shifted.checked_add(digit as u32),
            None => None,
        };
        n = match next {
            Some(value) => value,
            None => return None,
        };
        i += 1;
    }
    Some(n)
}

/// Reads a decimal `u32`. An empty string, a non-digit, or an overflow fails
/// compilation in a constant.
///
/// # Panics
///
/// Outside a constant, a non-digit panics (index out of bounds).
/// An empty string or an overflow panics the same way.
pub const fn parse_u32(s: &str) -> u32 {
    let parsed = try_parse_u32(s);
    let n = match parsed {
        Some(value) => value,
        None => 0,
    };
    // Index 1 is out of bounds. A constant stops compiling; a runtime call panics.
    let _ = [0u32; 1][parsed.is_none() as usize];
    n
}

/// ABI number carried in the fingerprint string.
pub const GWEN_CORE_ABI_VERSION: u32 = parse_u32(gwen_core_abi!());

const _: () = [(); 1][(GWEN_CORE_ABI_VERSION < 1) as usize];

#[cfg(debug_assertions)]
macro_rules! profile {
    () => {
        "dev"
    };
}

#[cfg(not(debug_assertions))]
macro_rules! profile {
    () => {
        "release"
    };
}

macro_rules! fingerprint {
    ($variant:literal) => {
        concat!(
            "gwen-core;variant=",
            $variant,
            ";abi=",
            gwen_core_abi!(),
            ";profile=",
            profile!(),
        )
    };
}

// `build-tools` enables `physics3d` (crates/gwen-core/Cargo.toml:56), so the
// physics3d arm excludes `build-tools`. The four arms stay mutually exclusive.
/// Text of the `gwen.fingerprint` section for this build.
#[cfg(feature = "build-tools")]
pub const FINGERPRINT: &str = fingerprint!("build-tools");
/// Text of the `gwen.fingerprint` section for this build.
#[cfg(all(feature = "physics3d", not(feature = "build-tools")))]
pub const FINGERPRINT: &str = fingerprint!("physics3d");
/// Text of the `gwen.fingerprint` section for this build.
#[cfg(feature = "physics2d")]
pub const FINGERPRINT: &str = fingerprint!("physics2d");
/// Text of the `gwen.fingerprint` section for this build.
#[cfg(not(any(feature = "physics2d", feature = "physics3d")))]
pub const FINGERPRINT: &str = fingerprint!("light");

/// FNV-1a, 32 bits. Offset basis `0x811c9dc5`, prime `0x01000193`.
pub const fn fnv1a32(bytes: &[u8]) -> u32 {
    let mut hash = 0x811c9dc5u32;
    let mut i = 0;
    while i < bytes.len() {
        hash ^= bytes[i] as u32;
        hash = hash.wrapping_mul(0x01000193);
        i += 1;
    }
    hash
}

#[cfg(target_arch = "wasm32")]
#[link_section = "gwen.fingerprint"]
#[used]
static FINGERPRINT_SECTION: [u8; FINGERPRINT.len()] = {
    let bytes = FINGERPRINT.as_bytes();
    let mut out = [0u8; FINGERPRINT.len()];
    let mut i = 0;
    while i < bytes.len() {
        out[i] = bytes[i];
        i += 1;
    }
    out
};

/// FNV-1a 32-bit hash of [`FINGERPRINT`].
#[wasm_bindgen]
pub fn gwen_abi_fingerprint() -> u32 {
    const H: u32 = fnv1a32(FINGERPRINT.as_bytes());
    H
}
