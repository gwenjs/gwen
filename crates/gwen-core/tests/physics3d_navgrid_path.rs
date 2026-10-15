//! Nav grid upload and 3D path search through the public physics3d exports.
//!
//! Native only. Run with `--features physics3d`. The grid pointer is the address of a `Vec<u8>`
//! owned by the test, the same shape of call JavaScript makes with a `__wbindgen_malloc` address.
//! `worst_accepted_grid_search` is ignored by default; its rustdoc in `pathfinding.rs` names the
//! command that measures it.

#![cfg(feature = "physics3d")]

use gwen_core::bindings::Engine;
use gwen_core::physics3d::{
    get_path_buffer_ptr_3d, PathRequestReject, Physics3DError, MAX_NAVGRID_CELLS, MAX_PATH_COORD,
};

type Outcome = Result<(), Physics3DError>;

const NAN: f32 = f32::NAN;
const INF: f32 = f32::INFINITY;

fn engine() -> Result<Engine, Physics3DError> {
    let mut e = Engine::new(4).map_err(Physics3DError::Core)?;
    e.physics3d_init(0.0, -9.81, 0.0, 4);
    Ok(e)
}

fn invalid_grid(w: u32, h: u32, d: u32) -> Physics3DError {
    Physics3DError::InvalidNavGrid { w, h, d }
}

fn bad_request(reason: PathRequestReject) -> Physics3DError {
    Physics3DError::InvalidPathRequest { reason }
}

/// Uploads `cells` as a `w x h x d` grid with cell size 1 and origin 0.
fn upload(e: &mut Engine, cells: &[u8], w: u32, h: u32, d: u32) -> Outcome {
    e.physics3d_init_navgrid_3d(cells.as_ptr() as usize, w, h, d, 1.0, 0.0, 0.0, 0.0)
}

/// Uploads an all-open `w x h x d` grid with the given cell size and origin.
fn upload_open(
    e: &mut Engine,
    dims: [u32; 3],
    cell_size: f32,
    origin: [f32; 3],
) -> Result<(), Physics3DError> {
    let cells = vec![0u8; dims[0] as usize * dims[1] as usize * dims[2] as usize];
    e.physics3d_init_navgrid_3d(
        cells.as_ptr() as usize,
        dims[0],
        dims[1],
        dims[2],
        cell_size,
        origin[0],
        origin[1],
        origin[2],
    )
}

/// Reads the first `count` waypoints of the calling thread's path buffer.
fn path(count: u32) -> Vec<f32> {
    let ptr = get_path_buffer_ptr_3d();
    // SAFETY: the buffer holds `MAX_PATH_NODES_3D * 3` floats on this thread and every `count`
    // in this file comes from a search that is capped at `MAX_PATH_NODES_3D`.
    unsafe { std::slice::from_raw_parts(ptr, count as usize * 3).to_vec() }
}

fn find(e: &mut Engine, from: [f32; 3], to: [f32; 3]) -> Result<u32, Physics3DError> {
    e.physics3d_find_path_3d(from[0], from[1], from[2], to[0], to[1], to[2])
}

/// A 3x1x3 open grid with a known path primed in the buffer: (1,0,0) to (1,0,2), 3 waypoints.
fn primed() -> Result<Engine, Physics3DError> {
    let mut e = engine()?;
    upload(&mut e, &[0; 9], 3, 1, 3)?;
    assert_eq!(find(&mut e, [1.0, 0.0, 0.0], [1.0, 0.0, 2.0]), Ok(3));
    Ok(e)
}

const PRIMED_PATH: [f32; 9] = [1.0, 0.0, 0.0, 1.0, 0.0, 1.0, 1.0, 0.0, 2.0];

// --- no world, no grid ---

#[test]
fn init_and_find_without_a_world_return_not_initialized() -> Outcome {
    let mut e = Engine::new(4).map_err(Physics3DError::Core)?;
    assert_eq!(
        upload(&mut e, &[0; 9], 3, 1, 3),
        Err(Physics3DError::WorldNotInitialized)
    );
    assert_eq!(
        find(&mut e, [0.0; 3], [1.0; 3]),
        Err(Physics3DError::WorldNotInitialized)
    );
    Ok(())
}

