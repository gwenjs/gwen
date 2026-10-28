//! Shared utilities for GWEN WASM plugins.
//!
//! # Modules
//! - `buffer`  — Read/write helpers for `js_sys::Uint8Array` (little-endian).
//! - `channel` — `gwen_channel!()` macro for declaring ring-buffer channels.
//! - `debug`   — Sentinel canary helpers for buffer overrun detection.
//! - `ring`    — Ring-buffer writer for the GWEN binary event protocol.
//!
//! [`gwen_plugin_abi!`] emits `gwen_plugin_api_version`, which returns
//! [`GWEN_PLUGIN_API_VERSION`].

/// Plugin ABI number shared with the TypeScript constant.
/// Encoded as major * 1_000_000 + minor * 1_000 + patch.
pub const GWEN_PLUGIN_API_VERSION: i32 = 2_001_000;

/// Emits `gwen_plugin_api_version`, which returns [`GWEN_PLUGIN_API_VERSION`].
#[macro_export]
macro_rules! gwen_plugin_abi {
    () => {
        #[no_mangle]
        /// Returns the plugin ABI version this module was built against.
        pub extern "C" fn gwen_plugin_api_version() -> i32 {
            $crate::GWEN_PLUGIN_API_VERSION
        }
    };
}

pub mod buffer;
pub mod channel;
pub mod debug;
pub mod ring;

#[cfg(test)]
mod buffer_tests;

#[cfg(test)]
mod channel_tests;

#[cfg(test)]
mod ring_tests;
