//! Per-world collision event buffer for the 3D physics pipeline.
//!
//! Each `PhysicsWorld3D` owns one buffer. The free functions are ABI shims.

/// Maximum number of 3D collision events stored per world per step.
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

/// Collision events for one 3D physics world.
pub struct CollisionEventBuffer3D {
    events: [PhysicsCollisionEvent3D; MAX_COLLISION_EVENTS_3D],
    count: usize,
}

impl CollisionEventBuffer3D {
    pub fn new() -> Self {
        Self {
            events: [PhysicsCollisionEvent3D::default(); MAX_COLLISION_EVENTS_3D],
            count: 0,
        }
    }

    pub fn clear(&mut self) {
        self.count = 0;
    }

    pub fn push(&mut self, event: PhysicsCollisionEvent3D) {
        if self.count < MAX_COLLISION_EVENTS_3D {
            self.events[self.count] = event;
            self.count += 1;
        }
    }

    pub fn as_ptr(&self) -> *const PhysicsCollisionEvent3D {
        self.events.as_ptr()
    }

    pub fn get(&self, index: usize) -> PhysicsCollisionEvent3D {
        self.events[index]
    }

    pub fn len(&self) -> usize {
        self.count
    }
}

/// ABI shim. The live buffer is on each `PhysicsWorld3D`.
pub fn get_collision_events_ptr_3d() -> *const PhysicsCollisionEvent3D {
    std::ptr::null()
}

/// ABI shim. The live count is on each `PhysicsWorld3D`.
pub fn get_collision_event_count_3d() -> usize {
    0
}
