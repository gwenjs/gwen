//! Native probe (E4): hostile floats and shapes forwarded through the physics3d collider, mesh and
//! bulk exports must never panic. Each case runs in its own `catch_unwind` on a fresh engine,
//! then steps twice and runs a ray cast and a point projection so a poisoned collider is reached.
//! The export results are ignored on purpose: a typed refusal and an accepted value both count as
//! "did not panic". Three controls are known to panic through the raw parry and nalgebra paths and
//! prove the probe can detect a panic.
#![cfg(feature = "physics3d")]

use gwen_core::bindings::Engine;
use gwen_core::physics3d::world::MAX_COLLIDER_MAGNITUDE;
use gwen_core::physics3d::RAPIER_VERSION;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::Mutex;

const NAN: f32 = f32::NAN;
const INF: f32 = f32::INFINITY;
const ALL: u32 = 0xFFFF_FFFF;

/// Number of probe cases built by `cases()`. Update together with the case list.
const CASE_COUNT: usize = 315;

/// Hostile values tried at every float position.
const VALUES: [(&str, f32); 7] = [
    ("NaN", NAN),
    ("inf", INF),
    ("-inf", -INF),
    ("neg", -1.0),
    ("zero", 0.0),
    ("huge", 1e30),
    ("tiny", 1e-30),
];

/// Corners of a valid tetrahedron.
const TETRA: [f32; 12] = [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0];
/// Vertices of a valid two-triangle quad.
const QUAD: [f32; 12] = [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 1.0, 1.0, 0.0];
const QUAD_IDX: [u32; 6] = [0, 1, 2, 1, 3, 2];

/// Serialises tests that swap the process-wide panic hook.
static HOOK_LOCK: Mutex<()> = Mutex::new(());

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

/// Standard world: a fixed ground box (slot 0), a dynamic box (slot 1), an empty dynamic body
/// (slot 3) and an empty fixed body (slot 4) that the cases attach colliders to.
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
    let _ = e.physics3d_add_body(3, 0.0, 3.0, 0.0, 1, 1.0, 0.0, 0.0);
    let _ = e.physics3d_add_body(4, 5.0, 0.0, 0.0, 0, 1.0, 0.0, 0.0);
    let _ = e.physics3d_step(0.016);
    Some(e)
}

/// Runs `f` on a fresh world, then steps twice, casts a ray and projects a point.
fn on_world(name: String, f: impl FnOnce(&mut Engine) + 'static) -> Case {
    let run = move || {
        let Some(mut e) = world() else { return };
        f(&mut e);
        let _ = e.physics3d_step(0.016);
        let _ = e.physics3d_step(0.016);
        let _ = e.physics3d_cast_ray(0.0, 5.0, 0.0, 0.0, -1.0, 0.0, 100.0, ALL, ALL, true);
        let _ = e.physics3d_project_point(0.0, 5.0, 0.0, ALL, ALL, true);
    };
    (name, Box::new(run))
}

/// A compound part: `[type, p0, p1, p2, 0, ox, oy, oz, sensor, friction, restitution, id]`.
fn part(shape: f32, p: [f32; 3], offset: [f32; 3], friction: f32, restitution: f32) -> [f32; 12] {
    [
        shape,
        p[0],
        p[1],
        p[2],
        0.0,
        offset[0],
        offset[1],
        offset[2],
        0.0,
        friction,
        restitution,
        1.0,
    ]
}

/// GBVH header for `version` plus `payload`.
fn bvh_at_version(version: (u16, u16), payload: &[u8]) -> Vec<u8> {
    let mut out = b"GBVH".to_vec();
    out.extend_from_slice(&version.0.to_le_bytes());
    out.extend_from_slice(&version.1.to_le_bytes());
    out.extend_from_slice(payload);
    out
}

