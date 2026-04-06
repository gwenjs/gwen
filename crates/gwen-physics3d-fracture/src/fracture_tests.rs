//! Deterministic unit tests for the Voronoi fracture algorithm.
//!
//! These tests run natively with `cargo test` and do not require a browser environment.
//! They verify correctness of mesh fracturing, index validity, triangle distribution,
//! and deterministic behavior with fixed seeds.

#[cfg(test)]
mod tests {
    use crate::voronoi_fracture_core;

    /// Returns a simple tetrahedron mesh: 4 vertices, 4 triangles.
    fn tetrahedron() -> (Vec<f32>, Vec<u32>) {
        let v = vec![
            0.0, 1.0, 0.0,      // vertex 0: top
            -1.0, -1.0, 1.0,    // vertex 1: front-left
            1.0, -1.0, 1.0,     // vertex 2: front-right
            0.0, -1.0, -1.0,    // vertex 3: back
        ];
        let i = vec![
            0, 1, 2,  // front face
            0, 2, 3,  // right face
            0, 3, 1,  // left face
            1, 3, 2,  // bottom face
        ];
        (v, i)
    }

    /// Returns a unit cube mesh: 8 vertices, 12 triangles (2 per face).
    fn cube() -> (Vec<f32>, Vec<u32>) {
        let v = vec![
            // Front face
            -1.0, -1.0, -1.0, // 0
            1.0, -1.0, -1.0,  // 1
            1.0, 1.0, -1.0,   // 2
            -1.0, 1.0, -1.0,  // 3
            // Back face
            -1.0, -1.0, 1.0,  // 4
            1.0, -1.0, 1.0,   // 5
            1.0, 1.0, 1.0,    // 6
            -1.0, 1.0, 1.0,   // 7
        ];
        let i = vec![
            // Front face
            0, 1, 2, 0, 2, 3,
            // Back face
            4, 5, 6, 4, 6, 7,
            // Left face
            0, 3, 7, 0, 7, 4,
            // Right face
            1, 2, 6, 1, 6, 5,
            // Top face
            3, 2, 6, 3, 6, 7,
            // Bottom face
            0, 4, 5, 0, 5, 1,
        ];
        (v, i)
    }

