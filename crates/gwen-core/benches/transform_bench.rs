//! Criterion benchmarks for TransformSystem propagation and bulk operations.
//!
//! Run with: `cargo bench -p gwen-core`
//! 
//! These benchmarks measure:
//! - Transform propagation in flat hierarchies (no parents)
//! - Transform propagation in deep chains (32 levels)
//! - Mixed scenarios with 10% of entities dirty (typical game scene)
//! - Bulk destroy operations
//! - Bulk spawn with transforms operations

use criterion::{criterion_group, criterion_main, BenchmarkId, Criterion};
use gwen_core::bindings::Engine;
use gwen_core::transform::{Transform, TransformSystem};
use gwen_core::transform_math::Vec2;
use gwen_core::entity::EntityId;

fn entity(i: u32) -> EntityId {
    EntityId::from_parts(i, 0)
}

/// Build a TransformSystem with N flat entities (no parent-child relationships).
fn make_flat_system(count: usize) -> TransformSystem {
    let mut sys = TransformSystem::new();
    for i in 0..count {
        sys.add_transform(
            entity(i as u32),
            Transform::new(Vec2::zero(), 0.0, Vec2::one()),
        );
    }
    sys
}

/// Build a TransformSystem with a linear chain of N entities.
fn make_chain_system(count: usize) -> TransformSystem {
    let mut sys = TransformSystem::new();
    let chain_count = count.min(32);
    for i in 0..chain_count {
        sys.add_transform(
            entity(i as u32),
            Transform::new(Vec2::new(1.0, 0.0), 0.0, Vec2::one()),
        );
    }
    for i in 1..chain_count {
        sys.set_parent(entity(i as u32), Some(entity(i as u32 - 1)));
    }
    sys
}

fn bench_transform_propagation(c: &mut Criterion) {
    let mut group = c.benchmark_group("transform_propagation");

    for count in [100usize, 1_000, 10_000] {
        group.bench_with_input(
            BenchmarkId::new("flat_no_parent", count),
            &count,
            |b, &n| {
                let mut sys = make_flat_system(n);
                b.iter(|| {
                    // Mark all dirty before each iteration
                    for i in 0..n {
                        if let Some(t) = sys.get_transform_mut(entity(i as u32)) {
                            t.mark_dirty();
                        }
                    }
                    sys.update()
                })
            },
        );

        group.bench_with_input(
            BenchmarkId::new("chain_depth_32", count),
            &count,
            |b, &_n| {
                let mut sys = make_chain_system(32);
                b.iter(|| {
                    if let Some(t) = sys.get_transform_mut(entity(0)) {
                        t.mark_dirty();
                    }
                    sys.update()
                })
            },
        );

        // 10% dirty — typical game scene (most entities static)
        group.bench_with_input(
            BenchmarkId::new("mixed_10pct_dirty", count),
            &count,
            |b, &n| {
                let mut sys = make_flat_system(n);
                b.iter(|| {
                    let dirty_count = (n / 10).max(1);
                    for i in 0..dirty_count {
                        if let Some(t) = sys.get_transform_mut(entity(i as u32)) {
                            t.mark_dirty();
                        }
                    }
                    sys.update()
                })
            },
        );
    }
    group.finish();
}

fn bench_bulk_ops(c: &mut Criterion) {
    let mut group = c.benchmark_group("bulk_ops");

    group.bench_function("bulk_destroy_1k", |b| {
        b.iter(|| {
            let mut engine = Engine::new(2_000);
            let ids: Vec<u32> = (0..1_000)
                .map(|_| engine.create_entity().index())
                .collect();
            engine.bulk_destroy(&ids);
        })
    });

    group.bench_function("bulk_spawn_200_with_transforms", |b| {
        b.iter(|| {
            let mut engine = Engine::new(300);
            let positions: Vec<f32> = (0..200)
                .flat_map(|i| [i as f32 * 16.0, 0.0])
                .collect();
            engine.bulk_spawn_with_transforms(&positions, &[]);
        })
    });

    group.bench_function("bulk_spawn_500_with_rotations", |b| {
        b.iter(|| {
            let mut engine = Engine::new(600);
            let positions: Vec<f32> = (0..500)
                .flat_map(|i| [i as f32 * 8.0, 0.0])
                .collect();
            let rotations: Vec<f32> = (0..500)
                .map(|i| (i as f32) * 0.01)
                .collect();
            engine.bulk_spawn_with_transforms(&positions, &rotations);
        })
    });

    group.finish();
}

criterion_group!(benches, bench_transform_propagation, bench_bulk_ops);
criterion_main!(benches);
