// crates/gwen-core/tests/build_tools_test.rs
#[cfg(feature = "build-tools")]
mod build_tools_tests {
    use gwen_core::build_tools::{build_bvh_buffer, build_bvh_from_glb};

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
        let buf = build_bvh_buffer(&vertices, &indices);

        assert!(buf.len() > 8, "buffer should have header + bincode data");
        assert_eq!(&buf[0..4], b"GBVH", "header magic should be GBVH");
        let major = u16::from_le_bytes([buf[4], buf[5]]);
        let minor = u16::from_le_bytes([buf[6], buf[7]]);
        assert_eq!(major, 0, "rapier major should be 0");
        assert_eq!(minor, 22, "rapier minor should be 22");
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
        let buf = build_bvh_buffer(&vertices, &indices);

        let payload = &buf[8..];
        let (trimesh, _): (TriMesh, _) =
            bincode::serde::decode_from_slice(payload, bincode::config::standard()).unwrap();
        assert_eq!(trimesh.vertices().len(), 3);
        assert_eq!(trimesh.indices().len(), 1);
    }

    #[test]
    fn test_build_bvh_from_glb_invalid_bytes() {
        let result = build_bvh_from_glb(&[0xFF, 0xFE, 0x00], None);
        assert!(result.is_err(), "should fail on invalid GLB bytes");
    }
}
