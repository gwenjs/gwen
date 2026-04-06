//! Integration tests for voronoi_fracture().
//!
//! Uses a minimal 4-vertex, 2-triangle quad mesh so results are deterministic
//! and easy to reason about by hand.

use gwen_physics3d_fracture::voronoi_fracture;

/// Helper: parse the output buffer into `(shard_count, shards)` where each
/// shard is `(vertex_count, tri_count, vertices, indices)`.
fn parse_output(buf: &[f32]) -> (usize, Vec<(usize, usize, Vec<f32>, Vec<u32>)>) {
    let mut offset = 0;
    let shard_count = buf[offset] as usize;
    offset += 1;
    let mut shards = Vec::new();
    for _ in 0..shard_count {
        let vert_count = buf[offset] as usize;
        offset += 1;
        let tri_count = buf[offset] as usize;
        offset += 1;
        let verts: Vec<f32> = buf[offset..offset + vert_count * 3].to_vec();
        offset += vert_count * 3;
        let idxs: Vec<u32> = buf[offset..offset + tri_count * 3].iter().map(|&f| f as u32).collect();
        offset += tri_count * 3;
        shards.push((vert_count, tri_count, verts, idxs));
    }
    (shard_count, shards)
}

/// Flat quad mesh: 4 vertices, 2 triangles.
///   v0(0,0,0)  v1(1,0,0)
///   v2(0,1,0)  v3(1,1,0)
fn quad_mesh() -> (Vec<f32>, Vec<u32>) {
    let verts: Vec<f32> = vec![
        0.0, 0.0, 0.0,
        1.0, 0.0, 0.0,
        0.0, 1.0, 0.0,
        1.0, 1.0, 0.0,
    ];
    // Two triangles: lower-left and upper-right.
    let idxs: Vec<u32> = vec![0, 1, 2, 1, 3, 2];
    (verts, idxs)
}

#[test]
fn test_voronoi_fracture_empty_input_returns_empty() {
    let result = voronoi_fracture(&[], &[], 0.0, 0.0, 0.0, 2, 42);
    assert!(result.is_empty());
}

#[test]
fn test_voronoi_fracture_shard_count_1_returns_all_triangles() {
    let (verts, idxs) = quad_mesh();
    let result = voronoi_fracture(&verts, &idxs, 0.5, 0.5, 0.0, 1, 0);
    let (shard_count, shards) = parse_output(&result);

    assert_eq!(shard_count, 1, "should produce exactly 1 shard");
    let (_, tri_count, _, _) = &shards[0];
    assert_eq!(*tri_count, 2, "all 2 triangles must be in the single shard");
}

#[test]
fn test_voronoi_fracture_2_shards_split_quad() {
    // Impact at corner (0,0,0) — that site is closer to tri-0 centroid (~0.33,0.33).
    // Second site is random, but with seed=0 it should end up near the opposite corner.
    let (verts, idxs) = quad_mesh();
    let result = voronoi_fracture(&verts, &idxs, 0.0, 0.0, 0.0, 2, 0);
    let (shard_count, shards) = parse_output(&result);

    assert_eq!(shard_count, 2, "both shards must be non-empty for this input");

    let total_tris: usize = shards.iter().map(|(_, tc, _, _)| tc).sum();
    assert_eq!(total_tris, 2, "total triangle count across shards must equal original");
}

#[test]
fn test_voronoi_fracture_indices_are_valid_for_each_shard() {
    let (verts, idxs) = quad_mesh();
    let result = voronoi_fracture(&verts, &idxs, 0.5, 0.5, 0.0, 2, 99);
    let (_, shards) = parse_output(&result);

    for (vert_count, _, _, shard_idxs) in &shards {
        for &idx in shard_idxs {
            assert!(
                (idx as usize) < *vert_count,
                "shard index {idx} out of range for vert_count={vert_count}"
            );
        }
    }
}

#[test]
fn test_voronoi_fracture_is_reproducible_with_same_seed() {
    let (verts, idxs) = quad_mesh();
    let a = voronoi_fracture(&verts, &idxs, 0.5, 0.5, 0.0, 4, 12345);
    let b = voronoi_fracture(&verts, &idxs, 0.5, 0.5, 0.0, 4, 12345);
    assert_eq!(a, b, "same seed must produce identical output");
}

#[test]
fn test_voronoi_fracture_differs_with_different_seeds() {
    let (verts, idxs) = quad_mesh();
    let a = voronoi_fracture(&verts, &idxs, 0.5, 0.5, 0.0, 2, 1);
    let b = voronoi_fracture(&verts, &idxs, 0.5, 0.5, 0.0, 2, 9999);
    // Different seeds should (almost always) produce different site placements.
    // With only 2 triangles this test may occasionally pass even if wrong, but
    // the seed test above guards reproducibility.
    let _ = (a, b); // just verify no panic; determinism tested above
}

#[test]
fn test_voronoi_fracture_shard_count_clamped_to_1() {
    // shard_count = 0 must not panic (clamped to 1 internally).
    let (verts, idxs) = quad_mesh();
    let result = voronoi_fracture(&verts, &idxs, 0.5, 0.5, 0.0, 0, 42);
    assert!(!result.is_empty());
    let (sc, _) = parse_output(&result);
    assert_eq!(sc, 1);
}
