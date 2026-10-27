//! Hostile floats must not panic the four physics2d exports.
//!
//! Each case runs in its own `catch_unwind` on a fresh engine, same shape as
//! `physics3d_float_probe.rs`. A one-sample heightfield built straight through
//! Rapier panics in parry (`heightfield2.rs:40`) and proves the probe sees panics.
#![cfg(feature = "physics2d")]

use gwen_core::bindings::Engine;
use gwen_core::physics2d::Physics2DError;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::Mutex;

const ALL: u32 = 0xFFFF_FFFF;
const MAX_WORLD_EXTENT: f32 = 1.0e7;
const DT: f32 = 1.0 / 60.0;

/// Number of probe cases built by `cases()`. Update together with the case list.
const CASE_COUNT: usize = 98;

/// Serialises tests that swap the process-wide panic hook.
static HOOK_LOCK: Mutex<()> = Mutex::new(());

type Case = (String, Box<dyn FnOnce() -> Result<(), Physics2DError>>);
type PanicHook = Box<dyn Fn(&std::panic::PanicHookInfo<'_>) + Sync + Send + 'static>;

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

fn hostile_values() -> [(&'static str, f32); 8] {
    [
        ("NaN", f32::NAN),
        ("+inf", f32::INFINITY),
        ("-inf", f32::NEG_INFINITY),
        ("-0", -0.0),
        ("1e-38", 1e-38),
        ("max", MAX_WORLD_EXTENT),
        ("max+ulp", MAX_WORLD_EXTENT.next_up()),
        ("1e20", 1e20),
    ]
}

fn fresh(gravity_y: f32) -> Result<Engine, Physics2DError> {
    let mut engine = Engine::new(16).map_err(Physics2DError::Core)?;
    engine.physics_init(0.0, gravity_y, 16);
    Ok(engine)
}

fn add_box(
    engine: &mut Engine,
    slot: u32,
    x: f32,
    y: f32,
    kind: u8,
    half: (f32, f32),
    restitution: f32,
) -> Result<(), Physics2DError> {
    let handle = engine
        .physics_add_rigid_body(slot, x, y, kind, 1.0, 1.0, 0.0, 0.0, 0.0, 0.0, None, None)?;
    engine.physics_add_box_collider(
        handle,
        half.0,
        half.1,
        restitution,
        0.0,
        0,
        1.0,
        ALL,
        ALL,
        None,
        None,
        None,
        None,
    )
}

fn with_body() -> Result<Engine, Physics2DError> {
    let mut engine = fresh(0.0)?;
    add_box(&mut engine, 0, 0.0, 0.0, 1, (0.5, 0.5), 0.0)?;
    Ok(engine)
}

fn case(name: String, run: impl FnOnce() -> Result<(), Physics2DError> + 'static) -> Case {
    (name, Box::new(run))
}

fn cases() -> Vec<Case> {
    let mut out = Vec::new();
    for (label, value) in hostile_values() {
        out.push(case(format!("step delta={label}"), move || {
            let mut engine = with_body()?;
            let _ = engine.physics_step(value);
            Ok(())
        }));
        out.push(case(format!("point x={label}"), move || {
            let engine = with_body()?;
            let _ = engine.physics_point_query(value, 0.0, ALL, ALL);
            Ok(())
        }));
        out.push(case(format!("point y={label}"), move || {
            let engine = with_body()?;
            let _ = engine.physics_point_query(0.0, value, ALL, ALL);
            Ok(())
        }));
        out.push(case(format!("radius x={label}"), move || {
            let engine = with_body()?;
            let _ = engine.physics_query_radius(value, 0.0, 1.0, ALL, ALL);
            Ok(())
        }));
        out.push(case(format!("radius y={label}"), move || {
            let engine = with_body()?;
            let _ = engine.physics_query_radius(0.0, value, 1.0, ALL, ALL);
            Ok(())
        }));
        out.push(case(format!("radius radius={label}"), move || {
            let engine = with_body()?;
            let _ = engine.physics_query_radius(0.0, 0.0, value, ALL, ALL);
            Ok(())
        }));
        out.push(case(format!("rect x={label}"), move || {
            let engine = with_body()?;
            let _ = engine.physics_query_rect(value, 0.0, 1.0, 1.0, ALL, ALL);
            Ok(())
        }));
        out.push(case(format!("rect y={label}"), move || {
            let engine = with_body()?;
            let _ = engine.physics_query_rect(0.0, value, 1.0, 1.0, ALL, ALL);
            Ok(())
        }));
        out.push(case(format!("rect hw={label}"), move || {
            let engine = with_body()?;
            let _ = engine.physics_query_rect(0.0, 0.0, value, 1.0, ALL, ALL);
            Ok(())
        }));
        out.push(case(format!("rect hh={label}"), move || {
            let engine = with_body()?;
            let _ = engine.physics_query_rect(0.0, 0.0, 1.0, value, ALL, ALL);
            Ok(())
        }));
    }

    out.push(case("restitution 1e9 then step x120".to_string(), || {
        let mut engine = fresh(-9.81)?;
        add_box(&mut engine, 0, 0.0, 0.0, 0, (20.0, 0.5), 1.0e9)?;
        add_box(&mut engine, 1, 0.0, 2.0, 1, (0.5, 0.5), 1.0e9)?;
        for _ in 0..120 {
            let _ = engine.physics_step(DT);
        }
        Ok(())
    }));
    out.push(case("velocity 1e12 then step x120".to_string(), || {
        let mut engine = fresh(0.0)?;
        add_box(&mut engine, 0, 0.0, 1.0, 1, (0.5, 0.5), 0.0)?;
        engine.physics_set_linear_velocity(0, 0.0, 1.0e12)?;
        for _ in 0..120 {
            let _ = engine.physics_step(DT);
        }
        Ok(())
    }));
    out.push(case("impulse 1e12 then step x120".to_string(), || {
        let mut engine = fresh(0.0)?;
        add_box(&mut engine, 0, 0.0, 1.0, 1, (0.5, 0.5), 0.0)?;
        engine.physics_apply_impulse(0, 0.0, 1.0e12)?;
        for _ in 0..120 {
            let _ = engine.physics_step(DT);
        }
        Ok(())
    }));

    for (label, x) in [
        ("1e4", 1.0e4_f32),
        ("1e5", 1.0e5),
        ("1e6", 1.0e6),
        ("1e7", MAX_WORLD_EXTENT),
        ("1e7+ulp", MAX_WORLD_EXTENT.next_up()),
        ("1e8", 1.0e8),
        ("4.9e8", 4.9e8),
        ("8.4e8", 8.4e8),
        ("1.2e9", 1.2e9),
    ] {
        out.push(case(format!("position x={label}"), move || {
            let mut engine = fresh(-9.81)?;
            add_box(&mut engine, 0, 0.0, 0.0, 0, (50.0, 0.5), 0.0)?;
            add_box(&mut engine, 1, x, 1.0, 1, (0.5, 0.5), 0.0)?;
            let _ = engine.physics_step(DT);
            Ok(())
        }));
    }

    for (label, x) in [("4.9e8", 4.9e8_f32), ("8.4e8", 8.4e8), ("1.2e9", 1.2e9)] {
        out.push(case(format!("fixed position x={label}"), move || {
            let mut engine = fresh(0.0)?;
            add_box(&mut engine, 0, x, 0.0, 0, (0.5, 0.5), 0.0)?;
            let _ = engine.physics_step(DT);
            Ok(())
        }));
        out.push(case(format!("kinematic position x={label}"), move || {
            let mut engine = fresh(0.0)?;
            add_box(&mut engine, 0, x, 0.0, 2, (0.5, 0.5), 0.0)?;
            engine.physics_set_kinematic_position(0, x, 0.0, 0.0)?;
            let _ = engine.physics_step(DT);
            Ok(())
        }));
    }
    out
}

/// A panic, or a setup `Err`, counts as a failed case. An export `Err` does not:
/// the closures discard it.
fn failed(f: impl FnOnce() -> Result<(), Physics2DError>) -> bool {
    let _lock = HOOK_LOCK
        .lock()
        .unwrap_or_else(|poison| poison.into_inner());
    let _guard = HookGuard::silence();
    !matches!(catch_unwind(AssertUnwindSafe(f)), Ok(Ok(())))
}

/// One height. parry asserts `heights.len() > 1` before it builds the shape.
fn one_sample_heightfield() -> Result<(), Physics2DError> {
    use rapier2d::math::Vector;
    // parry2d 0.31.1 `shape/heightfield2.rs:40` asserts `heights.len() > 1`.
    let _ = rapier2d::geometry::ColliderBuilder::heightfield(vec![0.0], Vector::new(1.0, 1.0));
    Ok(())
}

#[test]
fn hostile_floats_never_panic() {
    let failed_names: Vec<String> = cases()
        .into_iter()
        .filter_map(|(name, run)| failed(run).then_some(name))
        .collect();
    assert_eq!(failed_names, Vec::<String>::new(), "cases that panicked");
}

#[test]
fn control_rapier_panics_on_one_sample_heightfield() {
    let outcome = if failed(one_sample_heightfield) {
        "panicked"
    } else {
        "returned"
    };
    assert_eq!(
        outcome, "panicked",
        "one-sample heightfield did not panic: probe cannot detect"
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
