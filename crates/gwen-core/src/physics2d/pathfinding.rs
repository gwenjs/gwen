//! Pathfinding 2D — A* grid implementation.
//!
//! The solver runs on an integer grid derived from world-space coordinates.
//! World inputs are rounded to nearest grid cell and path nodes are written
//! back as `f32` points in the buffer the caller passes.
//! Each engine owns that buffer. It is allocated once in `Engine::new`.

use pathfinding::prelude::astar;

/// Maximum number of nodes in a single path result.
pub const MAX_PATH_NODES: usize = 256;

/// Largest cell coordinate `Engine::path_find_2d` accepts, inclusive.
///
/// Every integer from `-16777216` to `16777216` is an exact `f32`.
/// This bound is `2^24 - 1`, so the next `f32` is the first refused value.
/// A cell inside the bound has a 4-neighbour at most one step outside it
/// (`16_777_216`), and that step still fits in `i32`. `neighbors4` only adds
/// or subtracts 1. The Manhattan helper runs on accepted cells and on those
/// neighbours. The difference of two such values is at most `33_554_432`,
/// which fits in `i32` and is not `i32::MIN`, so `.abs()` does not overflow.
/// The sum of the two absolute differences fits in `u32`.
pub const MAX_PATH_COORD: i32 = 16_777_215;

/// Largest Manhattan distance `Engine::path_find_2d` accepts, inclusive.
///
/// A 4-connected path of this distance has [`MAX_PATH_NODES`] nodes.
/// A longer request is refused before the search, instead of running and
/// then keeping only the first 256 nodes.
pub const MAX_PATH_DISTANCE: u32 = 255;

/// A node in a path (x, y coordinate).
#[repr(C)]
#[derive(Debug, Clone, Copy, Default)]
pub struct PathNode {
    pub x: f32,
    pub y: f32,
}

fn neighbors4((x, y): (i32, i32)) -> [(i32, i32); 4] {
    [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)]
}

#[inline]
fn manhattan((ax, ay): (i32, i32), (bx, by): (i32, i32)) -> u32 {
    ((ax - bx).abs() + (ay - by).abs()) as u32
}

fn cell(value: f32) -> Result<i32, super::Physics2DError> {
    if !value.is_finite() {
        return Err(super::Physics2DError::InvalidPathRequest {
            reason: super::PathRequestReject::NonFinite,
        });
    }
    let rounded = value.round();
    if rounded > MAX_PATH_COORD as f32 || rounded < -(MAX_PATH_COORD as f32) {
        return Err(super::Physics2DError::InvalidPathRequest {
            reason: super::PathRequestReject::CoordOutOfRange,
        });
    }
    Ok(rounded as i32)
}

/// Find a path between two points and write it into `buffer`.
///
/// # Returns
/// The number of nodes written (up to `MAX_PATH_NODES`).
///
/// # Errors
/// Returns [`Physics2DError::InvalidPathRequest`] when a coordinate is not
/// finite, a rounded coordinate is outside [`MAX_PATH_COORD`], or the
/// Manhattan distance is above [`MAX_PATH_DISTANCE`]. A refusal does not
/// write `buffer`.
pub(crate) fn find_path_2d(
    buffer: &mut [PathNode; MAX_PATH_NODES],
    start_x: f32,
    start_y: f32,
    end_x: f32,
    end_y: f32,
) -> Result<usize, super::Physics2DError> {
    let start = (cell(start_x)?, cell(start_y)?);
    let goal = (cell(end_x)?, cell(end_y)?);
    if manhattan(start, goal) > MAX_PATH_DISTANCE {
        return Err(super::Physics2DError::InvalidPathRequest {
            reason: super::PathRequestReject::DistanceOutOfRange,
        });
    }

    let path = astar(
        &start,
        |&p| neighbors4(p).into_iter().map(|n| (n, 1u32)),
        |&p| manhattan(p, goal),
        |&p| p == goal,
    )
    .map(|(nodes, _cost)| nodes)
    .unwrap_or_else(|| vec![start, goal]);

    let count = path.len().min(MAX_PATH_NODES);
    for (i, (x, y)) in path.into_iter().take(count).enumerate() {
        buffer[i] = PathNode {
            x: x as f32,
            y: y as f32,
        };
    }
    Ok(count)
}
