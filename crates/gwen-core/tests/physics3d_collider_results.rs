//! Observable physics3d collider, mesh and bulk export behaviour through `Engine`.
//!
//! Native only. Run with `--features physics3d`. Every case reaches the exports through the
//! public `Engine` methods that JavaScript calls. A refused call is checked against a twin world
//! that never saw the call: after the same steps both must end bit for bit identical.

#![cfg(feature = "physics3d")]

use gwen_core::bindings::Engine;
use gwen_core::physics3d::world::MAX_COLLIDER_MAGNITUDE;
use gwen_core::physics3d::{
    BvhLoadReason, InvalidColliderReason, InvalidCompoundReason, InvalidShapeReason, Physics3DError,
};

const ALL: u32 = 0xFFFF_FFFF;
const NAN: f32 = f32::NAN;
const INF: f32 = f32::INFINITY;

type Outcome = Result<(), Physics3DError>;
type Add = fn(&mut Engine, f32) -> Result<bool, Physics3DError>;

/// Corners of a valid tetrahedron.
const TETRA: [f32; 12] = [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0];
/// Vertices of a valid two-triangle quad (a floor patch).
const QUAD: [f32; 12] = [
    -4.0, 0.0, -4.0, 4.0, 0.0, -4.0, -4.0, 0.0, 4.0, 4.0, 0.0, 4.0,
];
const QUAD_IDX: [u32; 6] = [0, 2, 1, 1, 2, 3];
const FLAT_3X3: [f32; 9] = [0.0; 9];

fn above(value: f32) -> f32 {
    f32::from_bits(value.to_bits() + 1)
}

fn invalid_collider(reason: InvalidColliderReason) -> Physics3DError {
    Physics3DError::InvalidCollider { reason }
}

fn invalid_shape(reason: InvalidShapeReason) -> Physics3DError {
    Physics3DError::InvalidShape { reason }
}

/// A world with a ground box (slot 0), a dynamic box (1), a dynamic body without collider (2),
/// a fixed body without collider (3) and a kinematic body (4). Slots 5 and 6 are free.
fn scene() -> Result<Engine, Physics3DError> {
    let mut e = Engine::new(16).map_err(Physics3DError::Core)?;
    e.physics3d_init(0.0, -9.81, 0.0, 16);
    e.physics3d_add_body(0, 0.0, 0.0, 0.0, 0, 1.0, 0.0, 0.0)?;
    e.physics3d_add_box_collider(
        0, 20.0, 0.5, 20.0, 0.0, 0.0, 0.0, false, 0.5, 0.0, ALL, ALL, 1,
    )?;
    e.physics3d_add_body(1, 0.0, 3.0, 0.0, 1, 1.0, 0.0, 0.0)?;
    e.physics3d_add_box_collider(
        1, 0.5, 0.5, 0.5, 0.0, 0.0, 0.0, false, 0.5, 0.0, ALL, ALL, 2,
    )?;
    e.physics3d_add_body(2, 3.0, 3.0, 0.0, 1, 1.0, 0.0, 0.0)?;
    e.physics3d_add_body(3, 8.0, 1.0, 0.0, 0, 1.0, 0.0, 0.0)?;
    e.physics3d_add_body(4, -8.0, 4.0, 0.0, 2, 1.0, 0.0, 0.0)?;
    Ok(e)
}

/// Steps 60 frames, then returns the bit pattern of every body state and of four rays.
fn fingerprint(e: &mut Engine) -> Result<Vec<u32>, Physics3DError> {
    for _ in 0..60 {
        e.physics3d_step(0.016)?;
    }
    let mut bits = Vec::new();
    for slot in 0..=12 {
        bits.push(slot);
        bits.extend(
            e.physics3d_get_body_state(slot)?
                .iter()
                .map(|v| v.to_bits()),
        );
    }
    for x in [-8.0, 0.0, 3.0, 8.0] {
        let hit = e.physics3d_cast_ray(x, 50.0, 0.0, 0.0, -1.0, 0.0, 100.0, ALL, ALL, true)?;
        bits.extend(hit.iter().map(|v| v.to_bits()));
    }
    Ok(bits)
}

/// Runs `setup` on two scenes, `op` on the first only, and compares both after the same steps.
fn refused(
    setup: fn(&mut Engine) -> Outcome,
    expected: Physics3DError,
    op: impl FnOnce(&mut Engine) -> Outcome,
) -> Outcome {
    let mut touched = scene()?;
    setup(&mut touched)?;
    let mut untouched = scene()?;
    setup(&mut untouched)?;
    assert_eq!(op(&mut touched), Err(expected));
    assert_eq!(fingerprint(&mut touched)?, fingerprint(&mut untouched)?);
    Ok(())
}

fn no_setup(_: &mut Engine) -> Outcome {
    Ok(())
}

/// Slot 5 holds a fixed 3x3 heightfield floor (collider 7) with a dynamic ball (slot 6) above it.
fn heightfield_floor(e: &mut Engine) -> Outcome {
    e.physics3d_add_body(5, 30.0, 0.0, 0.0, 0, 1.0, 0.0, 0.0)?;
    e.physics3d_add_heightfield_collider(5, &FLAT_3X3, 3, 3, 8.0, 1.0, 8.0, 0.5, 0.0, ALL, ALL, 7)?;
    e.physics3d_add_body(6, 30.0, 4.0, 0.0, 1, 1.0, 0.0, 0.0)?;
    e.physics3d_add_sphere_collider(6, 0.5, 0.0, 0.0, 0.0, false, 0.5, 0.0, ALL, ALL, 8)?;
    Ok(())
}

/// Slot 5 holds a fixed mesh floor (collider 7) with a dynamic ball (slot 6) above it.
fn mesh_floor(e: &mut Engine) -> Outcome {
    e.physics3d_add_body(5, 30.0, 0.0, 0.0, 0, 1.0, 0.0, 0.0)?;
    e.physics3d_add_mesh_collider(
        5, &QUAD, &QUAD_IDX, 0.0, 0.0, 0.0, false, 0.5, 0.0, ALL, ALL, 7,
    )?;
    e.physics3d_add_body(6, 30.0, 4.0, 0.0, 1, 1.0, 0.0, 0.0)?;
    e.physics3d_add_sphere_collider(6, 0.5, 0.0, 0.0, 0.0, false, 0.5, 0.0, ALL, ALL, 8)?;
    Ok(())
}

fn ok(result: Result<bool, Physics3DError>) -> Outcome {
    result.map(|_| ())
}

fn hf(e: &mut Engine, heights: &[f32], rows: u32, cols: u32, scale: [f32; 3]) -> Outcome {
    ok(e.physics3d_add_heightfield_collider(
        3, heights, rows, cols, scale[0], scale[1], scale[2], 0.5, 0.0, ALL, ALL, 9,
    ))
}

fn mesh(e: &mut Engine, vertices: &[f32], indices: &[u32]) -> Outcome {
    ok(e.physics3d_add_mesh_collider(
        3, vertices, indices, 0.0, 0.0, 0.0, false, 0.5, 0.0, ALL, ALL, 9,
    ))
}

fn convex(e: &mut Engine, points: &[f32], density: f32) -> Outcome {
    ok(e.physics3d_add_convex_collider(
        2, points, 0.0, 0.0, 0.0, false, 0.5, 0.0, density, ALL, ALL, 9,
    ))
}

/// One compound part: `[type, p0, p1, p2, 0, ox, oy, oz, sensor, friction, restitution, id]`.
fn part(shape: f32, p: [f32; 3], id: f32) -> [f32; 12] {
    [
        shape, p[0], p[1], p[2], 0.0, 0.0, 0.0, 0.0, 0.0, 0.5, 0.0, id,
    ]
}

/// Header plus bincode payload for a valid baked mesh.
fn bvh_bytes(vertices: &[f32], indices: &[u32]) -> Vec<u8> {
    use rapier3d::geometry::TriMesh;
    use rapier3d::na::Point3;
    let points: Vec<Point3<f32>> = vertices
        .chunks(3)
        .map(|c| Point3::new(c[0], c[1], c[2]))
        .collect();
    let triangles: Vec<[u32; 3]> = indices.chunks(3).map(|c| [c[0], c[1], c[2]]).collect();
    let mesh = TriMesh::new(points, triangles);
    let payload =
        bincode::serde::encode_to_vec(&mesh, bincode::config::standard()).unwrap_or_default();
    let mut out = b"GBVH".to_vec();
    out.extend_from_slice(&0u16.to_le_bytes());
    out.extend_from_slice(&22u16.to_le_bytes());
    out.extend_from_slice(&payload);
    out
}

fn load_bvh(e: &mut Engine, slot: u32, bytes: &[u8]) -> Outcome {
    ok(e.physics3d_load_bvh_collider(slot, bytes, 0.0, 0.0, 0.0, false, 0.5, 0.0, ALL, ALL, 9))
}

