//! Native measurement behind `MAX_COLLIDER_MAGNITUDE` and the zero-size decision.
//!
//! Native only. Run with:
//! `cargo test -p gwen-core --features physics3d --test physics3d_magnitude_probe`.
//! The raw cases build rapier and parry objects directly, because the exports refuse anything
//! above the bound before it reaches them.

#![cfg(feature = "physics3d")]

use gwen_core::bindings::Engine;
use gwen_core::physics3d::world::MAX_COLLIDER_MAGNITUDE;
use gwen_core::physics3d::Physics3DError;
use rapier3d::na::{Point3, Vector3};
use rapier3d::parry::query::{PointQuery, Ray, RayCast};
use rapier3d::parry::shape::TriMesh;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::Mutex;

type Outcome = Result<(), Physics3DError>;

const ALL: u32 = 0xFFFF_FFFF;

/// Serialises tests that swap the process-wide panic hook.
static HOOK_LOCK: Mutex<()> = Mutex::new(());

/// Indices of the values that are NaN or infinite.
fn non_finite(values: &[f32]) -> Vec<usize> {
    values
        .iter()
        .enumerate()
        .filter_map(|(i, v)| (!v.is_finite()).then_some(i))
        .collect()
}

/// Runs `f` with the panic hook silenced; true when it panicked.
fn panicked(f: impl FnOnce()) -> bool {
    let _lock = HOOK_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let prev = std::panic::take_hook();
    std::panic::set_hook(Box::new(|_| {}));
    let result = catch_unwind(AssertUnwindSafe(f));
    std::panic::set_hook(prev);
    result.is_err()
}

/// One large triangle with corners at `(-m,-m,-m)`, `(m,-m,-m)` and `(-m,m,m)`, the widest
/// triangle a coordinate bound of `m` allows along these axes.
fn diagonal_mesh(m: f32) -> TriMesh {
    let points = vec![
        Point3::new(-m, -m, -m),
        Point3::new(m, -m, -m),
        Point3::new(-m, m, m),
    ];
    TriMesh::new(points, vec![[0, 1, 2]])
}

/// A floor patch of half size `m` at y = 0, made of two triangles.
fn floor_mesh(m: f32) -> TriMesh {
    let points = vec![
        Point3::new(-m, 0.0, -m),
        Point3::new(m, 0.0, -m),
        Point3::new(-m, 0.0, m),
        Point3::new(m, 0.0, m),
    ];
    TriMesh::new(points, vec![[0, 2, 1], [1, 2, 3]])
}

/// True when projecting a point near the origin onto `mesh` panics.
fn projection_panics(mesh: impl FnOnce() -> TriMesh) -> bool {
    panicked(|| {
        let _ = mesh().project_local_point(&Point3::new(0.0, 5.0, 0.0), true);
    })
}

/// True when a downward ray cast onto `mesh` panics.
fn ray_cast_panics(mesh: impl FnOnce() -> TriMesh) -> bool {
    panicked(|| {
        let ray = Ray::new(Point3::new(0.0, 5.0, 0.0), Vector3::new(0.0, -1.0, 0.0));
        let _ = mesh().cast_local_ray(&ray, 100.0, true);
    })
}

#[test]
fn f32_spacing_at_the_bound_is_64() {
    let spacing = |v: f32| f32::from_bits(v.to_bits() + 1) - v;
    assert_eq!(MAX_COLLIDER_MAGNITUDE, 1.0e9);
    assert_eq!(spacing(MAX_COLLIDER_MAGNITUDE), 64.0);
    assert_eq!(spacing(1.0e12), 65536.0);
    assert_eq!(spacing(1.0), f32::EPSILON);
}

#[test]
fn point_projection_on_a_large_mesh_panics_above_about_two_and_a_half_billion() {
    let diagonal: Vec<(f32, bool)> = [1.0e9, 2.0e9, 2.5e9, 1.0e12]
        .into_iter()
        .map(|m| (m, projection_panics(|| diagonal_mesh(m))))
        .collect();
    assert_eq!(
        diagonal,
        vec![
            (1.0e9, false),
            (2.0e9, false),
            (2.5e9, true),
            (1.0e12, true)
        ]
    );
    let floor: Vec<(f32, bool)> = [1.0e9, 2.0e9, 3.0e9, 1.0e12]
        .into_iter()
        .map(|m| (m, projection_panics(|| floor_mesh(m))))
        .collect();
    assert_eq!(
        floor,
        vec![
            (1.0e9, false),
            (2.0e9, false),
            (3.0e9, true),
            (1.0e12, true)
        ]
    );
}

