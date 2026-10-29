//! Pathfinding 3D — A* voxel-grid implementation.
//!
//! The solver runs on an integer 3D grid derived from world-space coordinates.
//! Cells are one byte each: `0` = open/walkable, `1` = solid/blocked.
//! Results are written to the path buffer as `[x, y, z, x, y, z, …]` f32 triples.
//!
//! # State ownership
//! Each `PhysicsWorld3D` owns its nav grid and its path buffer. The buffer is
//! allocated once in `PhysicsWorld3D::new` and reused for every search.
//!
//! # Feature gate
//! Full A* search is only available with the `pathfinding-3d` feature. Without
//! it, the search writes a trivial two-waypoint straight-line result.
//!
//! # Usage
//! 1. Call [`Engine::physics3d_init_navgrid_3d`] once (or whenever the grid
//!    changes) to store the voxel bytes on that world.
//!    [`init_navgrid_3d`] is `pub(crate)` and is not the public call.
//! 2. Call [`Engine::physics3d_find_path_3d`]. The return value is the waypoint count.
//! 3. Call [`Engine::physics3d_get_path_buffer_ptr_3d`] and wrap the pointer in a
//!    `Float32Array` view from JavaScript.
//!
//! [`Engine::physics3d_init_navgrid_3d`]: crate::bindings::Engine::physics3d_init_navgrid_3d
//! [`Engine::physics3d_find_path_3d`]: crate::bindings::Engine::physics3d_find_path_3d
//! [`Engine::physics3d_get_path_buffer_ptr_3d`]: crate::bindings::Engine::physics3d_get_path_buffer_ptr_3d

use super::PathRequestReject;
use super::Physics3DError;

#[cfg(feature = "pathfinding-3d")]
use pathfinding::prelude::astar;

/// Maximum number of waypoint nodes in one path result.
pub const MAX_PATH_NODES_3D: usize = 512;

/// Largest cell count [`init_navgrid_3d`] accepts, inclusive: `64 * 64 * 64`.
///
/// A grid is `width * height * depth` bytes moved into Rust-owned storage. The worst search
/// on it is an open grid with a goal outside it: A* visits every cell and finds no route.
///
/// The cap was chosen from native runs of that worst search on open cubic grids, the ignored
/// integration test `worst_accepted_grid_search` of the `physics3d_navgrid_path` test target (cell
/// size 1, goal at `(-5, -5, -5)`, side taken from the `GWEN_NAVGRID_SIDE` variable):
///
/// ```text
/// cargo test -p gwen-core --features physics3d --test physics3d_navgrid_path --no-run
/// GWEN_NAVGRID_SIDE=<side> /usr/bin/time -l target/<profile>/deps/physics3d_navgrid_path-<hash> --ignored --exact worst_accepted_grid_search
/// ```
///
/// | side | cells | debug time | debug peak RSS | release time | release peak RSS |
/// | --- | --- | --- | --- | --- | --- |
/// | 64 | 262_144 | 0.51 s | 29_491_200 bytes | 0.04 s | 28_508_160 bytes |
/// | 96 | 884_736 | 1.66 s | 77_660_160 bytes | 0.14 s | 76_627_968 bytes |
/// | 128 | 2_097_152 | 4.45 s | 266_797_056 bytes | 0.39 s | 265_797_632 bytes |
///
/// A cheap test in the same binary used 3_473_408 bytes (debug) and 2_441_216 bytes (release).
/// The difference, about 100 to 125 bytes per cell, is the A* state: its visited map and its open
/// list. A scratch run on a `256^3` grid (16_777_216 cells, not committed) measured 1_984_004_096
/// bytes and 5.58 s in release, about 2 GiB for one query.
///
/// The cap is `64^3`. One query then stays near 30 MB and well under a second even in a debug
/// build, while `128^3` costs about 266 MB for one query, and WebAssembly linear memory grows but
/// never shrinks, so that peak would stay resident. A `64^3` grid at cell size 1 still covers a
/// 64 metre cube; a larger world needs a coarser cell size. Times are for one run on one host and
/// give the order of magnitude, not a guarantee.
pub const MAX_NAVGRID_CELLS: usize = 262_144;

/// Largest cell coordinate [`find_path_checked`] accepts on any axis, inclusive.
///
/// Every integer from `-16777216` to `16777216` is an exact `f32`. This bound is `2^24 - 1`, so
/// the next integer is the first one refused. A cell inside the bound has a 6-neighbour at most
/// one step outside it, and that step still fits in `i32`: `neighbors6` only adds or subtracts 1.
/// The Manhattan helper runs on accepted cells. The difference of two such values is at most
/// `33_554_430`, which fits in `i32` and is not `i32::MIN`, so `.abs()` does not overflow. The
/// sum of the three absolute differences is at most `100_663_290`, which fits in `i32` and `u32`.
pub const MAX_PATH_COORD: i32 = 16_777_215;

