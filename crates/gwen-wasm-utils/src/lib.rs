//! Shared utilities for GWEN WASM plugins.
//!
//! # Modules
//! - `buffer`  — Read/write helpers for `js_sys::Uint8Array` (little-endian).
//! - `channel` — `gwen_channel!()` macro for declaring ring-buffer channels.
//! - `debug`   — Sentinel canary helpers for buffer overrun detection.
//! - `ring`    — Ring-buffer writer for the GWEN binary event protocol.

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