// ── no world, missing body, success values ──────────────────────────────────

#[test]
fn every_converted_export_without_a_world_returns_not_initialized() -> Outcome {
    let mut e = Engine::new(8).map_err(Physics3DError::Core)?;
    let bvh = bvh_bytes(&QUAD, &QUAD_IDX);
    let part_data = part(0.0, [0.5; 3], 1.0);
    let outcomes: Vec<(&str, Physics3DError)> = vec![
        (
            "box",
            e.physics3d_add_box_collider(
                1, 1.0, 1.0, 1.0, 0.0, 0.0, 0.0, false, 0.5, 0.0, ALL, ALL, 1,
            )
            .err(),
        ),
        (
            "sphere",
            e.physics3d_add_sphere_collider(1, 1.0, 0.0, 0.0, 0.0, false, 0.5, 0.0, ALL, ALL, 1)
                .err(),
        ),
        (
            "capsule",
            e.physics3d_add_capsule_collider(
                1, 1.0, 1.0, 0.0, 0.0, 0.0, false, 0.5, 0.0, ALL, ALL, 1,
            )
            .err(),
        ),
        (
            "convex",
            e.physics3d_add_convex_collider(
                1, &TETRA, 0.0, 0.0, 0.0, false, 0.5, 0.0, 1.0, ALL, ALL, 1,
            )
            .err(),
        ),
        (
            "heightfield",
            e.physics3d_add_heightfield_collider(
                1, &FLAT_3X3, 3, 3, 1.0, 1.0, 1.0, 0.5, 0.0, ALL, ALL, 1,
            )
            .err(),
        ),
        (
            "update_heightfield",
            e.physics3d_update_heightfield_collider(
                1, 1, &FLAT_3X3, 3, 3, 1.0, 1.0, 1.0, 0.5, 0.0, ALL, ALL,
            )
            .err(),
        ),
        (
            "mesh",
            e.physics3d_add_mesh_collider(
                1, &QUAD, &QUAD_IDX, 0.0, 0.0, 0.0, false, 0.5, 0.0, ALL, ALL, 1,
            )
            .err(),
        ),
        (
            "rebuild_mesh",
            e.physics3d_rebuild_mesh_collider(
                1, 1, &QUAD, &QUAD_IDX, 0.0, 0.0, 0.0, false, 0.5, 0.0, ALL, ALL,
            )
            .err(),
        ),
        (
            "bvh",
            e.physics3d_load_bvh_collider(1, &bvh, 0.0, 0.0, 0.0, false, 0.5, 0.0, ALL, ALL, 1)
                .err(),
        ),
        (
            "compound",
            e.physics3d_add_compound_collider(1, &part_data, ALL, ALL)
                .err(),
        ),
        ("remove_collider", e.physics3d_remove_collider(1, 1).err()),
        (
            "bulk_spawn",
            e.physics3d_bulk_spawn_static_boxes(&[1], &[0.0; 3], &[0.5; 3], 0.5, 0.0, ALL, ALL)
                .err(),
        ),
        (
            "bulk_step",
            e.physics3d_bulk_step_kinematics(&[1], &[0.0], &[0.0], &[0.0], 0.016)
                .err(),
        ),
        (
            "bulk_rot",
            e.physics3d_bulk_step_kinematic_rotations(&[1], &[0.0], &[0.0], &[0.0], 0.016)
                .err(),
        ),
    ]
    .into_iter()
    .filter_map(|(name, err)| err.map(|e| (name, e)))
    .collect();
    assert_eq!(outcomes.len(), 14);
    for (name, err) in outcomes {
        assert_eq!(
            (name, err),
            (name, Physics3DError::WorldNotInitialized),
            "{name}"
        );
    }
    Ok(())
}

#[test]
fn every_add_collider_export_on_a_missing_body_returns_body_not_found() -> Outcome {
    let mut e = scene()?;
    let bvh = bvh_bytes(&QUAD, &QUAD_IDX);
    let compound = part(0.0, [0.5; 3], 1.0);
    let missing = Physics3DError::BodyNotFound { slot: 99 };
    let outcomes: Vec<Option<Physics3DError>> = vec![
        e.physics3d_add_box_collider(
            99, 1.0, 1.0, 1.0, 0.0, 0.0, 0.0, false, 0.5, 0.0, ALL, ALL, 1,
        )
        .err(),
        e.physics3d_add_sphere_collider(99, 1.0, 0.0, 0.0, 0.0, false, 0.5, 0.0, ALL, ALL, 1)
            .err(),
        e.physics3d_add_capsule_collider(99, 1.0, 1.0, 0.0, 0.0, 0.0, false, 0.5, 0.0, ALL, ALL, 1)
            .err(),
        e.physics3d_add_convex_collider(
            99, &TETRA, 0.0, 0.0, 0.0, false, 0.5, 0.0, 1.0, ALL, ALL, 1,
        )
        .err(),
        e.physics3d_add_heightfield_collider(
            99, &FLAT_3X3, 3, 3, 1.0, 1.0, 1.0, 0.5, 0.0, ALL, ALL, 1,
        )
        .err(),
        e.physics3d_update_heightfield_collider(
            99, 1, &FLAT_3X3, 3, 3, 1.0, 1.0, 1.0, 0.5, 0.0, ALL, ALL,
        )
        .err(),
        e.physics3d_add_mesh_collider(
            99, &QUAD, &QUAD_IDX, 0.0, 0.0, 0.0, false, 0.5, 0.0, ALL, ALL, 1,
        )
        .err(),
        e.physics3d_rebuild_mesh_collider(
            99, 1, &QUAD, &QUAD_IDX, 0.0, 0.0, 0.0, false, 0.5, 0.0, ALL, ALL,
        )
        .err(),
        e.physics3d_load_bvh_collider(99, &bvh, 0.0, 0.0, 0.0, false, 0.5, 0.0, ALL, ALL, 1)
            .err(),
        e.physics3d_add_compound_collider(99, &compound, ALL, ALL)
            .err(),
    ];
    assert_eq!(outcomes.len(), 10);
    for outcome in outcomes {
        assert_eq!(outcome, Some(missing));
    }
    Ok(())
}

#[test]
fn add_collider_exports_return_true_and_the_collider_changes_the_simulation() -> Outcome {
    let mut with = scene()?;
    let mut without = scene()?;
    let compound = [
        part(0.0, [0.5; 3], 1.0),
        part(1.0, [0.5, 0.0, 0.0], 2.0),
        part(2.0, [0.5, 0.5, 0.0], 3.0),
    ]
    .concat();
    assert_eq!(
        with.physics3d_add_box_collider(
            2, 0.5, 0.5, 0.5, 0.0, 0.0, 0.0, false, 0.5, 0.0, ALL, ALL, 9
        ),
        Ok(true)
    );
    assert_eq!(
        with.physics3d_add_sphere_collider(3, 0.5, 0.0, 0.0, 0.0, false, 0.5, 0.0, ALL, ALL, 9),
        Ok(true)
    );
    assert_eq!(
        with.physics3d_add_capsule_collider(
            3, 0.25, 0.5, 0.0, 1.0, 0.0, false, 0.5, 0.0, ALL, ALL, 10
        ),
        Ok(true)
    );
    assert_eq!(
        with.physics3d_add_convex_collider(
            4, &TETRA, 0.0, 0.0, 0.0, false, 0.5, 0.0, 1.0, ALL, ALL, 9
        ),
        Ok(true)
    );
    assert_eq!(
        with.physics3d_add_compound_collider(3, &compound, ALL, ALL),
        Ok(3)
    );
    assert_eq!(
        with.physics3d_add_compound_collider(3, &[], ALL, ALL),
        Ok(0)
    );
    assert_ne!(fingerprint(&mut with)?, fingerprint(&mut without)?);
    Ok(())
}

#[test]
fn remove_collider_returns_true_then_collider_not_found() -> Outcome {
    let mut e = scene()?;
    assert_eq!(e.physics3d_remove_collider(1, 2), Ok(true));
    assert_eq!(
        e.physics3d_remove_collider(1, 2),
        Err(Physics3DError::ColliderNotFound {
            slot: 1,
            collider_id: 2
        })
    );
    assert_eq!(
        e.physics3d_remove_collider(77, 2),
        Err(Physics3DError::ColliderNotFound {
            slot: 77,
            collider_id: 2
        })
    );
    // The body is still there and now falls through the missing collider's footprint.
    let mut reference = scene()?;
    reference.physics3d_remove_collider(1, 2)?;
    assert_eq!(fingerprint(&mut e)?, fingerprint(&mut reference)?);
    Ok(())
}

#[test]
fn remove_collider_not_found_leaves_the_world_unchanged() -> Outcome {
    refused(
        no_setup,
        Physics3DError::ColliderNotFound {
            slot: 1,
            collider_id: 99,
        },
        |e| ok(e.physics3d_remove_collider(1, 99)),
    )
}