fn cases() -> Vec<Case> {
    let mut v: Vec<Case> = Vec::new();
    for (n, x) in VALUES {
        // box: each half extent alone, all three, offset, material.
        for (label, h) in [
            ("hx", [x, 0.5, 0.5]),
            ("hy", [0.5, x, 0.5]),
            ("hz", [0.5, 0.5, x]),
            ("all", [x, x, x]),
        ] {
            v.push(on_world(format!("box {label} {n}"), move |e| {
                let _ = e.physics3d_add_box_collider(
                    3, h[0], h[1], h[2], 0.0, 0.0, 0.0, false, 0.5, 0.0, ALL, ALL, 5,
                );
            }));
        }
        v.push(on_world(format!("box offset {n}"), move |e| {
            let _ = e.physics3d_add_box_collider(
                3, 0.5, 0.5, 0.5, x, 0.0, x, false, 0.5, 0.0, ALL, ALL, 5,
            );
        }));
        v.push(on_world(format!("box material {n}"), move |e| {
            let _ = e.physics3d_add_box_collider(
                3, 0.5, 0.5, 0.5, 0.0, 0.0, 0.0, false, x, x, ALL, ALL, 5,
            );
        }));
        // sphere
        v.push(on_world(format!("sphere radius {n}"), move |e| {
            let _ =
                e.physics3d_add_sphere_collider(3, x, 0.0, 0.0, 0.0, false, 0.5, 0.0, ALL, ALL, 5);
        }));
        v.push(on_world(format!("sphere offset {n}"), move |e| {
            let _ = e.physics3d_add_sphere_collider(3, 0.5, x, x, x, false, 0.5, 0.0, ALL, ALL, 5);
        }));
        v.push(on_world(format!("sphere material {n}"), move |e| {
            let _ =
                e.physics3d_add_sphere_collider(3, 0.5, 0.0, 0.0, 0.0, false, x, x, ALL, ALL, 5);
        }));
        // capsule
        for (label, r, hh) in [("radius", x, 0.5), ("half_height", 0.5, x), ("both", x, x)] {
            v.push(on_world(format!("capsule {label} {n}"), move |e| {
                let _ = e.physics3d_add_capsule_collider(
                    3, r, hh, 0.0, 0.0, 0.0, false, 0.5, 0.0, ALL, ALL, 5,
                );
            }));
        }
        v.push(on_world(format!("capsule offset+material {n}"), move |e| {
            let _ =
                e.physics3d_add_capsule_collider(3, 0.5, 0.5, x, x, x, false, x, x, ALL, ALL, 5);
        }));
        // convex: one coordinate, density, offset, material.
        v.push(on_world(format!("convex coord {n}"), move |e| {
            let mut pts = TETRA;
            pts[4] = x;
            let _ = e.physics3d_add_convex_collider(
                3, &pts, 0.0, 0.0, 0.0, false, 0.5, 0.0, 1.0, ALL, ALL, 5,
            );
        }));
        v.push(on_world(format!("convex all coords {n}"), move |e| {
            let pts = [x; 12];
            let _ = e.physics3d_add_convex_collider(
                3, &pts, 0.0, 0.0, 0.0, false, 0.5, 0.0, 1.0, ALL, ALL, 5,
            );
        }));
        v.push(on_world(format!("convex density {n}"), move |e| {
            let _ = e.physics3d_add_convex_collider(
                3, &TETRA, 0.0, 0.0, 0.0, false, 0.5, 0.0, x, ALL, ALL, 5,
            );
        }));
        v.push(on_world(format!("convex offset+material {n}"), move |e| {
            let _ =
                e.physics3d_add_convex_collider(3, &TETRA, x, x, x, false, x, x, 1.0, ALL, ALL, 5);
        }));
        // heightfield: heights, scale, material.
        v.push(on_world(format!("heightfield height {n}"), move |e| {
            let mut h = [0.0f32; 9];
            h[4] = x;
            let _ = e.physics3d_add_heightfield_collider(
                4, &h, 3, 3, 1.0, 1.0, 1.0, 0.5, 0.0, ALL, ALL, 5,
            );
        }));
        for (label, s) in [
            ("scale_x", [x, 1.0, 1.0]),
            ("scale_y", [1.0, x, 1.0]),
            ("scale_z", [1.0, 1.0, x]),
            ("scale_all", [x, x, x]),
        ] {
            v.push(on_world(format!("heightfield {label} {n}"), move |e| {
                let h = [0.0f32; 9];
                let _ = e.physics3d_add_heightfield_collider(
                    4, &h, 3, 3, s[0], s[1], s[2], 0.5, 0.0, ALL, ALL, 5,
                );
            }));
        }
        v.push(on_world(format!("heightfield material {n}"), move |e| {
            let h = [0.0f32; 9];
            let _ =
                e.physics3d_add_heightfield_collider(4, &h, 3, 3, 1.0, 1.0, 1.0, x, x, ALL, ALL, 5);
        }));
        v.push(on_world(
            format!("heightfield update height {n}"),
            move |e| {
                let h = [0.0f32; 9];
                let _ = e.physics3d_add_heightfield_collider(
                    4, &h, 3, 3, 1.0, 1.0, 1.0, 0.5, 0.0, ALL, ALL, 5,
                );
                let mut h2 = [0.0f32; 9];
                h2[4] = x;
                let _ = e.physics3d_update_heightfield_collider(
                    4, 5, &h2, 3, 3, x, 1.0, x, 0.5, 0.0, ALL, ALL,
                );
            },
        ));
        // mesh: one vertex coordinate, offset, material, rebuild.
        v.push(on_world(format!("mesh coord {n}"), move |e| {
            let mut vs = QUAD;
            vs[4] = x;
            let _ = e.physics3d_add_mesh_collider(
                4, &vs, &QUAD_IDX, 0.0, 0.0, 0.0, false, 0.5, 0.0, ALL, ALL, 5,
            );
        }));
        v.push(on_world(format!("mesh offset+material {n}"), move |e| {
            let _ = e.physics3d_add_mesh_collider(
                4, &QUAD, &QUAD_IDX, x, x, x, false, x, x, ALL, ALL, 5,
            );
        }));
        v.push(on_world(format!("mesh rebuild coord {n}"), move |e| {
            let _ = e.physics3d_add_mesh_collider(
                4, &QUAD, &QUAD_IDX, 0.0, 0.0, 0.0, false, 0.5, 0.0, ALL, ALL, 5,
            );
            let mut vs = QUAD;
            vs[3] = x;
            vs[10] = x;
            let _ = e.physics3d_rebuild_mesh_collider(
                4, 5, &vs, &QUAD_IDX, 0.0, 0.0, 0.0, false, 0.5, 0.0, ALL, ALL,
            );
        }));
        // compound: one of each shape type, hostile parameters.
        v.push(on_world(format!("compound params {n}"), move |e| {
            let mut data = Vec::new();
            data.extend_from_slice(&part(0.0, [x, 0.5, 0.5], [0.0; 3], 0.5, 0.0));
            data.extend_from_slice(&part(1.0, [x, 0.0, 0.0], [0.0; 3], 0.5, 0.0));
            data.extend_from_slice(&part(2.0, [x, x, 0.0], [0.0; 3], 0.5, 0.0));
            let _ = e.physics3d_add_compound_collider(3, &data, ALL, ALL);
        }));
        v.push(on_world(
            format!("compound offset+material {n}"),
            move |e| {
                let data = part(0.0, [0.5; 3], [x, x, x], x, x);
                let _ = e.physics3d_add_compound_collider(3, &data, ALL, ALL);
            },
        ));
        v.push(on_world(format!("compound shape type {n}"), move |e| {
            let data = part(x, [0.5; 3], [0.0; 3], 0.5, 0.0);
            let _ = e.physics3d_add_compound_collider(3, &data, ALL, ALL);
        }));
        // bulk spawn: positions, extents, material.
        v.push(on_world(format!("bulk_spawn position {n}"), move |e| {
            let _ = e.physics3d_bulk_spawn_static_boxes(
                &[7, 8],
                &[x, 0.0, x, 1.0, 1.0, 1.0],
                &[0.5, 0.5, 0.5],
                0.5,
                0.0,
                ALL,
                ALL,
            );
        }));
        v.push(on_world(format!("bulk_spawn extents {n}"), move |e| {
            let _ = e.physics3d_bulk_spawn_static_boxes(
                &[7, 8],
                &[0.0; 6],
                &[x, 0.5, 0.5, 0.5, x, 0.5],
                0.5,
                0.0,
                ALL,
                ALL,
            );
        }));
        v.push(on_world(
            format!("bulk_spawn uniform extents {n}"),
            move |e| {
                let _ = e.physics3d_bulk_spawn_static_boxes(
                    &[7, 8],
                    &[0.0; 6],
                    &[x, x, x],
                    x,
                    x,
                    ALL,
                    ALL,
                );
            },
        ));
        // bulk kinematic steps on the dynamic body and a kinematic body.
        v.push(on_world(format!("bulk_step velocity {n}"), move |e| {
            let _ = e.physics3d_set_body_kind(1, 2);
            let _ = e.physics3d_bulk_step_kinematics(&[1], &[x], &[x], &[x], 0.016);
        }));
        v.push(on_world(format!("bulk_step dt {n}"), move |e| {
            let _ = e.physics3d_set_body_kind(1, 2);
            let _ = e.physics3d_bulk_step_kinematics(&[1], &[1.0], &[1.0], &[1.0], x);
        }));
        v.push(on_world(format!("bulk_rot velocity {n}"), move |e| {
            let _ = e.physics3d_set_body_kind(1, 2);
            let _ = e.physics3d_bulk_step_kinematic_rotations(&[1], &[x], &[x], &[x], 0.016);
        }));
        v.push(on_world(format!("bulk_rot dt {n}"), move |e| {
            let _ = e.physics3d_set_body_kind(1, 2);
            let _ = e.physics3d_bulk_step_kinematic_rotations(&[1], &[1.0], &[1.0], &[1.0], x);
        }));
    }
    // Both ends of the accepted range: the magnitude bound itself must not panic.
    for (n, x) in [
        ("+max", MAX_COLLIDER_MAGNITUDE),
        ("-max", -MAX_COLLIDER_MAGNITUDE),
    ] {
        v.push(on_world(format!("bound box {n}"), move |e| {
            let _ = e.physics3d_add_box_collider(
                3,
                x.abs(),
                x.abs(),
                x.abs(),
                x,
                x,
                x,
                false,
                0.5,
                0.0,
                ALL,
                ALL,
                5,
            );
        }));
        v.push(on_world(format!("bound sphere {n}"), move |e| {
            let _ =
                e.physics3d_add_sphere_collider(3, x.abs(), x, x, x, false, 0.5, 0.0, ALL, ALL, 5);
        }));
        v.push(on_world(format!("bound capsule {n}"), move |e| {
            let _ = e.physics3d_add_capsule_collider(
                3,
                x.abs(),
                x.abs(),
                x,
                x,
                x,
                false,
                0.5,
                0.0,
                ALL,
                ALL,
                5,
            );
        }));
        v.push(on_world(format!("bound mesh {n}"), move |e| {
            let vs = QUAD.map(|c| c * x);
            let _ = e.physics3d_add_mesh_collider(
                4, &vs, &QUAD_IDX, x, x, x, false, 0.5, 0.0, ALL, ALL, 5,
            );
        }));
        v.push(on_world(format!("bound convex {n}"), move |e| {
            let pts = TETRA.map(|c| c * x);
            let _ = e
                .physics3d_add_convex_collider(3, &pts, x, x, x, false, 0.5, 0.0, 1.0, ALL, ALL, 5);
        }));
        v.push(on_world(format!("bound heightfield {n}"), move |e| {
            let h = [x; 9];
            let _ = e.physics3d_add_heightfield_collider(
                4,
                &h,
                3,
                3,
                x.abs(),
                x.abs(),
                x.abs(),
                0.5,
                0.0,
                ALL,
                ALL,
                5,
            );
        }));
        v.push(on_world(format!("bound compound {n}"), move |e| {
            let mut data = Vec::new();
            data.extend_from_slice(&part(0.0, [x.abs(); 3], [x; 3], 0.5, 0.0));
            data.extend_from_slice(&part(1.0, [x.abs(), 0.0, 0.0], [x; 3], 0.5, 0.0));
            data.extend_from_slice(&part(2.0, [x.abs(), x.abs(), 0.0], [x; 3], 0.5, 0.0));
            let _ = e.physics3d_add_compound_collider(3, &data, ALL, ALL);
        }));
        v.push(on_world(format!("bound bulk_spawn {n}"), move |e| {
            let _ = e.physics3d_bulk_spawn_static_boxes(
                &[7],
                &[x, x, x],
                &[x.abs(), x.abs(), x.abs()],
                0.5,
                0.0,
                ALL,
                ALL,
            );
        }));
    }
    // Degenerate convex clouds.
    let clouds: [(&str, Vec<f32>); 6] = [
        (
            "collinear",
            vec![0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 2.0, 0.0, 0.0, 3.0, 0.0, 0.0],
        ),
        (
            "coplanar",
            vec![0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 1.0, 1.0, 0.0],
        ),
        ("duplicates", vec![1.0; 12]),
        ("two points", vec![0.0, 0.0, 0.0, 1.0, 0.0, 0.0]),
        (
            "ragged",
            vec![0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0],
        ),
        ("empty", Vec::new()),
    ];
    for (n, pts) in clouds {
        v.push(on_world(format!("convex {n}"), move |e| {
            let _ = e.physics3d_add_convex_collider(
                3, &pts, 0.0, 0.0, 0.0, false, 0.5, 0.0, 1.0, ALL, ALL, 5,
            );
        }));
    }
    // Shape-size boundaries.
    for (rows, cols, len) in [
        (0u32, 0u32, 0usize),
        (1, 1, 1),
        (2, 1, 2),
        (1, 2, 2),
        (2, 2, 4),
        (2, 2, 3),
        (2, 2, 5),
        (3, 0, 0),
        (65_536, 65_536, 4),
        (u32::MAX, 2, 4),
    ] {
        v.push(on_world(
            format!("heightfield {rows}x{cols} len {len}"),
            move |e| {
                let h = vec![0.0f32; len];
                let _ = e.physics3d_add_heightfield_collider(
                    4, &h, rows, cols, 1.0, 1.0, 1.0, 0.5, 0.0, ALL, ALL, 5,
                );
            },
        ));
    }
    let meshes: [(&str, Vec<f32>, Vec<u32>); 8] = [
        ("index past end", QUAD.to_vec(), vec![0, 1, 9]),
        ("index u32 max", QUAD.to_vec(), vec![0, 1, u32::MAX]),
        ("index at count", QUAD.to_vec(), vec![0, 1, 4]),
        ("ragged vertices", QUAD[..11].to_vec(), QUAD_IDX.to_vec()),
        ("ragged indices", QUAD.to_vec(), vec![0, 1, 2, 3]),
        ("empty indices", QUAD.to_vec(), Vec::new()),
        ("empty vertices", Vec::new(), QUAD_IDX.to_vec()),
        ("degenerate triangle", QUAD.to_vec(), vec![0, 0, 0]),
    ];
    for (n, vs, idx) in meshes {
        v.push(on_world(format!("mesh {n}"), move |e| {
            let _ = e.physics3d_add_mesh_collider(
                4, &vs, &idx, 0.0, 0.0, 0.0, false, 0.5, 0.0, ALL, ALL, 5,
            );
        }));
    }
    // Compound buffers.
    let compounds: [(&str, Vec<f32>); 4] = [
        ("empty", Vec::new()),
        ("ragged", vec![0.0; 13]),
        (
            "unknown type",
            part(77.0, [0.5; 3], [0.0; 3], 0.5, 0.0).to_vec(),
        ),
        (
            "negative type",
            part(-1.0, [0.5; 3], [0.0; 3], 0.5, 0.0).to_vec(),
        ),
    ];
    for (n, data) in compounds {
        v.push(on_world(format!("compound {n}"), move |e| {
            let _ = e.physics3d_add_compound_collider(3, &data, ALL, ALL);
        }));
    }
    // BVH buffers.
    let bvh: [(&str, Vec<u8>); 6] = [
        ("empty", Vec::new()),
        ("short", b"GBVH".to_vec()),
        ("bad magic", b"XXXXxxxxpayload".to_vec()),
        ("header only", bvh_at_version(RAPIER_VERSION, &[])),
        (
            "garbage payload",
            bvh_at_version(RAPIER_VERSION, &[0xFF; 64]),
        ),
        (
            "version mismatch",
            bvh_at_version((RAPIER_VERSION.0, RAPIER_VERSION.1.wrapping_add(1)), &[]),
        ),
    ];
    for (n, bytes) in bvh {
        v.push(on_world(format!("bvh {n}"), move |e| {
            let _ = e.physics3d_load_bvh_collider(
                4, &bytes, 0.0, 0.0, 0.0, false, 0.5, 0.0, ALL, ALL, 5,
            );
        }));
    }
    // Registration and removal boundaries.
    v.push(on_world("remove unknown collider".to_string(), |e| {
        let _ = e.physics3d_remove_collider(4, 99);
    }));
    v.push(on_world("remove collider twice".to_string(), |e| {
        let _ = e.physics3d_remove_collider(0, 1);
        let _ = e.physics3d_remove_collider(0, 1);
    }));
    v.push(on_world("collider on missing body".to_string(), |e| {
        let _ = e.physics3d_add_box_collider(
            99, 0.5, 0.5, 0.5, 0.0, 0.0, 0.0, false, 0.5, 0.0, ALL, ALL, 5,
        );
    }));
    v.push(on_world("bulk_spawn registered slot".to_string(), |e| {
        let _ = e.physics3d_bulk_spawn_static_boxes(
            &[0, 1],
            &[0.0; 6],
            &[0.5, 0.5, 0.5],
            0.5,
            0.0,
            ALL,
            ALL,
        );
    }));
    v.push(on_world("bulk_spawn duplicate slots".to_string(), |e| {
        let _ = e.physics3d_bulk_spawn_static_boxes(
            &[7, 7],
            &[0.0; 6],
            &[0.5, 0.5, 0.5],
            0.5,
            0.0,
            ALL,
            ALL,
        );
    }));
    v.push(on_world("bulk_step mismatch".to_string(), |e| {
        let _ = e.physics3d_bulk_step_kinematics(&[1, 3], &[1.0], &[1.0, 1.0], &[], 0.016);
        let _ = e.physics3d_bulk_step_kinematic_rotations(&[1, 3], &[1.0], &[], &[1.0], 0.016);
    }));
    v
}