#[test]
fn find_without_a_grid_returns_navgrid_not_initialized() -> Outcome {
    let mut e = engine()?;
    assert_eq!(
        find(&mut e, [0.0; 3], [1.0; 3]),
        Err(Physics3DError::NavGridNotInitialized)
    );
    Ok(())
}

// --- dimensions ---

#[test]
fn zero_dimension_is_refused_and_keeps_the_previous_grid() -> Outcome {
    let mut e = primed()?;
    for (w, h, d) in [(0, 1, 3), (3, 0, 3), (3, 1, 0), (0, 0, 0)] {
        assert_eq!(upload(&mut e, &[0; 9], w, h, d), Err(invalid_grid(w, h, d)));
    }
    assert_eq!(find(&mut e, [1.0, 0.0, 0.0], [1.0, 0.0, 2.0]), Ok(3));
    assert_eq!(path(3), PRIMED_PATH);
    Ok(())
}

#[test]
fn overflowing_cell_count_is_refused_and_keeps_the_previous_grid() -> Outcome {
    let mut e = primed()?;
    // The buffer holds a full cap's worth of bytes, so a call that wrongly accepts a wrapped
    // count still reads inside the allocation.
    let cells = vec![0u8; MAX_NAVGRID_CELLS];
    // u32::MAX cubed overflows usize on a 64-bit host. 65536 x 65536 overflows usize on wasm32
    // and is far above the cap on a 64-bit host. 2 * 2147516409 * 4294901775 is 2^64 + 1900334:
    // it overflows a 64-bit usize and wraps to a count below the cap, so only `checked_mul`
    // refuses it.
    for (w, h, d) in [
        (u32::MAX, u32::MAX, u32::MAX),
        (65_536, 65_536, 1),
        (65_536, 65_536, 65_536),
        (u32::MAX, 2, 1),
        (2, 2_147_516_409, 4_294_901_775),
    ] {
        assert_eq!(upload(&mut e, &cells, w, h, d), Err(invalid_grid(w, h, d)));
    }
    assert_eq!(find(&mut e, [1.0, 0.0, 0.0], [1.0, 0.0, 2.0]), Ok(3));
    assert_eq!(path(3), PRIMED_PATH);
    Ok(())
}

#[test]
fn cell_count_at_the_cap_is_accepted_and_one_above_is_refused() -> Outcome {
    let cap = u32::try_from(MAX_NAVGRID_CELLS).map_err(|_| invalid_grid(0, 0, 0))?;
    let mut e = engine()?;
    let cells = vec![0u8; MAX_NAVGRID_CELLS];
    assert_eq!(upload(&mut e, &cells, cap, 1, 1), Ok(()));
    assert_eq!(find(&mut e, [0.0; 3], [2.0, 0.0, 0.0]), Ok(3));
    assert_eq!(path(3), vec![0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 2.0, 0.0, 0.0]);

    assert_eq!(
        upload(&mut e, &cells, cap + 1, 1, 1),
        Err(invalid_grid(cap + 1, 1, 1))
    );
    assert_eq!(
        upload(&mut e, &cells, 1, cap + 1, 1),
        Err(invalid_grid(1, cap + 1, 1))
    );
    assert_eq!(
        upload(&mut e, &cells, 1, 1, cap + 1),
        Err(invalid_grid(1, 1, cap + 1))
    );
    // The refusals kept the accepted grid.
    assert_eq!(find(&mut e, [0.0; 3], [2.0, 0.0, 0.0]), Ok(3));
    Ok(())
}

