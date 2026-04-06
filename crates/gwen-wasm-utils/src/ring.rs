//! Ring-buffer writer for the GWEN binary event protocol.
//!
//! ## Buffer layout (mirrors the TypeScript side)
//! ```text
//! Offset 0..4  : write_head (u32 LE) — index of the next slot to write
//! Offset 4..8  : read_head  (u32 LE) — index of the next slot to read
//! Offset 8..N  : events, each `stride` bytes wide
//! ```
//!
//! Standard GWEN event (stride = 11 bytes):
//! ```text
//! [type u16][slotA u32][slotB u32][flags u8]
//! ```
//!
//! The ring wraps around when `write_head` reaches `capacity`.
//! `next_write_offset` returns `None` when the ring is full.

use crate::buffer::{read_u32, write_u32};
use js_sys::Uint8Array;

/// Byte size of the ring-buffer header (write_head + read_head).
pub const HEADER_BYTES: usize = 8;

// ── Pure Rust ring buffer operations (no js_sys) ────────────────────────────

/// Pure-Rust ring buffer operations that work on `&[u8]` slices.
///
/// These functions are stateless and operate directly on byte slices,
/// making them easily testable without JavaScript dependencies.
pub(crate) mod raw {
    use super::HEADER_BYTES;
    use crate::buffer::{read_u32_raw, write_u32_raw};

    /// Returns the byte offset at which to write the **next** event.
    ///
    /// Returns `None` if the ring is full (overflow — the buffer should
    /// emit a warning and skip the event).
    ///
    /// # Arguments
    /// - `buf`: Byte slice containing the ring buffer (must be at least `HEADER_BYTES + capacity * stride` bytes).
    /// - `stride`: Byte width of each event slot.
    ///
    /// # Returns
    /// `Some(offset)` with the byte offset to write the next event, or `None` if full or invalid.
    #[allow(dead_code)]
    pub fn next_write_offset(buf: &[u8], stride: usize) -> Option<usize> {
        if stride == 0 {
            return None;
        }
        let capacity = (buf.len().saturating_sub(HEADER_BYTES)) / stride;
        if capacity == 0 {
            return None;
        }
        let write_head = read_u32_raw(buf, 0) as usize;
        let read_head = read_u32_raw(buf, 4) as usize;
        let next = (write_head + 1) % capacity;
        if next == read_head {
            return None;
        } // ring full
        Some(HEADER_BYTES + write_head * stride)
    }

    /// Advance `write_head` by one slot after an event has been written.
    ///
    /// Must be called **once** after writing at the offset returned by
    /// [`next_write_offset`].
    ///
    /// # Arguments
    /// - `buf`: Mutable byte slice containing the ring buffer.
    /// - `stride`: Byte width of each event slot.
    #[allow(dead_code)]
    pub fn advance(buf: &mut [u8], stride: usize) {
        if stride == 0 {
            return;
        }
        let capacity = (buf.len().saturating_sub(HEADER_BYTES)) / stride;
        if capacity == 0 {
            return;
        }
        let write_head = read_u32_raw(buf, 0) as usize;
        write_u32_raw(buf, 0, ((write_head + 1) % capacity) as u32);
    }

    /// Returns the current write head index.
    ///
    /// # Arguments
    /// - `buf`: Byte slice containing the ring buffer header.
    ///
    /// # Returns
    /// The write head index value.
    #[allow(dead_code)]
    pub fn write_head(buf: &[u8]) -> usize {
        read_u32_raw(buf, 0) as usize
    }

    /// Returns the current read head index.
    ///
    /// # Arguments
    /// - `buf`: Byte slice containing the ring buffer header.
    ///
    /// # Returns
    /// The read head index value.
    #[allow(dead_code)]
    pub fn read_head(buf: &[u8]) -> usize {
        read_u32_raw(buf, 4) as usize
    }
}

/// Writer handle for a single ring buffer backed by a JS `Uint8Array`.
///
/// The buffer is **not** reset by this struct — it is the TypeScript engine's
/// responsibility to reset both heads to 0 at the start of each frame
/// (before calling the Rust `step()`).
pub struct RingWriter<'a> {
    buf: &'a Uint8Array,
    capacity: usize,
    stride: usize,
}

impl<'a> RingWriter<'a> {
    /// Create a writer for `buf` where each event is `stride` bytes.
    ///
    /// `capacity` is computed from the buffer length:
    /// `(buf.length() - HEADER_BYTES) / stride`
    pub fn new(buf: &'a Uint8Array, stride: usize) -> Self {
        let capacity = (buf.length() as usize).saturating_sub(HEADER_BYTES) / stride;
        Self {
            buf,
            capacity,
            stride,
        }
    }

    /// Number of writable event slots in this ring buffer.
    pub fn capacity(&self) -> usize {
        self.capacity
    }

    /// Returns the byte offset at which to write the **next** event.
    ///
    /// Returns `None` if the ring is full (overflow — the Rust plugin should
    /// emit a warning and skip the event).
    pub fn next_write_offset(&self) -> Option<usize> {
        if self.capacity == 0 {
            return None;
        }
        let write_head = read_u32(self.buf, 0) as usize;
        let read_head = read_u32(self.buf, 4) as usize;
        let next = (write_head + 1) % self.capacity;
        if next == read_head {
            return None;
        } // ring full
        Some(HEADER_BYTES + write_head * self.stride)
    }

    /// Advance `write_head` by one slot after an event has been written.
    ///
    /// Must be called **once** after writing at the offset returned by
    /// [`next_write_offset`].
    pub fn advance(&self) {
        if self.capacity == 0 {
            return;
        }
        let write_head = read_u32(self.buf, 0) as usize;
        write_u32(self.buf, 0, ((write_head + 1) % self.capacity) as u32);
    }
}