// ── INVALID_COLLIDER: sizes, coordinates, coefficients ───────────────────────

/// Value cases for a size: finite, not negative, at most the magnitude bound.
fn size_cases() -> Vec<(f32, Outcome)> {
    vec![
        (NAN, Err(invalid_collider(InvalidColliderReason::NonFinite))),
        (INF, Err(invalid_collider(InvalidColliderReason::NonFinite))),
        (
            -INF,
            Err(invalid_collider(InvalidColliderReason::NonFinite)),
        ),
        (-1.0, Err(invalid_collider(InvalidColliderReason::Negative))),
        (-0.0, Ok(())),
        (0.0, Ok(())),
        (MAX_COLLIDER_MAGNITUDE, Ok(())),
        (
            above(MAX_COLLIDER_MAGNITUDE),
            Err(invalid_collider(InvalidColliderReason::TooLarge)),
        ),
        (1e30, Err(invalid_collider(InvalidColliderReason::TooLarge))),
    ]
}

/// Value cases for a coordinate or offset: finite, either sign, at most the magnitude bound.
fn coordinate_cases() -> Vec<(f32, Outcome)> {
    vec![
        (NAN, Err(invalid_collider(InvalidColliderReason::NonFinite))),
        (INF, Err(invalid_collider(InvalidColliderReason::NonFinite))),
        (
            -INF,
            Err(invalid_collider(InvalidColliderReason::NonFinite)),
        ),
        (-1.0, Ok(())),
        (0.0, Ok(())),
        (MAX_COLLIDER_MAGNITUDE, Ok(())),
        (-MAX_COLLIDER_MAGNITUDE, Ok(())),
        (
            above(MAX_COLLIDER_MAGNITUDE),
            Err(invalid_collider(InvalidColliderReason::TooLarge)),
        ),
        (
            -above(MAX_COLLIDER_MAGNITUDE),
            Err(invalid_collider(InvalidColliderReason::TooLarge)),
        ),
        (1e30, Err(invalid_collider(InvalidColliderReason::TooLarge))),
    ]
}

/// Value cases for a friction or restitution coefficient: finite, either sign.
fn coefficient_cases() -> Vec<(f32, Outcome)> {
    vec![
        (NAN, Err(invalid_collider(InvalidColliderReason::NonFinite))),
        (INF, Err(invalid_collider(InvalidColliderReason::NonFinite))),
        (
            -INF,
            Err(invalid_collider(InvalidColliderReason::NonFinite)),
        ),
        (-1.0, Ok(())),
        (0.0, Ok(())),
        (2.0, Ok(())),
    ]
}

/// Tries every case on a fresh scene. A refused case is compared with a twin that skipped it.
fn run_cases(name: &str, add: Add, cases: Vec<(f32, Outcome)>) -> Outcome {
    for (value, expected) in cases {
        let mut touched = scene()?;
        let result = add(&mut touched, value).map(|_| ());
        assert_eq!(result, expected, "{name} = {value:e}");
        if expected.is_err() {
            let mut untouched = scene()?;
            assert_eq!(
                fingerprint(&mut touched)?,
                fingerprint(&mut untouched)?,
                "{name} = {value:e} changed the world"
            );
        }
    }
    Ok(())
}

#[test]
fn box_half_extents_are_validated() -> Outcome {
    let adds: [(&str, Add); 3] = [
        ("half_x", |e, v| {
            e.physics3d_add_box_collider(
                2, v, 0.5, 0.5, 0.0, 0.0, 0.0, false, 0.5, 0.0, ALL, ALL, 9,
            )
        }),
        ("half_y", |e, v| {
            e.physics3d_add_box_collider(
                2, 0.5, v, 0.5, 0.0, 0.0, 0.0, false, 0.5, 0.0, ALL, ALL, 9,
            )
        }),
        ("half_z", |e, v| {
            e.physics3d_add_box_collider(
                2, 0.5, 0.5, v, 0.0, 0.0, 0.0, false, 0.5, 0.0, ALL, ALL, 9,
            )
        }),
    ];
    for (name, add) in adds {
        run_cases(name, add, size_cases())?;
    }
    Ok(())
}

#[test]
fn sphere_and_capsule_sizes_are_validated() -> Outcome {
    let adds: [(&str, Add); 3] = [
        ("sphere radius", |e, v| {
            e.physics3d_add_sphere_collider(2, v, 0.0, 0.0, 0.0, false, 0.5, 0.0, ALL, ALL, 9)
        }),
        ("capsule radius", |e, v| {
            e.physics3d_add_capsule_collider(2, v, 0.5, 0.0, 0.0, 0.0, false, 0.5, 0.0, ALL, ALL, 9)
        }),
        ("capsule half_height", |e, v| {
            e.physics3d_add_capsule_collider(2, 0.5, v, 0.0, 0.0, 0.0, false, 0.5, 0.0, ALL, ALL, 9)
        }),
    ];
    for (name, add) in adds {
        run_cases(name, add, size_cases())?;
    }
    Ok(())
}

#[test]
fn offsets_are_validated_for_every_collider_export() -> Outcome {
    let adds: [(&str, Add); 6] = [
        ("box offset", |e, v| {
            e.physics3d_add_box_collider(
                2, 0.5, 0.5, 0.5, 0.0, v, 0.0, false, 0.5, 0.0, ALL, ALL, 9,
            )
        }),
        ("sphere offset", |e, v| {
            e.physics3d_add_sphere_collider(2, 0.5, v, 0.0, 0.0, false, 0.5, 0.0, ALL, ALL, 9)
        }),
        ("capsule offset", |e, v| {
            e.physics3d_add_capsule_collider(2, 0.5, 0.5, 0.0, 0.0, v, false, 0.5, 0.0, ALL, ALL, 9)
        }),
        ("convex offset", |e, v| {
            e.physics3d_add_convex_collider(
                2, &TETRA, 0.0, v, 0.0, false, 0.5, 0.0, 1.0, ALL, ALL, 9,
            )
        }),
        ("mesh offset", |e, v| {
            e.physics3d_add_mesh_collider(
                3, &QUAD, &QUAD_IDX, v, 0.0, 0.0, false, 0.5, 0.0, ALL, ALL, 9,
            )
        }),
        ("bvh offset", |e, v| {
            let bytes = bvh_bytes(&QUAD, &QUAD_IDX);
            e.physics3d_load_bvh_collider(3, &bytes, 0.0, 0.0, v, false, 0.5, 0.0, ALL, ALL, 9)
        }),
    ];
    for (name, add) in adds {
        run_cases(name, add, coordinate_cases())?;
    }
    Ok(())
}

#[test]
fn friction_and_restitution_are_validated_for_every_collider_export() -> Outcome {
    let adds: [(&str, Add); 10] = [
        ("box friction", |e, v| {
            e.physics3d_add_box_collider(
                2, 0.5, 0.5, 0.5, 0.0, 0.0, 0.0, false, v, 0.0, ALL, ALL, 9,
            )
        }),
        ("box restitution", |e, v| {
            e.physics3d_add_box_collider(
                2, 0.5, 0.5, 0.5, 0.0, 0.0, 0.0, false, 0.5, v, ALL, ALL, 9,
            )
        }),
        ("sphere friction", |e, v| {
            e.physics3d_add_sphere_collider(2, 0.5, 0.0, 0.0, 0.0, false, v, 0.0, ALL, ALL, 9)
        }),
        ("sphere restitution", |e, v| {
            e.physics3d_add_sphere_collider(2, 0.5, 0.0, 0.0, 0.0, false, 0.5, v, ALL, ALL, 9)
        }),
        ("capsule friction", |e, v| {
            e.physics3d_add_capsule_collider(2, 0.5, 0.5, 0.0, 0.0, 0.0, false, v, 0.0, ALL, ALL, 9)
        }),
        ("capsule restitution", |e, v| {
            e.physics3d_add_capsule_collider(2, 0.5, 0.5, 0.0, 0.0, 0.0, false, 0.5, v, ALL, ALL, 9)
        }),
        ("convex friction", |e, v| {
            e.physics3d_add_convex_collider(
                2, &TETRA, 0.0, 0.0, 0.0, false, v, 0.0, 1.0, ALL, ALL, 9,
            )
        }),
        ("heightfield friction", |e, v| {
            e.physics3d_add_heightfield_collider(
                3, &FLAT_3X3, 3, 3, 1.0, 1.0, 1.0, v, 0.0, ALL, ALL, 9,
            )
        }),
        ("heightfield restitution", |e, v| {
            e.physics3d_add_heightfield_collider(
                3, &FLAT_3X3, 3, 3, 1.0, 1.0, 1.0, 0.5, v, ALL, ALL, 9,
            )
        }),
        ("mesh restitution", |e, v| {
            e.physics3d_add_mesh_collider(
                3, &QUAD, &QUAD_IDX, 0.0, 0.0, 0.0, false, 0.5, v, ALL, ALL, 9,
            )
        }),
    ];
    for (name, add) in adds {
        run_cases(name, add, coefficient_cases())?;
    }
    Ok(())
}

