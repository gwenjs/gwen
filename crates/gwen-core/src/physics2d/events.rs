//! Per-world collision event buffer.
//!
//! Each `PhysicsWorld` owns one buffer. The free `wasm_bindgen` functions stay
//! as ABI shims and no longer share state across engines.

use wasm_bindgen::prelude::*;

/// Maximum number of collision events stored per world per step.
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

/// Collision events for one physics world.
pub struct CollisionEventBuffer {
    events: [PhysicsCollisionEvent; MAX_COLLISION_EVENTS],
    count: usize,
}

impl CollisionEventBuffer {
    pub fn new() -> Self {
        Self {
            events: [PhysicsCollisionEvent::default(); MAX_COLLISION_EVENTS],
            count: 0,
        }
    }

    pub fn clear(&mut self) {
        self.count = 0;
    }

    pub fn push(&mut self, event: PhysicsCollisionEvent) {
        if self.count < MAX_COLLISION_EVENTS {
            self.events[self.count] = event;
            self.count += 1;
        }
    }

    pub fn as_ptr(&self) -> *const PhysicsCollisionEvent {
        self.events.as_ptr()
    }

    pub fn len(&self) -> usize {
        self.count
    }
}

/// ABI shim. Returns a null pointer. Call `Engine::physics_get_collision_events_ptr`.
///
/// # Safety
/// The returned pointer is null. The live buffer belongs to one `PhysicsWorld`.
#[wasm_bindgen]
pub fn get_collision_events_ptr() -> *const PhysicsCollisionEvent {
    std::ptr::null()
}

/// ABI shim. Returns `0`. Call `Engine::physics_get_collision_event_count`.
#[wasm_bindgen]
pub fn get_collision_event_count() -> usize {
    0
}