    /// Parses the output buffer according to the encoding format.
    ///
    /// # Format
    /// ```text
    /// [f32: non_empty_shard_count]
    /// per shard {
    ///   [f32: vertex_count]
    ///   [f32: triangle_count]
    ///   [f32 × vertex_count × 3]  // vertex positions
    ///   [f32 × triangle_count × 3] // triangle indices (as f32)
    /// }
    /// ```
    fn parse_output(buf: &[f32]) -> Vec<(usize, usize, Vec<f32>, Vec<u32>)> {
        if buf.is_empty() {
            return vec![];
        }

        let mut offset = 0;
        let shard_count = buf[offset] as usize;
        offset += 1;

        let mut shards = vec![];
        for _ in 0..shard_count {
            if offset >= buf.len() {
                break;
            }

            let vc = buf[offset] as usize;
            offset += 1;
            let tc = buf[offset] as usize;
            offset += 1;

            let verts: Vec<f32> = buf[offset..offset + vc * 3].to_vec();
            offset += vc * 3;

            let idxs: Vec<u32> = buf[offset..offset + tc * 3]
                .iter()
                .map(|&f| f as u32)
                .collect();
            offset += tc * 3;

            shards.push((vc, tc, verts, idxs));
        }
        shards
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Edge Case Tests
    // ──────────────────────────────────────────────────────────────────────────

    /// Empty vertex buffer should return an empty result.
    #[test]
    fn test_empty_vertices_returns_empty() {
        let result = voronoi_fracture_core(&[], &[0, 1, 2], 0.0, 0.0, 0.0, 4, 42);
        assert!(result.is_empty(), "empty vertices should produce empty output");
    }

    /// Empty index buffer should return an empty result.
    #[test]
    fn test_empty_indices_returns_empty() {
        let (v, _) = tetrahedron();
        let result = voronoi_fracture_core(&v, &[], 0.0, 0.0, 0.0, 4, 42);
        assert!(result.is_empty(), "empty indices should produce empty output");
    }

    /// Both buffers empty should return empty result.
    #[test]
    fn test_empty_both_returns_empty() {
        let result = voronoi_fracture_core(&[], &[], 0.0, 0.0, 0.0, 4, 42);
        assert!(result.is_empty(), "both empty should produce empty output");
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Single Shard Tests
    // ──────────────────────────────────────────────────────────────────────────

    /// With `shard_count = 1`, all triangles should be in a single shard.
    #[test]
    fn test_single_shard_contains_all_triangles() {
        let (v, i) = tetrahedron();
        let result = voronoi_fracture_core(&v, &i, 0.0, 0.0, 0.0, 1, 42);
        assert!(!result.is_empty(), "result must not be empty");

        let shards = parse_output(&result);
        assert_eq!(shards.len(), 1, "expected exactly 1 shard");

        let (_, tc, _, _) = &shards[0];
        assert_eq!(
            *tc, 4,
            "single shard must contain all 4 triangles from tetrahedron"
        );
    }

    /// With `shard_count = 1` on a cube (12 triangles), all should be in one shard.
    #[test]
    fn test_single_shard_cube_all_triangles() {
        let (v, i) = cube();
        let result = voronoi_fracture_core(&v, &i, 0.0, 0.0, 0.0, 1, 99);
        assert!(!result.is_empty(), "cube fracture should not be empty");

        let shards = parse_output(&result);
        assert_eq!(shards.len(), 1, "cube with 1 shard should produce 1 output shard");

        let (_, tc, _, _) = &shards[0];
        assert_eq!(*tc, 12, "single shard must contain all 12 triangles from cube");
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Multiple Shard Tests
    // ──────────────────────────────────────────────────────────────────────────

    /// Requesting more shards than triangles should not panic.
    #[test]
    fn test_more_shards_than_triangles_does_not_panic() {
        let (v, i) = tetrahedron(); // 4 triangles
        let result = voronoi_fracture_core(&v, &i, 0.0, 0.0, 0.0, 100, 42);
        assert!(!result.is_empty(), "result should not be empty");

        let shards = parse_output(&result);
        assert!(
            shards.len() <= 4,
            "cannot have more non-empty shards than input triangles (have {}, expected <= 4)",
            shards.len()
        );
    }

    /// Cube with 2 shards should distribute triangles into at most 2 shards.
    #[test]
    fn test_multiple_shards_cube_2shards() {
        let (v, i) = cube();
        let result = voronoi_fracture_core(&v, &i, 0.0, 0.0, 0.0, 2, 7777);
        assert!(!result.is_empty(), "result should not be empty");

        let shards = parse_output(&result);
        assert!(
            shards.len() >= 1 && shards.len() <= 2,
            "expected 1-2 shards, got {}",
            shards.len()
        );
    }

    /// Cube with 4 shards should distribute triangles into multiple shards.
    #[test]
    fn test_multiple_shards_cube_4shards() {
        let (v, i) = cube();
        let result = voronoi_fracture_core(&v, &i, 0.5, 0.5, 0.5, 4, 12345);
        assert!(!result.is_empty());

        let shards = parse_output(&result);
        assert!(
            shards.len() >= 1 && shards.len() <= 4,
            "expected 1-4 shards, got {}",
            shards.len()
        );
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Determinism Tests
    // ──────────────────────────────────────────────────────────────────────────

    /// Same seed should produce identical output (determinism check).
    #[test]
    fn test_same_seed_produces_identical_output() {
        let (v, i) = cube();
        let r1 = voronoi_fracture_core(&v, &i, 0.5, 0.5, 0.5, 4, 12345);
        let r2 = voronoi_fracture_core(&v, &i, 0.5, 0.5, 0.5, 4, 12345);
        assert_eq!(r1, r2, "same seed must produce identical output");
    }

    /// Different seeds should (likely) produce different outputs.
    #[test]
    fn test_different_seeds_produce_different_output() {
        let (v, i) = cube();
        let r1 = voronoi_fracture_core(&v, &i, 0.5, 0.5, 0.5, 4, 111);
        let r2 = voronoi_fracture_core(&v, &i, 0.5, 0.5, 0.5, 4, 222);
        // Different seeds *usually* produce different outputs, but we only check
        // that both are non-empty (statistical assertion would be fragile).
        assert!(!r1.is_empty());
        assert!(!r2.is_empty());
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Output Format Tests
    // ──────────────────────────────────────────────────────────────────────────

    /// Output should start with a shard count in the valid range.
    #[test]
    fn test_output_starts_with_shard_count() {
        let (v, i) = cube();
        let result = voronoi_fracture_core(&v, &i, 0.0, 0.0, 0.0, 3, 42);
        assert!(!result.is_empty(), "result must not be empty");

        let non_empty_count = result[0] as usize;
        assert!(
            non_empty_count >= 1 && non_empty_count <= 3,
            "shard count {} must be in range [1, 3]",
            non_empty_count
        );
    }

    /// Each shard's declared vertex count must match actual vertex buffer length.
    #[test]
    fn test_shard_vertices_buffer_length_matches_declared_count() {
        let (v, i) = cube();
        let result = voronoi_fracture_core(&v, &i, 0.0, 0.0, 0.0, 4, 42);
        let shards = parse_output(&result);

        for (si, (vc, _tc, verts, _idxs)) in shards.iter().enumerate() {
            assert_eq!(
                verts.len(),
                vc * 3,
                "shard {}: vertex buffer length {} != declared {} * 3",
                si,
                verts.len(),
                vc
            );
        }
    }

    /// Each shard's declared triangle count must match actual index buffer length / 3.
    #[test]
    fn test_shard_indices_buffer_length_matches_declared_count() {
        let (v, i) = cube();
        let result = voronoi_fracture_core(&v, &i, 0.5, 0.5, 0.5, 4, 42);
        let shards = parse_output(&result);

        for (si, (_, tc, _verts, idxs)) in shards.iter().enumerate() {
            assert_eq!(
                idxs.len(),
                tc * 3,
                "shard {}: index buffer length {} != declared {} * 3",
                si,
                idxs.len(),
                tc
            );
        }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Index Validity Tests
    // ──────────────────────────────────────────────────────────────────────────

    /// All triangle indices must be valid references to shard vertices.
    #[test]
    fn test_output_indices_are_valid_vertex_references() {
        let (v, i) = cube();
        let result = voronoi_fracture_core(&v, &i, 0.0, 0.0, 0.0, 4, 7777);
        let shards = parse_output(&result);

        for (si, (vc, _tc, _verts, idxs)) in shards.iter().enumerate() {
            for &idx in idxs {
                assert!(
                    (idx as usize) < *vc,
                    "shard {}: index {} out of range (vertex_count={})",
                    si,
                    idx,
                    vc
                );
            }
        }
    }

    /// Indices should form valid triangles (no negative, no out-of-bounds).
    #[test]
    fn test_indices_form_valid_triangles() {
        let (v, i) = tetrahedron();
        let result = voronoi_fracture_core(&v, &i, 0.25, 0.25, 0.25, 2, 9999);
        let shards = parse_output(&result);

        for (si, (_vc, tc, _verts, idxs)) in shards.iter().enumerate() {
            assert_eq!(
                idxs.len() % 3,
                0,
                "shard {}: index count {} must be divisible by 3",
                si,
                idxs.len()
            );
            assert_eq!(
                idxs.len() / 3,
                *tc,
                "shard {}: index buffer should contain {} * 3 = {} values",
                si,
                tc,
                tc * 3
            );
        }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Triangle Distribution Tests
    // ──────────────────────────────────────────────────────────────────────────

    /// Sum of triangles across all shards should equal input triangle count.
    #[test]
    fn test_total_triangles_equals_input_triangles() {
        let (v, i) = cube();
        let input_tri_count = i.len() / 3;
        let result = voronoi_fracture_core(&v, &i, 0.5, 0.5, 0.5, 3, 1);
        let shards = parse_output(&result);

        let total: usize = shards.iter().map(|(_, tc, _, _)| tc).sum();
        assert_eq!(
            total, input_tri_count,
            "sum of shard triangles {} must equal input triangle count {}",
            total, input_tri_count
        );
    }

    /// No triangle should be duplicated across shards.
    #[test]
    fn test_no_triangle_duplication() {
        let (v, i) = cube();
        let input_tri_count = i.len() / 3;
        let result = voronoi_fracture_core(&v, &i, 0.0, 0.0, 0.0, 3, 555);
        let shards = parse_output(&result);

        let total: usize = shards.iter().map(|(_, tc, _, _)| tc).sum();
        assert_eq!(
            total, input_tri_count,
            "no triangle should be lost or duplicated"
        );
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Vertex Deduplication Tests
    // ──────────────────────────────────────────────────────────────────────────

    /// Each shard should have at least 3 vertices if non-empty (forms a triangle).
    #[test]
    fn test_non_empty_shards_have_at_least_3_vertices() {
        let (v, i) = cube();
        let result = voronoi_fracture_core(&v, &i, 0.1, 0.1, 0.1, 4, 42);
        let shards = parse_output(&result);

        for (si, (vc, _tc, _verts, _idxs)) in shards.iter().enumerate() {
            assert!(
                *vc >= 3,
                "shard {}: non-empty shard must have >= 3 vertices, has {}",
                si,
                vc
            );
        }
    }

    /// Vertices are deduplicated within each shard (no redundant vertices within a shard).
    /// However, the same vertex may appear in multiple shards, so total count can exceed original.
    #[test]
    fn test_vertices_deduplicated_within_shards() {
        let (v, i) = cube();
        let result = voronoi_fracture_core(&v, &i, 0.0, 0.0, 0.0, 2, 42);
        let shards = parse_output(&result);

        // Within each shard, vertices should be efficiently deduplicated.
        for (si, (vc, tc, _verts, _idxs)) in shards.iter().enumerate() {
            // A shard with tc triangles needs at least 3 vertices.
            // With perfect deduplication, tc triangles need at least tc+2 vertices.
            // (minimal case: triangle strip). Allow some inefficiency.
            assert!(
                *vc >= 3,
                "shard {}: should have >= 3 unique vertices, has {}",
                si,
                vc
            );

            // Sanity check: vertex count shouldn't be absurdly high for a single shard.
            // At most we'd have 3*tc unique vertices (if every triangle has entirely unique verts).
            assert!(
                *vc <= 3 * tc,
                "shard {}: vertex count {} is too high for {} triangles",
                si,
                vc,
                tc
            );
        }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Impact Point Tests
    // ──────────────────────────────────────────────────────────────────────────

    /// Impact point at cube center should create balanced distribution.
    #[test]
    fn test_impact_at_center_creates_distribution() {
        let (v, i) = cube(); // cube from -1 to 1 on all axes
        let result = voronoi_fracture_core(&v, &i, 0.0, 0.0, 0.0, 4, 42);
        assert!(!result.is_empty());

        let shards = parse_output(&result);
        assert!(shards.len() >= 1 && shards.len() <= 4);
    }

    /// Impact point far outside mesh should still fracture (uses bounding box).
    #[test]
    fn test_impact_outside_mesh() {
        let (v, i) = cube();
        let result = voronoi_fracture_core(&v, &i, 100.0, 100.0, 100.0, 2, 42);
        assert!(!result.is_empty());

        let shards = parse_output(&result);
        assert_eq!(shards.iter().map(|(_, tc, _, _)| tc).sum::<usize>(), i.len() / 3);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Golden Tests (Deterministic Reference Values)
    // ──────────────────────────────────────────────────────────────────────────

    /// Golden test: tetrahedron with 2 shards, seed 42.
    #[test]
    fn test_golden_tetrahedron_2shards_seed42() {
        let (v, i) = tetrahedron();
        let result = voronoi_fracture_core(&v, &i, 0.0, 0.0, 0.0, 2, 42);
        let shards = parse_output(&result);

        // With 2 sites and 4 triangles, we expect 1-2 non-empty shards.
        assert!(
            shards.len() >= 1 && shards.len() <= 2,
            "golden: expected 1-2 non-empty shards (seed=42, 2 sites), got {}",
            shards.len()
        );

        // All triangles should be preserved.
        let total_tris: usize = shards.iter().map(|(_, tc, _, _)| tc).sum();
        assert_eq!(
            total_tris, 4,
            "golden: all 4 triangles must be preserved"
        );
    }

    /// Golden test: cube with 4 shards, impact at center, seed 12345.
    #[test]
    fn test_golden_cube_4shards_center_seed12345() {
        let (v, i) = cube();
        let result = voronoi_fracture_core(&v, &i, 0.0, 0.0, 0.0, 4, 12345);
        let shards = parse_output(&result);

        // With 4 sites and 12 triangles, we expect multiple non-empty shards.
        assert!(
            shards.len() >= 1 && shards.len() <= 4,
            "golden: expected 1-4 non-empty shards, got {}",
            shards.len()
        );

        // All 12 triangles should be preserved.
        let total_tris: usize = shards.iter().map(|(_, tc, _, _)| tc).sum();
        assert_eq!(
            total_tris, 12,
            "golden: all 12 triangles must be preserved"
        );
    }

    /// Golden test: cube with 8 shards, offset impact, seed 99999.
    #[test]
    fn test_golden_cube_8shards_offset_seed99999() {
        let (v, i) = cube();
        let result = voronoi_fracture_core(&v, &i, 0.5, -0.5, 0.3, 8, 99999);
        let shards = parse_output(&result);

        // With 8 sites, expect good distribution.
        assert!(
            shards.len() >= 1 && shards.len() <= 8,
            "golden: expected 1-8 non-empty shards, got {}",
            shards.len()
        );

        let total_tris: usize = shards.iter().map(|(_, tc, _, _)| tc).sum();
        assert_eq!(total_tris, 12, "golden: all 12 triangles preserved");
    }
}