/// Runs `f` under `catch_unwind` with the panic hook silenced; true when it panicked.
fn panicked(f: impl FnOnce()) -> bool {
    let _lock = HOOK_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let _guard = HookGuard::silence();
    catch_unwind(AssertUnwindSafe(f)).is_err()
}

fn outcome(f: impl FnOnce()) -> &'static str {
    if panicked(f) {
        "panicked"
    } else {
        "returned"
    }
}

/// Control: a 1x1 heightfield reaches parry `HeightField::with_flags` its row and column count assert.
fn raw_one_by_one_heightfield() {
    use rapier3d::na::{DMatrix, Vector3};
    let matrix = DMatrix::from_row_slice(1, 1, &[0.0f32]);
    let _ = rapier3d::geometry::ColliderBuilder::heightfield(matrix, Vector3::new(1.0, 1.0, 1.0));
}

/// Control: a triangle index past the vertex list reaches parry `rebuild_qbvh` indexing.
fn raw_out_of_range_trimesh() {
    use rapier3d::na::Point3;
    let verts: Vec<Point3<f32>> = QUAD
        .chunks(3)
        .map(|c| Point3::new(c[0], c[1], c[2]))
        .collect();
    let _ = rapier3d::geometry::ColliderBuilder::trimesh(verts, vec![[0, 1, 9]]);
}

