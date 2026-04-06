//! Voronoi mesh fracture for GWEN Physics 3D.
//!
//! Exposes a single WASM-bindgen function [`voronoi_fracture`] that splits a
//! triangle mesh into `shard_count` pieces using a triangle-centroid assignment
//! strategy:
//!
//! 1. Generate `shard_count` Voronoi sites around the impact point.
//! 2. For each triangle, compute its centroid and assign it to the nearest site.
//! 3. Collect per-site triangle buckets and build deduplicated sub-meshes.
//!
//! **Algorithm complexity:** O(triangles × sites). Fast enough for games with
//! 64 shards and meshes up to ~10 000 triangles at 60 fps.
//!
//! **Output encoding:**
//! ```text
//! [f32: shard_count]
//! per non-empty shard {
//!   [f32: vertex_count]   // number of unique vertices in this shard
//!   [f32: triangle_count] // number of triangles in this shard
//!   [f32 × vertex_count × 3] // vertex positions x,y,z
//!   [f32 × triangle_count × 3] // re-mapped triangle indices encoded as f32
//! }
//! ```
//! Indices are encoded as `f32` because wasm-bindgen returns `Vec<f32>` cleanly
//! from WASM; the TypeScript parser casts them back to `u32` when reading.

use std::collections::HashMap;
use wasm_bindgen::prelude::*;

// ─── Public WASM API ─────────────────────────────────────────────────────────

/// Core fracture logic without WASM-bindgen overhead.
///
/// This function wraps the core Voronoi fracture algorithm to allow deterministic
/// testing without WASM boundary crossing. It is used internally by [`voronoi_fracture`]
/// and can also be called directly in Rust tests.
///
/// # Arguments
/// * `vertices_flat` — Source mesh vertex positions `[x0,y0,z0, x1,y1,z1, ...]`.
/// * `indices_flat`  — Source mesh triangle indices `[a0,b0,c0, ...]`.
/// * `impact_x/y/z` — Impact point in local mesh space. Used as the first Voronoi site.
/// * `shard_count`  — Number of desired shards (1–64 recommended; clamped to 1 minimum).
/// * `seed`         — LCG random seed for reproducible fracture patterns.
///
/// # Returns
/// A flat `f32` buffer encoding all non-empty shards (see module-level docs for layout).
/// Returns an empty `vec![]` if `vertices_flat` or `indices_flat` is empty.
pub(crate) fn voronoi_fracture_core(
    vertices_flat: &[f32],
    indices_flat: &[u32],
    impact_x: f32,
    impact_y: f32,
    impact_z: f32,
    shard_count: u32,
    seed: u32,
) -> Vec<f32> {
    if vertices_flat.is_empty() || indices_flat.is_empty() {
        return vec![];
    }
    let shard_count = shard_count.max(1) as usize;

    let verts = parse_vertices(vertices_flat);
    let tris = parse_triangles(indices_flat);

    let sites = generate_sites(impact_x, impact_y, impact_z, shard_count, seed, &verts);
    let buckets = assign_triangles(&verts, &tris, &sites, shard_count);
    encode_output(&verts, &buckets, shard_count)
}

