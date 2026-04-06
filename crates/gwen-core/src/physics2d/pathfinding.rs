//! Pathfinding 2D — A* grid implementation.
//!
//! The solver runs on an integer grid derived from world-space coordinates.
//! World inputs are rounded to nearest grid cell and path nodes are written
//! back as `f32` points in `PATH_BUFFER`.

use wasm_bindgen::prelude::*;

#[cfg(feature = "pathfinding-2d")]
use pathfinding::prelude::astar;

/// Maximum number of nodes in a single path result.
pub const MAX_PATH_NODES: usize = 256;

/// A node in a path (x, y coordinate).
#[repr(C)]
#[derive(Debug, Clone, Copy, Default)]
pub struct PathNode {
    pub x: f32,
    pub y: f32,
}

static mut PATH_BUFFER: [PathNode; MAX_PATH_NODES] = [PathNode { x: 0.0, y: 0.0 }; MAX_PATH_NODES];
static mut PATH_NODE_COUNT: usize = 0;

#[cfg(feature = "pathfinding-2d")]
fn neighbors4((x, y): (i32, i32)) -> [(i32, i32); 4] {
    [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)]
}

#[cfg(feature = "pathfinding-2d")]
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

/// Find a path between two points in 2D space.
///
/// # Returns
/// The number of nodes in the found path (up to `MAX_PATH_NODES`).
#[wasm_bindgen]
pub fn find_path_2d(
    start_x: f32,
    start_y: f32,
    end_x: f32,
    end_y: f32,
) -> usize {
    let start = (start_x.round() as i32, start_y.round() as i32);
    let goal = (end_x.round() as i32, end_y.round() as i32);

    #[cfg(feature = "pathfinding-2d")]
    {
        let path = astar(
            &start,
            |&p| neighbors4(p).into_iter().map(|n| (n, 1u32)),
            |&p| manhattan(p, goal),
            |&p| p == goal,
        )
        .map(|(nodes, _cost)| nodes)
        .unwrap_or_else(|| vec![start, goal]);

        let count = path.len().min(MAX_PATH_NODES);
        unsafe {
            for (i, (x, y)) in path.into_iter().take(count).enumerate() {
                PATH_BUFFER[i] = PathNode {
                    x: x as f32,
                    y: y as f32,
                };
            }
            PATH_NODE_COUNT = count;
            return PATH_NODE_COUNT;
        }
    }

    #[cfg(not(feature = "pathfinding-2d"))]
    unsafe {
        PATH_BUFFER[0] = PathNode {
            x: start.0 as f32,
            y: start.1 as f32,
        };
        PATH_BUFFER[1] = PathNode {
            x: goal.0 as f32,
            y: goal.1 as f32,
        };
        PATH_NODE_COUNT = 2;
        PATH_NODE_COUNT
    }
}
