//! Errors returned by the entity-component system.

use std::fmt;

/// Failure from an entity-component operation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EcsError {
    /// No free slot remains, so another entity cannot be created.
    EntityLimitReached {
        /// Configured maximum number of entities.
        max: u32,
    },
}

impl fmt::Display for EcsError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let EcsError::EntityLimitReached { max } = self;
        write!(f, "Entity limit reached: {max}")
    }
}

impl std::error::Error for EcsError {}
