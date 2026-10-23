//! Build-time mesh processing utilities.
//!
//! This module is compiled only when the `build-tools` feature is enabled.
//! It contains pure-Rust helpers; their wasm-bindgen exports live in `bindings.rs`
//! (gated by `#[cfg(feature = "build-tools")]`) to keep all public WASM exports
//! centralised and auditable.
//!
//! # Key functions
//!
//! - [`build_bvh_buffer`] — Convert flat vertex/index arrays into a pre-baked BVH buffer.
//! - [`build_bvh_from_glb`] — Extract a triangle mesh from a GLB binary and bake its BVH.
//!
//! # Output format
//!
//! Both functions produce a buffer with the layout:
//! `[4: magic "GBVH"][2: RAPIER_VERSION major u16 LE][2: RAPIER_VERSION minor u16 LE][N: bincode(TriMesh)]`
//!
//! This buffer can be passed directly to `physics3d_load_bvh_collider` at browser
//! runtime, avoiding the ~50 ms QBVH construction cost on large meshes.

use rapier3d::{geometry::TriMesh, na::Point3};

/// Build a pre-baked BVH buffer from flat vertex and triangle index arrays.
///
/// Constructs a Rapier3D [`TriMesh`] (including its internal QBVH tree), then
/// serialises it with bincode. The result can be passed directly to
/// `physics3d_load_bvh_collider` at browser runtime, skipping the ~50 ms
/// QBVH construction cost on large meshes.
///
/// # Output format
/// `[4: magic "GBVH"][2: RAPIER_VERSION major u16 LE][2: RAPIER_VERSION minor u16 LE][N: bincode(TriMesh)]`
///
/// # Arguments
/// * `vertices_flat` — Flat vertex positions `[x0,y0,z0, x1,y1,z1, ...]`.
///   Length must be a multiple of 3.
/// * `indices_flat`  — Flat triangle indices `[i0,i1,i2, ...]`.
///   Length must be a multiple of 3.
///
/// # Errors
///
/// Returns an error when a length is not a multiple of 3, when indices are
/// empty, when an index is >= the vertex count, or on bincode encode failure.
pub fn build_bvh_buffer(vertices_flat: &[f32], indices_flat: &[u32]) -> Result<Vec<u8>, String> {
    if !vertices_flat.len().is_multiple_of(3) {
        return Err("vertices_flat length must be a multiple of 3".to_string());
    }
    if !indices_flat.len().is_multiple_of(3) {
        return Err("indices_flat length must be a multiple of 3".to_string());
    }
    if indices_flat.is_empty() {
        return Err("indices_flat must contain at least one triangle".to_string());
    }
    let vertex_count = vertices_flat.len() / 3;
    for &index in indices_flat {
        if (index as usize) >= vertex_count {
            return Err(format!(
                "index {index} is outside the vertex count {vertex_count}"
            ));
        }
    }

    let verts: Vec<Point3<f32>> = vertices_flat
        .as_chunks::<3>()
        .0
        .iter()
        .map(|c| Point3::new(c[0], c[1], c[2]))
        .collect();
    let idxs: Vec<[u32; 3]> = indices_flat
        .as_chunks::<3>()
        .0
        .iter()
        .map(|c| [c[0], c[1], c[2]])
        .collect();

    let trimesh = TriMesh::new(verts, idxs);
    let bvh_bytes = bincode::serde::encode_to_vec(&trimesh, bincode::config::standard())
        .map_err(|err| format!("TriMesh serialisation failed: {err}"))?;

    Ok(write_gbvh_header(bvh_bytes))
}

/// Extract the first matching triangle mesh from a GLB binary and build its BVH.
///
/// Parses the GLB file, locates a mesh matching `mesh_name` (or the first
/// `TRIANGLES` primitive when `None`), and returns a pre-baked BVH buffer in
/// the same format as [`build_bvh_buffer`].
///
/// When `mesh_name` is provided, the search also accepts meshes whose name ends
/// with `_col`, `_collision`, or `_phys` (case-insensitive) as collision proxies.
///
/// # Arguments
/// * `glb_bytes`  — Raw bytes of the `.glb` file.
/// * `mesh_name`  — Optional mesh name to search for. When `None`, the first
///   `TRIANGLES` primitive is used.
///
/// # Errors
/// Returns a descriptive `String` error if the GLB is malformed, no matching
/// triangle mesh is found, or the embedded buffer is missing.
pub fn build_bvh_from_glb(glb_bytes: &[u8], mesh_name: Option<&str>) -> Result<Vec<u8>, String> {
    use gltf::{mesh::Mode, Gltf};

    let gltf = Gltf::from_slice(glb_bytes).map_err(|e| format!("GLB parse error: {e}"))?;
    // The embedded binary blob lives in the first GLB chunk.
    let blob = gltf.blob.as_deref().unwrap_or(&[]);

    for mesh in gltf.meshes() {
        if let Some(target) = mesh_name {
            let name = mesh.name().unwrap_or("");
            let name_lower = name.to_lowercase();
            // Accept an exact match or a collision-proxy suffix convention.
            let is_suffix = name_lower.ends_with("_col")
                || name_lower.ends_with("_collision")
                || name_lower.ends_with("_phys");
            if name != target && !is_suffix {
                continue;
            }
        }

        for prim in mesh.primitives() {
            if prim.mode() != Mode::Triangles {
                continue;
            }
            let reader = prim.reader(|buf| {
                // Buffer 0 is always the embedded GLB blob.
                if buf.index() == 0 {
                    Some(blob)
                } else {
                    None
                }
            });

            let Some(positions) = reader.read_positions() else {
                continue;
            };
            let vertices_flat: Vec<f32> = positions.flatten().collect();
            if vertices_flat.is_empty() {
                continue;
            }

            let indices_flat: Vec<u32> = match reader.read_indices() {
                Some(iter) => iter.into_u32().collect(),
                // No index buffer — generate sequential indices from face count.
                None => (0..vertices_flat.len() as u32 / 3).collect(),
            };

            return build_bvh_buffer(&vertices_flat, &indices_flat);
        }
    }

    Err(format!(
        "No valid triangle mesh found in GLB{}",
        mesh_name
            .map(|n| format!(" (looking for '{n}')"))
            .unwrap_or_default()
    ))
}

// ─── helpers ─────────────────────────────────────────────────────────────────

/// Prepend the GBVH file header to serialised BVH bytes and return the
/// combined buffer.
///
/// Header layout:
/// `[0..4]  b"GBVH"                      — magic`
/// `[4..6]  RAPIER_VERSION major u16 LE — rapier major`
/// `[6..8]  RAPIER_VERSION minor u16 LE — rapier minor`
/// `[8..]   bincode data`
fn write_gbvh_header(bvh_bytes: Vec<u8>) -> Vec<u8> {
    let mut out = Vec::with_capacity(8 + bvh_bytes.len());
    out.extend_from_slice(b"GBVH");
    out.extend_from_slice(&crate::physics3d::RAPIER_VERSION.0.to_le_bytes());
    out.extend_from_slice(&crate::physics3d::RAPIER_VERSION.1.to_le_bytes());
    out.extend_from_slice(&bvh_bytes);
    out
}