#[test]
fn convex_density_is_validated() -> Outcome {
    let density: Add = |e, v| {
        e.physics3d_add_convex_collider(2, &TETRA, 0.0, 0.0, 0.0, false, 0.5, 0.0, v, ALL, ALL, 9)
    };
    let cases = vec![
        (NAN, Err(invalid_collider(InvalidColliderReason::NonFinite))),
        (INF, Err(invalid_collider(InvalidColliderReason::NonFinite))),
        (-1.0, Err(invalid_collider(InvalidColliderReason::Negative))),
        (0.0, Ok(())),
        (1.0, Ok(())),
        (1e9, Ok(())),
    ];
    run_cases("convex density", density, cases)
}

// ── INVALID_SHAPE: heightfield ───────────────────────────────────────────────

#[test]
fn heightfield_scale_and_heights_are_validated() -> Outcome {
    let adds: [(&str, Add); 4] = [
        ("scale_x", |e, v| {
            e.physics3d_add_heightfield_collider(
                3, &FLAT_3X3, 3, 3, v, 1.0, 1.0, 0.5, 0.0, ALL, ALL, 9,
            )
        }),
        ("scale_y", |e, v| {
            e.physics3d_add_heightfield_collider(
                3, &FLAT_3X3, 3, 3, 1.0, v, 1.0, 0.5, 0.0, ALL, ALL, 9,
            )
        }),
        ("scale_z", |e, v| {
            e.physics3d_add_heightfield_collider(
                3, &FLAT_3X3, 3, 3, 1.0, 1.0, v, 0.5, 0.0, ALL, ALL, 9,
            )
        }),
        ("update scale_x", |e, v| {
            e.physics3d_update_heightfield_collider(
                3, 9, &FLAT_3X3, 3, 3, v, 1.0, 1.0, 0.5, 0.0, ALL, ALL,
            )
        }),
    ];
    for (name, add) in adds {
        run_cases(name, add, size_cases())?;
    }
    let height: Add = |e, v| {
        let mut heights = FLAT_3X3;
        heights[4] = v;
        e.physics3d_add_heightfield_collider(
            3, &heights, 3, 3, 1.0, 1.0, 1.0, 0.5, 0.0, ALL, ALL, 9,
        )
    };
    run_cases("height", height, coordinate_cases())
}

#[test]
fn heightfield_with_fewer_than_two_rows_or_columns_is_refused() -> Outcome {
    let too_small = invalid_shape(InvalidShapeReason::HeightfieldTooSmall);
    for (rows, cols, len) in [
        (0, 0, 0),
        (1, 1, 1),
        (2, 1, 2),
        (1, 2, 2),
        (3, 0, 0),
        (0, 3, 0),
    ] {
        let heights = vec![0.0f32; len];
        refused(no_setup, too_small, |e| {
            hf(e, &heights, rows, cols, [1.0; 3])
        })?;
    }
    Ok(())
}

#[test]
fn heightfield_sample_count_must_equal_rows_times_columns() -> Outcome {
    let mismatch = invalid_shape(InvalidShapeReason::HeightfieldSampleCount);
    // 2x2 needs 4. A short, a long, an empty and an overflowing product are all refused.
    for (rows, cols, len) in [
        (2, 2, 3),
        (2, 2, 5),
        (2, 2, 0),
        (65_536, 65_536, 0),
        (65_536, 65_536, 4),
        (u32::MAX, 2, 4),
        (u32::MAX, u32::MAX, 4),
    ] {
        let heights = vec![0.0f32; len];
        refused(no_setup, mismatch, |e| {
            hf(e, &heights, rows, cols, [1.0; 3])
        })?;
    }
    Ok(())
}

#[test]
fn heightfield_two_by_two_is_accepted() -> Outcome {
    let mut e = scene()?;
    assert_eq!(hf(&mut e, &[0.0; 4], 2, 2, [1.0; 3]), Ok(()));
    Ok(())
}

/// Local (x, z) of sample (row, col).
///
/// `x_at` / `z_at` in parry3d-0.17.6 `shape/heightfield3.rs:225-231`:
/// `(-0.5 + j / (cols-1)) * scale_x`, `(-0.5 + i / (rows-1)) * scale_z`.
fn heightfield_sample_xz(
    row: u32,
    col: u32,
    rows: u32,
    cols: u32,
    scale_x: f32,
    scale_z: f32,
) -> (f32, f32) {
    let cell_x = 1.0 / (cols as f32 - 1.0);
    let cell_z = 1.0 / (rows as f32 - 1.0);
    let x = (-0.5 + cell_x * col as f32) * scale_x;
    let z = (-0.5 + cell_z * row as f32) * scale_z;
    (x, z)
}

fn downward_ray(e: &Engine, x: f32, z: f32) -> Result<Vec<f32>, Physics3DError> {
    // Hit layout is 9 floats: [1, entity, toi, nx, ny, nz, px, py, pz]
    // (`physics3d/world.rs:2859-2868`). A miss is `[0]` (`:2851`).
    e.physics3d_cast_ray(x, 20.0, z, 0.0, -1.0, 0.0, 100.0, ALL, ALL, true)
}

fn assert_ray_height(hit: &[f32], entity: f32, y: f32, tol: f32) {
    assert_eq!(hit.len(), 9, "ray missed");
    assert_eq!(hit[0], 1.0);
    assert_eq!(hit[1], entity);
    let delta = (hit[7] - y).abs();
    assert_eq!(
        delta.clamp(0.0, tol),
        delta,
        "hit y {} expected {y} ± {tol}",
        hit[7]
    );
}

#[test]
fn heightfield_row_major_cell_is_where_the_ray_hits() -> Outcome {
    // 2×3, row-major. Only (row 0, col 2) is raised. Scales differ so an axis swap moves the cell.
    const ROWS: u32 = 2;
    const COLS: u32 = 3;
    const RAISED: f32 = 4.0;
    const SCALE_X: f32 = 8.0;
    const SCALE_Y: f32 = 2.0;
    const SCALE_Z: f32 = 6.0;
    const ORIGIN_X: f32 = 30.0;
    const ORIGIN_Y: f32 = 0.0;
    const ORIGIN_Z: f32 = 0.0;
    const SLOT: f32 = 5.0;
    let heights = [0.0, 0.0, RAISED, 0.0, 0.0, 0.0];
    let mut e = scene()?;
    e.physics3d_add_body(5, ORIGIN_X, ORIGIN_Y, ORIGIN_Z, 0, 1.0, 0.0, 0.0)?;
    e.physics3d_add_heightfield_collider(
        5, &heights, ROWS, COLS, SCALE_X, SCALE_Y, SCALE_Z, 0.5, 0.0, ALL, ALL, 7,
    )?;
    // The query pipeline updates inside `step` (`physics3d/world.rs:939`).
    e.physics3d_step(1.0 / 60.0)?;

    let cell_x = SCALE_X / (COLS as f32 - 1.0);
    let cell_z = SCALE_Z / (ROWS as f32 - 1.0);
    let (peak_x, peak_z) = heightfield_sample_xz(0, 2, ROWS, COLS, SCALE_X, SCALE_Z);
    // (row 0, col 2) is the +X/−Z corner, on the AABB face (`heightfield3.rs:100-101`).
    // A ray exactly on that face can miss the triangle, so the ray steps inside the
    // left triangle of the cell that owns the vertex (`heightfield3.rs:394-398`).
    // ez is half the limit ez <= ex * cell_z / cell_x that keeps the point in that triangle.
    let ex = cell_x * 1.0e-3;
    let ez = ex * cell_z / cell_x * 0.5;
    let raised_y = ORIGIN_Y + RAISED * SCALE_Y;
    // On that triangle y falls linearly with ex. The drop is raised_y * (ex / cell_x).
    let raised_tol = (RAISED * SCALE_Y) * (ex / cell_x) * 2.0;
    let peak = downward_ray(&e, ORIGIN_X + peak_x - ex, ORIGIN_Z + peak_z + ez)?;
    assert_ray_height(&peak, SLOT, raised_y, raised_tol);

    // (row 1, col 0) is the opposite corner, where a reversed or doubly mirrored
    // fill would put the raised sample.
    let (flat_x, flat_z) = heightfield_sample_xz(1, 0, ROWS, COLS, SCALE_X, SCALE_Z);
    // That sample is the other corner. The ray steps into the cell whose four samples are 0.
    let flat = downward_ray(&e, ORIGIN_X + flat_x + ex, ORIGIN_Z + flat_z - ez)?;
    assert_ray_height(&flat, SLOT, ORIGIN_Y, 1.0e-3);

    // (row 0, col 1) is the neighbour along the raised edge. The ray steps away from the
    // peak, into the same all-zero cell, so a column-major fill would raise this point.
    let (mid_x, mid_z) = heightfield_sample_xz(0, 1, ROWS, COLS, SCALE_X, SCALE_Z);
    let neighbour = downward_ray(&e, ORIGIN_X + mid_x - ex, ORIGIN_Z + mid_z + ez)?;
    assert_ray_height(&neighbour, SLOT, ORIGIN_Y, 1.0e-3);
    Ok(())
}

