//! Errors returned by the entity-component system and by core WASM exports.

use std::fmt;

/// Upper bound accepted by `Engine::new`. Matches the TypeScript config check.
pub const MAX_ENTITIES_LIMIT: u32 = 2_000_000;

/// Distinct component type ids a core engine can address.
pub const MAX_COMPONENT_TYPES: u32 = 128;

/// Failure from an entity-component operation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EcsError {
    /// No free slot remains, so another entity cannot be created.
    EntityLimitReached {
        /// Configured maximum number of entities.
        max: u32,
    },
}

/// Failure returned by a fallible core export.
///
/// The `code()` string is the value TypeScript copies onto the thrown `Error`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CoreError {
    /// No free entity slot remains.
    EntityLimitReached {
        /// Configured maximum number of entities.
        max: u32,
    },
    /// A query matched more entities than the result buffer can hold.
    QueryCapacityExceeded {
        /// Number of matches.
        matches: u32,
        /// Buffer capacity in entity ids.
        capacity: u32,
    },
    /// The 129th distinct component type id was refused.
    ComponentTypeLimitReached {
        /// Maximum number of component types (128).
        max: u32,
    },
    /// `set_entity_parent` refused a self-parent or a cycle.
    InvalidParent {
        /// Child entity index.
        child: u32,
        /// Requested parent index.
        parent: u32,
    },
    /// `max_entities` is outside the accepted range, or a sync length exceeds capacity.
    InvalidMaxEntities {
        /// Rejected value.
        value: u32,
        /// Inclusive upper bound that applies to this call.
        max: u32,
    },
    /// A bulk write was given slices whose lengths do not agree.
    BufferLengthMismatch {
        /// Name of the buffer that disagreed (`"data"` or `"gens"`).
        buffer: &'static str,
        /// Length the call required, in elements or bytes.
        expected: u32,
        /// Length the caller passed.
        actual: u32,
    },
    /// `ptr` is not the start of a live `alloc_shared_buffer` allocation
    /// long enough for the requested slot count.
    InvalidSharedBuffer {
        /// Pointer the caller passed.
        ptr: usize,
        /// Byte length of the live allocation, or 0 when `ptr` is not live.
        len: usize,
    },
}

impl CoreError {
    /// Stable `CORE:` code. Matches `CoreErrorCodes` in TypeScript.
    pub fn code(&self) -> &'static str {
        match self {
            Self::EntityLimitReached { .. } => "CORE:ENTITY_LIMIT_REACHED",
            Self::QueryCapacityExceeded { .. } => "CORE:QUERY_CAPACITY_EXCEEDED",
            Self::ComponentTypeLimitReached { .. } => "CORE:COMPONENT_TYPE_LIMIT_REACHED",
            Self::InvalidParent { .. } => "CORE:INVALID_PARENT",
            Self::InvalidMaxEntities { .. } => "CORE:INVALID_MAX_ENTITIES",
            Self::BufferLengthMismatch { .. } => "CORE:BUFFER_LENGTH_MISMATCH",
            Self::InvalidSharedBuffer { .. } => "CORE:INVALID_SHARED_BUFFER",
        }
    }
}

impl From<EcsError> for CoreError {
    fn from(err: EcsError) -> Self {
        match err {
            EcsError::EntityLimitReached { max } => Self::EntityLimitReached { max },
        }
    }
}

impl fmt::Display for EcsError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let EcsError::EntityLimitReached { max } = self;
        write!(f, "Entity limit reached: {max}")
    }
}

impl std::error::Error for EcsError {}

impl fmt::Display for CoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::EntityLimitReached { max } => write!(f, "Entity limit reached: {max}"),
            Self::QueryCapacityExceeded { matches, capacity } => {
                write!(
                    f,
                    "query exceeded the buffer capacity ({matches} > {capacity})"
                )
            }
            Self::ComponentTypeLimitReached { max } => {
                write!(f, "Component type limit reached: {max}")
            }
            Self::InvalidParent { child, parent } => {
                write!(f, "Invalid parent: child {child} parent {parent}")
            }
            Self::InvalidMaxEntities { value, max } => {
                write!(f, "Invalid max entities: {value}, max {max}")
            }
            Self::BufferLengthMismatch {
                buffer,
                expected,
                actual,
            } => {
                write!(
                    f,
                    "buffer {buffer} length mismatch: expected {expected}, actual {actual}"
                )
            }
            Self::InvalidSharedBuffer { ptr, len } => {
                write!(f, "invalid shared buffer: ptr {ptr}, len {len}")
            }
        }
    }
}

impl std::error::Error for CoreError {}

impl From<CoreError> for wasm_bindgen::JsValue {
    fn from(err: CoreError) -> Self {
        let js_error = js_sys::Error::new(&err.to_string());
        let _ = js_sys::Reflect::set(
            &js_error,
            &wasm_bindgen::JsValue::from_str("code"),
            &wasm_bindgen::JsValue::from_str(err.code()),
        );
        wasm_bindgen::JsValue::from(js_error)
    }
}
