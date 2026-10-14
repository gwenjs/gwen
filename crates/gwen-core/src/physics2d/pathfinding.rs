//! Pathfinding 2D — A* grid implementation.
//!
//! The solver runs on an integer grid derived from world-space coordinates.
//! World inputs are rounded to nearest grid cell and path nodes are written
//! back as `f32` points in `PATH_BUFFER`.

use pathfinding::prelude::astar;
use wasm_bindgen::prelude::*;

/// Maximum number of nodes in a single path result.
pub const MAX_PATH_NODES: usize = 256;

/// Largest cell coordinate [`find_path_2d`] accepts, inclusive.
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

/// Largest Manhattan distance [`find_path_2d`] accepts, inclusive.
///
/// A 4-connected path of this distance has [`MAX_PATH_NODES`] nodes.
/// A longer request is refused before the search, instead of running and
/// then keeping only the first 256 nodes.
///
/// A native debug call of the worst accepted request, `(0, 0)` to `(255, 0)`,
/// took 1_386_750 ns around `find_path_2d`. The process that made that call
/// had a maximum resident set size of 2_818_048 bytes (`/usr/bin/time -l`).
/// That size includes the test harness.
pub const MAX_PATH_DISTANCE: u32 = 255;

/// A node in a path (x, y coordinate).
#[repr(C)]
#[derive(Debug, Clone, Copy, Default)]
pub struct PathNode {
    pub x: f32,
    pub y: f32,
}

static mut PATH_BUFFER: [PathNode; MAX_PATH_NODES] = [PathNode { x: 0.0, y: 0.0 }; MAX_PATH_NODES];
static mut PATH_NODE_COUNT: usize = 0;

fn neighbors4((x, y): (i32, i32)) -> [(i32, i32); 4] {
    [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)]
}

#[inline]
fn manhattan((ax, ay): (i32, i32), (bx, by): (i32, i32)) -> u32 {
    ((ax - bx).abs() + (ay - by).abs()) as u32
}

/// Returns a raw pointer to the static path buffer.
///
/// # Safety
/// This pointer is only valid until the next `find_path_2d` call.
#[wasm_bindgen]
pub fn get_path_buffer_ptr() -> *const PathNode {
    std::ptr::addr_of!(PATH_BUFFER) as *const PathNode
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

/// Find a path between two points in 2D space.
///
/// # Returns
/// The number of nodes in the found path (up to `MAX_PATH_NODES`).
///
/// # Errors
/// Returns [`Physics2DError::InvalidPathRequest`] when a coordinate is not
/// finite, a rounded coordinate is outside [`MAX_PATH_COORD`], or the
/// Manhattan distance is above [`MAX_PATH_DISTANCE`]. A refusal does not
/// write the path buffer.
#[wasm_bindgen]
pub fn find_path_2d(
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
    // SAFETY: `PATH_BUFFER` is a static mut and this function is its only writer.
    // The write finishes before any caller reads the buffer. [U-008]
    unsafe {
        for (i, (x, y)) in path.into_iter().take(count).enumerate() {
            PATH_BUFFER[i] = PathNode {
                x: x as f32,
                y: y as f32,
            };
        }
        PATH_NODE_COUNT = count;
        Ok(PATH_NODE_COUNT)
    }
}