#[test]
fn update_heightfield_refused_keeps_the_old_collider() -> Outcome {
    let too_small = invalid_shape(InvalidShapeReason::HeightfieldTooSmall);
    let update = |e: &mut Engine, heights: &[f32], rows: u32, cols: u32, scale: f32| {
        ok(e.physics3d_update_heightfield_collider(
            5, 7, heights, rows, cols, scale, 1.0, 8.0, 0.5, 0.0, ALL, ALL,
        ))
    };
    refused(heightfield_floor, too_small, |e| {
        update(e, &[0.0], 1, 1, 8.0)
    })?;
    refused(
        heightfield_floor,
        invalid_shape(InvalidShapeReason::HeightfieldSampleCount),
        |e| update(e, &[0.0; 8], 3, 3, 8.0),
    )?;
    refused(
        heightfield_floor,
        invalid_collider(InvalidColliderReason::NonFinite),
        |e| update(e, &FLAT_3X3, 3, 3, NAN),
    )?;
    refused(
        heightfield_floor,
        Physics3DError::BodyNotFound { slot: 99 },
        |e| {
            ok(e.physics3d_update_heightfield_collider(
                99, 7, &FLAT_3X3, 3, 3, 8.0, 1.0, 8.0, 0.5, 0.0, ALL, ALL,
            ))
        },
    )
}

#[test]
fn update_heightfield_accepted_replaces_the_old_collider() -> Outcome {
    let mut e = scene()?;
    heightfield_floor(&mut e)?;
    let mut reference = scene()?;
    heightfield_floor(&mut reference)?;
    let lifted = [4.0f32; 9];
    assert_eq!(
        e.physics3d_update_heightfield_collider(
            5, 7, &lifted, 3, 3, 8.0, 1.0, 8.0, 0.5, 0.0, ALL, ALL
        ),
        Ok(true)
    );
    assert_ne!(fingerprint(&mut e)?, fingerprint(&mut reference)?);
    Ok(())
}

// ── INVALID_SHAPE / INVALID_MESH_BUFFER: mesh ────────────────────────────────

#[test]
fn mesh_positions_length_not_a_multiple_of_three_is_refused() -> Outcome {
    for len in [1usize, 2, 4, 11, 13] {
        let vertices = vec![0.0f32; len];
        refused(
            no_setup,
            Physics3DError::InvalidMeshBuffer { actual: len as u32 },
            |e| mesh(e, &vertices, &QUAD_IDX),
        )?;
    }
    Ok(())
}

#[test]
fn mesh_index_outside_the_vertex_list_is_refused() -> Outcome {
    let out_of_range = invalid_shape(InvalidShapeReason::TrimeshIndexOutOfRange);
    // The quad has 4 vertices: index 3 is the last valid one.
    for indices in [[0u32, 1, 4], [0, 1, 9], [0, 1, u32::MAX]] {
        refused(no_setup, out_of_range, |e| mesh(e, &QUAD, &indices))?;
    }
    let mut e = scene()?;
    assert_eq!(mesh(&mut e, &QUAD, &[0, 1, 3]), Ok(()));
    Ok(())
}

#[test]
fn mesh_without_vertices_or_triangles_is_refused() -> Outcome {
    let empty = invalid_shape(InvalidShapeReason::MeshEmpty);
    refused(no_setup, empty, |e| mesh(e, &QUAD, &[]))?;
    refused(no_setup, empty, |e| mesh(e, &[], &QUAD_IDX))?;
    refused(no_setup, empty, |e| mesh(e, &[], &[]))?;
    Ok(())
}

#[test]
fn mesh_vertex_coordinates_are_validated() -> Outcome {
    let vertex: Add = |e, v| {
        let mut vertices = QUAD;
        vertices[4] = v;
        e.physics3d_add_mesh_collider(
            3, &vertices, &QUAD_IDX, 0.0, 0.0, 0.0, false, 0.5, 0.0, ALL, ALL, 9,
        )
    };
    run_cases("mesh vertex", vertex, coordinate_cases())
}

#[test]
fn rebuild_mesh_refused_keeps_the_old_collider() -> Outcome {
    let rebuild = |e: &mut Engine, vertices: &[f32], indices: &[u32]| {
        ok(e.physics3d_rebuild_mesh_collider(
            5, 7, vertices, indices, 0.0, 0.0, 0.0, false, 0.5, 0.0, ALL, ALL,
        ))
    };
    refused(
        mesh_floor,
        invalid_shape(InvalidShapeReason::TrimeshIndexOutOfRange),
        |e| rebuild(e, &QUAD, &[0, 1, 9]),
    )?;
    refused(
        mesh_floor,
        Physics3DError::InvalidMeshBuffer { actual: 5 },
        |e| rebuild(e, &[0.0; 5], &QUAD_IDX),
    )?;
    refused(
        mesh_floor,
        invalid_shape(InvalidShapeReason::MeshEmpty),
        |e| rebuild(e, &QUAD, &[]),
    )?;
    refused(
        mesh_floor,
        invalid_collider(InvalidColliderReason::NonFinite),
        |e| {
            let mut vertices = QUAD;
            vertices[0] = NAN;
            rebuild(e, &vertices, &QUAD_IDX)
        },
    )
}

#[test]
fn rebuild_mesh_accepted_replaces_the_old_collider() -> Outcome {
    let mut e = scene()?;
    mesh_floor(&mut e)?;
    let mut reference = scene()?;
    mesh_floor(&mut reference)?;
    let lifted: Vec<f32> = QUAD
        .chunks(3)
        .flat_map(|c| [c[0], c[1] + 3.0, c[2]])
        .collect();
    assert_eq!(
        e.physics3d_rebuild_mesh_collider(
            5, 7, &lifted, &QUAD_IDX, 0.0, 0.0, 0.0, false, 0.5, 0.0, ALL, ALL
        ),
        Ok(true)
    );
    assert_ne!(fingerprint(&mut e)?, fingerprint(&mut reference)?);
    Ok(())
}

// ── INVALID_SHAPE: convex ────────────────────────────────────────────────────

#[test]
fn convex_with_fewer_than_four_points_is_refused() -> Outcome {
    let few = invalid_shape(InvalidShapeReason::ConvexTooFewPoints);
    for points in [&TETRA[..0], &TETRA[..3], &TETRA[..6], &TETRA[..9]] {
        refused(no_setup, few, |e| convex(e, points, 1.0))?;
    }
    Ok(())
}

#[test]
fn convex_clouds_rejected_by_try_convex_hull_are_refused() -> Outcome {
    let degenerate = invalid_shape(InvalidShapeReason::ConvexDegenerate);
    let clouds: [&[f32]; 4] = [
        &[1.0; 12],
        &[0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 2.0, 0.0, 0.0, 3.0, 0.0, 0.0],
        &[0.0, 0.0, 0.0, 1e9, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0],
        &[0.0; 12],
    ];
    for cloud in clouds {
        refused(no_setup, degenerate, |e| convex(e, cloud, 1.0))?;
    }
    Ok(())
}

#[test]
fn convex_coplanar_points_that_parry_accepts_stay_accepted() -> Outcome {
    let mut e = scene()?;
    let quad = [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 1.0, 1.0, 0.0];
    assert_eq!(convex(&mut e, &quad, 1.0), Ok(()));
    Ok(())
}

#[test]
fn convex_coordinates_are_validated() -> Outcome {
    // A tetrahedron of edge `v`: every coordinate is `v` or 0.
    let coordinate: Add = |e, v| {
        let points = [0.0, 0.0, 0.0, v, 0.0, 0.0, 0.0, v, 0.0, 0.0, 0.0, v];
        e.physics3d_add_convex_collider(
            2, &points, 0.0, 0.0, 0.0, false, 0.5, 0.0, 1.0, ALL, ALL, 9,
        )
    };
    let cases = vec![
        (NAN, Err(invalid_collider(InvalidColliderReason::NonFinite))),
        (INF, Err(invalid_collider(InvalidColliderReason::NonFinite))),
        (
            -INF,
            Err(invalid_collider(InvalidColliderReason::NonFinite)),
        ),
        (
            0.0,
            Err(invalid_shape(InvalidShapeReason::ConvexDegenerate)),
        ),
        (-1.0, Ok(())),
        (1.0, Ok(())),
        (MAX_COLLIDER_MAGNITUDE, Ok(())),
        (-MAX_COLLIDER_MAGNITUDE, Ok(())),
        (
            above(MAX_COLLIDER_MAGNITUDE),
            Err(invalid_collider(InvalidColliderReason::TooLarge)),
        ),
        (1e30, Err(invalid_collider(InvalidColliderReason::TooLarge))),
    ];
    run_cases("convex coordinate", coordinate, cases)
}

