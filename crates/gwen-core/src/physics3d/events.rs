//! Zero-allocation collision event buffer for the 3D physics pipeline.
//!
//! Collision events produced during each `step()` are written into a static
//! ring buffer and read directly from WASM linear memory by JavaScript.

/// Maximum number of 3D collision events stored in the static buffer per frame.
pub const MAX_COLLISION_EVENTS_3D: usize = 1024;

/// A single 3D collision event.
///
/// Memory layout is exactly 16 bytes (`#[repr(C)]`), matching the TypeScript
/// `EVENT_STRIDE_3D = 16` constant used to walk the buffer from JS.
///
/// | Offset | Type | Field          |
/// |--------|------|----------------|
/// | 0      | u32  | entity_a       |
/// | 4      | u32  | entity_b       |
/// | 8      | u32  | flags          |
/// | 12     | u16  | collider_a_id  |
/// | 14     | u16  | collider_b_id  |
#[repr(C)]
#[derive(Debug, Clone, Copy, Default)]
pub struct PhysicsCollisionEvent3D {
    /// First entity involved in the collision.
    pub entity_a: u32,
    /// Second entity involved in the collision.
    pub entity_b: u32,
    /// Flags: bit 0 = 1 means collision started, 0 means collision stopped.
    pub flags: u32,
    /// Stable ID of the first collider (`u16::MAX` if absent).
    pub collider_a_id: u16,
    /// Stable ID of the second collider (`u16::MAX` if absent).
    pub collider_b_id: u16,
}

static mut COLLISION_BUFFER_3D: [PhysicsCollisionEvent3D; MAX_COLLISION_EVENTS_3D] =
    [PhysicsCollisionEvent3D {
        entity_a: 0,
        entity_b: 0,
        flags: 0,
        collider_a_id: 0,
        collider_b_id: 0,
    }; MAX_COLLISION_EVENTS_3D];

static mut COLLISION_COUNT_3D: usize = 0;

/// Returns a raw pointer to the static 3D collision event buffer.
///
/// Valid only for the duration of the current frame, after `physics3d_step`.
/// The buffer must not be written to from JavaScript.
pub fn get_collision_events_ptr_3d() -> *const PhysicsCollisionEvent3D {
    std::ptr::addr_of!(COLLISION_BUFFER_3D) as *const PhysicsCollisionEvent3D
}

/// Returns the number of 3D collision events in the buffer for the current frame.
pub fn get_collision_event_count_3d() -> usize {
    unsafe { COLLISION_COUNT_3D }
}

/// Clears the collision event buffer. Called at the start of each `step()`.
pub(crate) fn clear_collision_events_3d() {
    unsafe {
        COLLISION_COUNT_3D = 0;
    }
}

/// Pushes a collision event into the buffer. Silently drops events when full.
pub(crate) fn push_collision_event_3d(event: PhysicsCollisionEvent3D) {
    unsafe {
        if COLLISION_COUNT_3D < MAX_COLLISION_EVENTS_3D {
            COLLISION_BUFFER_3D[COLLISION_COUNT_3D] = event;
            COLLISION_COUNT_3D += 1;
        }
    }
}
