//! `Physics3DError` codes, messages, and equality.
//!
//! Native only. The physics3d CI step runs these tests.

#![cfg(feature = "physics3d")]

use gwen_core::ecs::CoreError;
use gwen_core::physics3d::{
    BvhLoadReason, InvalidColliderReason, InvalidCompoundReason, InvalidShapeReason,
    PathRequestReject, Physics3DError, MAX_NAVGRID_CELLS,
};
use std::error::Error;

type TestResult = Result<(), Box<dyn Error>>;

/// Boxes the error as `dyn Error` and returns its message.
fn message_via_std(err: Physics3DError) -> Result<String, Box<dyn Error>> {
    let boxed: Box<dyn Error> = Box::new(err);
    Ok(boxed.to_string())
}

#[test]
fn world_not_initialized_code_message_and_equality() -> TestResult {
    let err = Physics3DError::WorldNotInitialized;
    assert_eq!(err.code(), "PHYSICS3D:NOT_INITIALIZED");
    assert_eq!(err.to_string(), "physics world is not initialized");
    assert_eq!(err, Physics3DError::WorldNotInitialized);
    assert_ne!(err, Physics3DError::BodyNotFound { slot: 1 });
    let message = message_via_std(err)?;
    assert_eq!(message, "physics world is not initialized");
    Ok(())
}

#[test]
fn body_not_found_code_message_and_equality() -> TestResult {
    let err = Physics3DError::BodyNotFound { slot: 7 };
    assert_eq!(err.code(), "PHYSICS3D:BODY_NOT_FOUND");
    assert_eq!(err.to_string(), "no rigid body is registered for slot 7");
    assert_eq!(err, Physics3DError::BodyNotFound { slot: 7 });
    assert_ne!(err, Physics3DError::BodyNotFound { slot: 8 });
    let message = message_via_std(err)?;
    assert_eq!(message, "no rigid body is registered for slot 7");
    Ok(())
}

#[test]
fn body_already_exists_code_message_and_equality() -> TestResult {
    let err = Physics3DError::BodyAlreadyExists { slot: 3 };
    assert_eq!(err.code(), "PHYSICS3D:BODY_ALREADY_EXISTS");
    assert_eq!(
        err.to_string(),
        "a rigid body is already registered for slot 3"
    );
    assert_eq!(err, Physics3DError::BodyAlreadyExists { slot: 3 });
    assert_ne!(err, Physics3DError::BodyAlreadyExists { slot: 4 });
    let message = message_via_std(err)?;
    assert_eq!(message, "a rigid body is already registered for slot 3");
    Ok(())
}

#[test]
fn invalid_body_kind_code_message_and_equality() -> TestResult {
    let err = Physics3DError::InvalidBodyKind { kind: 9 };
    assert_eq!(err.code(), "PHYSICS3D:INVALID_BODY_KIND");
    assert_eq!(err.to_string(), "body kind 9 is outside 0, 1, and 2");
    assert_eq!(err, Physics3DError::InvalidBodyKind { kind: 9 });
    assert_ne!(err, Physics3DError::InvalidBodyKind { kind: 1 });
    let message = message_via_std(err)?;
    assert_eq!(message, "body kind 9 is outside 0, 1, and 2");
    Ok(())
}

#[test]
fn buffer_length_mismatch_code_message_and_equality() -> TestResult {
    let err = Physics3DError::BufferLengthMismatch {
        buffer: "vx",
        expected: 4,
        actual: 3,
    };
    assert_eq!(err.code(), "PHYSICS3D:BUFFER_LENGTH_MISMATCH");
    assert_eq!(
        err.to_string(),
        "buffer vx length mismatch: expected 4, actual 3"
    );
    assert_eq!(
        err,
        Physics3DError::BufferLengthMismatch {
            buffer: "vx",
            expected: 4,
            actual: 3
        }
    );
    assert_ne!(
        err,
        Physics3DError::BufferLengthMismatch {
            buffer: "vx",
            expected: 4,
            actual: 2
        }
    );
    let message = message_via_std(err)?;
    assert_eq!(message, "buffer vx length mismatch: expected 4, actual 3");
    Ok(())
}

