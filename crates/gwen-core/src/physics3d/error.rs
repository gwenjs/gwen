//! Typed failures for physics3d exports.
//!
//! `code()` is the string TypeScript copies onto the thrown error.
//! `Display` is the "what" only. Conversion to a JS value happens at the
//! export boundary; native tests do not build that value.

use crate::ecs::CoreError;
use std::fmt;

/// Why a collider export refuses a shape.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InvalidShapeReason {
    /// A triangle index points past the end of the vertex list.
    TrimeshIndexOutOfRange,
    /// A heightfield has fewer than 2 rows or fewer than 2 columns.
    HeightfieldTooSmall,
    /// A heightfield sample count differs from rows times columns.
    HeightfieldSampleCount,
    /// A convex hull was given fewer than 4 points.
    ConvexTooFewPoints,
    /// Parry's `try_convex_hull` rejects the points (collinear, duplicated, or an extreme aspect ratio).
    ConvexDegenerate,
    /// A mesh has no vertex or no triangle.
    MeshEmpty,
}

/// Why `physics3d_add_compound_collider` refuses a buffer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InvalidCompoundReason {
    /// The buffer length is not a multiple of the 12-float part stride.
    LengthNotMultipleOfStride,
    /// A part carries a shape type that is not known.
    UnknownShapeType,
}

/// Why `physics3d_load_bvh_collider` refuses a baked BVH.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BvhLoadReason {
    /// The buffer is shorter than the 8-byte header.
    TooShort,
    /// The first four bytes are not `GBVH`.
    BadMagic,
    /// The payload is not a valid bincode `TriMesh`.
    DecodeFailed,
    /// The decoded mesh has no triangle, a vertex that is not finite or too large, or an
    /// index or BVH leaf that points outside its list.
    InvalidMesh,
}

/// Why a collider export refuses a numeric parameter before it reaches Rapier.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InvalidColliderReason {
    /// A value is NaN or infinite.
    NonFinite,
    /// A value (half extent, radius, half height, scale, density) is negative where zero is
    /// allowed.
    Negative,
    /// A coordinate, offset, height or size is larger in magnitude than
    /// [`MAX_COLLIDER_MAGNITUDE`](crate::physics3d::world::MAX_COLLIDER_MAGNITUDE).
    TooLarge,
}

/// Failure returned by a fallible physics3d export.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Physics3DError {
    /// The export touched the world before `physics3d_init`.
    WorldNotInitialized,
    /// No rigid body is registered for this slot.
    BodyNotFound {
        /// Entity slot.
        slot: u32,
    },
    /// An add or bulk spawn found a body already registered for this slot.
    BodyAlreadyExists {
        /// Entity slot.
        slot: u32,
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
    /// A collider operation named a collider that is not registered.
    ColliderNotFound {
        /// Entity slot.
        slot: u32,
        /// Collider id.
        collider_id: u32,
    },
    /// An add refused a collider id that is already registered for the slot.
    ColliderAlreadyExists {
        /// Entity slot.
        slot: u32,
        /// Collider id.
        collider_id: u32,
    },
    /// A shape was refused.
    InvalidShape {
        /// Which check refused the shape.
        reason: InvalidShapeReason,
    },
    /// A mesh positions or indices buffer length is not a multiple of 3.
    InvalidMeshBuffer {
        /// Length the caller passed.
        actual: u32,
    },
    /// A compound collider buffer was refused.
    InvalidCompound {
        /// Which check refused the buffer.
        reason: InvalidCompoundReason,
    },
    /// A baked BVH could not be loaded.
    BvhLoadFailed {
        /// Which check refused the BVH.
        reason: BvhLoadReason,
    },
    /// A joint operation named a joint that is not registered.
    JointNotFound {
        /// Joint id.
        joint_id: u32,
    },
    /// No character controller is registered for this slot.
    CharacterControllerNotFound {
        /// Entity slot.
        slot: u32,
    },
    /// The character controller pool is full.
    CharacterControllerLimitReached {
        /// Pool capacity.
        max: u32,
    },
    /// `physics3d_find_path_3d` ran before `physics3d_init_navgrid_3d`.
    NavGridNotInitialized,
    /// A navigation grid dimension is zero, or the cell count overflows or is too large.
    InvalidNavGrid {
        /// Width in cells.
        w: u32,
        /// Height in cells.
        h: u32,
        /// Depth in cells.
        d: u32,
    },
    /// A collider numeric parameter was refused before reaching Rapier.
    InvalidCollider {
        /// Which check refused the parameter.
        reason: InvalidColliderReason,
    },
    /// A physics3d bulk export is forwarding a core bulk failure.
    Core(CoreError),
}

