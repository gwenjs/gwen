use gwen_core::physics2d::components::{BodyOptions, BodyType, ColliderOptions};
use gwen_core::physics2d::world::{PhysicsQualityPreset, PhysicsWorld};
use std::time::Instant;

const DT: f32 = 1.0 / 60.0;
const TUNNEL_DT: f32 = 1.0 / 120.0;
const STACK_ROWS: usize = 8;
const STACK_COLS: usize = 6;
const STACK_HALF_EXTENT: f32 = 0.45;
const STACK_SPACING: f32 = 0.92;
const STACK_WARMUP_STEPS: usize = 120;
const STACK_MEASURE_STEPS: usize = 240;
const TUNNEL_TRIALS: usize = 24;
const TUNNEL_STEPS: usize = 24;

#[derive(Clone, Copy)]
struct PresetRun {
    preset: PhysicsQualityPreset,
    name: &'static str,
    global_ccd_enabled: bool,
}

#[derive(Debug)]
struct PresetBenchResult {
    preset: &'static str,
    global_ccd_enabled: bool,
    solver_iterations: usize,
    ccd_substeps: usize,
    step_p50_ms: f64,
    step_p95_ms: f64,
    tunnel_rate: f64,
    stability_jitter_m: f64,
}

fn preset_runs() -> [PresetRun; 4] {
    [
        PresetRun {
            preset: PhysicsQualityPreset::Low,
            name: "low",
            global_ccd_enabled: false,
        },
        PresetRun {
            preset: PhysicsQualityPreset::Medium,
            name: "medium",
            global_ccd_enabled: false,
        },
        PresetRun {
            preset: PhysicsQualityPreset::High,
            name: "high",
            global_ccd_enabled: true,
        },
        PresetRun {
            preset: PhysicsQualityPreset::Esport,
            name: "esport",
            global_ccd_enabled: true,
        },
    ]
}

fn add_box(world: &mut PhysicsWorld, entity: u32, x: f32, y: f32, kind: BodyType) {
    let handle = world.add_rigid_body(entity, x, y, kind, BodyOptions::default());
    world.add_box_collider(handle, STACK_HALF_EXTENT, STACK_HALF_EXTENT, ColliderOptions::default());
}

fn setup_stack_world(run: PresetRun) -> PhysicsWorld {
    let mut world = PhysicsWorld::new(0.0, -9.81);
    world.set_quality_preset(run.preset);

    let ground = world.add_rigid_body(1, 0.0, -0.75, BodyType::Fixed, BodyOptions::default());
    world.add_box_collider(ground, 12.0, 0.5, ColliderOptions::default());

    let mut entity = 100u32;
    let start_x = -((STACK_COLS as f32 - 1.0) * STACK_SPACING) * 0.5;
    for row in 0..STACK_ROWS {
        for col in 0..STACK_COLS {
            add_box(
                &mut world,
                entity,
                start_x + col as f32 * STACK_SPACING,
                0.25 + row as f32 * STACK_SPACING,
                BodyType::Dynamic,
            );
            entity += 1;
        }
    }

    world
}

fn percentile_ms(samples_ms: &[f64], percentile: f64) -> f64 {
    let mut sorted = samples_ms.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let idx = ((sorted.len().saturating_sub(1)) as f64 * percentile).round() as usize;
    sorted[idx]
}

fn measure_stack(run: PresetRun) -> (f64, f64, f64, usize, usize) {
    let mut world = setup_stack_world(run);
    for _ in 0..STACK_WARMUP_STEPS {
        world.step(DT);
    }

    let probe_entity = 100u32 + (STACK_ROWS as u32 - 1) * STACK_COLS as u32 + (STACK_COLS as u32 / 2);
    let mut samples_ms = Vec::with_capacity(STACK_MEASURE_STEPS);
    let mut y_min = f32::MAX;
    let mut y_max = f32::MIN;

    for _ in 0..STACK_MEASURE_STEPS {
        let t0 = Instant::now();
        world.step(DT);
        let elapsed_ms = t0.elapsed().as_secs_f64() * 1000.0;
        samples_ms.push(elapsed_ms);

        if let Some((_, y, _)) = world.get_position(probe_entity) {
            y_min = y_min.min(y);
            y_max = y_max.max(y);
        }
    }

    let solver_iterations = 0;
    let ccd_substeps = 0;

    (
        percentile_ms(&samples_ms, 0.50),
        percentile_ms(&samples_ms, 0.95),
        (y_max - y_min) as f64,
        solver_iterations,
        ccd_substeps,
    )
}

