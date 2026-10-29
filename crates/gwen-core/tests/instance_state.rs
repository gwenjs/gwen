//! Each engine keeps the path buffer it reads.
//!
//! `physics2d` and `physics3d` cannot be enabled together (`Cargo.toml:41`).
//! `cargo test -p gwen-core --features physics2d --test instance_state` runs the 2d test.
//! `cargo test -p gwen-core --features physics3d --test instance_state` runs the 3d test.

#[cfg(feature = "physics2d")]
mod physics2d {
    use gwen_core::bindings::Engine;
    use gwen_core::CoreError;

    #[test]
    fn two_engines_keep_their_own_2d_path_buffer() -> Result<(), CoreError> {
        let mut first = Engine::new(8)?;
        let second = Engine::new(8)?;
        assert_eq!(first.path_find_2d(0.0, 0.0, 5.0, 0.0), Ok(6));
        assert_ne!(first.path_get_result_ptr(), second.path_get_result_ptr());
        let ptr = second.path_get_result_ptr();
        // SAFETY: the 2d path buffer holds 256 `PathNode`s (`pathfinding.rs:11`), 512 f32s.
        // Twelve floats are the six waypoints of `(0, 0)` to `(5, 0)` and sit inside it.
        let floats = unsafe { std::slice::from_raw_parts(ptr, 12) };
        assert_eq!(floats, &[0.0; 12]);
        Ok(())
    }
}

#[cfg(feature = "physics3d")]
mod physics3d {
    use std::fmt::Debug;

    use gwen_core::bindings::Engine;
    use gwen_core::CoreError;

    /// Pointer from the export as it is today (`u32`) and after it returns `Result`.
    trait AsPathPtr {
        fn into_path_ptr(self) -> u32;
    }

    impl AsPathPtr for u32 {
        fn into_path_ptr(self) -> u32 {
            self
        }
    }

    impl<E: Debug> AsPathPtr for Result<u32, E> {
        #[allow(clippy::panic, reason = "a refused path pointer fails the test")]
        fn into_path_ptr(self) -> u32 {
            match self {
                Ok(ptr) => ptr,
                Err(err) => panic!("path pointer refused: {err:?}"),
            }
        }
    }

    #[test]
    fn two_engines_keep_their_own_3d_path_buffer() -> Result<(), CoreError> {
        let mut first = Engine::new(8)?;
        let mut second = Engine::new(8)?;
        first.physics3d_init(0.0, 0.0, 0.0, 8);
        second.physics3d_init(0.0, 0.0, 0.0, 8);
        assert_ne!(
            first.physics3d_get_path_buffer_ptr_3d().into_path_ptr(),
            second.physics3d_get_path_buffer_ptr_3d().into_path_ptr(),
        );
        Ok(())
    }
}
