//! Native probe: hostile float inputs (NaN, +/-inf, negative, zero, huge, tiny) must never make
//! the physics3d exports panic. Each case runs in its own `catch_unwind` on a fresh engine.
//! A control case (1x1 heightfield built straight through rapier) is known to panic and proves
//! the probe can detect panics.
#![cfg(feature = "physics3d")]

use gwen_core::bindings::Engine;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::Mutex;

const NAN: f32 = f32::NAN;
const INF: f32 = f32::INFINITY;
const ALL: u32 = 0xFFFF_FFFF;

/// Number of probe cases built by `cases()`. Update together with the case list.
const CASE_COUNT: usize = 141;

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
type PanicHook = Box<dyn Fn(&std::panic::PanicHookInfo<'_>) + Sync + Send + 'static>;

type Case = (String, Box<dyn FnOnce()>);

/// Silences panic output while alive and restores the previous hook on drop.
struct HookGuard {
    prev: Option<PanicHook>,
}

impl HookGuard {
    fn silence() -> Self {
        let prev = std::panic::take_hook();
        std::panic::set_hook(Box::new(|_| {}));
        Self { prev: Some(prev) }
    }
}

impl Drop for HookGuard {
    fn drop(&mut self) {
        if let Some(prev) = self.prev.take() {
            std::panic::set_hook(prev);
        }
    }
}

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
    v
}

/// Runs `f` under `catch_unwind` with the panic hook silenced; true when it panicked.
fn panicked(f: impl FnOnce()) -> bool {
    let _lock = HOOK_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let _guard = HookGuard::silence();
    catch_unwind(AssertUnwindSafe(f)).is_err()
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
        .filter_map(|(name, f)| panicked(f).then_some(name))
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

#[test]
fn case_count_is_pinned() {
    let n = cases().len();
    assert_eq!(
        n, CASE_COUNT,
        "probe case count is {n}, expected {CASE_COUNT}"
    );
}