#[test]
fn ray_cast_on_a_large_mesh_does_not_panic_below_the_known_edge() {
    let measured: Vec<(f32, bool)> = [1.0e9, 1.0e12, 1.0e15]
        .into_iter()
        .map(|m| (m, ray_cast_panics(|| floor_mesh(m))))
        .collect();
    assert_eq!(
        measured,
        vec![(1.0e9, false), (1.0e12, false), (1.0e15, false)]
    );
}

/// Ground box of half extent `m` (slot 0) with a dynamic ball above it (slot 1): the ball's
/// state after 120 steps and a ray cast at the ground.
fn engine_run(m: f32) -> Result<(Vec<f32>, Vec<f32>), Physics3DError> {
    let mut e = Engine::new(16).map_err(Physics3DError::Core)?;
    e.physics3d_init(0.0, -9.81, 0.0, 16);
    e.physics3d_add_body(0, 0.0, 0.0, 0.0, 0, 1.0, 0.0, 0.0)?;
    e.physics3d_add_box_collider(0, m, m, m, 0.0, 0.0, 0.0, false, 0.5, 0.0, ALL, ALL, 1)?;
    e.physics3d_add_body(1, 0.0, m + 3.0, 0.0, 1, 1.0, 0.0, 0.0)?;
    e.physics3d_add_sphere_collider(1, 0.5, 0.0, 0.0, 0.0, false, 0.5, 0.0, ALL, ALL, 2)?;
    for _ in 0..120 {
        e.physics3d_step(1.0 / 60.0)?;
    }
    let state = e.physics3d_get_body_state(1)?;
    let ray = e.physics3d_cast_ray(0.0, m + 5.0, 0.0, 0.0, -1.0, 0.0, 10.0 * m, ALL, ALL, true)?;
    Ok((state, ray))
}

#[test]
fn bodies_and_queries_at_the_bound_stay_finite() -> Outcome {
    let (state, ray) = engine_run(MAX_COLLIDER_MAGNITUDE)?;
    assert_eq!(non_finite(&state), Vec::<usize>::new(), "state {state:?}");
    assert_eq!(non_finite(&ray), Vec::<usize>::new(), "ray {ray:?}");
    Ok(())
}

#[test]
fn a_mesh_at_the_bound_can_be_queried_through_the_exports() -> Outcome {
    let m = MAX_COLLIDER_MAGNITUDE;
    let vertices = [-m, -m, -m, m, -m, -m, -m, m, m];
    let mut e = Engine::new(16).map_err(Physics3DError::Core)?;
    e.physics3d_init(0.0, -9.81, 0.0, 16);
    e.physics3d_add_body(0, 0.0, 0.0, 0.0, 0, 1.0, 0.0, 0.0)?;
    e.physics3d_add_mesh_collider(
        0,
        &vertices,
        &[0, 1, 2],
        0.0,
        0.0,
        0.0,
        false,
        0.5,
        0.0,
        ALL,
        ALL,
        1,
    )?;
    e.physics3d_step(1.0 / 60.0)?;
    let projection = e.physics3d_project_point(0.0, 5.0, 0.0, ALL, ALL, true)?;
    assert_eq!(
        non_finite(&projection),
        Vec::<usize>::new(),
        "{projection:?}"
    );
    Ok(())
}