/// Fracture a triangle mesh into `shard_count` pieces using Voronoi site assignment.
///
/// # Arguments
/// * `vertices_flat` — Source mesh vertex positions `[x0,y0,z0, x1,y1,z1, ...]`.
///   Length must be a non-zero multiple of 3.
/// * `indices_flat`  — Source mesh triangle indices `[a0,b0,c0, ...]`.
///   Length must be a non-zero multiple of 3.
/// * `impact_x/y/z` — Impact point in local mesh space. Used as the first Voronoi site.
/// * `shard_count`  — Number of desired shards (1–64 recommended; clamped to 1 minimum).
/// * `seed`         — LCG random seed for reproducible fracture patterns.
///
/// # Returns
/// A flat `f32` buffer encoding all non-empty shards (see module-level docs for layout).
/// Returns an empty `vec![]` if `vertices_flat` or `indices_flat` is empty.
#[wasm_bindgen]
pub fn voronoi_fracture(
    vertices_flat: &[f32],
    indices_flat: &[u32],
    impact_x: f32,
    impact_y: f32,
    impact_z: f32,
    shard_count: u32,
    seed: u32,
) -> Vec<f32> {
    voronoi_fracture_core(vertices_flat, indices_flat, impact_x, impact_y, impact_z, shard_count, seed)
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

fn parse_vertices(flat: &[f32]) -> Vec<[f32; 3]> {
    flat.chunks_exact(3)
        .map(|c| [c[0], c[1], c[2]])
        .collect()
}

fn parse_triangles(flat: &[u32]) -> Vec<[u32; 3]> {
    flat.chunks_exact(3)
        .map(|c| [c[0], c[1], c[2]])
        .collect()
}

/// Generate `count` Voronoi site positions.
/// Site 0 is always the impact point; the rest are uniformly sampled from the
/// mesh bounding box using a simple LCG PRNG seeded with `seed`.
fn generate_sites(
    ix: f32,
    iy: f32,
    iz: f32,
    count: usize,
    seed: u32,
    verts: &[[f32; 3]],
) -> Vec<[f32; 3]> {
    let mut rng = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);

    let mut min = [f32::MAX; 3];
    let mut max = [f32::MIN; 3];
    for v in verts {
        for i in 0..3 {
            min[i] = min[i].min(v[i]);
            max[i] = max[i].max(v[i]);
        }
    }
    let spread = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];

    let mut sites = vec![[ix, iy, iz]];
    for _ in 1..count {
        let [rx, ry, rz] = std::array::from_fn(|i| {
            rng = rng.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            min[i] + (rng as f32 / u32::MAX as f32) * spread[i]
        });
        sites.push([rx, ry, rz]);
    }
    sites
}

#[inline]
fn dist2(a: [f32; 3], b: [f32; 3]) -> f32 {
    (a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2) + (a[2] - b[2]).powi(2)
}

/// Assign each triangle to the Voronoi site nearest to its centroid.
fn assign_triangles(
    verts: &[[f32; 3]],
    tris: &[[u32; 3]],
    sites: &[[f32; 3]],
    shard_count: usize,
) -> Vec<Vec<[u32; 3]>> {
    let mut buckets: Vec<Vec<[u32; 3]>> = vec![Vec::new(); shard_count];
    for tri in tris {
        let cx = (verts[tri[0] as usize][0] + verts[tri[1] as usize][0] + verts[tri[2] as usize][0]) / 3.0;
        let cy = (verts[tri[0] as usize][1] + verts[tri[1] as usize][1] + verts[tri[2] as usize][1]) / 3.0;
        let cz = (verts[tri[0] as usize][2] + verts[tri[1] as usize][2] + verts[tri[2] as usize][2]) / 3.0;
        let nearest = sites
            .iter()
            .enumerate()
            .min_by(|(_, a), (_, b)| {
                dist2(**a, [cx, cy, cz])
                    .partial_cmp(&dist2(**b, [cx, cy, cz]))
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
            .map(|(i, _)| i)
            .unwrap_or(0);
        buckets[nearest].push(*tri);
    }
    buckets
}

/// Build the output buffer from the per-shard triangle buckets.
fn encode_output(verts: &[[f32; 3]], buckets: &[Vec<[u32; 3]>], shard_count: usize) -> Vec<f32> {
    let non_empty_count = buckets.iter().filter(|b| !b.is_empty()).count();
    let mut out = vec![non_empty_count as f32];

    for bucket in buckets.iter().take(shard_count) {
        if bucket.is_empty() {
            continue;
        }
        let mut shard_verts: Vec<f32> = Vec::new();
        let mut shard_idxs: Vec<f32> = Vec::new();
        let mut vert_map: HashMap<u32, u32> = HashMap::new();

        for tri in bucket {
            for &orig_idx in tri {
                let new_idx = *vert_map.entry(orig_idx).or_insert_with(|| {
                    let ni = (shard_verts.len() / 3) as u32;
                    shard_verts.extend_from_slice(&verts[orig_idx as usize]);
                    ni
                });
                shard_idxs.push(new_idx as f32);
            }
        }

        out.push((shard_verts.len() / 3) as f32); // vertex count
        out.push((shard_idxs.len() / 3) as f32);  // triangle count
        out.extend_from_slice(&shard_verts);
        out.extend_from_slice(&shard_idxs);
    }
    out
}

// ─── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod fracture_tests;