#[test]
fn a_cubic_grid_at_the_cap_is_accepted_and_a_larger_one_is_refused() -> Outcome {
    assert_eq!(64usize.pow(3), MAX_NAVGRID_CELLS);
    let mut e = engine()?;
    assert_eq!(upload_open(&mut e, [64, 64, 64], 1.0, [0.0; 3]), Ok(()));
    assert_eq!(find(&mut e, [0.0; 3], [2.0, 0.0, 0.0]), Ok(3));
    let cells = vec![0u8; MAX_NAVGRID_CELLS];
    assert_eq!(
        upload(&mut e, &cells, 65, 64, 64),
        Err(invalid_grid(65, 64, 64))
    );
    assert_eq!(
        upload(&mut e, &cells, 128, 128, 128),
        Err(invalid_grid(128, 128, 128))
    );
    // The refusals kept the accepted grid.
    assert_eq!(find(&mut e, [0.0; 3], [2.0, 0.0, 0.0]), Ok(3));
    Ok(())
}

#[test]
fn null_pointer_with_valid_dimensions_clears_the_grid() -> Outcome {
    let mut e = primed()?;
    assert_eq!(
        e.physics3d_init_navgrid_3d(0, 3, 1, 3, 1.0, 0.0, 0.0, 0.0),
        Ok(())
    );
    assert_eq!(
        find(&mut e, [0.0; 3], [1.0; 3]),
        Err(Physics3DError::NavGridNotInitialized)
    );
    Ok(())
}

// --- accepted requests keep their results ---

#[test]
fn open_grid_path_and_blocked_grid_fallback_are_unchanged() -> Outcome {
    let mut e = primed()?;
    assert_eq!(path(3), PRIMED_PATH);
    // The whole z = 1 row is solid: no route, so the two-waypoint straight fallback.
    upload(&mut e, &[0, 0, 0, 1, 1, 1, 0, 0, 0], 3, 1, 3)?;
    assert_eq!(find(&mut e, [1.0, 0.0, 0.0], [1.0, 0.0, 2.0]), Ok(2));
    assert_eq!(path(2), vec![1.0, 0.0, 0.0, 1.0, 0.0, 2.0]);
    Ok(())
}

#[test]
fn cell_size_and_origin_scale_the_waypoints() -> Outcome {
    let mut e = engine()?;
    upload_open(&mut e, [3, 1, 3], 2.0, [10.0, 0.0, 10.0])?;
    assert_eq!(find(&mut e, [10.0, 0.0, 10.0], [14.0, 0.0, 10.0]), Ok(3));
    assert_eq!(
        path(3),
        vec![10.0, 0.0, 10.0, 12.0, 0.0, 10.0, 14.0, 0.0, 10.0]
    );
    Ok(())
}

#[test]
fn negative_cell_size_still_mirrors_the_grid() -> Outcome {
    let mut e = engine()?;
    upload_open(&mut e, [3, 1, 3], -1.0, [0.0; 3])?;
    assert_eq!(find(&mut e, [0.0; 3], [-2.0, 0.0, 0.0]), Ok(3));
    assert_eq!(path(3), vec![0.0, 0.0, 0.0, -1.0, 0.0, 0.0, -2.0, 0.0, 0.0]);
    Ok(())
}

// --- request bounds ---

/// Refuses `from` to `to` with `reason`, then checks the buffer and the grid kept their state.
fn refuse(from: [f32; 3], to: [f32; 3], reason: PathRequestReject) -> Outcome {
    let mut e = primed()?;
    assert_eq!(find(&mut e, from, to), Err(bad_request(reason)));
    assert_eq!(path(3), PRIMED_PATH);
    assert_eq!(find(&mut e, [1.0, 0.0, 0.0], [1.0, 0.0, 2.0]), Ok(3));
    assert_eq!(path(3), PRIMED_PATH);
    Ok(())
}

#[test]
fn non_finite_coordinates_are_refused_on_every_argument() -> Outcome {
    for bad in [NAN, INF, -INF] {
        for axis in 0..3 {
            let mut from = [1.0, 0.0, 0.0];
            let mut to = [1.0, 0.0, 2.0];
            from[axis] = bad;
            refuse(from, to, PathRequestReject::NonFinite)?;
            from[axis] = 1.0;
            to[axis] = bad;
            refuse(from, to, PathRequestReject::NonFinite)?;
        }
    }
    Ok(())
}

