//! Native probe: hostile float inputs (NaN, +/-inf, negative, zero, huge, tiny) must never make
//! the physics3d exports panic. Each case runs in its own `catch_unwind` on a fresh engine.
//! A control case (1x1 heightfield built straight through rapier) is known to panic and proves
//! the probe can detect panics.
#![cfg(feature = "physics3d")]

use gwen_core::bindings::Engine;
use gwen_core::physics3d::world::{PhysicsWorld3D, MAX_COLLIDER_MAGNITUDE};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::{Arc, Mutex};

const NAN: f32 = f32::NAN;
const INF: f32 = f32::INFINITY;
const ALL: u32 = 0xFFFF_FFFF;

/// Number of probe cases built by `cases()`. Update together with the case list.
const CASE_COUNT: usize = 443;

/// Serialises tests that swap the process-wide panic hook.
static HOOK_LOCK: Mutex<()> = Mutex::new(());

type Quat = (f32, f32, f32, f32);
type State = (&'static str, [f32; 3], Quat, [f32; 3], [f32; 3]);
type Shape = (
    &'static str,
    [f32; 3],
    [f32; 3],
    [f32; 4],
    u32,
    [f32; 3],
    f32,
);
type Case = (String, Box<dyn FnOnce()>);

/// Builds the standard world, or `None` if the engine cannot be created.
fn world() -> Option<Engine> {
    let mut e = Engine::new(16).ok()?;
    e.physics3d_init(0.0, -9.81, 0.0, 16);
    let _ = e.physics3d_add_body(0, 0.0, -1.0, 0.0, 0, 1.0, 0.0, 0.0);
    let _ = e.physics3d_add_box_collider(
        0, 10.0, 0.5, 10.0, 0.0, 0.0, 0.0, false, 0.5, 0.0, ALL, ALL, 1,
    );
    let _ = e.physics3d_add_body(1, 0.0, 1.0, 0.0, 1, 1.0, 0.0, 0.0);
    let _ = e.physics3d_add_box_collider(
        1, 0.5, 0.5, 0.5, 0.0, 0.0, 0.0, false, 0.5, 0.0, ALL, ALL, 2,
    );
    let _ = e.physics3d_step(0.016);
    Some(e)
}

/// Runs `f` on a fresh world, then steps twice and casts a ray.
fn on_world<R>(name: &str, f: impl FnOnce(&mut Engine) -> R + 'static) -> Case {
    let run = move || {
        let Some(mut e) = world() else { return };
        let _ = f(&mut e);
        let _ = e.physics3d_step(0.016);
        let _ = e.physics3d_step(0.016);
        let _ = e.physics3d_cast_ray(0.0, 5.0, 0.0, 0.0, -1.0, 0.0, 100.0, ALL, ALL, true);
    };
    (name.to_string(), Box::new(run))
}

fn cases() -> Vec<Case> {
    let mut v: Vec<Case> = Vec::new();
    for (n, dt) in [
        ("nan", NAN),
        ("inf", INF),
        ("-inf", -INF),
        ("neg", -0.016),
        ("zero", 0.0),
        ("huge", 1e30),
        ("tiny", 1e-30),
    ] {
        v.push(on_world(&format!("step dt={n}"), move |e| {
            e.physics3d_step(dt)
        }));
    }
    let q1 = (0.0, 0.0, 0.0, 1.0);
    let states: [State; 6] = [
        ("pos NaN", [NAN; 3], q1, [0.0; 3], [0.0; 3]),
        ("pos inf", [INF, 0.0, 0.0], q1, [0.0; 3], [0.0; 3]),
        (
            "quat zero",
            [0.0, 1.0, 0.0],
            (0.0, 0.0, 0.0, 0.0),
            [0.0; 3],
            [0.0; 3],
        ),
        (
            "quat NaN",
            [0.0, 1.0, 0.0],
            (NAN, 0.0, 0.0, 1.0),
            [0.0; 3],
            [0.0; 3],
        ),
        (
            "vel NaN",
            [0.0, 1.0, 0.0],
            q1,
            [NAN, 0.0, 0.0],
            [NAN, 0.0, 0.0],
        ),
        (
            "vel inf",
            [0.0, 1.0, 0.0],
            q1,
            [INF, 0.0, 0.0],
            [INF, 0.0, 0.0],
        ),
    ];
    for (n, p, q, lv, av) in states {
        v.push(on_world(&format!("set_body_state {n}"), move |e| {
            e.physics3d_set_body_state(
                1, p[0], p[1], p[2], q.0, q.1, q.2, q.3, lv[0], lv[1], lv[2], av[0], av[1], av[2],
            )
        }));
    }
    let bad = [
        ("NaN", NAN),
        ("inf", INF),
        ("-inf", -INF),
        ("neg", -1.0),
        ("zero", 0.0),
    ];
    let big = [("huge", 1e30), ("tiny", 1e-30)];
    for (n, x) in bad.into_iter().chain(big) {
        v.push(on_world(&format!("lin vel {n}"), move |e| {
            e.physics3d_set_linear_velocity(1, x, x, x)
        }));
        v.push(on_world(&format!("ang vel {n}"), move |e| {
            e.physics3d_set_angular_velocity(1, x, 0.0, x)
        }));
        v.push(on_world(&format!("impulse {n}"), move |e| {
            e.physics3d_apply_impulse(1, x, 0.0, x)
        }));
        v.push(on_world(&format!("ang impulse {n}"), move |e| {
            e.physics3d_apply_angular_impulse(1, x, 0.0, x)
        }));
        v.push(on_world(&format!("force {n}"), move |e| {
            e.physics3d_add_force(1, x, 0.0, x)
        }));
        v.push(on_world(&format!("torque {n}"), move |e| {
            e.physics3d_add_torque(1, x, 0.0, x)
        }));
        v.push(on_world(&format!("force_at_point {n}"), move |e| {
            e.physics3d_add_force_at_point(1, 1.0, 0.0, 0.0, x, 0.0, x)
        }));
        v.push(on_world(&format!("gravity scale {n}"), move |e| {
            e.physics3d_set_gravity_scale(1, x)
        }));
        v.push(on_world(&format!("kinematic pos {n}"), move |e| {
            let _ = e.physics3d_set_body_kind(1, 2);
            let _ = e.physics3d_set_kinematic_position(1, x, 0.0, x, 0.0, 0.0, 0.0, 1.0);
        }));
    }
    v.push(on_world("kinematic quat zero", |e| {
        let _ = e.physics3d_set_body_kind(1, 2);
        let _ = e.physics3d_set_kinematic_position(1, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
    }));
    v.push(on_world("kinematic quat NaN", |e| {
        let _ = e.physics3d_set_body_kind(1, 2);
        let _ = e.physics3d_set_kinematic_position(1, 0.0, 0.0, 0.0, NAN, 0.0, 0.0, 1.0);
    }));
    let bodies = [
        ("mass NaN", NAN, 0.0),
        ("mass inf", INF, 0.0),
        ("mass neg", -1.0, 0.0),
        ("mass zero", 0.0, 0.0),
        ("mass huge", 1e30, 0.0),
        ("mass tiny", 1e-30, 0.0),
        ("damp NaN", 1.0, NAN),
        ("damp neg", 1.0, -1.0),
        ("damp inf", 1.0, INF),
        ("damp huge", 1.0, 1e30),
    ];
    for (n, m, d) in bodies {
        v.push(on_world(&format!("add_body {n}"), move |e| {
            let _ = e.physics3d_add_body(5, 0.0, 3.0, 0.0, 1, m, d, d);
            let _ = e.physics3d_add_box_collider(
                5, 0.5, 0.5, 0.5, 0.0, 0.0, 0.0, false, 0.5, 0.0, ALL, ALL, 3,
            );
        }));
    }
    let rays: [(&str, [f32; 7]); 10] = [
        ("origin NaN", [NAN, 5.0, 0.0, 0.0, -1.0, 0.0, 100.0]),
        ("origin inf", [INF, 5.0, 0.0, 0.0, -1.0, 0.0, 100.0]),
        ("dir zero", [0.0, 5.0, 0.0, 0.0, 0.0, 0.0, 100.0]),
        ("dir NaN", [0.0, 5.0, 0.0, NAN, -1.0, 0.0, 100.0]),
        ("dir inf", [0.0, 5.0, 0.0, INF, -1.0, 0.0, 100.0]),
        ("max NaN", [0.0, 5.0, 0.0, 0.0, -1.0, 0.0, NAN]),
        ("max inf", [0.0, 5.0, 0.0, 0.0, -1.0, 0.0, INF]),
        ("max neg", [0.0, 5.0, 0.0, 0.0, -1.0, 0.0, -1.0]),
        ("max zero", [0.0, 5.0, 0.0, 0.0, -1.0, 0.0, 0.0]),
        ("huge", [1e38, 5.0, 0.0, 0.0, -1.0, 0.0, 1e38]),
    ];
    for (n, r) in rays {
        for solid in [true, false] {
            v.push((
                format!("ray {n} solid={solid}"),
                Box::new(move || {
                    let Some(e) = world() else { return };
                    let _ = e.physics3d_cast_ray(
                        r[0], r[1], r[2], r[3], r[4], r[5], r[6], ALL, ALL, solid,
                    );
                }),
            ));
        }
    }
    let points: [(&str, [f32; 3]); 5] = [
        ("NaN", [NAN, 0.0, 0.0]),
        ("inf", [INF, 0.0, 0.0]),
        ("-inf", [-INF; 3]),
        ("huge", [1e38; 3]),
        ("allnan", [NAN; 3]),
    ];
    for (n, p) in points {
        for solid in [true, false] {
            v.push((
                format!("project {n} solid={solid}"),
                Box::new(move || {
                    let Some(e) = world() else { return };
                    let _ = e.physics3d_project_point(p[0], p[1], p[2], ALL, ALL, solid);
                }),
            ));
        }
    }
    let q = [0.0f32, 0.0, 0.0, 1.0];
    let o = [0.0f32, 5.0, 0.0];
    let d = [0.0f32, -1.0, 0.0];
    let s = [0.5f32, 0.0, 0.0];
    #[rustfmt::skip]
    let shapes: Vec<Shape> = vec![
        ("ok", o, d, q, 1, s, 100.0),
        ("pos NaN", [NAN, 5.0, 0.0], d, q, 1, s, 100.0),
        ("pos inf", [INF, 5.0, 0.0], d, q, 1, s, 100.0),
        ("dir zero", o, [0.0; 3], q, 1, s, 100.0),
        ("dir NaN", o, [NAN, -1.0, 0.0], q, 1, s, 100.0),
        ("dir inf", o, [INF, -1.0, 0.0], q, 1, s, 100.0),
        ("max NaN", o, d, q, 1, s, NAN),
        ("max inf", o, d, q, 1, s, INF),
        ("max neg", o, d, q, 1, s, -1.0),
        ("quat zero", o, d, [0.0; 4], 1, s, 100.0),
        ("quat NaN", o, d, [NAN, 0.0, 0.0, 1.0], 1, s, 100.0),
        ("ball r NaN", o, d, q, 1, [NAN, 0.0, 0.0], 100.0),
        ("ball r neg", o, d, q, 1, [-0.5, 0.0, 0.0], 100.0),
        ("ball r zero", o, d, q, 1, [0.0; 3], 100.0),
        ("ball r inf", o, d, q, 1, [INF, 0.0, 0.0], 100.0),
        ("box neg", o, d, q, 0, [-1.0; 3], 100.0),
        ("box NaN", o, d, q, 0, [NAN, 1.0, 1.0], 100.0),
        ("box zero", o, d, q, 0, [0.0; 3], 100.0),
        ("box inf", o, d, q, 0, [INF, 1.0, 1.0], 100.0),
        ("capsule neg", o, d, q, 2, [-0.5, -1.0, 0.0], 100.0),
        ("capsule NaN", o, d, q, 2, [NAN, NAN, 0.0], 100.0),
        ("capsule zero", o, d, q, 2, [0.0; 3], 100.0),
        ("unknown type", o, d, q, 77, [0.0; 3], 100.0),
    ];
    for (n, p, dir, qq, t, pp, m) in shapes {
        v.push((
            format!("cast_shape {n}"),
            Box::new(move || {
                let Some(e) = world() else { return };
                let _ = e.physics3d_cast_shape(
                    p[0], p[1], p[2], qq[0], qq[1], qq[2], qq[3], dir[0], dir[1], dir[2], t, pp[0],
                    pp[1], pp[2], m, ALL, ALL,
                );
            }),
        ));
    }
    push_extent_matrix(&mut v);
    push_blowups(&mut v);
    push_large_directions(&mut v);
    push_mesh_pose_cases(&mut v);
    v
}

fn hostile_matrix_values() -> [(&'static str, f32); 8] {
    [
        ("NaN", NAN),
        ("+inf", INF),
        ("-inf", -INF),
        ("-0", -0.0),
        ("1e-38", 1e-38),
        ("max", 1.0e7),
        ("max+ulp", 1.0e7_f32.next_up()),
        ("1e20", 1e20),
    ]
}

/// One case per float argument of `step`, `cast_ray`, `cast_shape` and `project_point`.
fn push_extent_matrix(v: &mut Vec<Case>) {
    for (label, value) in hostile_matrix_values() {
        v.push((
            format!("matrix step delta={label}"),
            Box::new(move || {
                let Some(mut e) = world() else { return };
                let _ = e.physics3d_step(value);
            }),
        ));
        for (axis, origin) in [
            ("ox", [value, 5.0, 0.0]),
            ("oy", [0.0, value, 0.0]),
            ("oz", [0.0, 5.0, value]),
        ] {
            v.push((
                format!("matrix ray {axis}={label}"),
                Box::new(move || {
                    let Some(e) = world() else { return };
                    let _ = e.physics3d_cast_ray(
                        origin[0], origin[1], origin[2], 0.0, -1.0, 0.0, 100.0, ALL, ALL, true,
                    );
                }),
            ));
        }
        for (axis, dir) in [
            ("dx", [value, -1.0, 0.0]),
            ("dy", [0.0, value, 0.0]),
            ("dz", [0.0, -1.0, value]),
        ] {
            v.push((
                format!("matrix ray {axis}={label}"),
                Box::new(move || {
                    let Some(e) = world() else { return };
                    let _ = e.physics3d_cast_ray(
                        0.0, 5.0, 0.0, dir[0], dir[1], dir[2], 100.0, ALL, ALL, true,
                    );
                }),
            ));
        }
        v.push((
            format!("matrix ray max_dist={label}"),
            Box::new(move || {
                let Some(e) = world() else { return };
                let _ = e.physics3d_cast_ray(0.0, 5.0, 0.0, 0.0, -1.0, 0.0, value, ALL, ALL, true);
            }),
        ));
        for (axis, point) in [
            ("px", [value, 0.0, 0.0]),
            ("py", [0.0, value, 0.0]),
            ("pz", [0.0, 0.0, value]),
        ] {
            v.push((
                format!("matrix project {axis}={label}"),
                Box::new(move || {
                    let Some(e) = world() else { return };
                    let _ = e.physics3d_project_point(point[0], point[1], point[2], ALL, ALL, true);
                }),
            ));
        }
        for (axis, pos) in [
            ("pos_x", [value, 5.0, 0.0]),
            ("pos_y", [0.0, value, 0.0]),
            ("pos_z", [0.0, 5.0, value]),
        ] {
            v.push((
                format!("matrix cast_shape {axis}={label}"),
                Box::new(move || {
                    let Some(e) = world() else { return };
                    let _ = e.physics3d_cast_shape(
                        pos[0], pos[1], pos[2], 0.0, 0.0, 0.0, 1.0, 0.0, -1.0, 0.0, 0, 0.5, 0.5,
                        0.5, 100.0, ALL, ALL,
                    );
                }),
            ));
        }
        for (axis, rot) in [
            ("rot_x", [value, 0.0, 0.0, 1.0]),
            ("rot_y", [0.0, value, 0.0, 1.0]),
            ("rot_z", [0.0, 0.0, value, 1.0]),
            ("rot_w", [0.0, 0.0, 0.0, value]),
        ] {
            v.push((
                format!("matrix cast_shape {axis}={label}"),
                Box::new(move || {
                    let Some(e) = world() else { return };
                    let _ = e.physics3d_cast_shape(
                        0.0, 5.0, 0.0, rot[0], rot[1], rot[2], rot[3], 0.0, -1.0, 0.0, 0, 0.5, 0.5,
                        0.5, 100.0, ALL, ALL,
                    );
                }),
            ));
        }
        for (axis, dir) in [
            ("dir_x", [value, -1.0, 0.0]),
            ("dir_y", [0.0, value, 0.0]),
            ("dir_z", [0.0, -1.0, value]),
        ] {
            v.push((
                format!("matrix cast_shape {axis}={label}"),
                Box::new(move || {
                    let Some(e) = world() else { return };
                    let _ = e.physics3d_cast_shape(
                        0.0, 5.0, 0.0, 0.0, 0.0, 0.0, 1.0, dir[0], dir[1], dir[2], 0, 0.5, 0.5,
                        0.5, 100.0, ALL, ALL,
                    );
                }),
            ));
        }
        for (axis, params) in [
            ("p0", [value, 0.5, 0.5]),
            ("p1", [0.5, value, 0.5]),
            ("p2", [0.5, 0.5, value]),
        ] {
            v.push((
                format!("matrix cast_shape {axis}={label}"),
                Box::new(move || {
                    let Some(e) = world() else { return };
                    let _ = e.physics3d_cast_shape(
                        0.0, 5.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, -1.0, 0.0, 0, params[0], params[1],
                        params[2], 100.0, ALL, ALL,
                    );
                }),
            ));
        }
        v.push((
            format!("matrix cast_shape max_dist={label}"),
            Box::new(move || {
                let Some(e) = world() else { return };
                let _ = e.physics3d_cast_shape(
                    0.0, 5.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, -1.0, 0.0, 0, 0.5, 0.5, 0.5, value,
                    ALL, ALL,
                );
            }),
        ));
        for (axis, pos) in [
            ("pos_x", [value, 5.0, 0.0]),
            ("pos_y", [0.0, value, 0.0]),
            ("pos_z", [0.0, 5.0, value]),
        ] {
            v.push((
                format!("matrix overlap {axis}={label}"),
                Box::new(move || overlap_shape_case(pos, [0.0, 0.0, 0.0, 1.0], [0.5, 0.5, 0.5])),
            ));
        }
        for (axis, rot) in [
            ("rot_x", [value, 0.0, 0.0, 1.0]),
            ("rot_y", [0.0, value, 0.0, 1.0]),
            ("rot_z", [0.0, 0.0, value, 1.0]),
            ("rot_w", [0.0, 0.0, 0.0, value]),
        ] {
            v.push((
                format!("matrix overlap {axis}={label}"),
                Box::new(move || overlap_shape_case([0.0, 5.0, 0.0], rot, [0.5, 0.5, 0.5])),
            ));
        }
        for (axis, params) in [
            ("p0", [value, 0.5, 0.5]),
            ("p1", [0.5, value, 0.5]),
            ("p2", [0.5, 0.5, value]),
        ] {
            v.push((
                format!("matrix overlap {axis}={label}"),
                Box::new(move || overlap_shape_case([0.0, 5.0, 0.0], [0.0, 0.0, 0.0, 1.0], params)),
            ));
        }
    }
}

/// One overlap of a box. The export is used when `alloc_shared_buffer` fits in a `u32`.
/// The same floats always reach `PhysicsWorld3D::overlap_shape`, which is what the export
/// calls after its pointer check. A 64-bit host pointer does not fit in that `u32`.
fn overlap_shape_case(pos: [f32; 3], rot: [f32; 4], params: [f32; 3]) {
    if let Some(mut engine) = world() {
        let ptr = engine.alloc_shared_buffer(16);
        if let Ok(out_ptr) = u32::try_from(ptr) {
            let _ = engine.physics3d_overlap_shape(
                pos[0], pos[1], pos[2], rot[0], rot[1], rot[2], rot[3], 0, params[0], params[1],
                params[2], ALL, ALL, out_ptr, 4,
            );
        }
        let _ = engine.free_shared_buffer(ptr, 16);
    }
    let built = overlap_world();
    assert_eq!(built.as_ref().err().copied(), None, "overlap world");
    let Ok(world) = built else { return };
    let mut out = [0u32; 4];
    let _ = world.overlap_shape(
        pos[0], pos[1], pos[2], rot[0], rot[1], rot[2], rot[3], 0, params[0], params[1], params[2],
        ALL, ALL, &mut out,
    );
}

/// Fixed floor large enough that a query box near the origin overlaps it.
fn overlap_world() -> Result<PhysicsWorld3D, &'static str> {
    let mut world = PhysicsWorld3D::new(0.0, 0.0, 0.0);
    if !world.add_body(0, 0.0, 0.0, 0.0, 0, 1.0, 0.0, 0.0) {
        return Err("floor body");
    }
    world
        .add_box_collider(
            0, 20.0, 20.0, 20.0, 0.0, 0.0, 0.0, false, 0.5, 0.0, ALL, ALL, 1,
        )
        .map_err(|_| "floor box")?;
    world.step(1.0 / 60.0);
    Ok(world)
}

/// Floor box plus a standing mesh. Large directions are cast at both.
fn floor_and_mesh() -> Option<Engine> {
    let mut e = Engine::new(16).ok()?;
    e.physics3d_init(0.0, -9.81, 0.0, 16);
    let _ = e.physics3d_add_body(0, 0.0, -0.5, 0.0, 0, 1.0, 0.0, 0.0);
    let _ = e.physics3d_add_box_collider(
        0, 10.0, 0.5, 10.0, 0.0, 0.0, 0.0, false, 0.5, 0.0, ALL, ALL, 1,
    );
    let _ = e.physics3d_add_body(1, 0.0, 0.0, 0.0, 0, 1.0, 0.0, 0.0);
    let vertices = [1.0, -1.0, -1.0, 1.0, -1.0, 1.0, 1.0, 2.0, 0.0];
    let _ = e.physics3d_add_mesh_collider(
        1,
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
        2,
    );
    let _ = e.physics3d_step(0.016);
    Some(e)
}

/// `1e8`, `1e20`, `1e30`, `f32::MAX`, and `(f32::MAX, f32::MAX, 0)` on cast ray and cast shape.
fn push_large_directions(v: &mut Vec<Case>) {
    let dirs: [(&str, [f32; 3]); 5] = [
        ("1e8", [1.0e8, 0.0, 0.0]),
        ("1e20", [1.0e20, 0.0, 0.0]),
        ("1e30", [1.0e30, 0.0, 0.0]),
        ("max", [f32::MAX, 0.0, 0.0]),
        ("max-max-0", [f32::MAX, f32::MAX, 0.0]),
    ];
    for (label, dir) in dirs {
        v.push((
            format!("large dir ray {label}"),
            Box::new(move || {
                let Some(e) = floor_and_mesh() else { return };
                let _ = e.physics3d_cast_ray(
                    0.0, 1.0, 0.0, dir[0], dir[1], dir[2], 100.0, ALL, ALL, true,
                );
            }),
        ));
        v.push((
            format!("large dir shape {label}"),
            Box::new(move || {
                let Some(e) = floor_and_mesh() else { return };
                let _ = e.physics3d_cast_shape(
                    0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, dir[0], dir[1], dir[2], 0, 0.5, 0.5, 0.5,
                    100.0, ALL, ALL,
                );
            }),
        ));
    }
}

fn push_blowups(v: &mut Vec<Case>) {
    v.push((
        "restitution 1e9 then step x120".to_string(),
        Box::new(|| {
            let Ok(mut e) = (|| -> Result<Engine, gwen_core::physics3d::Physics3DError> {
                let mut e = Engine::new(16).map_err(gwen_core::physics3d::Physics3DError::Core)?;
                e.physics3d_init(0.0, -9.81, 0.0, 16);
                e.physics3d_add_body(0, 0.0, 0.0, 0.0, 0, 1.0, 0.0, 0.0)?;
                e.physics3d_add_box_collider(
                    0, 20.0, 0.5, 20.0, 0.0, 0.0, 0.0, false, 0.0, 1.0e9, ALL, ALL, 1,
                )?;
                e.physics3d_add_body(1, 0.0, 2.0, 0.0, 1, 1.0, 0.0, 0.0)?;
                e.physics3d_add_box_collider(
                    1, 0.5, 0.5, 0.5, 0.0, 0.0, 0.0, false, 0.0, 1.0e9, ALL, ALL, 2,
                )?;
                Ok(e)
            })() else {
                return;
            };
            for _ in 0..120 {
                let _ = e.physics3d_step(1.0 / 60.0);
            }
        }),
    ));
    v.push((
        "velocity 1e12 then step x120".to_string(),
        Box::new(|| {
            let Some(mut e) = world() else { return };
            let _ = e.physics3d_set_linear_velocity(1, 0.0, 1.0e12, 0.0);
            for _ in 0..120 {
                let _ = e.physics3d_step(1.0 / 60.0);
            }
        }),
    ));
    v.push((
        "impulse 1e12 then step x120".to_string(),
        Box::new(|| {
            let Some(mut e) = world() else { return };
            let _ = e.physics3d_apply_impulse(1, 0.0, 1.0e12, 0.0);
            for _ in 0..120 {
                let _ = e.physics3d_step(1.0 / 60.0);
            }
        }),
    ));
    v.push((
        "kinematic 1e20 then step x120".to_string(),
        Box::new(|| {
            let Some(mut e) = world() else { return };
            let _ = e.physics3d_set_body_kind(1, 2);
            let _ = e.physics3d_set_kinematic_position(1, 1.0e20, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0);
            for _ in 0..120 {
                let _ = e.physics3d_step(1.0 / 60.0);
            }
        }),
    ));
}

/// Fixed body at `x`, or a kinematic body moved there by `physics3d_set_kinematic_position`.
/// Each pose carries a 1 m triangle and a triangle whose corners sit on the 1e9 vertex cap.
/// Both queries go through the exports.
fn push_mesh_pose_cases(v: &mut Vec<Case>) {
    let m = MAX_COLLIDER_MAGNITUDE;
    let meshes: [(&str, [f32; 9]); 2] = [
        ("1m", [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0]),
        ("cap", [-m, -m, -m, m, -m, -m, -m, m, m]),
    ];
    let poses: [(&str, f32, u8, bool); 4] = [
        ("fixed 1e19", 1.0e19, 0, false),
        ("fixed 1e30", 1.0e30, 0, false),
        ("fixed max", f32::MAX, 0, false),
        ("kinematic 1e19", 1.0e19, 2, true),
    ];
    for (pose_name, x, kind, kinematic) in poses {
        for (mesh_name, vertices) in meshes {
            v.push((
                format!("mesh pose {pose_name} {mesh_name}"),
                Box::new(move || mesh_pose_case(x, kind, kinematic, vertices)),
            ));
        }
    }
}

fn mesh_pose_case(x: f32, kind: u8, kinematic: bool, vertices: [f32; 9]) {
    let Ok(mut engine) = Engine::new(8) else {
        return;
    };
    engine.physics3d_init(0.0, 0.0, 0.0, 8);
    let start_x = if kinematic { 0.0 } else { x };
    let _ = engine.physics3d_add_body(0, start_x, 0.0, 0.0, kind, 1.0, 0.0, 0.0);
    let _ = engine.physics3d_add_mesh_collider(
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
    );
    if kinematic {
        let _ = engine.physics3d_set_kinematic_position(0, x, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0);
    }
    let _ = engine.physics3d_step(1.0 / 60.0);
    let state = match engine.physics3d_get_body_state(0) {
        Ok(state) => state,
        Err(_) => Vec::new(),
    };
    assert_eq!(state.first().copied(), Some(x), "pose {state:?}");
    let _ = engine.physics3d_project_point(0.0, 0.0, 0.0, ALL, ALL, true);
    let _ = engine.physics3d_cast_ray(0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 100.0, ALL, ALL, true);
}

/// Runs `f` under `catch_unwind` with the panic hook silenced; true when it panicked.
fn panicked(f: impl FnOnce()) -> bool {
    panic_report(f).is_some()
}

/// Panic message and source location, or `None` when `f` returns.
fn panic_report(f: impl FnOnce()) -> Option<String> {
    let _lock = HOOK_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let prev = std::panic::take_hook();
    let slot = Arc::new(Mutex::new(String::new()));
    let hook_slot = Arc::clone(&slot);
    std::panic::set_hook(Box::new(move |info| {
        let message = match info.payload().downcast_ref::<&str>() {
            Some(text) => (*text).to_string(),
            None => match info.payload().downcast_ref::<String>() {
                Some(text) => text.clone(),
                None => "non-string panic".to_string(),
            },
        };
        let location = match info.location() {
            Some(loc) => format!("{}:{}:{}", loc.file(), loc.line(), loc.column()),
            None => "unknown location".to_string(),
        };
        let mut stored = hook_slot.lock().unwrap_or_else(|p| p.into_inner());
        *stored = format!("{message} at {location}");
    }));
    let result = catch_unwind(AssertUnwindSafe(f));
    std::panic::set_hook(prev);
    match result {
        Ok(()) => None,
        Err(_) => Some(match slot.lock() {
            Ok(guard) => guard.clone(),
            Err(poisoned) => poisoned.into_inner().clone(),
        }),
    }
}

/// Builds a heightfield straight through rapier. The export refuses a grid below 2x2, so the
/// control reaches parry's own assert without it.
fn heightfield(rows: usize, cols: usize) {
    use rapier3d::na::{DMatrix, Vector3};
    let heights = vec![0.0f32; rows * cols];
    let matrix = DMatrix::from_row_slice(rows, cols, &heights);
    let _ = rapier3d::geometry::ColliderBuilder::heightfield(matrix, Vector3::new(1.0, 1.0, 1.0));
}

#[test]
fn world_fixture_builds() {
    assert_eq!(world().map(|_| "built"), Some("built"));
}

#[test]
fn hostile_floats_never_panic() {
    let failed: Vec<String> = cases()
        .into_iter()
        .filter_map(|(name, f)| panic_report(f).map(|detail| format!("{name}: {detail}")))
        .collect();
    assert_eq!(failed, Vec::<String>::new(), "cases that panicked");
}

#[test]
fn control_one_by_one_heightfield_panics() {
    let outcome = if panicked(|| heightfield(1, 1)) {
        "panicked"
    } else {
        "returned"
    };
    assert_eq!(
        outcome, "panicked",
        "1x1 heightfield did not panic: probe cannot detect"
    );
}

/// An index past the vertex list is read by `TriMesh::rebuild_qbvh`
/// (parry3d-0.17.6 `shape/trimesh.rs:489-493`).
fn out_of_range_trimesh_index() {
    use rapier3d::na::Point3;
    use rapier3d::parry::shape::TriMesh;
    let vertices = vec![
        Point3::new(0.0, 0.0, 0.0),
        Point3::new(1.0, 0.0, 0.0),
        Point3::new(0.0, 1.0, 0.0),
    ];
    let _ = TriMesh::new(vertices, vec![[0, 1, 99]]);
}

#[test]
fn control_out_of_range_trimesh_index_panics() {
    let outcome = if panicked(out_of_range_trimesh_index) {
        "panicked"
    } else {
        "returned"
    };
    assert_eq!(
        outcome, "panicked",
        "out-of-range trimesh index did not panic"
    );
}

#[test]
fn case_count_is_pinned() {
    let n = cases().len();
    assert_eq!(
        n, CASE_COUNT,
        "probe case count is {n}, expected {CASE_COUNT}"
    );
}