/// Control: duplicate points reach the unwrapping `convex_hull` inside `from_convex_hull`.
fn raw_duplicate_convex_hull() {
    use rapier3d::na::Point3;
    let verts: Vec<Point3<f32>> = (0..4).map(|_| Point3::new(1.0, 1.0, 1.0)).collect();
    let _ = rapier3d::geometry::ColliderBuilder::convex_hull(&verts);
}

#[test]
fn collider_inputs_never_panic() {
    let failed: Vec<String> = cases()
        .into_iter()
        .filter_map(|(name, f)| panicked(f).then_some(name))
        .collect();
    assert_eq!(failed, Vec::<String>::new(), "cases that panicked");
}

#[test]
fn control_one_by_one_heightfield_panics() {
    assert_eq!(outcome(raw_one_by_one_heightfield), "panicked");
}

#[test]
fn control_out_of_range_trimesh_panics() {
    assert_eq!(outcome(raw_out_of_range_trimesh), "panicked");
}

#[test]
fn control_duplicate_convex_hull_panics() {
    assert_eq!(outcome(raw_duplicate_convex_hull), "panicked");
}

#[test]
fn case_count_is_pinned() {
    let n = cases().len();
    assert_eq!(
        n, CASE_COUNT,
        "probe case count is {n}, expected {CASE_COUNT}"
    );
}