#[test]
fn convex_tetrahedron_is_accepted_and_ragged_points_are_dropped() -> Outcome {
    let mut e = scene()?;
    assert_eq!(convex(&mut e, &TETRA, 1.0), Ok(()));
    let mut ragged = scene()?;
    assert_eq!(
        convex(&mut ragged, &TETRA[..11], 1.0),
        Err(invalid_shape(InvalidShapeReason::ConvexTooFewPoints))
    );
    Ok(())
}

// ── INVALID_COMPOUND ─────────────────────────────────────────────────────────

#[test]
fn compound_length_not_a_multiple_of_twelve_is_refused() -> Outcome {
    let ragged = Physics3DError::InvalidCompound {
        reason: InvalidCompoundReason::LengthNotMultipleOfStride,
    };
    for len in [1usize, 11, 13, 25] {
        let data = vec![0.0f32; len];
        refused(no_setup, ragged, |e| {
            e.physics3d_add_compound_collider(2, &data, ALL, ALL)
                .map(|_| ())
        })?;
    }
    Ok(())
}

#[test]
fn compound_with_an_unknown_shape_type_inserts_nothing() -> Outcome {
    let unknown = Physics3DError::InvalidCompound {
        reason: InvalidCompoundReason::UnknownShapeType,
    };
    for bad in [3.0, 77.0, -1.0, NAN, INF, 0.5] {
        // The valid first part must not survive the refusal of the second.
        let data = [part(0.0, [0.5; 3], 1.0), part(bad, [0.5; 3], 2.0)].concat();
        refused(no_setup, unknown, |e| {
            e.physics3d_add_compound_collider(2, &data, ALL, ALL)
                .map(|_| ())
        })?;
    }
    Ok(())
}

#[test]
fn compound_with_an_invalid_part_inserts_nothing() -> Outcome {
    let cases = [
        (
            part(1.0, [NAN, 0.0, 0.0], 2.0),
            invalid_collider(InvalidColliderReason::NonFinite),
        ),
        (
            part(0.0, [-0.5, 0.5, 0.5], 2.0),
            invalid_collider(InvalidColliderReason::Negative),
        ),
        (
            part(2.0, [1e30, 0.5, 0.0], 2.0),
            invalid_collider(InvalidColliderReason::TooLarge),
        ),
        (
            part(0.0, [0.5; 3], NAN),
            invalid_collider(InvalidColliderReason::NonFinite),
        ),
    ];
    for (bad, expected) in cases {
        let data = [part(0.0, [0.5; 3], 1.0), bad].concat();
        refused(no_setup, expected, |e| {
            e.physics3d_add_compound_collider(2, &data, ALL, ALL)
                .map(|_| ())
        })?;
    }
    Ok(())
}

// ── BVH_LOAD_FAILED ──────────────────────────────────────────────────────────

fn bvh_failure(reason: BvhLoadReason) -> Physics3DError {
    Physics3DError::BvhLoadFailed { reason }
}

#[test]
fn bvh_header_failures_are_typed() -> Outcome {
    let valid = bvh_bytes(&QUAD, &QUAD_IDX);
    refused(no_setup, bvh_failure(BvhLoadReason::TooShort), |e| {
        load_bvh(e, 3, &[])
    })?;
    refused(no_setup, bvh_failure(BvhLoadReason::TooShort), |e| {
        load_bvh(e, 3, &valid[..7])
    })?;
    let mut bad_magic = valid.clone();
    bad_magic[0] = b'X';
    refused(no_setup, bvh_failure(BvhLoadReason::BadMagic), |e| {
        load_bvh(e, 3, &bad_magic)
    })
}

#[test]
fn bvh_payload_failures_are_typed() -> Outcome {
    let valid = bvh_bytes(&QUAD, &QUAD_IDX);
    refused(no_setup, bvh_failure(BvhLoadReason::DecodeFailed), |e| {
        load_bvh(e, 3, &valid[..valid.len() / 2])
    })?;
    let mut garbage = b"GBVH\0\0\0\0".to_vec();
    garbage.extend_from_slice(&[0xFF; 64]);
    refused(no_setup, bvh_failure(BvhLoadReason::DecodeFailed), |e| {
        load_bvh(e, 3, &garbage)
    })
}

#[test]
fn bvh_with_an_index_outside_the_vertex_list_is_refused() -> Outcome {
    let mut bytes = bvh_bytes(&QUAD, &QUAD_IDX);
    // bincode lays out `indices` as the length (2) then six one-byte indices.
    let needle = [2u8, 0, 2, 1, 1, 2, 3];
    let at = bytes.windows(needle.len()).position(|w| w == needle);
    assert_eq!(at.is_some(), at.is_some());
    if let Some(start) = at {
        bytes[start + 6] = 100;
    }
    refused(no_setup, bvh_failure(BvhLoadReason::InvalidMesh), |e| {
        load_bvh(e, 3, &bytes)
    })
}

#[test]
fn bvh_valid_buffer_is_accepted() -> Outcome {
    let mut e = scene()?;
    let valid = bvh_bytes(&QUAD, &QUAD_IDX);
    assert_eq!(load_bvh(&mut e, 3, &valid), Ok(()));
    Ok(())
}

// ── bulk_spawn_static_boxes ──────────────────────────────────────────────────

fn spawn(
    e: &mut Engine,
    slots: &[u32],
    positions: &[f32],
    extents: &[f32],
) -> Result<u32, Physics3DError> {
    e.physics3d_bulk_spawn_static_boxes(slots, positions, extents, 0.5, 0.0, ALL, ALL)
}

#[test]
fn bulk_spawn_registers_every_slot_and_returns_the_count() -> Outcome {
    let mut e = scene()?;
    let positions = [20.0, 2.0, 0.0, 22.0, 2.0, 0.0, 24.0, 2.0, 0.0];
    assert_eq!(spawn(&mut e, &[7, 8, 9], &positions, &[0.5; 3]), Ok(3));
    for slot in [7, 8, 9] {
        assert_eq!(e.physics3d_has_body(slot), Ok(true));
        assert_eq!(e.physics3d_get_body_kind(slot), Ok(0));
    }
    assert_eq!(e.physics3d_get_body_state(8)?[0..3], [22.0, 2.0, 0.0]);
    // Per-entity extents are accepted too, and an empty batch is a no-op.
    let per_entity = [0.5, 0.5, 0.5, 1.0, 1.0, 1.0];
    assert_eq!(
        spawn(&mut e, &[10, 11], &positions[..6], &per_entity),
        Ok(2)
    );
    assert_eq!(spawn(&mut e, &[], &[], &[0.5; 3]), Ok(0));
    Ok(())
}

#[test]
fn bulk_spawn_on_a_registered_slot_returns_body_already_exists_and_writes_nothing() -> Outcome {
    let positions = [20.0, 2.0, 0.0, 22.0, 2.0, 0.0, 24.0, 2.0, 0.0];
    // Slot 2 is registered and listed last: slots 7 and 8 must not be created either.
    let mut e = scene()?;
    let mut untouched = scene()?;
    assert_eq!(
        spawn(&mut e, &[7, 8, 2], &positions, &[0.5; 3]),
        Err(Physics3DError::BodyAlreadyExists { slot: 2 })
    );
    assert_eq!(e.physics3d_has_body(7), Ok(false));
    assert_eq!(e.physics3d_has_body(8), Ok(false));
    assert_eq!(fingerprint(&mut e)?, fingerprint(&mut untouched)?);
    Ok(())
}

#[test]
fn bulk_spawn_with_a_duplicate_slot_in_the_batch_writes_nothing() -> Outcome {
    refused(
        no_setup,
        Physics3DError::BodyAlreadyExists { slot: 7 },
        |e| spawn(e, &[7, 8, 7], &[0.0; 9], &[0.5; 3]).map(|_| ()),
    )?;
    let mut e = scene()?;
    spawn(&mut e, &[7, 8, 7], &[0.0; 9], &[0.5; 3]).ok();
    assert_eq!(e.physics3d_has_body(7), Ok(false));
    assert_eq!(e.physics3d_has_body(8), Ok(false));
    Ok(())
}

