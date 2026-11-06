//! How a rigid body interacts with the simulation.

/// How a rigid body interacts with the simulation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum BodyType {
    /// Immovable: never affected by forces or gravity.
    Fixed = 0,
    /// Fully simulated: affected by gravity, forces, and collisions.
    Dynamic = 1,
    /// Manually driven: position set by user code.
    Kinematic = 2,
}

impl BodyType {
    /// Converts a raw `u8` from the WASM boundary. Unknown values are `Fixed`.
    pub fn from_u8(v: u8) -> Self {
        match v {
            1 => BodyType::Dynamic,
            2 => BodyType::Kinematic,
            _ => BodyType::Fixed,
        }
    }
}
