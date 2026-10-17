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
    /// A bulk read, write, or spawn was given slices whose lengths do not agree.
    BufferLengthMismatch {
        /// Name of the buffer that disagreed
        /// (`"data"`, `"gens"`, `"positions"`, or `"rotations"`).
        buffer: &'static str,
        /// Length the call required, in elements or bytes.
        expected: u32,
        /// Length the caller passed.
        actual: u32,
    },
    /// `ptr` is not live, the byte length is not the recorded one, or the
    /// buffer is not long enough for the requested slot count. The `len`
    /// field is 0 when `ptr` is not live.
    InvalidSharedBuffer {
        /// Pointer the caller passed.
        ptr: usize,
        /// Byte length of the live allocation, or 0 when `ptr` is not live.
        len: usize,
    },
    /// Storage refused a component write.
    ///
    /// The chunk store reports a wrong row width as
    /// [`CoreError::BufferLengthMismatch`] or
    /// [`CoreError::ComponentLayoutInvalid`] before any row changes.
    ComponentWriteRejected {
        /// Entity slot index.
        entity: u32,
        /// Component type id passed to the export.
        component_type: u32,
        /// Bytes passed for this entity.
        bytes: u32,
    },
    /// The two history buffers could not be allocated.
    HistoryBuffersUnavailable {
        /// Configured maximum number of entities.
        max_entities: u32,
    },
    /// A component layout was refused before any row changed.
    ///
    /// `reason`: 1 unknown lane, 2 more than 64 lanes, 3 unregistered type,
    /// 4 `data` length is not the row width, 5 row wider than 512 bytes.
    /// Sixty-four lanes of 8 bytes are exactly 512, so reason 5 is the same
    /// bound as reason 2 for the lane sizes this store accepts.
    ComponentLayoutInvalid {
        /// Type id the caller passed, or the id the registration would have used.
        type_id: u32,
        /// Which check failed. See the variant docs.
        reason: u8,
    },
    /// A new component mask would exceed the archetype table.
    ArchetypeLimitReached {
        /// Maximum number of archetypes (4096).
        max: u32,
    },
    /// `register_query` got no type ids, or `query_chunks` got an unknown handle.
    ///
    /// An empty type list uses `query` 0. Nothing is stored.
    QueryInvalid {
        /// Handle the caller passed, or 0 when the type list was empty.
        query: u32,
    },
    /// The chunk store broke an invariant that a public call cannot build.
    ///
    /// A dead entity, a stale generation, and an absent component stay a
    /// `false` or `None`. This variant is a bug in the store. Report it with
    /// `site`.
    ///
    /// | site | branch |
    /// | --- | --- |
    /// | 1 | a slot names a chunk that is not live |
    /// | 2 | dormancy read: that chunk is not live |
    /// | 3 | dormancy read: the slot row is past `len` |
    /// | 4 | dormancy read: `awake` is past `len` |
    /// | 5 | `has`: the chunk is not live |
    /// | 6 | `has`: the slot row is past `len` |
    /// | 7 | `has`: `awake` is past `len` |
    /// | 8 | row copy: the chunk is not live |
    /// | 9 | row copy: the slot row is past `len` |
    /// | 10 | row copy: `awake` is past `len` |
    /// | 11 | row copy: a lane cell is missing |
    /// | 12 | archetype read: the chunk is not live |
    /// | 13 | delete: the row cannot be filled |
    /// | 14 | remove of the last component: the row cannot be filled |
    /// | 15 | dormancy of a live row: the row is past `len` |
    /// | 16 | dormancy of a live row: `awake` is past `len` |
    /// | 17 | add onto a new mask: the archetype record is missing |
    /// | 18 | in-place write: a lane cell is missing |
    /// | 19 | `set_dormant`: the slot row is past `len` |
    /// | 20 | `set_dormant`: `awake` is past `len` |
    /// | 21 | `set_dormant`: the swapped entity has no slot |
    /// | 22 | an archetype lists a chunk that is not live |
    /// | 23 | a listed chunk has `awake` past `len` |
    StorageInconsistent {
        /// Which broken branch reported. See the table above.
        site: u32,
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
            Self::ComponentWriteRejected { .. } => "CORE:COMPONENT_WRITE_REJECTED",
            Self::HistoryBuffersUnavailable { .. } => "CORE:HISTORY_BUFFERS_UNAVAILABLE",
            Self::ComponentLayoutInvalid { .. } => "CORE:COMPONENT_LAYOUT_INVALID",
            Self::ArchetypeLimitReached { .. } => "CORE:ARCHETYPE_LIMIT_REACHED",
            Self::QueryInvalid { .. } => "CORE:QUERY_INVALID",
            Self::StorageInconsistent { .. } => "CORE:STORAGE_INCONSISTENT",
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
            Self::ComponentWriteRejected {
                entity,
                component_type,
                bytes,
            } => write!(
                f,
                "Component write rejected: entity {entity} component type {component_type} ({bytes} bytes)"
            ),
            Self::HistoryBuffersUnavailable { .. } => {
                write!(f, "history buffers cannot be allocated")
            }
            Self::ComponentLayoutInvalid { type_id, reason } => {
                write!(f, "Component layout invalid: type {type_id} reason {reason}")
            }
            Self::ArchetypeLimitReached { max } => {
                write!(f, "Archetype limit reached: {max}")
            }
            Self::QueryInvalid { query } => write!(f, "Query invalid: {query}"),
            Self::StorageInconsistent { site } => write!(f, "Storage inconsistent: site {site}"),
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
