//! Sentinel canary helpers for buffer overrun detection (debug mode).
//!
//! Write `0xDEADBEEF` at the end of a buffer at construction time.
//! Check it each frame — if it has changed, a Rust plugin wrote past
//! its allocated region.

use crate::buffer::{read_u32, write_u32};
use js_sys::Uint8Array;

/// Sentinel value: `0xDEADBEEF`.
pub const SENTINEL: u32 = 0xDEAD_BEEF;

/// Write the sentinel at the last 4 bytes of `buf`.
///
/// Call once after all channel buffers have been handed to Rust plugins.
pub fn write_sentinel(buf: &Uint8Array) {
    let len = buf.length() as usize;
    if len < 4 {
        return;
    }
    write_u32(buf, len - 4, SENTINEL);
}

/// Check the sentinel at the last 4 bytes of `buf`.
///
/// Returns `true` if intact, `false` if overwritten.
/// In debug mode, logs a console error when corrupted.
pub fn check_sentinel(buf: &Uint8Array, plugin_name: &str) -> bool {
    let len = buf.length() as usize;
    if len < 4 {
        return true;
    }
    let value = read_u32(buf, len - 4);
    if value != SENTINEL {
        #[cfg(debug_assertions)]
        {
            let msg = format!(
                "[GWEN] Sentinel overwrite in plugin '{}': expected 0x{:08X}, got 0x{:08X}",
                plugin_name, SENTINEL, value
            );
            js_sys::eval(&format!("console.error('{}')", msg)).ok();
        }
        #[cfg(not(debug_assertions))]
        let _ = plugin_name;
        return false;
    }
    true
}