#[test]
fn bulk_spawn_short_buffers_return_buffer_length_mismatch() -> Outcome {
    let mismatch = |buffer, expected, actual| Physics3DError::BufferLengthMismatch {
        buffer,
        expected,
        actual,
    };
    refused(no_setup, mismatch("positions", 6, 5), |e| {
        spawn(e, &[7, 8], &[0.0; 5], &[0.5; 3]).map(|_| ())
    })?;
    refused(no_setup, mismatch("half_extents", 6, 4), |e| {
        spawn(e, &[7, 8], &[0.0; 6], &[0.5; 4]).map(|_| ())
    })?;
    refused(no_setup, mismatch("half_extents", 6, 0), |e| {
        spawn(e, &[7, 8], &[0.0; 6], &[]).map(|_| ())
    })
}

#[test]
fn bulk_spawn_values_are_validated_before_any_body_is_created() -> Outcome {
    let bad_position = Physics3DError::InvalidCollider {
        reason: InvalidColliderReason::NonFinite,
    };
    let mut positions = [0.0f32; 9];
    positions[7] = NAN;
    refused(no_setup, bad_position, |e| {
        spawn(e, &[7, 8, 9], &positions, &[0.5; 3]).map(|_| ())
    })?;
    refused(
        no_setup,
        invalid_collider(InvalidColliderReason::Negative),
        |e| spawn(e, &[7, 8], &[0.0; 6], &[0.5, 0.5, 0.5, 0.5, -0.5, 0.5]).map(|_| ()),
    )?;
    refused(
        no_setup,
        invalid_collider(InvalidColliderReason::TooLarge),
        |e| spawn(e, &[7], &[0.0; 3], &[1e30, 0.5, 0.5]).map(|_| ()),
    )?;
    refused(
        no_setup,
        invalid_collider(InvalidColliderReason::NonFinite),
        |e| {
            e.physics3d_bulk_spawn_static_boxes(&[7], &[0.0; 3], &[0.5; 3], NAN, 0.0, ALL, ALL)
                .map(|_| ())
        },
    )?;
    refused(
        no_setup,
        invalid_collider(InvalidColliderReason::NonFinite),
        |e| {
            e.physics3d_bulk_spawn_static_boxes(&[7], &[0.0; 3], &[0.5; 3], 0.5, INF, ALL, ALL)
                .map(|_| ())
        },
    )
}

// ── bulk_step_kinematics / bulk_step_kinematic_rotations ─────────────────────

fn mismatch(buffer: &'static str, expected: u32, actual: u32) -> Physics3DError {
    Physics3DError::BufferLengthMismatch {
        buffer,
        expected,
        actual,
    }
}

#[test]
fn bulk_step_kinematics_length_mismatch_names_the_buffer_and_moves_nothing() -> Outcome {
    let one = [1.0f32];
    let two = [1.0f32, 1.0];
    refused(no_setup, mismatch("vx", 2, 1), |e| {
        e.physics3d_bulk_step_kinematics(&[4, 4], &one, &two, &two, 1.0)
            .map(|_| ())
    })?;
    refused(no_setup, mismatch("vy", 2, 1), |e| {
        e.physics3d_bulk_step_kinematics(&[4, 4], &two, &one, &two, 1.0)
            .map(|_| ())
    })?;
    refused(no_setup, mismatch("vz", 2, 0), |e| {
        e.physics3d_bulk_step_kinematics(&[4, 4], &two, &two, &[], 1.0)
            .map(|_| ())
    })?;
    // When several buffers disagree, the first in argument order is named.
    refused(no_setup, mismatch("vx", 2, 3), |e| {
        e.physics3d_bulk_step_kinematics(&[4, 4], &[1.0; 3], &one, &[], 1.0)
            .map(|_| ())
    })
}

#[test]
fn bulk_step_kinematic_rotations_length_mismatch_names_the_buffer_and_moves_nothing() -> Outcome {
    let one = [1.0f32];
    let two = [1.0f32, 1.0];
    refused(no_setup, mismatch("wx", 2, 1), |e| {
        e.physics3d_bulk_step_kinematic_rotations(&[4, 4], &one, &two, &two, 1.0)
            .map(|_| ())
    })?;
    refused(no_setup, mismatch("wy", 2, 1), |e| {
        e.physics3d_bulk_step_kinematic_rotations(&[4, 4], &two, &one, &two, 1.0)
            .map(|_| ())
    })?;
    refused(no_setup, mismatch("wz", 2, 0), |e| {
        e.physics3d_bulk_step_kinematic_rotations(&[4, 4], &two, &two, &[], 1.0)
            .map(|_| ())
    })
}

#[test]
fn bulk_step_kinematics_moves_found_bodies_and_returns_the_count() -> Outcome {
    let mut e = scene()?;
    // Slot 4 is kinematic, slot 99 does not exist and is skipped, as before.
    assert_eq!(
        e.physics3d_bulk_step_kinematics(&[4, 99], &[2.0, 1.0], &[0.0, 1.0], &[0.0, 1.0], 1.0),
        Ok(1)
    );
    e.physics3d_step(0.016)?;
    assert_eq!(e.physics3d_get_body_state(4)?[0..3], [-6.0, 4.0, 0.0]);
    assert_eq!(
        e.physics3d_bulk_step_kinematics(&[], &[], &[], &[], 1.0),
        Ok(0)
    );
    Ok(())
}

#[test]
fn bulk_step_kinematic_rotations_returns_the_count() -> Outcome {
    let mut e = scene()?;
    assert_eq!(
        e.physics3d_bulk_step_kinematic_rotations(
            &[4, 99],
            &[0.0, 1.0],
            &[1.0, 1.0],
            &[0.0, 1.0],
            0.5
        ),
        Ok(1)
    );
    assert_eq!(
        e.physics3d_bulk_step_kinematic_rotations(&[], &[], &[], &[], 0.5),
        Ok(0)
    );
    Ok(())
}

// ── INVALID_MESH_BUFFER: indices ─────────────────────────────────────────────

#[test]
fn mesh_indices_length_not_a_multiple_of_three_is_refused() -> Outcome {
    for len in [1usize, 2, 4, 5, 7] {
        let mut indices = vec![0u32; len];
        indices
            .iter_mut()
            .enumerate()
            .for_each(|(i, v)| *v = (i % 3) as u32);
        refused(
            no_setup,
            Physics3DError::InvalidMeshBuffer { actual: len as u32 },
            |e| mesh(e, &QUAD, &indices),
        )?;
    }
    // A whole triangle followed by a stray index used to be accepted.
    refused(
        no_setup,
        Physics3DError::InvalidMeshBuffer { actual: 4 },
        |e| mesh(e, &QUAD, &[0, 1, 2, 3]),
    )
}

#[test]
fn mesh_positions_length_is_reported_before_the_indices_length() -> Outcome {
    refused(
        no_setup,
        Physics3DError::InvalidMeshBuffer { actual: 5 },
        |e| mesh(e, &[0.0; 5], &[0, 1, 2, 3]),
    )
}

#[test]
fn rebuild_mesh_with_indices_not_a_multiple_of_three_keeps_the_old_collider() -> Outcome {
    refused(
        mesh_floor,
        Physics3DError::InvalidMeshBuffer { actual: 4 },
        |e| {
            ok(e.physics3d_rebuild_mesh_collider(
                5,
                7,
                &QUAD,
                &[0, 1, 2, 3],
                0.0,
                0.0,
                0.0,
                false,
                0.5,
                0.0,
                ALL,
                ALL,
            ))
        },
    )?;
    // The old floor still holds the ball: it is still registered under id 7.
    let mut e = scene()?;
    mesh_floor(&mut e)?;
    let refusal = e.physics3d_rebuild_mesh_collider(
        5,
        7,
        &QUAD,
        &[0, 1, 2, 3],
        0.0,
        0.0,
        0.0,
        false,
        0.5,
        0.0,
        ALL,
        ALL,
    );
    assert_eq!(
        refusal,
        Err(Physics3DError::InvalidMeshBuffer { actual: 4 })
    );
    assert_eq!(e.physics3d_remove_collider(5, 7), Ok(true));
    Ok(())
}

// ── COLLIDER_ALREADY_EXISTS ──────────────────────────────────────────────────

fn already_exists() -> Physics3DError {
    Physics3DError::ColliderAlreadyExists {
        slot: 5,
        collider_id: 7,
    }
}

/// Slot 5 holds a fixed box floor (collider 7) with a dynamic ball (slot 6) above it.
fn box_floor(e: &mut Engine) -> Outcome {
    e.physics3d_add_body(5, 30.0, 0.0, 0.0, 0, 1.0, 0.0, 0.0)?;
    e.physics3d_add_box_collider(
        5, 8.0, 0.5, 8.0, 0.0, 0.0, 0.0, false, 0.5, 0.0, ALL, ALL, 7,
    )?;
    e.physics3d_add_body(6, 30.0, 4.0, 0.0, 1, 1.0, 0.0, 0.0)?;
    e.physics3d_add_sphere_collider(6, 0.5, 0.0, 0.0, 0.0, false, 0.5, 0.0, ALL, ALL, 8)?;
    Ok(())
}

