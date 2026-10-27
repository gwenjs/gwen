//! Native probe: hostile float inputs (NaN, +/-inf, negative, zero, huge, tiny) and degenerate
//! pairs (both ends on one entity) must never make the physics3d character controller and joint
//! exports panic. Each case runs in its own `catch_unwind` on a fresh engine. A control case
//! (1x1 heightfield built straight through rapier) is known to panic and proves the probe can
//! detect panics. The case list is pinned by `CASE_COUNT`.
#![cfg(feature = "physics3d")]

use gwen_core::bindings::Engine;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::Mutex;

const NAN: f32 = f32::NAN;
const INF: f32 = f32::INFINITY;
const ALL: u32 = 0xFFFF_FFFF;

/// Number of probe cases built by `cases()`. Update together with the case list.
const CASE_COUNT: usize = 221;

/// Serialises tests that swap the process-wide panic hook.
static HOOK_LOCK: Mutex<()> = Mutex::new(());

type PanicHook = Box<dyn Fn(&std::panic::PanicHookInfo<'_>) + Sync + Send + 'static>;
/// A named case. It returns `false` when a body state is not finite after the run.
type Case = (String, Box<dyn FnOnce() -> bool>);

/// Hostile and edge values shared by every float parameter.
const VALUES: [(&str, f32); 7] = [
    ("NaN", NAN),
    ("inf", INF),
    ("-inf", -INF),
    ("neg", -1.0),
    ("zero", 0.0),
    ("huge", 1e30),
    ("tiny", 1e-30),
];

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
///
/// Slot 0 is a static floor, slot 1 a kinematic character with a box collider, slot 2 a dynamic
/// box one gap away from the character on +X, slots 3 and 4 two dynamic balls, slot 5 a fixed
/// body.
fn world() -> Option<Engine> {
    let mut e = Engine::new(16).ok()?;
    e.physics3d_init(0.0, -9.81, 0.0, 16);
    let _ = e.physics3d_add_body(0, 0.0, -0.5, 0.0, 0, 1.0, 0.0, 0.0);
    let _ = e.physics3d_add_box_collider(
        0, 20.0, 0.5, 20.0, 0.0, 0.0, 0.0, false, 0.5, 0.0, ALL, ALL, 1,
    );
    let _ = e.physics3d_add_body(1, 0.0, 0.6, 0.0, 2, 1.0, 0.0, 0.0);
    let _ = e.physics3d_add_box_collider(
        1, 0.5, 0.5, 0.5, 0.0, 0.0, 0.0, false, 0.5, 0.0, ALL, ALL, 2,
    );
    let _ = e.physics3d_add_body(2, 1.2, 0.6, 0.0, 1, 1.0, 0.0, 0.0);
    let _ = e.physics3d_add_box_collider(
        2, 0.5, 0.5, 0.5, 0.0, 0.0, 0.0, false, 0.5, 0.0, ALL, ALL, 3,
    );
    let _ = e.physics3d_add_body(3, 4.0, 3.0, 0.0, 1, 1.0, 0.0, 0.0);
    let _ = e.physics3d_add_sphere_collider(3, 0.5, 0.0, 0.0, 0.0, false, 0.5, 0.0, ALL, ALL, 4);
    let _ = e.physics3d_add_body(4, 5.0, 3.0, 0.0, 1, 1.0, 0.0, 0.0);
    let _ = e.physics3d_add_sphere_collider(4, 0.5, 0.0, 0.0, 0.0, false, 0.5, 0.0, ALL, ALL, 5);
    let _ = e.physics3d_add_body(5, 8.0, 3.0, 0.0, 0, 1.0, 0.0, 0.0);
    let _ = e.physics3d_step(0.016);
    Some(e)
}

/// True when every body state of slots 0 to 5 is finite.
fn states_finite(e: &mut Engine) -> bool {
    (0..=5).all(|slot| {
        e.physics3d_get_body_state(slot)
            .map_or(true, |s| s.iter().all(|v| v.is_finite()))
    })
}

/// Runs `f` on a fresh world, then steps three times, moves the character once and casts a ray.
fn on_world<R>(name: &str, f: impl FnOnce(&mut Engine) -> R + 'static) -> Case {
    let run = move || {
        let Some(mut e) = world() else { return true };
        let _ = f(&mut e);
        for _ in 0..3 {
            let _ = e.physics3d_step(0.016);
        }
        let _ = e.physics3d_cast_ray(0.0, 5.0, 0.0, 0.0, -1.0, 0.0, 100.0, ALL, ALL, true);
        states_finite(&mut e)
    };
    (name.to_string(), Box::new(run))
}

/// Registers a controller on slot 1 with sane values, steps once, then runs `f`.
fn with_cc<R>(name: &str, f: impl FnOnce(&mut Engine) -> R + 'static) -> Case {
    on_world(name, move |e| {
        let _ = e.physics3d_add_character_controller(1, 0.35, 45.0, 0.02, 0.2, true, true);
        let _ = e.physics3d_step(0.016);
        f(e)
    })
}

/// Registers a controller on slot 1 with `[step_height, slope_limit, skin_width, snap]`, then
/// moves it into the dynamic box. A refused registration leaves nothing to move.
fn add_and_move(e: &mut Engine, p: [f32; 4]) {
    let _ = e.physics3d_add_character_controller(1, p[0], p[1], p[2], p[3], true, true);
    let _ = e.physics3d_character_controller_move(1, 10.0, -1.0, 0.0, 0.016);
}

fn character_cases(v: &mut Vec<Case>) {
    for (n, x) in VALUES {
        v.push(on_world(&format!("cc step_height {n}"), move |e| {
            add_and_move(e, [x, 45.0, 0.02, 0.2])
        }));
        v.push(on_world(&format!("cc slope_limit {n}"), move |e| {
            add_and_move(e, [0.35, x, 0.02, 0.2])
        }));
        v.push(on_world(&format!("cc skin_width {n}"), move |e| {
            add_and_move(e, [0.35, 45.0, x, 0.2])
        }));
        v.push(on_world(&format!("cc snap_to_ground {n}"), move |e| {
            add_and_move(e, [0.35, 45.0, 0.02, x])
        }));
        v.push(on_world(&format!("cc all params {n}"), move |e| {
            add_and_move(e, [x, x, x, x])
        }));
        v.push(with_cc(&format!("cc move vx {n}"), move |e| {
            e.physics3d_character_controller_move(1, x, -1.0, 0.0, 0.016)
        }));
        v.push(with_cc(&format!("cc move vy {n}"), move |e| {
            e.physics3d_character_controller_move(1, 0.0, x, 0.0, 0.016)
        }));
        v.push(with_cc(&format!("cc move vz {n}"), move |e| {
            e.physics3d_character_controller_move(1, 0.0, -1.0, x, 0.016)
        }));
        v.push(with_cc(&format!("cc move dt {n}"), move |e| {
            e.physics3d_character_controller_move(1, 10.0, -1.0, 0.0, x)
        }));
        v.push(with_cc(&format!("cc push dynamic dt {n}"), move |e| {
            e.physics3d_character_controller_move(1, 30.0, 0.0, 0.0, x)
        }));
        v.push(with_cc(&format!("cc push dynamic vx {n}"), move |e| {
            e.physics3d_character_controller_move(1, x, 0.0, 0.0, 0.1)
        }));
    }
    v.push(with_cc("cc move twice", |e| {
        let _ = e.physics3d_character_controller_move(1, 10.0, -1.0, 0.0, 0.016);
        e.physics3d_character_controller_move(1, 10.0, -1.0, 0.0, 0.016)
    }));
    v.push(on_world("cc add twice then move", |e| {
        let _ = e.physics3d_add_character_controller(1, 0.35, 45.0, 0.02, 0.2, true, true);
        let _ = e.physics3d_add_character_controller(1, NAN, NAN, NAN, NAN, true, true);
        e.physics3d_character_controller_move(1, 1.0, -1.0, 0.0, 0.016)
    }));
    v.push(on_world("cc on dynamic body", |e| {
        let _ = e.physics3d_add_character_controller(2, 0.35, 45.0, 0.02, 0.2, true, true);
        e.physics3d_character_controller_move(2, 1.0, -1.0, 0.0, 0.016)
    }));
    v.push(on_world("cc on body without collider", |e| {
        let _ = e.physics3d_add_character_controller(5, 0.35, 45.0, 0.02, 0.2, true, true);
        e.physics3d_character_controller_move(5, 1.0, -1.0, 0.0, 0.016)
    }));
    v.push(on_world("cc move then remove body", |e| {
        let _ = e.physics3d_add_character_controller(1, 0.35, 45.0, 0.02, 0.2, true, true);
        let _ = e.physics3d_remove_body(1);
        e.physics3d_character_controller_move(1, 1.0, -1.0, 0.0, 0.016)
    }));
}

type Anchors = (&'static str, [f32; 6]);

fn anchors() -> [Anchors; 4] {
    [
        ("zero", [0.0; 6]),
        ("NaN", [NAN; 6]),
        ("inf", [INF, 0.0, 0.0, 0.0, -INF, 0.0]),
        ("huge", [1e30; 6]),
    ]
}

/// Pairs of slots: dynamic/dynamic, dynamic/fixed, fixed/fixed (a fixed body twice), and one
/// entity on both ends.
const PAIRS: [(&str, u32, u32); 5] = [
    ("dyn-dyn", 3, 4),
    ("dyn-fixed", 3, 5),
    ("fixed-fixed", 5, 5),
    ("same dyn", 3, 3),
    ("kinematic-dyn", 1, 3),
];

fn joint_cases(v: &mut Vec<Case>) {
    for (pn, a, b) in PAIRS {
        v.push(on_world(&format!("fixed {pn}"), move |e| {
            e.physics3d_add_fixed_joint(a, b, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0)
        }));
        v.push(on_world(&format!("ball {pn}"), move |e| {
            e.physics3d_add_ball_joint(a, b, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0)
        }));
        v.push(on_world(&format!("revolute {pn}"), move |e| {
            e.physics3d_add_revolute_joint(
                a, b, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, false, 0.0, 0.0,
            )
        }));
        v.push(on_world(&format!("prismatic {pn}"), move |e| {
            e.physics3d_add_prismatic_joint(
                a, b, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, false, 0.0, 0.0,
            )
        }));
        v.push(on_world(&format!("spring {pn}"), move |e| {
            e.physics3d_add_spring_joint(a, b, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 100.0, 1.0)
        }));
    }
    for (an, p) in anchors() {
        v.push(on_world(&format!("fixed anchors {an}"), move |e| {
            e.physics3d_add_fixed_joint(3, 4, p[0], p[1], p[2], p[3], p[4], p[5])
        }));
        v.push(on_world(&format!("ball anchors {an}"), move |e| {
            e.physics3d_add_ball_joint(3, 4, p[0], p[1], p[2], p[3], p[4], p[5])
        }));
        v.push(on_world(&format!("revolute anchors {an}"), move |e| {
            e.physics3d_add_revolute_joint(
                3, 4, p[0], p[1], p[2], p[3], p[4], p[5], 0.0, 1.0, 0.0, false, 0.0, 0.0,
            )
        }));
        v.push(on_world(&format!("prismatic anchors {an}"), move |e| {
            e.physics3d_add_prismatic_joint(
                3, 4, p[0], p[1], p[2], p[3], p[4], p[5], 1.0, 0.0, 0.0, false, 0.0, 0.0,
            )
        }));
        v.push(on_world(&format!("spring anchors {an}"), move |e| {
            e.physics3d_add_spring_joint(3, 4, p[0], p[1], p[2], p[3], p[4], p[5], 1.0, 100.0, 1.0)
        }));
    }
    let axes: [(&str, [f32; 3]); 4] = [
        ("zero", [0.0; 3]),
        ("NaN", [NAN, 0.0, 0.0]),
        ("inf", [INF, 0.0, 0.0]),
        ("tiny", [1e-30; 3]),
    ];
    for (an, x) in axes {
        v.push(on_world(&format!("revolute axis {an}"), move |e| {
            e.physics3d_add_revolute_joint(
                3, 4, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, x[0], x[1], x[2], false, 0.0, 0.0,
            )
        }));
        v.push(on_world(&format!("prismatic axis {an}"), move |e| {
            e.physics3d_add_prismatic_joint(
                3, 4, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, x[0], x[1], x[2], false, 0.0, 0.0,
            )
        }));
    }
    let limits: [(&str, f32, f32); 7] = [
        ("min>max", 1.0, -1.0),
        ("NaN", NAN, NAN),
        ("min NaN", NAN, 1.0),
        ("max inf", 0.0, INF),
        ("-inf..inf", -INF, INF),
        ("equal", 0.5, 0.5),
        ("huge", -1e30, 1e30),
    ];
    for (ln, lo, hi) in limits {
        v.push(on_world(&format!("revolute limits {ln}"), move |e| {
            e.physics3d_add_revolute_joint(
                3, 4, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, true, lo, hi,
            )
        }));
        v.push(on_world(&format!("prismatic limits {ln}"), move |e| {
            e.physics3d_add_prismatic_joint(
                3, 4, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, true, lo, hi,
            )
        }));
    }
    for (n, x) in VALUES {
        v.push(on_world(&format!("spring rest_length {n}"), move |e| {
            e.physics3d_add_spring_joint(3, 4, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, x, 100.0, 1.0)
        }));
        v.push(on_world(&format!("spring stiffness {n}"), move |e| {
            e.physics3d_add_spring_joint(3, 4, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, x, 1.0)
        }));
        v.push(on_world(&format!("spring damping {n}"), move |e| {
            e.physics3d_add_spring_joint(3, 4, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 100.0, x)
        }));
        v.push(on_world(&format!("motor velocity {n}"), move |e| {
            let id = e.physics3d_add_revolute_joint(
                3, 4, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, false, 0.0, 0.0,
            );
            let _ = id.map(|id| e.physics3d_set_joint_motor_velocity(id, x, x));
        }));
        v.push(on_world(&format!("motor position {n}"), move |e| {
            let id = e.physics3d_add_prismatic_joint(
                3, 4, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, false, 0.0, 0.0,
            );
            let _ = id.map(|id| e.physics3d_set_joint_motor_position(id, x, x, x));
        }));
    }
    for (n, x) in VALUES {
        v.push(on_world(&format!("motor velocity only {n}"), move |e| {
            let id = e.physics3d_add_revolute_joint(
                3, 4, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, false, 0.0, 0.0,
            );
            let _ = id.map(|id| e.physics3d_set_joint_motor_velocity(id, x, 1000.0));
        }));
        v.push(on_world(&format!("motor max_force only {n}"), move |e| {
            let id = e.physics3d_add_revolute_joint(
                3, 4, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, false, 0.0, 0.0,
            );
            let _ = id.map(|id| e.physics3d_set_joint_motor_velocity(id, 1.0, x));
        }));
        v.push(on_world(&format!("motor target only {n}"), move |e| {
            let id = e.physics3d_add_prismatic_joint(
                3, 4, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, false, 0.0, 0.0,
            );
            let _ = id.map(|id| e.physics3d_set_joint_motor_position(id, x, 100.0, 1.0));
        }));
        v.push(on_world(&format!("motor stiffness only {n}"), move |e| {
            let id = e.physics3d_add_prismatic_joint(
                3, 4, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, false, 0.0, 0.0,
            );
            let _ = id.map(|id| e.physics3d_set_joint_motor_position(id, 0.5, x, 1.0));
        }));
        v.push(on_world(&format!("motor damping only {n}"), move |e| {
            let id = e.physics3d_add_prismatic_joint(
                3, 4, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, false, 0.0, 0.0,
            );
            let _ = id.map(|id| e.physics3d_set_joint_motor_position(id, 0.5, 100.0, x));
        }));
    }
    v.push(on_world("joint enabled toggle and remove", |e| {
        let id = e.physics3d_add_fixed_joint(3, 4, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
        let _ = id.map(|id| {
            let _ = e.physics3d_set_joint_enabled(id, false);
            let _ = e.physics3d_set_joint_enabled(id, true);
            e.physics3d_remove_joint(id)
        });
    }));
    v.push(on_world("same-entity joint then remove body", |e| {
        let _ = e.physics3d_add_fixed_joint(3, 3, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
        let _ = e.physics3d_step(0.016);
        let _ = e.physics3d_remove_body(3);
    }));
}

fn cases() -> Vec<Case> {
    let mut v: Vec<Case> = Vec::new();
    character_cases(&mut v);
    joint_cases(&mut v);
    v
}

/// Runs `f` under `catch_unwind` with the panic hook silenced; `None` when it panicked.
fn run_guarded<R>(f: impl FnOnce() -> R) -> Option<R> {
    let _lock = HOOK_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let _guard = HookGuard::silence();
    catch_unwind(AssertUnwindSafe(f)).ok()
}

/// Runs `f` with the panic hook silenced; true when it panicked.
fn panicked(f: impl FnOnce()) -> bool {
    run_guarded(f).is_none()
}

/// Builds a heightfield straight through rapier. The export refuses a grid below 2x2, so the
/// control reaches parry's own assert without it.
fn heightfield(rows: usize, cols: usize) {
    use rapier3d::math::Vector;
    use rapier3d::parry::utils::Array2;
    let heights = Array2::from_fn(rows, cols, |_, _| 0.0f32);
    let _ = rapier3d::geometry::ColliderBuilder::heightfield(heights, Vector::new(1.0, 1.0, 1.0));
}

#[test]
fn world_fixture_builds() {
    assert_eq!(world().map(|_| "built"), Some("built"));
}

#[test]
fn hostile_character_and_joint_inputs_never_panic() {
    let failed: Vec<String> = cases()
        .into_iter()
        .filter_map(|(name, f)| run_guarded(f).is_none().then_some(name))
        .collect();
    assert_eq!(failed, Vec::<String>::new(), "cases that panicked");
}

/// Joint cases whose body states must stay finite. Two groups are left out on purpose, both
/// measured to give a non-finite state: character controller moves with an infinite velocity
/// (outside the joint checks), and the `huge` value of 1e30, which is finite and needs a
/// magnitude bound that is not decided here.
fn state_checked(name: &str) -> bool {
    !name.starts_with("cc ") && !name.ends_with(" huge")
}

#[test]
fn hostile_joint_inputs_never_make_a_body_state_non_finite() {
    let failed: Vec<String> = cases()
        .into_iter()
        .filter(|(name, _)| state_checked(name))
        .filter_map(|(name, f)| (run_guarded(f) == Some(false)).then_some(name))
        .collect();
    assert_eq!(
        failed,
        Vec::<String>::new(),
        "cases with a non-finite body state"
    );
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
