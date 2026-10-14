//! `Physics2DError` codes, messages, and equality.
//!
//! Native only. `verify-red` runs this target without `--features physics2d`,
//! so the file is empty in that run. The physics2d CI step runs these tests.

#![cfg(feature = "physics2d")]

use gwen_core::ecs::CoreError;
use gwen_core::physics2d::{PathRequestReject, Physics2DError};

fn assert_std_error(err: &Physics2DError) {
    let displayed: &dyn std::error::Error = err;
    assert_eq!(displayed.to_string(), err.to_string());
}

#[test]
fn world_not_initialized_code_message_and_equality() {
    let err = Physics2DError::WorldNotInitialized;
    assert_eq!(err.code(), "PHYSICS2D:NOT_INITIALIZED");
    assert_eq!(err.to_string(), "physics world is not initialized");
    assert_eq!(err, Physics2DError::WorldNotInitialized);
    assert_ne!(err, Physics2DError::TilemapChunkNotLoaded);
    assert_std_error(&err);
}

#[test]
fn body_not_found_code_message_and_equality() {
    let err = Physics2DError::BodyNotFound { slot: 7 };
    assert_eq!(err.code(), "PHYSICS2D:BODY_NOT_FOUND");
    assert_eq!(err.to_string(), "no rigid body is registered for slot 7");
    assert_eq!(err, Physics2DError::BodyNotFound { slot: 7 });
    assert_ne!(err, Physics2DError::BodyNotFound { slot: 8 });
    assert_std_error(&err);
}

#[test]
fn body_already_exists_code_message_and_equality() {
    let err = Physics2DError::BodyAlreadyExists { slot: 3 };
    assert_eq!(err.code(), "PHYSICS2D:BODY_ALREADY_EXISTS");
    assert_eq!(
        err.to_string(),
        "a rigid body is already registered for slot 3"
    );
    assert_eq!(err, Physics2DError::BodyAlreadyExists { slot: 3 });
    assert_ne!(err, Physics2DError::BodyAlreadyExists { slot: 4 });
    assert_std_error(&err);
}

#[test]
fn stale_body_handle_code_message_and_equality() {
    let err = Physics2DError::StaleBodyHandle { handle: 11 };
    assert_eq!(err.code(), "PHYSICS2D:STALE_BODY_HANDLE");
    assert_eq!(err.to_string(), "body handle 11 is not registered");
    assert_eq!(err, Physics2DError::StaleBodyHandle { handle: 11 });
    assert_ne!(err, Physics2DError::StaleBodyHandle { handle: 12 });
    assert_std_error(&err);
}

#[test]
fn invalid_body_kind_code_message_and_equality() {
    let err = Physics2DError::InvalidBodyKind { kind: 9 };
    assert_eq!(err.code(), "PHYSICS2D:INVALID_BODY_KIND");
    assert_eq!(err.to_string(), "body kind 9 is outside 0, 1, and 2");
    assert_eq!(err, Physics2DError::InvalidBodyKind { kind: 9 });
    assert_ne!(err, Physics2DError::InvalidBodyKind { kind: 1 });
    assert_std_error(&err);
}

#[test]
fn buffer_length_mismatch_code_message_and_equality() {
    let err = Physics2DError::BufferLengthMismatch {
        buffer: "vx",
        expected: 4,
        actual: 3,
    };
    assert_eq!(err.code(), "PHYSICS2D:BUFFER_LENGTH_MISMATCH");
    assert_eq!(
        err.to_string(),
        "buffer vx length mismatch: expected 4, actual 3"
    );
    assert_eq!(
        err,
        Physics2DError::BufferLengthMismatch {
            buffer: "vx",
            expected: 4,
            actual: 3,
        }
    );
    assert_ne!(
        err,
        Physics2DError::BufferLengthMismatch {
            buffer: "vx",
            expected: 4,
            actual: 2,
        }
    );
    assert_std_error(&err);
}

#[test]
fn tilemap_chunk_already_loaded_code_message_and_equality() {
    let err = Physics2DError::TilemapChunkAlreadyLoaded;
    assert_eq!(err.code(), "PHYSICS2D:TILEMAP_CHUNK_ALREADY_LOADED");
    assert_eq!(err.to_string(), "tilemap chunk is already loaded");
    assert_eq!(err, Physics2DError::TilemapChunkAlreadyLoaded);
    assert_ne!(err, Physics2DError::TilemapChunkNotLoaded);
    assert_std_error(&err);
}

#[test]
fn tilemap_chunk_not_loaded_code_message_and_equality() {
    let err = Physics2DError::TilemapChunkNotLoaded;
    assert_eq!(err.code(), "PHYSICS2D:TILEMAP_CHUNK_NOT_LOADED");
    assert_eq!(err.to_string(), "tilemap chunk is not loaded");
    assert_eq!(err, Physics2DError::TilemapChunkNotLoaded);
    assert_ne!(err, Physics2DError::TilemapChunkAlreadyLoaded);
    assert_std_error(&err);
}

#[test]
fn invalid_path_request_code_message_and_equality() {
    let finite = Physics2DError::InvalidPathRequest {
        reason: PathRequestReject::NonFinite,
    };
    let coord = Physics2DError::InvalidPathRequest {
        reason: PathRequestReject::CoordOutOfRange,
    };
    let distance = Physics2DError::InvalidPathRequest {
        reason: PathRequestReject::DistanceOutOfRange,
    };
    assert_eq!(finite.code(), "PHYSICS2D:INVALID_PATH_REQUEST");
    assert_eq!(coord.code(), "PHYSICS2D:INVALID_PATH_REQUEST");
    assert_eq!(distance.code(), "PHYSICS2D:INVALID_PATH_REQUEST");
    assert_eq!(
        finite.to_string(),
        "path request refused: a coordinate is not finite"
    );
    assert_eq!(
        coord.to_string(),
        "path request refused: a coordinate is past the accepted bound"
    );
    assert_eq!(
        distance.to_string(),
        "path request refused: the Manhattan distance is past the accepted bound"
    );
    assert_eq!(finite, finite);
    assert_ne!(finite, coord);
    assert_ne!(coord, distance);
    assert_std_error(&finite);
}

#[test]
fn core_error_code_message_and_equality() {
    let inner = CoreError::EntityLimitReached { max: 4 };
    let err = Physics2DError::Core(inner);
    assert_eq!(err.code(), "CORE:ENTITY_LIMIT_REACHED");
    assert_eq!(err.to_string(), inner.to_string());
    assert_eq!(err.to_string(), "Entity limit reached: 4");
    assert_eq!(err, Physics2DError::Core(inner));
    assert_ne!(
        err,
        Physics2DError::Core(CoreError::EntityLimitReached { max: 5 })
    );
    assert_std_error(&err);
}
