//! Pathfinding 3D — A* voxel-grid implementation.
//!
//! The solver runs on an integer 3D grid derived from world-space coordinates.
//! Cells are one byte each: `0` = open/walkable, `1` = solid/blocked.
//! Results are written to a static [`PATH_BUFFER_3D`] as `[x, y, z, x, y, z, …]` f32 triples.
//!
//! # Feature gate
//! Full A* search is only available with the `pathfinding-3d` feature. Without
//! it, [`find_path_3d`] falls back to a trivial two-waypoint straight-line result.
//!
//! # Usage
//! 1. Call [`init_navgrid_3d`] once (or whenever the grid changes) to upload the
//!    voxel data from WASM linear memory.
//! 2. Call [`find_path_3d`] to compute a path; the return value is the waypoint count.
//! 3. Call [`get_path_buffer_ptr_3d`] to obtain a pointer to the result buffer and
//!    wrap it in a `Float32Array` view from JavaScript.

use wasm_bindgen::prelude::*;

#[cfg(feature = "pathfinding-3d")]
use pathfinding::prelude::astar;

/// Maximum number of waypoint nodes in one path result.
pub const MAX_PATH_NODES_3D: usize = 512;

/// Voxel grid state uploaded by [`init_navgrid_3d`].
#[derive(Default)]
struct NavGrid3D {
    /// Flat voxel array in row-major order: `index = x + y*width + z*width*height`.
    cells: Vec<u8>,
    /// Number of cells along the X axis.
    width: usize,
    /// Number of cells along the Y axis.
    height: usize,
    /// Number of cells along the Z axis.
    depth: usize,
    /// World-space size of one cubic cell (metres).
    cell_size: f32,
    /// World-space X origin of the first cell.
    origin_x: f32,
    /// World-space Y origin of the first cell.
    origin_y: f32,
    /// World-space Z origin of the first cell.
    origin_z: f32,
}

/// Shared static path output buffer (3 f32 per node: x, y, z).
///
/// Written by [`find_path_3d`]; read via [`get_path_buffer_ptr_3d`].
static mut PATH_BUFFER_3D: [f32; MAX_PATH_NODES_3D * 3] = [0.0_f32; MAX_PATH_NODES_3D * 3];

/// Shared mutable nav grid, populated by [`init_navgrid_3d`].
static mut NAV_GRID_3D: Option<NavGrid3D> = None;

// ─── Public WASM API ──────────────────────────────────────────────────────────

/// Returns a raw pointer to the start of the 3D path waypoint buffer.
///
/// # Description
/// The buffer holds up to [`MAX_PATH_NODES_3D`] waypoints, each encoded as
/// three consecutive `f32` values `(x, y, z)`. Wrap the returned pointer in a
/// `Float32Array` view over WASM linear memory from JavaScript.
///
/// # Returns
/// A const pointer to the first `f32` element of `PATH_BUFFER_3D`.
///
/// # Safety
/// The pointer is valid until the next [`find_path_3d`] call overwrites the buffer.
#[wasm_bindgen]
pub fn get_path_buffer_ptr_3d() -> *const f32 {
    // Taking the address of a static item is always safe; no dereference occurs here.
    std::ptr::addr_of!(PATH_BUFFER_3D) as *const f32
}

/// Uploads a voxel navigation grid for 3D A* pathfinding.
///
/// # Description
/// The grid is immediately copied from the supplied pointer into Rust-owned
/// heap storage so the caller may free the source buffer after this returns.
/// Any previously uploaded grid is replaced.
///
/// Cell encoding: `0` = walkable, any non-zero value = solid/blocked.
/// The flat array is indexed as `x + y*width + z*width*height`.
///
/// # Arguments
/// * `ptr`       — WASM linear-memory pointer to the flat `u8` cell array.
/// * `width`     — Number of cells along the X axis.
/// * `height`    — Number of cells along the Y axis.
/// * `depth`     — Number of cells along the Z axis.
/// * `cell_size` — World-space size of one cubic cell in metres.
/// * `origin_x`  — World-space X coordinate of the grid origin.
/// * `origin_y`  — World-space Y coordinate of the grid origin.
/// * `origin_z`  — World-space Z coordinate of the grid origin.
///
/// # Safety
/// `ptr` must point to a valid, readable allocation of at least
/// `width * height * depth` bytes for the duration of this call.
#[wasm_bindgen]
pub fn init_navgrid_3d(
    ptr: *const u8,
    width: usize,
    height: usize,
    depth: usize,
    cell_size: f32,
    origin_x: f32,
    origin_y: f32,
    origin_z: f32,
) {
    let len = width * height * depth;
    // SAFETY: the contract requires `ptr` to point to at least `len` readable bytes.
    let cells = unsafe { std::slice::from_raw_parts(ptr, len).to_vec() };
    // SAFETY: single-threaded WASM environment; no concurrent access.
    unsafe {
        NAV_GRID_3D = Some(NavGrid3D {
            cells,
            width,
            height,
            depth,
            cell_size,
            origin_x,
            origin_y,
            origin_z,
        });
    }
}

