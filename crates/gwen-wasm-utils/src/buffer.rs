//! Buffer I/O helpers for `js_sys::Uint8Array`.
//!
//! All multi-byte values use **little-endian** byte order, consistent with
//! the `DataView` calls on the TypeScript side.
//!
//! ## Performance note
//! Each `get_index` / `set_index` call crosses the WASM→JS FFI boundary.
//! These helpers are intended for **cold paths** (a few calls per frame at most).
//! For hot paths, use `flush_local_to_js` which performs a single bulk `copy_from`.

use js_sys::Uint8Array;

// ── Write helpers ─────────────────────────────────────────────────────────────

/// Write a `u32` little-endian at `byte_offset` in a JS `Uint8Array`.
#[inline]
pub fn write_u32(buf: &Uint8Array, byte_offset: usize, value: u32) {
    buf.set_index(byte_offset as u32, (value & 0xFF) as u8);
    buf.set_index((byte_offset + 1) as u32, ((value >> 8) & 0xFF) as u8);
    buf.set_index((byte_offset + 2) as u32, ((value >> 16) & 0xFF) as u8);
    buf.set_index((byte_offset + 3) as u32, ((value >> 24) & 0xFF) as u8);
}

/// Write a `u16` little-endian at `byte_offset` in a JS `Uint8Array`.
#[inline]
pub fn write_u16(buf: &Uint8Array, byte_offset: usize, value: u16) {
    buf.set_index(byte_offset as u32, (value & 0xFF) as u8);
    buf.set_index((byte_offset + 1) as u32, ((value >> 8) & 0xFF) as u8);
}

/// Write a `u8` at `byte_offset` in a JS `Uint8Array`.
#[inline]
pub fn write_u8(buf: &Uint8Array, byte_offset: usize, value: u8) {
    buf.set_index(byte_offset as u32, value);
}

// ── Read helpers ──────────────────────────────────────────────────────────────

/// Read a `u32` little-endian from `byte_offset` in a JS `Uint8Array`.
#[inline]
pub fn read_u32(buf: &Uint8Array, byte_offset: usize) -> u32 {
    buf.get_index(byte_offset as u32) as u32
        | (buf.get_index((byte_offset + 1) as u32) as u32) << 8
        | (buf.get_index((byte_offset + 2) as u32) as u32) << 16
        | (buf.get_index((byte_offset + 3) as u32) as u32) << 24
}

/// Read a `u16` little-endian from `byte_offset` in a JS `Uint8Array`.
#[inline]
pub fn read_u16(buf: &Uint8Array, byte_offset: usize) -> u16 {
    buf.get_index(byte_offset as u32) as u16 | (buf.get_index((byte_offset + 1) as u32) as u16) << 8
}

// ── Bulk flush (hot path) ─────────────────────────────────────────────────────

/// Copy a Rust-owned byte slice to a JS `Uint8Array` in a single FFI call.
///
/// Use this on hot paths: build your data in a `Vec<u8>` locally (zero FFI),
/// then flush in one shot. Reduces WASM→JS crossings from O(N) to O(1).
#[inline]
pub fn flush_local_to_js(buf: &Uint8Array, local: &[u8]) {
    let dst_len = buf.length() as usize;
    let src_len = local.len();

    if dst_len == src_len {
        buf.copy_from(local);
        return;
    }

    // Some runtimes can expose slightly larger channel views (padding/alignment).
    // Copy only the meaningful source payload instead of panicking on copy_from assert.
    if dst_len > src_len {
        let view = buf.subarray(0, src_len as u32);
        view.copy_from(local);
        return;
    }

    // Defensive fallback: destination smaller than source, truncate to avoid trap.
    let prefix = &local[..dst_len];
    buf.copy_from(prefix);
}

// ── Pure Rust helpers (no js_sys) ─────────────────────────────────────────────

/// Write a `u32` little-endian to a Rust byte slice.
///
/// # Arguments
/// - `buf`: Mutable byte slice (must have at least `byte_offset + 4` bytes).
/// - `byte_offset`: Starting offset in `buf` where the u32 is written.
/// - `value`: The u32 value to write.
#[inline]
#[allow(dead_code)]
pub(crate) fn write_u32_raw(buf: &mut [u8], byte_offset: usize, value: u32) {
    buf[byte_offset] = (value & 0xFF) as u8;
    buf[byte_offset + 1] = ((value >> 8) & 0xFF) as u8;
    buf[byte_offset + 2] = ((value >> 16) & 0xFF) as u8;
    buf[byte_offset + 3] = ((value >> 24) & 0xFF) as u8;
}

/// Write a `u16` little-endian to a Rust byte slice.
///
/// # Arguments
/// - `buf`: Mutable byte slice (must have at least `byte_offset + 2` bytes).
/// - `byte_offset`: Starting offset in `buf` where the u16 is written.
/// - `value`: The u16 value to write.
#[inline]
#[allow(dead_code)]
pub(crate) fn write_u16_raw(buf: &mut [u8], byte_offset: usize, value: u16) {
    buf[byte_offset] = (value & 0xFF) as u8;
    buf[byte_offset + 1] = ((value >> 8) & 0xFF) as u8;
}

/// Read a `u32` little-endian from a Rust byte slice.
///
/// # Arguments
/// - `buf`: Byte slice (must have at least `byte_offset + 4` bytes).
/// - `byte_offset`: Starting offset in `buf` from which the u32 is read.
///
/// # Returns
/// The u32 value read in little-endian byte order.
#[inline]
#[allow(dead_code)]
pub(crate) fn read_u32_raw(buf: &[u8], byte_offset: usize) -> u32 {
    (buf[byte_offset] as u32)
        | ((buf[byte_offset + 1] as u32) << 8)
        | ((buf[byte_offset + 2] as u32) << 16)
        | ((buf[byte_offset + 3] as u32) << 24)
}

/// Read a `u16` little-endian from a Rust byte slice.
///
/// # Arguments
/// - `buf`: Byte slice (must have at least `byte_offset + 2` bytes).
/// - `byte_offset`: Starting offset in `buf` from which the u16 is read.
///
/// # Returns
/// The u16 value read in little-endian byte order.
#[inline]
#[allow(dead_code)]
pub(crate) fn read_u16_raw(buf: &[u8], byte_offset: usize) -> u16 {
    (buf[byte_offset] as u16) | ((buf[byte_offset + 1] as u16) << 8)
}