#[test]
fn coordinates_past_the_cell_bound_are_refused_on_every_argument() -> Outcome {
    let past = (MAX_PATH_COORD as f32) + 1.0;
    let values = [
        past,
        -past,
        1e30,
        -1e30,
        2_147_483_648.0,
        -2_147_483_904.0,
        3.0e9,
        f32::MAX,
        f32::MIN,
    ];
    for bad in values {
        for axis in 0..3 {
            let mut from = [1.0, 0.0, 0.0];
            let mut to = [1.0, 0.0, 2.0];
            from[axis] = bad;
            refuse(from, to, PathRequestReject::CoordOutOfRange)?;
            from[axis] = 1.0;
            to[axis] = bad;
            refuse(from, to, PathRequestReject::CoordOutOfRange)?;
        }
    }
    Ok(())
}

#[test]
fn coordinates_at_the_cell_bound_are_accepted_and_keep_the_straight_fallback() -> Outcome {
    let edge = MAX_PATH_COORD as f32;
    let mut e = primed()?;
    for target in [[edge, 0.0, 0.0], [-edge, 0.0, 0.0], [0.0, edge, -edge]] {
        assert_eq!(find(&mut e, [1.0, 0.0, 0.0], target), Ok(2));
        assert_eq!(
            path(2),
            vec![1.0, 0.0, 0.0, target[0], target[1], target[2]]
        );
        assert_eq!(find(&mut e, target, [edge, edge, edge]), Ok(2));
    }
    Ok(())
}

#[test]
fn zero_nan_and_tiny_cell_size_are_refused_when_the_search_runs() -> Outcome {
    let mut e = engine()?;
    upload_open(&mut e, [3, 1, 3], 0.0, [0.0; 3])?;
    assert_eq!(
        find(&mut e, [0.0; 3], [1.0, 0.0, 0.0]),
        Err(bad_request(PathRequestReject::NonFinite))
    );
    assert_eq!(
        find(&mut e, [1.0, 0.0, 0.0], [0.0; 3]),
        Err(bad_request(PathRequestReject::NonFinite))
    );
    upload_open(&mut e, [3, 1, 3], NAN, [0.0; 3])?;
    assert_eq!(
        find(&mut e, [0.0; 3], [1.0, 0.0, 0.0]),
        Err(bad_request(PathRequestReject::NonFinite))
    );
    upload_open(&mut e, [3, 1, 3], 1e-30, [0.0; 3])?;
    assert_eq!(
        find(&mut e, [0.0; 3], [1.0, 0.0, 0.0]),
        Err(bad_request(PathRequestReject::CoordOutOfRange))
    );
    Ok(())
}

#[test]
fn non_finite_origin_is_refused_when_the_search_runs() -> Outcome {
    let mut e = engine()?;
    for origin in [[NAN, 0.0, 0.0], [0.0, INF, 0.0], [0.0, 0.0, -INF]] {
        upload_open(&mut e, [3, 1, 3], 1.0, origin)?;
        assert_eq!(
            find(&mut e, [0.0; 3], [1.0, 0.0, 0.0]),
            Err(bad_request(PathRequestReject::NonFinite))
        );
    }
    Ok(())
}

#[test]
fn max_path_coord_is_the_last_exact_cell_below_two_to_the_24() {
    assert_eq!(MAX_PATH_COORD, (1 << 24) - 1);
}

// --- measurement ---

/// The worst accepted search: an open cubic grid and a goal outside it, so A* visits every cell
/// and finds no route. The side comes from `GWEN_NAVGRID_SIDE` (default 64) so one build measures
/// several sizes; a side whose cube is above the cap is refused and the test fails on the upload.
/// Ignored by default because it takes seconds in a debug build.
#[test]
#[ignore = "measurement: run on demand, see MAX_NAVGRID_CELLS"]
fn worst_accepted_grid_search() -> Outcome {
    let side = std::env::var("GWEN_NAVGRID_SIDE")
        .ok()
        .and_then(|v| v.parse::<u32>().ok())
        .unwrap_or(64);
    let mut e = engine()?;
    upload_open(&mut e, [side; 3], 1.0, [0.0; 3])?;
    assert_eq!(find(&mut e, [0.0; 3], [-5.0, -5.0, -5.0]), Ok(2));
    Ok(())
}