/// Find a path between two world-space points using A* on the uploaded voxel grid.
///
/// # Description
/// Converts `from` and `to` to integer grid cells, runs A* with a 6-connected
/// neighbour set (±X, ±Y, ±Z) and a Manhattan distance heuristic, then writes
/// the resulting waypoints to [`PATH_BUFFER_3D`] as `(x, y, z)` f32 triples at
/// cell-centre world-space positions.
///
/// If the `pathfinding-3d` feature is not enabled, a trivial two-waypoint
/// straight-line result (`from → to`) is written instead.
///
/// # Arguments
/// * `from_x/from_y/from_z` — World-space start position.
/// * `to_x/to_y/to_z`       — World-space goal position.
///
/// # Returns
/// The number of waypoints written to the path buffer, or `0` if no grid has
/// been uploaded via [`init_navgrid_3d`].
#[wasm_bindgen]
pub fn find_path_3d(
    from_x: f32,
    from_y: f32,
    from_z: f32,
    to_x: f32,
    to_y: f32,
    to_z: f32,
) -> usize {
    // SAFETY: single-threaded WASM; no concurrent writes to NAV_GRID_3D.
    // Use a raw-pointer read to avoid the `static_mut_refs` lint while still
    // allowing safe pattern-matching on the Option.
    let grid = unsafe {
        let ptr = std::ptr::addr_of!(NAV_GRID_3D);
        match (*ptr).as_ref() {
            Some(g) => g,
            None => return 0,
        }
    };

    let start = world_to_cell(from_x, from_y, from_z, grid);
    let goal = world_to_cell(to_x, to_y, to_z, grid);

    #[cfg(feature = "pathfinding-3d")]
    {
        // SAFETY: we just confirmed NAV_GRID_3D is Some above via addr_of! read.
        // No mutation occurs between the two accesses in this single-threaded context.
        let grid_ref = unsafe {
            let ptr = std::ptr::addr_of!(NAV_GRID_3D);
            (*ptr).as_ref().unwrap()
        };
        let path = astar(
            &start,
            |&p| neighbors6(p, grid_ref),
            |&p| manhattan3(p, goal),
            |&p| p == goal,
        )
        .map(|(nodes, _cost)| nodes)
        // Fall back to a straight two-waypoint path when no route exists.
        .unwrap_or_else(|| vec![start, goal]);

        let count = path.len().min(MAX_PATH_NODES_3D);
        // SAFETY: `count <= MAX_PATH_NODES_3D`, so all index arithmetic is
        // within bounds of `PATH_BUFFER_3D`.
        unsafe {
            for (i, (cx, cy, cz)) in path.into_iter().take(count).enumerate() {
                let (wx, wy, wz) = cell_to_world(cx, cy, cz, grid_ref);
                PATH_BUFFER_3D[i * 3] = wx;
                PATH_BUFFER_3D[i * 3 + 1] = wy;
                PATH_BUFFER_3D[i * 3 + 2] = wz;
            }
        }
        return count;
    }

    // Without the feature, write a direct two-waypoint straight-line path.
    #[cfg(not(feature = "pathfinding-3d"))]
    {
        // SAFETY: indices 0..5 are always within PATH_BUFFER_3D (size 512*3).
        unsafe {
            PATH_BUFFER_3D[0] = from_x;
            PATH_BUFFER_3D[1] = from_y;
            PATH_BUFFER_3D[2] = from_z;
            PATH_BUFFER_3D[3] = to_x;
            PATH_BUFFER_3D[4] = to_y;
            PATH_BUFFER_3D[5] = to_z;
        }
        2
    }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/// Converts a world-space position to the nearest integer grid cell.
#[inline]
fn world_to_cell(wx: f32, wy: f32, wz: f32, g: &NavGrid3D) -> (i32, i32, i32) {
    (
        ((wx - g.origin_x) / g.cell_size).round() as i32,
        ((wy - g.origin_y) / g.cell_size).round() as i32,
        ((wz - g.origin_z) / g.cell_size).round() as i32,
    )
}

/// Converts an integer grid cell to its world-space centre position.
#[inline]
fn cell_to_world(cx: i32, cy: i32, cz: i32, g: &NavGrid3D) -> (f32, f32, f32) {
    (
        g.origin_x + cx as f32 * g.cell_size,
        g.origin_y + cy as f32 * g.cell_size,
        g.origin_z + cz as f32 * g.cell_size,
    )
}

/// Returns `true` if `(cx, cy, cz)` is within grid bounds and has a walkable cell value.
fn is_walkable(cx: i32, cy: i32, cz: i32, g: &NavGrid3D) -> bool {
    if cx < 0 || cy < 0 || cz < 0 {
        return false;
    }
    let (ux, uy, uz) = (cx as usize, cy as usize, cz as usize);
    if ux >= g.width || uy >= g.height || uz >= g.depth {
        return false;
    }
    g.cells[ux + uy * g.width + uz * g.width * g.height] == 0
}

/// Returns the 6-connected neighbours of `(x, y, z)` that are walkable, each with cost `1`.
///
/// The six neighbours correspond to ±X, ±Y, ±Z steps on the integer grid.
#[cfg(feature = "pathfinding-3d")]
fn neighbors6((x, y, z): (i32, i32, i32), g: &NavGrid3D) -> Vec<((i32, i32, i32), u32)> {
    [
        (x + 1, y, z),
        (x - 1, y, z),
        (x, y + 1, z),
        (x, y - 1, z),
        (x, y, z + 1),
        (x, y, z - 1),
    ]
    .into_iter()
    .filter(|&(nx, ny, nz)| is_walkable(nx, ny, nz, g))
    .map(|n| (n, 1u32))
    .collect()
}

/// 3D Manhattan distance heuristic for A*.
#[cfg(feature = "pathfinding-3d")]
#[inline]
fn manhattan3((ax, ay, az): (i32, i32, i32), (bx, by, bz): (i32, i32, i32)) -> u32 {
    ((ax - bx).abs() + (ay - by).abs() + (az - bz).abs()) as u32
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    /// Build an all-open `NavGrid3D` of the given dimensions with `cell_size = 1.0`
    /// and origin at `(0, 0, 0)`.
    fn make_open_grid(w: usize, h: usize, d: usize) -> NavGrid3D {
        NavGrid3D {
            cells: vec![0u8; w * h * d],
            width: w,
            height: h,
            depth: d,
            cell_size: 1.0,
            origin_x: 0.0,
            origin_y: 0.0,
            origin_z: 0.0,
        }
    }

    #[test]
    fn test_world_to_cell_rounds_to_nearest() {
        let g = make_open_grid(10, 10, 10);
        let (cx, cy, cz) = world_to_cell(3.4, 2.6, 1.5, &g);
        assert_eq!((cx, cy, cz), (3, 3, 2));
    }

    #[test]
    fn test_cell_to_world_returns_cell_centre() {
        let g = make_open_grid(10, 10, 10);
        let (wx, wy, wz) = cell_to_world(3, 3, 2, &g);
        assert!((wx - 3.0).abs() < 0.001);
        assert!((wy - 3.0).abs() < 0.001);
        assert!((wz - 2.0).abs() < 0.001);
    }

    #[test]
    fn test_world_to_cell_and_back_roundtrip() {
        let g = make_open_grid(10, 10, 10);
        let (cx, cy, cz) = world_to_cell(3.0, 3.0, 2.0, &g);
        let (wx, wy, wz) = cell_to_world(cx, cy, cz, &g);
        assert!((wx - 3.0).abs() < 0.001);
        assert!((wy - 3.0).abs() < 0.001);
        assert!((wz - 2.0).abs() < 0.001);
    }

    #[test]
    fn test_is_walkable_open_grid() {
        let g = make_open_grid(5, 5, 5);
        assert!(is_walkable(0, 0, 0, &g));
        assert!(is_walkable(4, 4, 4, &g));
        // Out of bounds
        assert!(!is_walkable(5, 0, 0, &g));
        assert!(!is_walkable(-1, 0, 0, &g));
        assert!(!is_walkable(0, 5, 0, &g));
        assert!(!is_walkable(0, 0, 5, &g));
    }

    #[test]
    fn test_is_walkable_blocked_cell() {
        let mut g = make_open_grid(3, 3, 3);
        // Block cell (1, 1, 1): index = 1 + 1*3 + 1*3*3 = 1 + 3 + 9 = 13
        g.cells[1 + 1 * 3 + 1 * 3 * 3] = 1;
        assert!(!is_walkable(1, 1, 1, &g));
        assert!(is_walkable(0, 0, 0, &g));
    }

    #[test]
    fn test_find_path_3d_no_grid_returns_zero() {
        // Ensure no grid is installed.
        // SAFETY: test-only; single-threaded.
        unsafe {
            NAV_GRID_3D = None;
        }
        let count = find_path_3d(0.0, 0.0, 0.0, 5.0, 0.0, 5.0);
        assert_eq!(count, 0);
    }

    #[cfg(feature = "pathfinding-3d")]
    #[test]
    fn test_find_path_3d_trivial_same_cell() {
        // A path from a cell to itself should return at least 1 waypoint.
        // SAFETY: test-only; single-threaded.
        unsafe {
            NAV_GRID_3D = Some(make_open_grid(5, 5, 5));
        }
        let count = find_path_3d(2.0, 2.0, 2.0, 2.0, 2.0, 2.0);
        assert!(count >= 1, "expected at least 1 waypoint for same-cell path");
        unsafe {
            NAV_GRID_3D = None;
        }
    }

    #[cfg(feature = "pathfinding-3d")]
    #[test]
    fn test_find_path_3d_straight_line() {
        // Open 10×1×10 slab — a straight path from (0,0,0) to (0,0,5).
        // SAFETY: test-only; single-threaded.
        unsafe {
            NAV_GRID_3D = Some(make_open_grid(10, 1, 10));
        }
        let count = find_path_3d(0.0, 0.0, 0.0, 0.0, 0.0, 5.0);
        assert!(count >= 2, "expected at least 2 waypoints for a 5-cell path");
        // First waypoint should be near the origin.
        let buf = unsafe { &*std::ptr::addr_of!(PATH_BUFFER_3D) };
        assert!(
            buf[0].abs() < 1.5,
            "first waypoint x ({}) should be near 0",
            buf[0]
        );
        unsafe {
            NAV_GRID_3D = None;
        }
    }

    #[cfg(feature = "pathfinding-3d")]
    #[test]
    fn test_find_path_3d_blocked_path_returns_fallback() {
        // Build a 3×1×3 grid and block the entire middle column on Z=1.
        let mut g = make_open_grid(3, 1, 3);
        // Block all cells at z=1: indices 1, 4, 7  (x=0,1,2 ; y=0 ; z=1)
        g.cells[0 + 0 * 3 + 1 * 3 * 1] = 1; // (0,0,1)
        g.cells[1 + 0 * 3 + 1 * 3 * 1] = 1; // (1,0,1)
        g.cells[2 + 0 * 3 + 1 * 3 * 1] = 1; // (2,0,1)
        // SAFETY: test-only; single-threaded.
        unsafe {
            NAV_GRID_3D = Some(g);
        }
        // No walkable path from z=0 side to z=2 side; expect fallback 2-node path.
        let count = find_path_3d(1.0, 0.0, 0.0, 1.0, 0.0, 2.0);
        assert_eq!(count, 2, "blocked path should fall back to 2-waypoint straight line");
        unsafe {
            NAV_GRID_3D = None;
        }
    }

    #[test]
    fn test_get_path_buffer_ptr_not_null() {
        let ptr = get_path_buffer_ptr_3d();
        assert!(!ptr.is_null());
    }
}