fn setup_tunnel_world(run: PresetRun) -> PhysicsWorld {
    let mut world = PhysicsWorld::new(0.0, 0.0);
    world.set_quality_preset(run.preset);

    let wall = world.add_rigid_body(2, 0.0, 0.0, BodyType::Fixed, BodyOptions::default());
    world.add_box_collider(wall, 0.05, 2.0, ColliderOptions::default());

    let projectile = world.add_rigid_body(
        3,
        -6.0,
        0.0,
        BodyType::Dynamic,
        BodyOptions {
            initial_velocity: (120.0, 0.0),
            ..BodyOptions::default()
        },
    );
    world.add_box_collider(projectile, 0.08, 0.08, ColliderOptions::default());
    world
}

fn measure_tunnel_rate(run: PresetRun) -> f64 {
    let mut tunneled = 0usize;

    for _ in 0..TUNNEL_TRIALS {
        let mut world = setup_tunnel_world(run);
        for _ in 0..TUNNEL_STEPS {
            world.step(TUNNEL_DT);
        }
        if let Some((x, _, _)) = world.get_position(3) {
            if x > 0.30 {
                tunneled += 1;
            }
        }
    }

    tunneled as f64 / TUNNEL_TRIALS as f64
}


fn run_bench() -> Vec<PresetBenchResult> {
    preset_runs()
        .into_iter()
        .map(|run| {
            let (p50, p95, jitter, solver_iterations, ccd_substeps) = measure_stack(run);
            let tunnel_rate = measure_tunnel_rate(run);
            PresetBenchResult {
                preset: run.name,
                global_ccd_enabled: run.global_ccd_enabled,
                solver_iterations,
                ccd_substeps,
                step_p50_ms: (p50 * 1000.0).round() / 1000.0,
                step_p95_ms: (p95 * 1000.0).round() / 1000.0,
                tunnel_rate: (tunnel_rate * 10000.0).round() / 10000.0,
                stability_jitter_m: (jitter * 100000.0).round() / 100000.0,
            }
        })
        .collect()
}

fn main() {
    let json_mode = std::env::args().any(|arg| arg == "--json");
    let results = run_bench();

    if json_mode {
        print!("{{\"scenario\":\"solver-presets\",\"results\":[");
        for (index, item) in results.iter().enumerate() {
            if index > 0 {
                print!(",");
            }
            print!(
                "{{\"preset\":\"{}\",\"globalCcdEnabled\":{},\"solverIterations\":{},\"ccdSubsteps\":{},\"stepP50Ms\":{},\"stepP95Ms\":{},\"tunnelRate\":{},\"stabilityJitterM\":{}}}",
                item.preset,
                item.global_ccd_enabled,
                item.solver_iterations,
                item.ccd_substeps,
                item.step_p50_ms,
                item.step_p95_ms,
                item.tunnel_rate,
                item.stability_jitter_m,
            );
        }
        println!("]}}");
        return;
    }

    println!("[bench:physics:solver] result");
    for item in results {
        println!(
            "- {}: p50={}ms p95={}ms tunnelRate={} jitter={}m solverIterations={} ccdSubsteps={} globalCcd={}",
            item.preset,
            item.step_p50_ms,
            item.step_p95_ms,
            item.tunnel_rate,
            item.stability_jitter_m,
            item.solver_iterations,
            item.ccd_substeps,
            item.global_ccd_enabled,
        );
    }
}