#[test]
fn collider_not_found_code_message_and_equality() -> TestResult {
    let err = Physics3DError::ColliderNotFound {
        slot: 2,
        collider_id: 5,
    };
    assert_eq!(err.code(), "PHYSICS3D:COLLIDER_NOT_FOUND");
    assert_eq!(err.to_string(), "no collider 5 is registered for slot 2");
    assert_eq!(
        err,
        Physics3DError::ColliderNotFound {
            slot: 2,
            collider_id: 5
        }
    );
    assert_ne!(
        err,
        Physics3DError::ColliderNotFound {
            slot: 2,
            collider_id: 6
        }
    );
    let message = message_via_std(err)?;
    assert_eq!(message, "no collider 5 is registered for slot 2");
    Ok(())
}

#[test]
fn collider_already_exists_code_message_and_equality() -> TestResult {
    let err = Physics3DError::ColliderAlreadyExists {
        slot: 2,
        collider_id: 5,
    };
    assert_eq!(err.code(), "PHYSICS3D:COLLIDER_ALREADY_EXISTS");
    assert_eq!(
        err.to_string(),
        "a collider 5 is already registered for slot 2"
    );
    assert_eq!(
        err,
        Physics3DError::ColliderAlreadyExists {
            slot: 2,
            collider_id: 5
        }
    );
    assert_ne!(
        err,
        Physics3DError::ColliderAlreadyExists {
            slot: 2,
            collider_id: 6
        }
    );
    assert_ne!(
        err,
        Physics3DError::ColliderNotFound {
            slot: 2,
            collider_id: 5
        }
    );
    let message = message_via_std(err)?;
    assert_eq!(message, "a collider 5 is already registered for slot 2");
    Ok(())
}

#[test]
fn invalid_shape_trimesh_code_message_and_equality() -> TestResult {
    let err = Physics3DError::InvalidShape {
        reason: InvalidShapeReason::TrimeshIndexOutOfRange,
    };
    assert_eq!(err.code(), "PHYSICS3D:INVALID_SHAPE");
    assert_eq!(
        err.to_string(),
        "shape refused: a triangle index is outside the vertex list"
    );
    assert_eq!(
        err,
        Physics3DError::InvalidShape {
            reason: InvalidShapeReason::TrimeshIndexOutOfRange
        }
    );
    assert_ne!(
        err,
        Physics3DError::InvalidShape {
            reason: InvalidShapeReason::HeightfieldTooSmall
        }
    );
    let message = message_via_std(err)?;
    assert_eq!(
        message,
        "shape refused: a triangle index is outside the vertex list"
    );
    Ok(())
}

#[test]
fn invalid_shape_heightfield_code_message_and_equality() -> TestResult {
    let err = Physics3DError::InvalidShape {
        reason: InvalidShapeReason::HeightfieldTooSmall,
    };
    assert_eq!(err.code(), "PHYSICS3D:INVALID_SHAPE");
    assert_eq!(
        err.to_string(),
        "shape refused: a heightfield needs at least 2 rows and 2 columns"
    );
    assert_eq!(
        err,
        Physics3DError::InvalidShape {
            reason: InvalidShapeReason::HeightfieldTooSmall
        }
    );
    assert_ne!(
        err,
        Physics3DError::InvalidShape {
            reason: InvalidShapeReason::ConvexTooFewPoints
        }
    );
    let message = message_via_std(err)?;
    assert_eq!(
        message,
        "shape refused: a heightfield needs at least 2 rows and 2 columns"
    );
    Ok(())
}

#[test]
fn invalid_shape_heightfield_samples_code_message_and_equality() -> TestResult {
    let err = Physics3DError::InvalidShape {
        reason: InvalidShapeReason::HeightfieldSampleCount,
    };
    assert_eq!(err.code(), "PHYSICS3D:INVALID_SHAPE");
    assert_eq!(
        err.to_string(),
        "shape refused: the heightfield sample count does not match rows times columns"
    );
    assert_eq!(
        err,
        Physics3DError::InvalidShape {
            reason: InvalidShapeReason::HeightfieldSampleCount
        }
    );
    assert_ne!(
        err,
        Physics3DError::InvalidShape {
            reason: InvalidShapeReason::HeightfieldTooSmall
        }
    );
    let message = message_via_std(err)?;
    assert_eq!(
        message,
        "shape refused: the heightfield sample count does not match rows times columns"
    );
    Ok(())
}

