#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::unreachable,
    clippy::todo,
    clippy::unimplemented,
    reason = "test-only code"
)]
// crates/gwen-core/tests/build_tools_test.rs
#[cfg(feature = "build-tools")]
mod build_tools_tests {
    use gwen_core::build_tools::{build_bvh_buffer, build_bvh_from_glb};
    use gwen_core::physics3d::RAPIER_VERSION;

    fn must_ok<T, E>(result: Result<T, E>) -> T {
        match result {
            Ok(value) => value,
            Err(_) => unreachable!(),
        }
    }

    #[test]
    fn test_build_bvh_buffer_valid() {
        #[rustfmt::skip]
        let vertices: Vec<f32> = vec![
            0.0, 0.0, 0.0,
            1.0, 0.0, 0.0,
            0.0, 1.0, 0.0,
            1.0, 1.0, 0.0,
        ];
        let indices: Vec<u32> = vec![0, 1, 2, 1, 3, 2];
        let buf = valid_bvh(&vertices, &indices);

        assert!(buf.len() > 8, "buffer should have header + bincode data");
        assert_eq!(&buf[0..4], b"GBVH", "header magic should be GBVH");
        let major = u16::from_le_bytes([buf[4], buf[5]]);
        let minor = u16::from_le_bytes([buf[6], buf[7]]);
        assert_eq!((major, minor), RAPIER_VERSION);
    }

    #[test]
    fn a_baked_buffer_is_accepted_by_the_physics3d_loader() {
        use gwen_core::bindings::Engine;

        #[rustfmt::skip]
        let vertices: Vec<f32> = vec![
            0.0, 0.0, 0.0,
            1.0, 0.0, 0.0,
            0.0, 1.0, 0.0,
        ];
        let indices = [0u32, 1, 2];
        let buf = valid_bvh(&vertices, &indices);
        let mut engine = must_ok(Engine::new(4));
        engine.physics3d_init(0.0, -9.81, 0.0, 4);
        assert_eq!(
            engine.physics3d_add_body(0, 0.0, 0.0, 0.0, 0, 1.0, 0.0, 0.0),
            Ok(true)
        );
        assert_eq!(
            engine.physics3d_load_bvh_collider(
                0,
                &buf,
                0.0,
                0.0,
                0.0,
                false,
                0.5,
                0.0,
                u32::MAX,
                u32::MAX,
                1,
            ),
            Ok(true)
        );
    }

    #[test]
    fn test_build_bvh_buffer_roundtrip() {
        use rapier3d::geometry::TriMesh;

        #[rustfmt::skip]
        let vertices: Vec<f32> = vec![
            0.0, 0.0, 0.0,
            1.0, 0.0, 0.0,
            0.0, 1.0, 0.0,
        ];
        let indices: Vec<u32> = vec![0, 1, 2];
        let buf = valid_bvh(&vertices, &indices);

        let payload = &buf[8..];
        let (trimesh, _): (TriMesh, _) =
            bincode::serde::decode_from_slice(payload, bincode::config::standard()).unwrap();
        assert_eq!(trimesh.vertices().len(), 3);
        assert_eq!(trimesh.indices().len(), 1);
    }

    trait BvhOutcome {
        fn error_text(self) -> String;
    }

    impl BvhOutcome for Vec<u8> {
        fn error_text(self) -> String {
            format!("produced {} bytes", self.len())
        }
    }

    impl BvhOutcome for Result<Vec<u8>, String> {
        fn error_text(self) -> String {
            match self {
                Ok(buf) => format!("produced {} bytes", buf.len()),
                Err(message) => message,
            }
        }
    }

    fn valid_bvh(vertices: &[f32], indices: &[u32]) -> Vec<u8> {
        match build_bvh_buffer(vertices, indices) {
            Ok(buf) => buf,
            Err(message) => {
                assert_eq!(message, "");
                Vec::new()
            }
        }
    }

    fn bvh_failure_text(vertices: &[f32], indices: &[u32]) -> String {
        match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            build_bvh_buffer(vertices, indices).error_text()
        })) {
            Ok(text) => text,
            Err(_) => "panic".to_string(),
        }
    }

    #[test]
    fn test_build_bvh_buffer_bad_vertex_length_returns_err() {
        let text = bvh_failure_text(&[1.0], &[0, 1, 2]);
        assert_eq!(text, "vertices_flat length must be a multiple of 3");
    }

    #[test]
    fn test_build_bvh_buffer_bad_index_length_returns_err() {
        let text = bvh_failure_text(&[0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0], &[0]);
        assert_eq!(text, "indices_flat length must be a multiple of 3");
    }

    #[test]
    fn test_build_bvh_buffer_empty_inputs_returns_err() {
        let text = bvh_failure_text(&[], &[]);
        assert_eq!(text, "indices_flat must contain at least one triangle");
    }

    #[test]
    fn test_build_bvh_buffer_empty_indices_returns_err() {
        let vertices = [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0];
        let text = bvh_failure_text(&vertices, &[]);
        assert_eq!(text, "indices_flat must contain at least one triangle");
    }

    #[test]
    fn test_build_bvh_buffer_index_past_vertex_count_returns_err() {
        let vertices = [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0];
        let text = bvh_failure_text(&vertices, &[0, 1, 7]);
        assert_eq!(text, "index 7 is outside the vertex count 3");
    }

    #[test]
    fn test_build_bvh_from_glb_invalid_bytes() {
        let result = build_bvh_from_glb(&[0xFF, 0xFE, 0x00], None);
        assert!(result.is_err(), "should fail on invalid GLB bytes");
    }
}
