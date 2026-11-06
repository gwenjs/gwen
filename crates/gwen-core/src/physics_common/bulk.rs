//! Bulk copies shared by the physics variants.
//!
//! [`Engine`] validates lengths from the registered row width and returns
//! [`CoreError::BufferLengthMismatch`]. `STRIDE` is the documented per-entity
//! width (12 or 28 for a transform, 8 or 12 for an impulse) used by
//! [`rows_bytes`]. `STRIDE` is not checked by `sync_from_rapier`,
//! `sync_to_rapier`, or `apply_impulse` (the engine checks the registered
//! row width); only `rows_bytes` reads it.

use crate::bindings::Engine;
use crate::ecs::error::CoreError;

/// Byte size of `rows` entities, to size caller buffers.
pub const fn rows_bytes<const STRIDE: usize>(rows: usize) -> usize {
    rows.saturating_mul(STRIDE)
}

/// Reads component rows through [`Engine::query_read_bulk`].
///
/// # Errors
/// Returns the [`CoreError`] from that call.
pub fn sync_from_rapier<const STRIDE: usize>(
    engine: &mut Engine,
    component_type_id: u32,
    out_slots: &mut [u32],
    out_gens: &mut [u32],
    out_buf: &mut [u8],
) -> Result<(u32, u32), CoreError> {
    let result = engine.query_read_bulk(
        &[component_type_id],
        component_type_id,
        out_slots,
        out_gens,
        out_buf,
    )?;
    let count = result.first().map_or(0, |value| *value);
    let bytes = result.get(1).map_or(0, |value| *value);
    Ok((count, bytes))
}

/// Writes component rows through [`Engine::set_components_bulk`].
///
/// # Errors
/// Returns the [`CoreError`] from that call.
pub fn sync_to_rapier<const STRIDE: usize>(
    engine: &mut Engine,
    slots: &[u32],
    gens: &[u32],
    component_type_id: u32,
    data: &[u8],
) -> Result<(), CoreError> {
    engine.set_components_bulk(slots, gens, component_type_id, data)
}

/// Writes impulse rows through [`Engine::set_components_bulk`].
///
/// # Errors
/// Returns the [`CoreError`] from that call.
pub fn apply_impulse<const STRIDE: usize>(
    engine: &mut Engine,
    slots: &[u32],
    gens: &[u32],
    component_type_id: u32,
    impulse_data: &[u8],
) -> Result<(), CoreError> {
    engine.set_components_bulk(slots, gens, component_type_id, impulse_data)
}
