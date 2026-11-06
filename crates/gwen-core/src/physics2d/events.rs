//! Per-world collision event buffer.
//!
//! Each `PhysicsWorld` owns one buffer. Read it through
//! `Engine::physics_get_collision_events_ptr`.

use crate::physics_common::events::CollisionEvent;

/// Maximum number of collision events stored per world per step.
pub const MAX_COLLISION_EVENTS: usize = 1024;

/// 2D collision event. `u32` ids, 20 bytes.
pub type PhysicsCollisionEvent = CollisionEvent<u32>;

/// Collision events for one physics world.
pub struct CollisionEventBuffer {
    events: [PhysicsCollisionEvent; MAX_COLLISION_EVENTS],
    count: usize,
}

impl Default for CollisionEventBuffer {
    fn default() -> Self {
        Self::new()
    }
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

    pub fn is_empty(&self) -> bool {
        self.count == 0
    }
}