/// Runs `op` on a world built by `setup`. It must return `expected`, leave the world bit for bit
/// as a twin that never saw it, and leave the first collider registered under its id: removing
/// that id on both worlds must still give identical simulations.
fn duplicate_refused(
    setup: fn(&mut Engine) -> Outcome,
    expected: Physics3DError,
    op: impl Fn(&mut Engine) -> Outcome,
) -> Outcome {
    refused(setup, expected, &op)?;
    let mut touched = scene()?;
    setup(&mut touched)?;
    let mut untouched = scene()?;
    setup(&mut untouched)?;
    assert_eq!(op(&mut touched), Err(expected));
    assert_eq!(touched.physics3d_remove_collider(5, 7), Ok(true));
    assert_eq!(untouched.physics3d_remove_collider(5, 7), Ok(true));
    assert_eq!(fingerprint(&mut touched)?, fingerprint(&mut untouched)?);
    Ok(())
}

#[test]
fn add_box_collider_on_a_registered_id_is_refused() -> Outcome {
    duplicate_refused(box_floor, already_exists(), |e| {
        ok(e.physics3d_add_box_collider(
            5, 3.0, 3.0, 3.0, 0.0, 4.0, 0.0, false, 0.5, 0.0, ALL, ALL, 7,
        ))
    })
}

#[test]
fn add_sphere_collider_on_a_registered_id_is_refused() -> Outcome {
    duplicate_refused(box_floor, already_exists(), |e| {
        ok(e.physics3d_add_sphere_collider(5, 3.0, 0.0, 4.0, 0.0, false, 0.5, 0.0, ALL, ALL, 7))
    })
}

#[test]
fn add_capsule_collider_on_a_registered_id_is_refused() -> Outcome {
    duplicate_refused(box_floor, already_exists(), |e| {
        ok(e.physics3d_add_capsule_collider(
            5, 3.0, 3.0, 0.0, 4.0, 0.0, false, 0.5, 0.0, ALL, ALL, 7,
        ))
    })
}

#[test]
fn add_convex_collider_on_a_registered_id_is_refused() -> Outcome {
    duplicate_refused(box_floor, already_exists(), |e| {
        ok(e.physics3d_add_convex_collider(
            5, &TETRA, 0.0, 4.0, 0.0, false, 0.5, 0.0, 1.0, ALL, ALL, 7,
        ))
    })
}

#[test]
fn add_heightfield_collider_on_a_registered_id_is_refused() -> Outcome {
    duplicate_refused(heightfield_floor, already_exists(), |e| {
        ok(e.physics3d_add_heightfield_collider(
            5, &FLAT_3X3, 3, 3, 40.0, 1.0, 40.0, 0.5, 0.0, ALL, ALL, 7,
        ))
    })
}

#[test]
fn add_mesh_collider_on_a_registered_id_is_refused() -> Outcome {
    duplicate_refused(mesh_floor, already_exists(), |e| {
        ok(e.physics3d_add_mesh_collider(
            5, &QUAD, &QUAD_IDX, 0.0, 2.0, 0.0, false, 0.5, 0.0, ALL, ALL, 7,
        ))
    })
}

#[test]
fn load_bvh_collider_on_a_registered_id_is_refused() -> Outcome {
    let bytes = bvh_bytes(&QUAD, &QUAD_IDX);
    duplicate_refused(box_floor, already_exists(), |e| {
        ok(e.physics3d_load_bvh_collider(5, &bytes, 0.0, 2.0, 0.0, false, 0.5, 0.0, ALL, ALL, 7))
    })
}

#[test]
fn add_compound_collider_with_a_registered_id_inserts_nothing() -> Outcome {
    // The first part has a free id and must not survive the refusal of the second.
    let data = [part(0.0, [3.0; 3], 3.0), part(1.0, [3.0, 0.0, 0.0], 7.0)].concat();
    duplicate_refused(box_floor, already_exists(), |e| {
        e.physics3d_add_compound_collider(5, &data, ALL, ALL)
            .map(|_| ())
    })?;
    let mut e = scene()?;
    box_floor(&mut e)?;
    e.physics3d_add_compound_collider(5, &data, ALL, ALL).ok();
    assert_eq!(
        e.physics3d_remove_collider(5, 3),
        Err(Physics3DError::ColliderNotFound {
            slot: 5,
            collider_id: 3
        })
    );
    Ok(())
}

#[test]
fn add_compound_collider_with_a_repeated_id_inserts_nothing() -> Outcome {
    let repeated = Physics3DError::ColliderAlreadyExists {
        slot: 5,
        collider_id: 3,
    };
    // Ids 3 and 4 are free; the third part repeats 3, and 3.5 truncates to 3 as well.
    for data in [
        [
            part(0.0, [3.0; 3], 3.0),
            part(1.0, [3.0, 0.0, 0.0], 4.0),
            part(0.0, [3.0; 3], 3.0),
        ]
        .concat(),
        [part(0.0, [3.0; 3], 3.0), part(1.0, [3.0, 0.0, 0.0], 3.5)].concat(),
    ] {
        refused(box_floor, repeated, |e| {
            e.physics3d_add_compound_collider(5, &data, ALL, ALL)
                .map(|_| ())
        })?;
        let mut e = scene()?;
        box_floor(&mut e)?;
        assert_eq!(
            e.physics3d_add_compound_collider(5, &data, ALL, ALL),
            Err(repeated)
        );
        for id in [3, 4] {
            assert_eq!(
                e.physics3d_remove_collider(5, id),
                Err(Physics3DError::ColliderNotFound {
                    slot: 5,
                    collider_id: id
                })
            );
        }
    }
    Ok(())
}

#[test]
fn a_value_error_is_reported_before_a_registered_id() -> Outcome {
    refused(
        box_floor,
        invalid_collider(InvalidColliderReason::NonFinite),
        |e| {
            ok(e.physics3d_add_box_collider(
                5, NAN, 3.0, 3.0, 0.0, 4.0, 0.0, false, 0.5, 0.0, ALL, ALL, 7,
            ))
        },
    )
}

#[test]
fn a_missing_body_is_reported_before_a_registered_id() -> Outcome {
    refused(box_floor, Physics3DError::BodyNotFound { slot: 77 }, |e| {
        ok(e.physics3d_add_box_collider(
            77, 3.0, 3.0, 3.0, 0.0, 4.0, 0.0, false, 0.5, 0.0, ALL, ALL, 7,
        ))
    })
}

#[test]
fn the_same_id_on_another_slot_and_a_removed_id_are_accepted() -> Outcome {
    let mut e = scene()?;
    box_floor(&mut e)?;
    // Slot 6 has no collider 7.
    assert_eq!(
        e.physics3d_add_box_collider(6, 0.5, 0.5, 0.5, 0.0, 0.0, 0.0, false, 0.5, 0.0, ALL, ALL, 7),
        Ok(true)
    );
    // Once removed, slot 5 can take id 7 again.
    assert_eq!(e.physics3d_remove_collider(5, 7), Ok(true));
    assert_eq!(
        e.physics3d_add_sphere_collider(5, 0.5, 0.0, 0.0, 0.0, false, 0.5, 0.0, ALL, ALL, 7),
        Ok(true)
    );
    Ok(())
}

#[test]
fn update_heightfield_and_rebuild_mesh_still_replace_an_existing_id() -> Outcome {
    let mut hf_world = scene()?;
    heightfield_floor(&mut hf_world)?;
    assert_eq!(
        hf_world.physics3d_update_heightfield_collider(
            5, 7, &FLAT_3X3, 3, 3, 40.0, 1.0, 40.0, 0.5, 0.0, ALL, ALL
        ),
        Ok(true)
    );
    assert_eq!(hf_world.physics3d_remove_collider(5, 7), Ok(true));
    assert_eq!(
        hf_world.physics3d_remove_collider(5, 7),
        Err(Physics3DError::ColliderNotFound {
            slot: 5,
            collider_id: 7
        })
    );
    let mut mesh_world = scene()?;
    mesh_floor(&mut mesh_world)?;
    assert_eq!(
        mesh_world.physics3d_rebuild_mesh_collider(
            5, 7, &QUAD, &QUAD_IDX, 0.0, 0.0, 0.0, false, 0.5, 0.0, ALL, ALL
        ),
        Ok(true)
    );
    assert_eq!(mesh_world.physics3d_remove_collider(5, 7), Ok(true));
    assert_eq!(
        mesh_world.physics3d_remove_collider(5, 7),
        Err(Physics3DError::ColliderNotFound {
            slot: 5,
            collider_id: 7
        })
    );
    Ok(())
}
