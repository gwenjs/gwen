//! Static ring buffer for collision events.
//!
//! Provides a zero-allocation bridge between the physics engine and JavaScript.
//! Collision events are written to a fixed-size static buffer that can be
//! read directly from WASM memory.

use wasm_bindgen::prelude::*;

/// Maximum number of collision events stored in the static buffer.
pub const MAX_COLLISION_EVENTS: usize = 1024;

/// A collision event produced during the physics step.
#[repr(C)]
#[derive(Debug, Clone, Copy, Default)]
pub struct PhysicsCollisionEvent {
    /// First entity involved in the collision.
    pub entity_a: u32,
    /// Second entity involved in the collision.
    pub entity_b: u32,
    /// Stable ID of the first collider (u32::MAX if absent).
    pub collider_a_id: u32,
    /// Stable ID of the second collider (u32::MAX if absent).
    pub collider_b_id: u32,
    /// Flags (e.g., bit 0: 1 = started, 0 = stopped).
    pub flags: u8,
}

static mut COLLISION_BUFFER: [PhysicsCollisionEvent; MAX_COLLISION_EVENTS] =
    [PhysicsCollisionEvent {
        entity_a: 0,
        entity_b: 0,
        collider_a_id: 0,
        collider_b_id: 0,
        flags: 0,
    }; MAX_COLLISION_EVENTS];

static mut COLLISION_COUNT: usize = 0;

/// Returns a raw pointer to the static collision event buffer.
///
/// # Safety
/// This pointer is only valid for the duration of the frame after the physics step.
/// Writing to this buffer from JS is undefined behavior.
#[wasm_bindgen]
pub fn get_collision_events_ptr() -> *const PhysicsCollisionEvent {
    std::ptr::addr_of!(COLLISION_BUFFER) as *const PhysicsCollisionEvent
}

/// Returns the number of collision events currently stored in the buffer.
#[wasm_bindgen]
pub fn get_collision_event_count() -> usize {
    unsafe { COLLISION_COUNT }
}

/// Internal helper to clear the collision buffer.
pub(crate) fn clear_collision_events() {
    unsafe {
        COLLISION_COUNT = 0;
    }
}

/// Internal helper to push a collision event to the buffer.
/// If the buffer is full, the event is dropped.
pub(crate) fn push_collision_event(event: PhysicsCollisionEvent) {
    unsafe {
        if COLLISION_COUNT < MAX_COLLISION_EVENTS {
            COLLISION_BUFFER[COLLISION_COUNT] = event;
            COLLISION_COUNT += 1;
        }
    }
}
