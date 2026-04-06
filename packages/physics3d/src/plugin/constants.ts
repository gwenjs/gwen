/**
 * Number of bytes per collision event entry in the WASM ring buffer.
 * Matches the Rust `PhysicsCollisionEvent3D` #[repr(C)] layout (16 bytes):
 * [entity_a: u32][entity_b: u32][flags: u32][collider_a_id: u16][collider_b_id: u16]
 * flags bit 0: 1 = contact started, 0 = contact ended
 */
export const EVENT_STRIDE_3D = 16;

/** Maximum events readable per frame. Matches Rust MAX_COLLISION_EVENTS_3D. */
export const MAX_EVENTS_3D = 1024;

/** Sentinel value indicating an absent collider id (u16::MAX). */
export const COLLIDER_ID_ABSENT = 0xffff;
