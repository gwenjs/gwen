//! Criterion benches for ADR-0001 storage models.
//! Reference scene: internals-docs/adr/0001-component-storage.md
//!
//! Native host target, not wasm32. Ranking only.

#[path = "storage_models/models.rs"]
mod models;

use std::hint::black_box;
use std::time::{Duration, Instant};

use criterion::measurement::WallTime;
use criterion::{criterion_group, criterion_main, BenchmarkGroup, Criterion};
use models::{
    run_frame, ModelADirect, ModelAProd, ModelB, ModelC, StorageModel, DT, STORAGE_REFERENCE_SCENE,
};

fn write_heap_bytes() {
    let mut path = std::path::PathBuf::from(
        std::env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| ".".to_string()),
    );
    path.pop();
    path.pop();
    path.push("target");
    let _ = std::fs::create_dir_all(&path);
    path.push("storage-bench-bytes-rust.json");
    let mut body = String::from("{\"runtime\":\"rust\",\"rows\":[");
    let mut first = true;
    for &count in &STORAGE_REFERENCE_SCENE {
        let rows = [
            ("A.prod", ModelAProd::build(count).heap_bytes()),
            ("A.direct", ModelADirect::build(count).heap_bytes()),
            ("B", ModelB::build(count).heap_bytes()),
            ("C", ModelC::build(count).heap_bytes()),
        ];
        for (model, bytes) in rows {
            if !first {
                body.push(',');
            }
            first = false;
            body.push_str(&format!(
                "{{\"model\":\"{model}\",\"e\":{count},\"bytes\":{bytes}}}"
            ));
        }
    }
    body.push_str("]}");
    let _ = std::fs::write(&path, body);
}

fn bench_iter(
    group: &mut BenchmarkGroup<WallTime>,
    label: &str,
    count: usize,
    mut model: impl StorageModel,
) {
    group.bench_function(format!("{label}/E{count}/iter"), |b| {
        b.iter(|| {
            model.movement(DT);
            black_box(&model);
        });
    });
}

fn bench_add<M: StorageModel>(
    group: &mut BenchmarkGroup<WallTime>,
    label: &str,
    count: usize,
    build: fn(usize) -> M,
) {
    group.bench_function(format!("{label}/E{count}/add"), |b| {
        b.iter_custom(|iters| {
            let mut total = Duration::ZERO;
            let mut model = build(count);
            let mut cursor = 0usize;
            let capacity = count / 2;
            for _ in 0..iters {
                if cursor >= capacity {
                    model = build(count);
                    cursor = 0;
                }
                let entity = (cursor * 2 + 1) as u32;
                cursor += 1;
                let start = Instant::now();
                model.add_health(entity);
                total += start.elapsed();
            }
            total
        });
    });
}

fn bench_remove<M: StorageModel>(
    group: &mut BenchmarkGroup<WallTime>,
    label: &str,
    count: usize,
    build: fn(usize) -> M,
) {
    group.bench_function(format!("{label}/E{count}/remove"), |b| {
        b.iter_custom(|iters| {
            let mut total = Duration::ZERO;
            let mut model = build(count);
            let mut cursor = 0usize;
            let capacity = count / 2;
            for _ in 0..iters {
                if cursor >= capacity {
                    model = build(count);
                    cursor = 0;
                }
                let entity = (cursor * 2) as u32;
                cursor += 1;
                let start = Instant::now();
                model.remove_health(entity);
                total += start.elapsed();
            }
            total
        });
    });
}

fn bench_frame<M: StorageModel>(
    group: &mut BenchmarkGroup<WallTime>,
    label: &str,
    count: usize,
    build: fn(usize) -> M,
) {
    group.bench_function(format!("{label}/E{count}/frame"), |b| {
        b.iter_custom(|iters| {
            let mut total = Duration::ZERO;
            let mut model = build(count);
            let mut frame = 0u32;
            // E/2 structural adds fit in 100 frames (each frame adds E/200).
            let limit = 100u32;
            for _ in 0..iters {
                if frame >= limit {
                    model = build(count);
                    frame = 0;
                }
                let start = Instant::now();
                run_frame(&mut model, frame, DT);
                total += start.elapsed();
                frame += 1;
            }
            total
        });
    });
}

fn storage_models(c: &mut Criterion) {
    write_heap_bytes();
    let mut group = c.benchmark_group("storage/rust");
    group.sample_size(10);
    group.warm_up_time(Duration::from_secs(1));
    group.measurement_time(Duration::from_secs(3));

    for &count in &STORAGE_REFERENCE_SCENE {
        bench_iter(&mut group, "A.prod", count, ModelAProd::build(count));
        bench_add(&mut group, "A.prod", count, ModelAProd::build);
        bench_remove(&mut group, "A.prod", count, ModelAProd::build);
        bench_frame(&mut group, "A.prod", count, ModelAProd::build);

        bench_iter(&mut group, "A.direct", count, ModelADirect::build(count));
        bench_add(&mut group, "A.direct", count, ModelADirect::build);
        bench_remove(&mut group, "A.direct", count, ModelADirect::build);
        bench_frame(&mut group, "A.direct", count, ModelADirect::build);

        bench_iter(&mut group, "B", count, ModelB::build(count));
        bench_add(&mut group, "B", count, ModelB::build);
        bench_remove(&mut group, "B", count, ModelB::build);
        bench_frame(&mut group, "B", count, ModelB::build);

        bench_iter(&mut group, "C", count, ModelC::build(count));
        bench_add(&mut group, "C", count, ModelC::build);
        bench_remove(&mut group, "C", count, ModelC::build);
        bench_frame(&mut group, "C", count, ModelC::build);
    }
    group.finish();
}

criterion_group!(benches, storage_models);
criterion_main!(benches);