#[test]
fn invalid_shape_convex_code_message_and_equality() -> TestResult {
    let err = Physics3DError::InvalidShape {
        reason: InvalidShapeReason::ConvexTooFewPoints,
    };
    assert_eq!(err.code(), "PHYSICS3D:INVALID_SHAPE");
    assert_eq!(
        err.to_string(),
        "shape refused: a convex hull needs at least 4 points"
    );
    assert_eq!(
        err,
        Physics3DError::InvalidShape {
            reason: InvalidShapeReason::ConvexTooFewPoints
        }
    );
    assert_ne!(
        err,
        Physics3DError::InvalidShape {
            reason: InvalidShapeReason::TrimeshIndexOutOfRange
        }
    );
    let message = message_via_std(err)?;
    assert_eq!(
        message,
        "shape refused: a convex hull needs at least 4 points"
    );
    Ok(())
}

#[test]
fn invalid_mesh_buffer_code_message_and_equality() -> TestResult {
    let err = Physics3DError::InvalidMeshBuffer { actual: 10 };
    assert_eq!(err.code(), "PHYSICS3D:INVALID_MESH_BUFFER");
    assert_eq!(
        err.to_string(),
        "mesh buffer length 10 is not a multiple of 3"
    );
    assert_eq!(err, Physics3DError::InvalidMeshBuffer { actual: 10 });
    assert_ne!(err, Physics3DError::InvalidMeshBuffer { actual: 11 });
    let message = message_via_std(err)?;
    assert_eq!(message, "mesh buffer length 10 is not a multiple of 3");
    Ok(())
}

#[test]
fn invalid_compound_length_code_message_and_equality() -> TestResult {
    let err = Physics3DError::InvalidCompound {
        reason: InvalidCompoundReason::LengthNotMultipleOfStride,
    };
    assert_eq!(err.code(), "PHYSICS3D:INVALID_COMPOUND");
    assert_eq!(
        err.to_string(),
        "compound refused: the buffer length is not a multiple of 12"
    );
    assert_eq!(
        err,
        Physics3DError::InvalidCompound {
            reason: InvalidCompoundReason::LengthNotMultipleOfStride
        }
    );
    assert_ne!(
        err,
        Physics3DError::InvalidCompound {
            reason: InvalidCompoundReason::UnknownShapeType
        }
    );
    let message = message_via_std(err)?;
    assert_eq!(
        message,
        "compound refused: the buffer length is not a multiple of 12"
    );
    Ok(())
}

#[test]
fn invalid_compound_shape_type_code_message_and_equality() -> TestResult {
    let err = Physics3DError::InvalidCompound {
        reason: InvalidCompoundReason::UnknownShapeType,
    };
    assert_eq!(err.code(), "PHYSICS3D:INVALID_COMPOUND");
    assert_eq!(
        err.to_string(),
        "compound refused: a part has an unknown shape type"
    );
    assert_eq!(
        err,
        Physics3DError::InvalidCompound {
            reason: InvalidCompoundReason::UnknownShapeType
        }
    );
    assert_ne!(
        err,
        Physics3DError::InvalidCompound {
            reason: InvalidCompoundReason::LengthNotMultipleOfStride
        }
    );
    let message = message_via_std(err)?;
    assert_eq!(
        message,
        "compound refused: a part has an unknown shape type"
    );
    Ok(())
}

/// Asserts code, message, `dyn Error` message, equality and inequality with `other`.
fn check_error(
    err: Physics3DError,
    code: &str,
    message: &str,
    other: Physics3DError,
) -> TestResult {
    assert_eq!(err.code(), code);
    assert_eq!(err.to_string(), message);
    let same = err;
    assert_eq!(err, same);
    assert_ne!(err, other);
    assert_eq!(message_via_std(err)?, message);
    Ok(())
}

fn bvh(reason: BvhLoadReason) -> Physics3DError {
    Physics3DError::BvhLoadFailed { reason }
}

#[test]
fn bvh_load_failed_too_short_code_message_and_equality() -> TestResult {
    check_error(
        bvh(BvhLoadReason::TooShort),
        "PHYSICS3D:BVH_LOAD_FAILED",
        "BVH load failed: the buffer is shorter than the 8-byte header",
        bvh(BvhLoadReason::BadMagic),
    )
}

#[test]
fn bvh_load_failed_bad_magic_code_message_and_equality() -> TestResult {
    check_error(
        bvh(BvhLoadReason::BadMagic),
        "PHYSICS3D:BVH_LOAD_FAILED",
        "BVH load failed: the magic is not GBVH",
        bvh(BvhLoadReason::TooShort),
    )
}

#[test]
fn bvh_load_failed_decode_failed_code_message_and_equality() -> TestResult {
    check_error(
        bvh(BvhLoadReason::DecodeFailed),
        "PHYSICS3D:BVH_LOAD_FAILED",
        "BVH load failed: the payload is not a valid triangle mesh",
        bvh(BvhLoadReason::InvalidMesh),
    )
}