/// Voxel grid state uploaded by [`init_navgrid_3d`].
#[derive(Default)]
pub(crate) struct NavGrid3D {
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

/// Validates the dimensions of a navigation grid and returns its cell count.
///
/// # Errors
/// Returns [`Physics3DError::InvalidNavGrid`] when a dimension is zero, when `width * height *
/// depth` overflows (`checked_mul`), or when the product is above [`MAX_NAVGRID_CELLS`].
pub(crate) fn navgrid_cell_count(
    width: u32,
    height: u32,
    depth: u32,
) -> Result<usize, Physics3DError> {
    let invalid = Physics3DError::InvalidNavGrid {
        w: width,
        h: height,
        d: depth,
    };
    let cells = (width as usize)
        .checked_mul(height as usize)
        .and_then(|n| n.checked_mul(depth as usize))
        .ok_or(invalid)?;
    if cells == 0 || cells > MAX_NAVGRID_CELLS {
        return Err(invalid);
    }
    Ok(cells)
}

/// Stores a voxel navigation grid for 3D A* pathfinding.
///
/// # Description
/// `None` clears `slot` and checks nothing. No production caller passes `None`:
/// `Engine::physics3d_init_navgrid_3d` always passes `Some`, and the spec's `Option` is kept.
/// `Some` moves the bytes into the slot after [`navgrid_cell_count`] accepts the dimensions
/// and the byte length equals that count. A refusal leaves `slot` unchanged.
///
/// Cell encoding: `0` = walkable, any non-zero value = solid/blocked.
/// The flat array is indexed as `x + y*width + z*width*height`.
///
/// # Errors
/// Returns [`Physics3DError::InvalidNavGrid`] when a dimension is zero, when the cell count
/// overflows, when it is above [`MAX_NAVGRID_CELLS`], or when the number of cell bytes differs
/// from the cell count. A dimension error is returned before the length is compared.
/// `None` does not return an error. A refusal does not touch `slot`.
#[allow(
    clippy::too_many_arguments,
    reason = "matches the navgrid upload signature"
)]
pub(crate) fn init_navgrid_3d(
    slot: &mut Option<NavGrid3D>,
    cells: Option<Vec<u8>>,
    width: u32,
    height: u32,
    depth: u32,
    cell_size: f32,
    origin_x: f32,
    origin_y: f32,
    origin_z: f32,
) -> Result<(), Physics3DError> {
    let Some(cells) = cells else {
        *slot = None;
        return Ok(());
    };
    let count = navgrid_cell_count(width, height, depth)?;
    if cells.len() != count {
        return Err(Physics3DError::InvalidNavGrid {
            w: width,
            h: height,
            d: depth,
        });
    }
    *slot = Some(NavGrid3D {
        cells,
        width: width as usize,
        height: height as usize,
        depth: depth as usize,
        cell_size,
        origin_x,
        origin_y,
        origin_z,
    });
    Ok(())
}

/// Find a path on `grid` and write waypoints into `buffer`.
///
/// Returns `0` when `grid` is `None` and does not write `buffer`.
/// An uploaded grid is searched by `write_path`. Without the `pathfinding-3d`
/// feature that search writes a two-waypoint straight line.
pub(crate) fn find_path_on_grid(
    grid: Option<&NavGrid3D>,
    buffer: &mut [f32; MAX_PATH_NODES_3D * 3],
    from: (f32, f32, f32),
    to: (f32, f32, f32),
) -> usize {
    let Some(grid) = grid else {
        return 0;
    };
    write_path(grid, buffer, from, to)
}

/// Rounded cell coordinate of `world` on one axis. NaN and infinity pass through.
#[inline]
fn axis_cell(world: f32, origin: f32, cell_size: f32) -> f32 {
    ((world - origin) / cell_size).round()
}

/// Refuses a rounded cell coordinate that is not finite or is past [`MAX_PATH_COORD`].
fn check_axis_cell(cell: f32) -> Result<(), Physics3DError> {
    if !cell.is_finite() {
        return Err(Physics3DError::InvalidPathRequest {
            reason: PathRequestReject::NonFinite,
        });
    }
    if cell.abs() > MAX_PATH_COORD as f32 {
        return Err(Physics3DError::InvalidPathRequest {
            reason: PathRequestReject::CoordOutOfRange,
        });
    }
    Ok(())
}

