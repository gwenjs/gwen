//! Typed failures for physics2d exports.
//!
//! `code()` is the string TypeScript copies onto the thrown error.
//! `Display` is the "what" only. Conversion to a JS value happens at the
//! export boundary; native tests do not build that value.

use crate::ecs::CoreError;
use std::fmt;

/// Why `path_find_2d` or `find_path_2d` refuses a request.
///
/// The numeric coordinate and distance bounds are applied by the check that
/// returns [`Physics2DError::InvalidPathRequest`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PathRequestReject {
    /// A coordinate is NaN or infinite.
    NonFinite,
    /// A coordinate is outside the accepted range.
    CoordOutOfRange,
    /// The Manhattan distance between the cells is outside the accepted range.
    DistanceOutOfRange,
}

/// Failure returned by a fallible physics2d export.
///
/// `Eq` is omitted: [`Self::InvalidQuery`] and [`Self::InvalidStepDelta`] carry
/// an `f32`, and `f32` is not `Eq`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Physics2DError {
    /// The export touched the world before `physics_init`.
    WorldNotInitialized,
    /// No rigid body is registered for this slot.
    BodyNotFound {
        /// Entity slot.
        slot: u32,
    },
    /// `physics_add_rigid_body` found a body already registered for this slot.
    BodyAlreadyExists {
        /// Entity slot.
        slot: u32,
    },
    /// A collider export was given a raw handle that is not registered.
    StaleBodyHandle {
        /// Raw body handle.
        handle: u32,
    },
    /// Body kind was not 0 (fixed), 1 (dynamic), or 2 (kinematic).
    InvalidBodyKind {
        /// Byte the caller passed.
        kind: u8,
    },
    /// Parallel slices of a bulk call differ in length.
    BufferLengthMismatch {
        /// Name of the buffer that disagreed.
        buffer: &'static str,
        /// Length the call required.
        expected: u32,
        /// Length the caller passed.
        actual: u32,
    },
    /// `physics_load_tilemap_chunk_body` was asked to load a chunk id that is already loaded.
    TilemapChunkAlreadyLoaded,
    /// `physics_unload_tilemap_chunk_body` was asked to unload a chunk id that is not loaded.
    TilemapChunkNotLoaded,
    /// A path coordinate is not finite, or a coordinate or Manhattan distance is past its bound.
    InvalidPathRequest {
        /// Which bound refused the request.
        reason: PathRequestReject,
    },
    /// A query argument is not finite, is negative where a length is required, or is past the world extent.
    InvalidQuery {
        /// `x`, `y`, `hw`, `hh`, or `radius`.
        field: &'static str,
        /// The value the caller passed.
        value: f32,
    },
    /// `physics_step` was given a delta that is not finite or is outside `0..=1`.
    InvalidStepDelta {
        /// The refused delta, in seconds.
        delta: f32,
    },
    /// A physics2d bulk export is forwarding a core bulk failure.
    Core(CoreError),
}

impl Physics2DError {
    /// Stable code. `Core` keeps the inner `CORE:` code.
    pub fn code(&self) -> &'static str {
        match self {
            Self::WorldNotInitialized => "PHYSICS2D:NOT_INITIALIZED",
            Self::BodyNotFound { .. } => "PHYSICS2D:BODY_NOT_FOUND",
            Self::BodyAlreadyExists { .. } => "PHYSICS2D:BODY_ALREADY_EXISTS",
            Self::StaleBodyHandle { .. } => "PHYSICS2D:STALE_BODY_HANDLE",
            Self::InvalidBodyKind { .. } => "PHYSICS2D:INVALID_BODY_KIND",
            Self::BufferLengthMismatch { .. } => "PHYSICS2D:BUFFER_LENGTH_MISMATCH",
            Self::TilemapChunkAlreadyLoaded => "PHYSICS2D:TILEMAP_CHUNK_ALREADY_LOADED",
            Self::TilemapChunkNotLoaded => "PHYSICS2D:TILEMAP_CHUNK_NOT_LOADED",
            Self::InvalidPathRequest { .. } => "PHYSICS2D:INVALID_PATH_REQUEST",
            Self::InvalidQuery { .. } => "PHYSICS2D:INVALID_QUERY",
            Self::InvalidStepDelta { .. } => "PHYSICS2D:INVALID_STEP_DELTA",
            Self::Core(inner) => inner.code(),
        }
    }
}

impl fmt::Display for Physics2DError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::WorldNotInitialized => write!(f, "physics world is not initialized"),
            Self::BodyNotFound { slot } => {
                write!(f, "no rigid body is registered for slot {slot}")
            }
            Self::BodyAlreadyExists { slot } => {
                write!(f, "a rigid body is already registered for slot {slot}")
            }
            Self::StaleBodyHandle { handle } => {
                write!(f, "body handle {handle} is not registered")
            }
            Self::InvalidBodyKind { kind } => {
                write!(f, "body kind {kind} is outside 0, 1, and 2")
            }
            Self::BufferLengthMismatch {
                buffer,
                expected,
                actual,
            } => write!(
                f,
                "buffer {buffer} length mismatch: expected {expected}, actual {actual}"
            ),
            Self::TilemapChunkAlreadyLoaded => write!(f, "tilemap chunk is already loaded"),
            Self::TilemapChunkNotLoaded => write!(f, "tilemap chunk is not loaded"),
            Self::InvalidPathRequest {
                reason: PathRequestReject::NonFinite,
            } => write!(f, "path request refused: a coordinate is not finite"),
            Self::InvalidPathRequest {
                reason: PathRequestReject::CoordOutOfRange,
            } => write!(
                f,
                "path request refused: a coordinate is past the accepted bound"
            ),
            Self::InvalidPathRequest {
                reason: PathRequestReject::DistanceOutOfRange,
            } => write!(
                f,
                "path request refused: the Manhattan distance is past the accepted bound"
            ),
            Self::InvalidQuery { field, value } => write!(
                f,
                "physics2d query field {field} is {value}; it must be finite and within ±MAX_WORLD_EXTENT"
            ),
            Self::InvalidStepDelta { delta } => write!(
                f,
                "physics2d step delta is {delta}; it must be finite and within 0..=1"
            ),
            Self::Core(inner) => write!(f, "{inner}"),
        }
    }
}

impl std::error::Error for Physics2DError {}

impl From<Physics2DError> for wasm_bindgen::JsValue {
    fn from(err: Physics2DError) -> Self {
        let js_error = js_sys::Error::new(&err.to_string());
        let _ = js_sys::Reflect::set(
            &js_error,
            &wasm_bindgen::JsValue::from_str("code"),
            &wasm_bindgen::JsValue::from_str(err.code()),
        );
        wasm_bindgen::JsValue::from(js_error)
    }
}