#[test]
fn bvh_load_failed_invalid_mesh_code_message_and_equality() -> TestResult {
    check_error(
        bvh(BvhLoadReason::InvalidMesh),
        "PHYSICS3D:BVH_LOAD_FAILED",
        "BVH load failed: the decoded mesh is empty, not finite, or has an index outside its list",
        bvh(BvhLoadReason::DecodeFailed),
    )
}

#[test]
fn invalid_shape_convex_degenerate_code_message_and_equality() -> TestResult {
    check_error(
        Physics3DError::InvalidShape {
            reason: InvalidShapeReason::ConvexDegenerate,
        },
        "PHYSICS3D:INVALID_SHAPE",
        "shape refused: a convex hull cannot be built from these points",
        Physics3DError::InvalidShape {
            reason: InvalidShapeReason::ConvexTooFewPoints,
        },
    )
}

#[test]
fn invalid_shape_mesh_empty_code_message_and_equality() -> TestResult {
    check_error(
        Physics3DError::InvalidShape {
            reason: InvalidShapeReason::MeshEmpty,
        },
        "PHYSICS3D:INVALID_SHAPE",
        "shape refused: a mesh needs at least one vertex and one triangle",
        Physics3DError::InvalidShape {
            reason: InvalidShapeReason::ConvexDegenerate,
        },
    )
}

#[test]
fn invalid_collider_too_large_code_message_and_equality() -> TestResult {
    check_error(
        Physics3DError::InvalidCollider {
            reason: InvalidColliderReason::TooLarge,
        },
        "PHYSICS3D:INVALID_COLLIDER",
        "collider refused: a value is larger than the accepted magnitude",
        Physics3DError::InvalidCollider {
            reason: InvalidColliderReason::Negative,
        },
    )
}

#[test]
fn joint_not_found_code_message_and_equality() -> TestResult {
    let err = Physics3DError::JointNotFound { joint_id: 12 };
    assert_eq!(err.code(), "PHYSICS3D:JOINT_NOT_FOUND");
    assert_eq!(err.to_string(), "no joint is registered for id 12");
    assert_eq!(err, Physics3DError::JointNotFound { joint_id: 12 });
    assert_ne!(err, Physics3DError::JointNotFound { joint_id: 13 });
    let message = message_via_std(err)?;
    assert_eq!(message, "no joint is registered for id 12");
    Ok(())
}

#[test]
fn character_controller_not_found_code_message_and_equality() -> TestResult {
    let err = Physics3DError::CharacterControllerNotFound { slot: 6 };
    assert_eq!(err.code(), "PHYSICS3D:CHARACTER_CONTROLLER_NOT_FOUND");
    assert_eq!(
        err.to_string(),
        "no character controller is registered for slot 6"
    );
    assert_eq!(err, Physics3DError::CharacterControllerNotFound { slot: 6 });
    assert_ne!(err, Physics3DError::CharacterControllerNotFound { slot: 7 });
    let message = message_via_std(err)?;
    assert_eq!(message, "no character controller is registered for slot 6");
    Ok(())
}

#[test]
fn character_controller_limit_reached_code_message_and_equality() -> TestResult {
    let err = Physics3DError::CharacterControllerLimitReached { max: 32 };
    assert_eq!(err.code(), "PHYSICS3D:CHARACTER_CONTROLLER_LIMIT_REACHED");
    assert_eq!(err.to_string(), "character controller limit reached: 32");
    assert_eq!(
        err,
        Physics3DError::CharacterControllerLimitReached { max: 32 }
    );
    assert_ne!(
        err,
        Physics3DError::CharacterControllerLimitReached { max: 16 }
    );
    let message = message_via_std(err)?;
    assert_eq!(message, "character controller limit reached: 32");
    Ok(())
}

#[test]
fn navgrid_not_initialized_code_message_and_equality() -> TestResult {
    let err = Physics3DError::NavGridNotInitialized;
    assert_eq!(err.code(), "PHYSICS3D:NAVGRID_NOT_INITIALIZED");
    assert_eq!(err.to_string(), "navigation grid is not initialized");
    assert_eq!(err, Physics3DError::NavGridNotInitialized);
    assert_ne!(err, Physics3DError::WorldNotInitialized);
    let message = message_via_std(err)?;
    assert_eq!(message, "navigation grid is not initialized");
    Ok(())
}