/// Zero-size colliders on a dynamic body above a ground box: positions after 120 steps.
fn zero_size_state(attach: fn(&mut Engine) -> Result<bool, Physics3DError>) -> Outcome {
    let mut e = Engine::new(16).map_err(Physics3DError::Core)?;
    e.physics3d_init(0.0, -9.81, 0.0, 16);
    e.physics3d_add_body(0, 0.0, 0.0, 0.0, 0, 1.0, 0.0, 0.0)?;
    e.physics3d_add_box_collider(
        0, 20.0, 0.5, 20.0, 0.0, 0.0, 0.0, false, 0.5, 0.0, ALL, ALL, 1,
    )?;
    e.physics3d_add_body(1, 0.0, 3.0, 0.0, 1, 1.0, 0.0, 0.0)?;
    attach(&mut e)?;
    for _ in 0..120 {
        e.physics3d_step(1.0 / 60.0)?;
    }
    let state = e.physics3d_get_body_state(1)?;
    assert_eq!(non_finite(&state), Vec::<usize>::new(), "state {state:?}");
    let ray = e.physics3d_cast_ray(0.0, 9.0, 0.0, 0.0, -1.0, 0.0, 50.0, ALL, ALL, true)?;
    assert_eq!(non_finite(&ray), Vec::<usize>::new(), "ray {ray:?}");
    Ok(())
}

#[test]
fn zero_sizes_keep_body_states_and_queries_finite() -> Outcome {
    zero_size_state(|e| {
        e.physics3d_add_box_collider(
            1, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, false, 0.5, 0.0, ALL, ALL, 2,
        )
    })?;
    zero_size_state(|e| {
        e.physics3d_add_sphere_collider(1, 0.0, 0.0, 0.0, 0.0, false, 0.5, 0.0, ALL, ALL, 2)
    })?;
    zero_size_state(|e| {
        e.physics3d_add_capsule_collider(1, 0.0, 0.0, 0.0, 0.0, 0.0, false, 0.5, 0.0, ALL, ALL, 2)
    })?;
    zero_size_state(|e| {
        e.physics3d_add_heightfield_collider(
            1, &[0.0; 4], 2, 2, 0.0, 0.0, 0.0, 0.5, 0.0, ALL, ALL, 2,
        )
    })?;
    zero_size_state(|e| {
        let part = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.5, 0.0, 2.0];
        e.physics3d_add_compound_collider(1, &part, ALL, ALL)
            .map(|n| n > 0)
    })
}

/// Raw rapier: a fixed cuboid of half extent `m` and a dynamic ball above it, stepped 120 times.
/// Returns the ball's final translation.
fn raw_step(m: f32) -> [f32; 3] {
    use rapier3d::prelude::*;
    let mut bodies = RigidBodySet::new();
    let mut colliders = ColliderSet::new();
    let ground = bodies.insert(RigidBodyBuilder::fixed().build());
    colliders.insert_with_parent(
        ColliderBuilder::cuboid(m, m, m).build(),
        ground,
        &mut bodies,
    );
    let ball = bodies.insert(
        RigidBodyBuilder::dynamic()
            .translation(vector![0.0, m + 3.0, 0.0])
            .build(),
    );
    colliders.insert_with_parent(ColliderBuilder::ball(0.5).build(), ball, &mut bodies);
    let mut pipeline = PhysicsPipeline::new();
    let mut islands = IslandManager::new();
    let mut broad_phase = DefaultBroadPhase::new();
    let mut narrow_phase = NarrowPhase::new();
    let mut impulse_joints = ImpulseJointSet::new();
    let mut multibody_joints = MultibodyJointSet::new();
    let mut ccd = CCDSolver::new();
    let params = IntegrationParameters::default();
    for _ in 0..120 {
        pipeline.step(
            &vector![0.0, -9.81, 0.0],
            &params,
            &mut islands,
            &mut broad_phase,
            &mut narrow_phase,
            &mut bodies,
            &mut colliders,
            &mut impulse_joints,
            &mut multibody_joints,
            &mut ccd,
            None,
            &(),
            &(),
        );
    }
    let t = bodies[ball].translation();
    [t.x, t.y, t.z]
}

#[test]
fn raw_rapier_steps_at_1e12_without_panicking_and_with_finite_positions() {
    let mut position = [0.0f32; 3];
    let did_panic = panicked(|| position = raw_step(1.0e12));
    let outcome = if did_panic { "panicked" } else { "returned" };
    assert_eq!(outcome, "returned");
    assert_eq!(non_finite(&position), Vec::<usize>::new(), "{position:?}");
}