/// Find a path on `grid` after checking the grid exists and the request is in range.
///
/// The checked request is searched with [`find_path_on_grid`], so an accepted request gives the
/// same waypoints as before.
///
/// # Errors
/// Returns [`Physics3DError::NavGridNotInitialized`] when `grid` is `None`, and
/// [`Physics3DError::InvalidPathRequest`] when a rounded cell coordinate of `from` or `to` is
/// not finite or is past [`MAX_PATH_COORD`]. That covers NaN or infinite coordinates, a zero or
/// NaN cell size, and a non-finite origin. A refusal does not write the path buffer.
pub(crate) fn find_path_checked(
    grid: Option<&NavGrid3D>,
    buffer: &mut [f32; MAX_PATH_NODES_3D * 3],
    from: (f32, f32, f32),
    to: (f32, f32, f32),
) -> Result<usize, Physics3DError> {
    let grid = grid.ok_or(Physics3DError::NavGridNotInitialized)?;
    for (x, y, z) in [from, to] {
        check_axis_cell(axis_cell(x, grid.origin_x, grid.cell_size))?;
        check_axis_cell(axis_cell(y, grid.origin_y, grid.cell_size))?;
        check_axis_cell(axis_cell(z, grid.origin_z, grid.cell_size))?;
    }
    Ok(find_path_on_grid(Some(grid), buffer, from, to))
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/// Searches `grid` from `from` to `to` and writes the waypoints to `buffer`.
///
/// Returns the number of waypoints written.
#[cfg(feature = "pathfinding-3d")]
fn write_path(
    grid: &NavGrid3D,
    buffer: &mut [f32; MAX_PATH_NODES_3D * 3],
    (from_x, from_y, from_z): (f32, f32, f32),
    (to_x, to_y, to_z): (f32, f32, f32),
) -> usize {
    let start = world_to_cell(from_x, from_y, from_z, grid);
    let goal = world_to_cell(to_x, to_y, to_z, grid);
    let path = astar(
        &start,
        |&p| neighbors6(p, grid),
        |&p| manhattan3(p, goal),
        |&p| p == goal,
    )
    .map(|(nodes, _cost)| nodes)
    // Fall back to a straight two-waypoint path when no route exists.
    .unwrap_or_else(|| vec![start, goal]);

    let count = path.len().min(MAX_PATH_NODES_3D);
    for (i, (cx, cy, cz)) in path.into_iter().take(count).enumerate() {
        let (wx, wy, wz) = cell_to_world(cx, cy, cz, grid);
        buffer[i * 3] = wx;
        buffer[i * 3 + 1] = wy;
        buffer[i * 3 + 2] = wz;
    }
    count
}

/// Without the feature, writes a direct two-waypoint straight-line path.
///
/// Returns `2`.
#[cfg(not(feature = "pathfinding-3d"))]
fn write_path(
    _grid: &NavGrid3D,
    buffer: &mut [f32; MAX_PATH_NODES_3D * 3],
    (from_x, from_y, from_z): (f32, f32, f32),
    (to_x, to_y, to_z): (f32, f32, f32),
) -> usize {
    buffer[..6].copy_from_slice(&[from_x, from_y, from_z, to_x, to_y, to_z]);
    2
}

/// Converts a world-space position to the nearest integer grid cell.
#[inline]
fn world_to_cell(wx: f32, wy: f32, wz: f32, g: &NavGrid3D) -> (i32, i32, i32) {
    (
        axis_cell(wx, g.origin_x, g.cell_size) as i32,
        axis_cell(wy, g.origin_y, g.cell_size) as i32,
        axis_cell(wz, g.origin_z, g.cell_size) as i32,
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
    #![allow(
        clippy::unwrap_used,
        clippy::expect_used,
        clippy::panic,
        clippy::unreachable,
        clippy::todo,
        clippy::unimplemented,
        reason = "test-only code"
    )]
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

    fn fresh_buffer() -> Box<[f32; MAX_PATH_NODES_3D * 3]> {
        Box::new([0.0; MAX_PATH_NODES_3D * 3])
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
    #[allow(
        clippy::identity_op,
        reason = "the factors keep x + y*width + z*width*height visible"
    )]
    fn test_is_walkable_blocked_cell() {
        let mut g = make_open_grid(3, 3, 3);
        // Block cell (1, 1, 1): index = 1 + 1*3 + 1*3*3 = 1 + 3 + 9 = 13
        g.cells[1 + 1 * 3 + 1 * 3 * 3] = 1;
        assert!(!is_walkable(1, 1, 1, &g));
        assert!(is_walkable(0, 0, 0, &g));
    }

    #[test]
    fn test_find_path_3d_no_grid_returns_zero() {
        let mut buffer = fresh_buffer();
        let count = find_path_on_grid(None, &mut buffer, (0.0, 0.0, 0.0), (5.0, 0.0, 5.0));
        assert_eq!(count, 0);
    }

    #[cfg(feature = "pathfinding-3d")]
    #[test]
    fn test_find_path_3d_trivial_same_cell() {
        // A path from a cell to itself should return at least 1 waypoint.
        let grid = make_open_grid(5, 5, 5);
        let mut buffer = fresh_buffer();
        let count = find_path_on_grid(Some(&grid), &mut buffer, (2.0, 2.0, 2.0), (2.0, 2.0, 2.0));
        assert!(
            count >= 1,
            "expected at least 1 waypoint for same-cell path"
        );
    }

    #[cfg(feature = "pathfinding-3d")]
    #[test]
    fn test_find_path_3d_straight_line() {
        // Open 10×1×10 slab — a straight path from (0,0,0) to (0,0,5).
        let grid = make_open_grid(10, 1, 10);
        let mut buffer = fresh_buffer();
        let count = find_path_on_grid(Some(&grid), &mut buffer, (0.0, 0.0, 0.0), (0.0, 0.0, 5.0));
        assert!(
            count >= 2,
            "expected at least 2 waypoints for a 5-cell path"
        );
        // First waypoint should be near the origin.
        let first_x = buffer[0];
        assert!(
            first_x.abs() < 1.5,
            "first waypoint x ({}) should be near 0",
            first_x
        );
    }

    #[cfg(feature = "pathfinding-3d")]
    #[test]
    #[allow(
        clippy::identity_op,
        clippy::erasing_op,
        reason = "the factors keep x + y*width + z*width*height visible"
    )]
    fn test_find_path_3d_blocked_path_returns_fallback() {
        // Build a 3×1×3 grid and block the entire middle column on Z=1.
        let mut g = make_open_grid(3, 1, 3);
        // Block all cells at z=1: indices 1, 4, 7  (x=0,1,2 ; y=0 ; z=1)
        g.cells[0 + 0 * 3 + 1 * 3 * 1] = 1; // (0,0,1)
        g.cells[1 + 0 * 3 + 1 * 3 * 1] = 1; // (1,0,1)
        g.cells[2 + 0 * 3 + 1 * 3 * 1] = 1; // (2,0,1)
                                            // No walkable path from z=0 side to z=2 side; expect fallback 2-node path.
        let mut buffer = fresh_buffer();
        let count = find_path_on_grid(Some(&g), &mut buffer, (1.0, 0.0, 0.0), (1.0, 0.0, 2.0));
        assert_eq!(
            count, 2,
            "blocked path should fall back to 2-waypoint straight line"
        );
    }

    /// `None` clears a slot that already holds a grid.
    #[test]
    fn init_navgrid_3d_none_clears_the_slot() {
        let mut slot = Some(make_open_grid(1, 1, 1));
        let result = init_navgrid_3d(&mut slot, None, 1, 1, 1, 1.0, 0.0, 0.0, 0.0);
        assert_eq!(result, Ok(()));
        assert_eq!(slot.map(|grid| grid.cells.len()), None);
    }

    /// `Some` moves the nine bytes into the slot.
    #[test]
    fn init_navgrid_3d_stores_the_nine_bytes() {
        let cells = vec![0u8, 1, 2, 3, 4, 5, 6, 7, 8];
        let mut slot = None;
        let result = init_navgrid_3d(&mut slot, Some(cells.clone()), 3, 1, 3, 1.0, 0.0, 0.0, 0.0);
        assert_eq!(result, Ok(()));
        assert_eq!(slot.map(|grid| grid.cells), Some(cells));
    }

    /// A zero dimension with `Some` bytes is refused and leaves the slot alone.
    #[test]
    fn init_navgrid_3d_zero_dimension_leaves_the_slot_unchanged() {
        let mut slot = Some(make_open_grid(1, 1, 1));
        let result = init_navgrid_3d(&mut slot, Some(vec![1, 2, 3]), 0, 1, 1, 1.0, 0.0, 0.0, 0.0);
        assert_eq!(
            result,
            Err(Physics3DError::InvalidNavGrid { w: 0, h: 1, d: 1 })
        );
        assert_eq!(slot.map(|grid| grid.cells), Some(vec![0]));
    }

    /// Fewer bytes than the cell count is refused and leaves the slot alone.
    #[test]
    fn init_navgrid_3d_refuses_fewer_bytes_than_the_cell_count() {
        let mut slot = Some(make_open_grid(1, 1, 1));
        let result = init_navgrid_3d(&mut slot, Some(vec![0; 8]), 3, 1, 3, 1.0, 0.0, 0.0, 0.0);
        assert_eq!(
            result,
            Err(Physics3DError::InvalidNavGrid { w: 3, h: 1, d: 3 })
        );
        assert_eq!(slot.map(|grid| grid.cells), Some(vec![0]));
    }

    /// More bytes than the cell count is refused and leaves the slot alone.
    #[test]
    fn init_navgrid_3d_refuses_more_bytes_than_the_cell_count() {
        let mut slot = Some(make_open_grid(1, 1, 1));
        let result = init_navgrid_3d(&mut slot, Some(vec![0; 10]), 3, 1, 3, 1.0, 0.0, 0.0, 0.0);
        assert_eq!(
            result,
            Err(Physics3DError::InvalidNavGrid { w: 3, h: 1, d: 3 })
        );
        assert_eq!(slot.map(|grid| grid.cells), Some(vec![0]));
    }

    /// Stores a 3×1×3 grid (cell size 1, origin 0) through [`init_navgrid_3d`].
    #[cfg(feature = "pathfinding-3d")]
    fn upload_3x1x3(cells: &[u8; 9]) -> Option<NavGrid3D> {
        let mut slot = None;
        init_navgrid_3d(&mut slot, Some(cells.to_vec()), 3, 1, 3, 1.0, 0.0, 0.0, 0.0).ok()?;
        slot
    }

    /// Reads the first `count` waypoints from the buffer the search wrote.
    #[cfg(feature = "pathfinding-3d")]
    fn read_path(buffer: &[f32], count: usize) -> Vec<f32> {
        buffer[..count * 3].to_vec()
    }

    /// Two callers on two threads, each with its own grid, interleaved step by step
    /// with a barrier. Each caller must search its own grid and read its own path,
    /// whatever the other caller did in between. The parallel test runner does this.
    #[cfg(feature = "pathfinding-3d")]
    #[test]
    fn test_state_is_not_shared_between_threads() {
        use std::sync::{Arc, Barrier};

        let barrier = Arc::new(Barrier::new(2));

        // Thread A: the whole z=1 row is blocked, so (1,0,0) → (1,0,2) has no
        // route and the result is the 2-node straight fallback.
        let a_barrier = Arc::clone(&barrier);
        let a = std::thread::spawn(move || {
            let grid = upload_3x1x3(&[0, 0, 0, 1, 1, 1, 0, 0, 0]);
            let mut buffer = fresh_buffer();
            a_barrier.wait(); // 1: A uploaded
            a_barrier.wait(); // 2: B uploaded its own grid
            let count =
                find_path_on_grid(grid.as_ref(), &mut buffer, (1.0, 0.0, 0.0), (1.0, 0.0, 2.0));
            a_barrier.wait(); // 3: A searched
            a_barrier.wait(); // 4: B searched and wrote its own path
            (count, read_path(buffer.as_ref(), count))
        });

        // Thread B: open grid, so (1,0,0) → (1,0,2) is a 3-node route along +Z.
        let b_barrier = Arc::clone(&barrier);
        let b = std::thread::spawn(move || {
            b_barrier.wait(); // 1
            let grid = upload_3x1x3(&[0; 9]);
            let mut buffer = fresh_buffer();
            b_barrier.wait(); // 2
            b_barrier.wait(); // 3
            let count =
                find_path_on_grid(grid.as_ref(), &mut buffer, (1.0, 0.0, 0.0), (1.0, 0.0, 2.0));
            b_barrier.wait(); // 4
            (count, read_path(buffer.as_ref(), count))
        });

        // Re-raise a thread's panic so its own message is the test failure.
        let (a_count, a_path) = a.join().unwrap_or_else(|e| std::panic::resume_unwind(e));
        let (b_count, b_path) = b.join().unwrap_or_else(|e| std::panic::resume_unwind(e));

        assert_eq!(a_count, 2, "thread A must search its own blocked grid");
        assert_eq!(
            a_path,
            vec![1.0, 0.0, 0.0, 1.0, 0.0, 2.0],
            "thread A must read its own path"
        );
        assert_eq!(b_count, 3, "thread B must search its own open grid");
        assert_eq!(
            b_path,
            vec![1.0, 0.0, 0.0, 1.0, 0.0, 1.0, 1.0, 0.0, 2.0],
            "thread B must read its own path"
        );
    }
}