impl Physics3DError {
    /// Stable code. `Core` keeps the inner `CORE:` code.
    pub fn code(&self) -> &'static str {
        match self {
            Self::WorldNotInitialized => "PHYSICS3D:NOT_INITIALIZED",
            Self::BodyNotFound { .. } => "PHYSICS3D:BODY_NOT_FOUND",
            Self::BodyAlreadyExists { .. } => "PHYSICS3D:BODY_ALREADY_EXISTS",
            Self::InvalidBodyKind { .. } => "PHYSICS3D:INVALID_BODY_KIND",
            Self::BufferLengthMismatch { .. } => "PHYSICS3D:BUFFER_LENGTH_MISMATCH",
            Self::ColliderNotFound { .. } => "PHYSICS3D:COLLIDER_NOT_FOUND",
            Self::ColliderAlreadyExists { .. } => "PHYSICS3D:COLLIDER_ALREADY_EXISTS",
            Self::InvalidShape { .. } => "PHYSICS3D:INVALID_SHAPE",
            Self::InvalidMeshBuffer { .. } => "PHYSICS3D:INVALID_MESH_BUFFER",
            Self::InvalidCompound { .. } => "PHYSICS3D:INVALID_COMPOUND",
            Self::BvhLoadFailed { .. } => "PHYSICS3D:BVH_LOAD_FAILED",
            Self::JointNotFound { .. } => "PHYSICS3D:JOINT_NOT_FOUND",
            Self::CharacterControllerNotFound { .. } => "PHYSICS3D:CHARACTER_CONTROLLER_NOT_FOUND",
            Self::CharacterControllerLimitReached { .. } => {
                "PHYSICS3D:CHARACTER_CONTROLLER_LIMIT_REACHED"
            }
            Self::NavGridNotInitialized => "PHYSICS3D:NAVGRID_NOT_INITIALIZED",
            Self::InvalidNavGrid { .. } => "PHYSICS3D:INVALID_NAVGRID",
            Self::InvalidCollider { .. } => "PHYSICS3D:INVALID_COLLIDER",
            Self::Core(inner) => inner.code(),
        }
    }
}

impl fmt::Display for Physics3DError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::WorldNotInitialized => write!(f, "physics world is not initialized"),
            Self::BodyNotFound { slot } => {
                write!(f, "no rigid body is registered for slot {slot}")
            }
            Self::BodyAlreadyExists { slot } => {
                write!(f, "a rigid body is already registered for slot {slot}")
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
            Self::ColliderNotFound { slot, collider_id } => {
                write!(f, "no collider {collider_id} is registered for slot {slot}")
            }
            Self::ColliderAlreadyExists { slot, collider_id } => {
                write!(f, "a collider {collider_id} is already registered for slot {slot}")
            }
            Self::InvalidShape { reason } => match reason {
                InvalidShapeReason::TrimeshIndexOutOfRange => {
                    write!(f, "shape refused: a triangle index is outside the vertex list")
                }
                InvalidShapeReason::HeightfieldTooSmall => write!(
                    f,
                    "shape refused: a heightfield needs at least 2 rows and 2 columns"
                ),
                InvalidShapeReason::HeightfieldSampleCount => write!(
                    f,
                    "shape refused: the heightfield sample count does not match rows times columns"
                ),
                InvalidShapeReason::ConvexTooFewPoints => {
                    write!(f, "shape refused: a convex hull needs at least 4 points")
                }
                InvalidShapeReason::ConvexDegenerate => write!(
                    f,
                    "shape refused: a convex hull cannot be built from these points"
                ),
                InvalidShapeReason::MeshEmpty => {
                    write!(f, "shape refused: a mesh needs at least one vertex and one triangle")
                }
            },
            Self::InvalidMeshBuffer { actual } => {
                write!(f, "mesh buffer length {actual} is not a multiple of 3")
            }
            Self::InvalidCompound { reason } => match reason {
                InvalidCompoundReason::LengthNotMultipleOfStride => write!(
                    f,
                    "compound refused: the buffer length is not a multiple of 12"
                ),
                InvalidCompoundReason::UnknownShapeType => {
                    write!(f, "compound refused: a part has an unknown shape type")
                }
            },
            Self::BvhLoadFailed { reason } => match reason {
                BvhLoadReason::TooShort => {
                    write!(f, "BVH load failed: the buffer is shorter than the 8-byte header")
                }
                BvhLoadReason::BadMagic => write!(f, "BVH load failed: the magic is not GBVH"),
                BvhLoadReason::DecodeFailed => {
                    write!(f, "BVH load failed: the payload is not a valid triangle mesh")
                }
                BvhLoadReason::InvalidMesh => write!(
                    f,
                    "BVH load failed: the decoded mesh is empty, not finite, or has an index outside its list"
                ),
            },
            Self::JointNotFound { joint_id } => {
                write!(f, "no joint is registered for id {joint_id}")
            }
            Self::CharacterControllerNotFound { slot } => {
                write!(f, "no character controller is registered for slot {slot}")
            }
            Self::CharacterControllerLimitReached { max } => {
                write!(f, "character controller limit reached: {max}")
            }
            Self::NavGridNotInitialized => write!(f, "navigation grid is not initialized"),
            Self::InvalidNavGrid { w, h, d } => write!(
                f,
                "navigation grid {w}x{h}x{d} is invalid: a dimension is zero or the cell count overflows"
            ),
            Self::InvalidCollider { reason } => match reason {
                InvalidColliderReason::NonFinite => {
                    write!(f, "collider refused: a value is not finite")
                }
                InvalidColliderReason::Negative => {
                    write!(f, "collider refused: a value must not be negative")
                }
                InvalidColliderReason::TooLarge => {
                    write!(f, "collider refused: a value is larger than the accepted magnitude")
                }
            },
            Self::Core(inner) => write!(f, "{inner}"),
        }
    }
}

impl std::error::Error for Physics3DError {}

impl From<Physics3DError> for wasm_bindgen::JsValue {
    fn from(err: Physics3DError) -> Self {
        let js_error = js_sys::Error::new(&err.to_string());
        let _ = js_sys::Reflect::set(
            &js_error,
            &wasm_bindgen::JsValue::from_str("code"),
            &wasm_bindgen::JsValue::from_str(err.code()),
        );
        wasm_bindgen::JsValue::from(js_error)
    }
}