fn invalid_navgrid_message() -> String {
    format!(
        "navigation grid 0x4x4 is invalid: a dimension is zero, the cell count overflows, or it is above {MAX_NAVGRID_CELLS} cells"
    )
}

#[test]
fn invalid_navgrid_code_message_and_equality() -> TestResult {
    let err = Physics3DError::InvalidNavGrid { w: 0, h: 4, d: 4 };
    assert_eq!(err.code(), "PHYSICS3D:INVALID_NAVGRID");
    assert_eq!(err.to_string(), invalid_navgrid_message());
    assert_eq!(err, Physics3DError::InvalidNavGrid { w: 0, h: 4, d: 4 });
    assert_ne!(err, Physics3DError::InvalidNavGrid { w: 1, h: 4, d: 4 });
    let message = message_via_std(err)?;
    assert_eq!(message, invalid_navgrid_message());
    Ok(())
}

#[test]
fn invalid_path_request_non_finite_code_message_and_equality() -> TestResult {
    let err = Physics3DError::InvalidPathRequest {
        reason: PathRequestReject::NonFinite,
    };
    assert_eq!(err.code(), "PHYSICS3D:INVALID_PATH_REQUEST");
    assert_eq!(
        err.to_string(),
        "path request refused: a coordinate is not finite"
    );
    assert_eq!(
        err,
        Physics3DError::InvalidPathRequest {
            reason: PathRequestReject::NonFinite
        }
    );
    assert_ne!(
        err,
        Physics3DError::InvalidPathRequest {
            reason: PathRequestReject::CoordOutOfRange
        }
    );
    let message = message_via_std(err)?;
    assert_eq!(message, "path request refused: a coordinate is not finite");
    Ok(())
}

#[test]
fn invalid_path_request_coord_out_of_range_code_message_and_equality() -> TestResult {
    let err = Physics3DError::InvalidPathRequest {
        reason: PathRequestReject::CoordOutOfRange,
    };
    assert_eq!(err.code(), "PHYSICS3D:INVALID_PATH_REQUEST");
    assert_eq!(
        err.to_string(),
        "path request refused: a coordinate is past the accepted bound"
    );
    let message = message_via_std(err)?;
    assert_eq!(
        message,
        "path request refused: a coordinate is past the accepted bound"
    );
    Ok(())
}

#[test]
fn invalid_collider_non_finite_code_message_and_equality() -> TestResult {
    let err = Physics3DError::InvalidCollider {
        reason: InvalidColliderReason::NonFinite,
    };
    assert_eq!(err.code(), "PHYSICS3D:INVALID_COLLIDER");
    assert_eq!(err.to_string(), "collider refused: a value is not finite");
    assert_eq!(
        err,
        Physics3DError::InvalidCollider {
            reason: InvalidColliderReason::NonFinite
        }
    );
    assert_ne!(
        err,
        Physics3DError::InvalidCollider {
            reason: InvalidColliderReason::Negative
        }
    );
    let message = message_via_std(err)?;
    assert_eq!(message, "collider refused: a value is not finite");
    Ok(())
}

#[test]
fn invalid_collider_negative_code_message_and_equality() -> TestResult {
    let err = Physics3DError::InvalidCollider {
        reason: InvalidColliderReason::Negative,
    };
    assert_eq!(err.code(), "PHYSICS3D:INVALID_COLLIDER");
    assert_eq!(
        err.to_string(),
        "collider refused: a value must not be negative"
    );
    assert_eq!(
        err,
        Physics3DError::InvalidCollider {
            reason: InvalidColliderReason::Negative
        }
    );
    assert_ne!(
        err,
        Physics3DError::InvalidCollider {
            reason: InvalidColliderReason::NonFinite
        }
    );
    let message = message_via_std(err)?;
    assert_eq!(message, "collider refused: a value must not be negative");
    Ok(())
}

#[test]
fn core_error_code_message_and_equality() -> TestResult {
    let inner = CoreError::EntityLimitReached { max: 4 };
    let err = Physics3DError::Core(inner);
    assert_eq!(err.code(), "CORE:ENTITY_LIMIT_REACHED");
    assert_eq!(err.to_string(), "Entity limit reached: 4");
    assert_eq!(err, Physics3DError::Core(inner));
    assert_ne!(
        err,
        Physics3DError::Core(CoreError::EntityLimitReached { max: 5 })
    );
    let message = message_via_std(err)?;
    assert_eq!(message, "Entity limit reached: 4");
    Ok(())
}
