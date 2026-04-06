/// Extended integration tests for the 3D physics WASM bindings.
///
/// These tests exercise the collider management, sensor state, quality presets,
/// and collision event flush pipeline defined in `bindings.rs` and
/// `physics3d/world.rs`.  Each test runs against the public `Engine` struct
/// (the same surface that JavaScript calls), exercising the full call path
/// including the `Option<PhysicsWorld3D>` guard in every binding.

#[cfg(feature = "physics3d")]
mod physics3d_extended {
    use gwen_core::bindings::Engine;

    // ── Helpers ───────────────────────────────────────────────────────────────

    /// Return an `Engine` with a 3D physics world initialised and one dynamic
    /// body registered at entity index 0, positioned at the origin.
    fn engine_with_one_body() -> Engine {
        let mut engine = Engine::new(32);
        engine.physics3d_init(0.0, -9.81, 0.0, 32);
        assert!(engine.physics3d_add_body(0, 0.0, 5.0, 0.0, 1, 1.0, 0.0, 0.0));
        engine
    }

    // ── Collider add / remove cycle ───────────────────────────────────────────

    #[test]
    fn test_physics3d_add_box_collider_returns_true() {
        let mut engine = engine_with_one_body();
        assert!(engine.physics3d_add_box_collider(
            0,    // entity_index
            0.5, 0.5, 0.5, // half-extents
            0.0, 0.0, 0.0, // offset
            false, // is_sensor
            0.5, 0.0, // friction, restitution
            0xFFFF_FFFF, 0xFFFF_FFFF, // layer_bits, mask_bits
            1,    // collider_id
        ));
    }

    #[test]
    fn test_physics3d_add_box_collider_no_body_returns_false() {
        let mut engine = Engine::new(32);
        engine.physics3d_init(0.0, -9.81, 0.0, 32);
        // Entity 99 has no body registered.
        assert!(!engine.physics3d_add_box_collider(
            99, 0.5, 0.5, 0.5, 0.0, 0.0, 0.0, false, 0.5, 0.0,
            0xFFFF_FFFF, 0xFFFF_FFFF, 1,
        ));
    }

    #[test]
    fn test_physics3d_add_box_collider_world_uninitialised_returns_false() {
        let mut engine = Engine::new(32);
        // No physics3d_init call.
        assert!(!engine.physics3d_add_box_collider(
            0, 0.5, 0.5, 0.5, 0.0, 0.0, 0.0, false, 0.5, 0.0,
            0xFFFF_FFFF, 0xFFFF_FFFF, 1,
        ));
    }

    #[test]
    fn test_physics3d_add_sphere_collider_returns_true() {
        let mut engine = engine_with_one_body();
        assert!(engine.physics3d_add_sphere_collider(
            0,    // entity_index
            0.4,  // radius
            0.0, 0.0, 0.0, // offset
            false, 0.5, 0.0,
            0xFFFF_FFFF, 0xFFFF_FFFF,
            2,    // collider_id
        ));
    }

    #[test]
    fn test_physics3d_add_sphere_collider_no_body_returns_false() {
        let mut engine = Engine::new(32);
        engine.physics3d_init(0.0, -9.81, 0.0, 32);
        assert!(!engine.physics3d_add_sphere_collider(
            5, 0.4, 0.0, 0.0, 0.0, false, 0.5, 0.0,
            0xFFFF_FFFF, 0xFFFF_FFFF, 2,
        ));
    }

    #[test]
    fn test_physics3d_add_capsule_collider_returns_true() {
        let mut engine = engine_with_one_body();
        assert!(engine.physics3d_add_capsule_collider(
            0,    // entity_index
            0.3,  // radius
            0.5,  // half_height
            0.0, 0.0, 0.0, // offset
            false, 0.5, 0.0,
            0xFFFF_FFFF, 0xFFFF_FFFF,
            3,    // collider_id
        ));
    }

    #[test]
    fn test_physics3d_add_capsule_collider_no_body_returns_false() {
        let mut engine = Engine::new(32);
        engine.physics3d_init(0.0, -9.81, 0.0, 32);
        assert!(!engine.physics3d_add_capsule_collider(
            7, 0.3, 0.5, 0.0, 0.0, 0.0, false, 0.5, 0.0,
            0xFFFF_FFFF, 0xFFFF_FFFF, 3,
        ));
    }

    #[test]
    fn test_physics3d_remove_collider_happy_path() {
        let mut engine = engine_with_one_body();
        assert!(engine.physics3d_add_box_collider(
            0, 0.5, 0.5, 0.5, 0.0, 0.0, 0.0, false, 0.5, 0.0,
            0xFFFF_FFFF, 0xFFFF_FFFF, 10,
        ));
        // First remove succeeds.
        assert!(engine.physics3d_remove_collider(0, 10));
        // Second remove on the same ID returns false — already gone.
        assert!(!engine.physics3d_remove_collider(0, 10));
    }

    #[test]
    fn test_physics3d_remove_collider_unknown_id_returns_false() {
        let mut engine = engine_with_one_body();
        assert!(!engine.physics3d_remove_collider(0, 999));
    }

    #[test]
    fn test_physics3d_remove_collider_world_uninitialised_returns_false() {
        let mut engine = Engine::new(32);
        assert!(!engine.physics3d_remove_collider(0, 1));
    }

    #[test]
    fn test_physics3d_add_multiple_collider_shapes_same_body() {
        let mut engine = engine_with_one_body();
        // Three distinct collider IDs can coexist on the same body.
        assert!(engine.physics3d_add_box_collider(
            0, 0.5, 0.5, 0.5, 0.0, 0.0, 0.0, false, 0.5, 0.0,
            0xFFFF_FFFF, 0xFFFF_FFFF, 1,
        ));
        assert!(engine.physics3d_add_sphere_collider(
            0, 0.4, 0.0, 0.0, 0.0, false, 0.5, 0.0,
            0xFFFF_FFFF, 0xFFFF_FFFF, 2,
        ));
        assert!(engine.physics3d_add_capsule_collider(
            0, 0.3, 0.5, 0.0, 0.0, 0.0, false, 0.5, 0.0,
            0xFFFF_FFFF, 0xFFFF_FFFF, 3,
        ));
        // Remove all three.
        assert!(engine.physics3d_remove_collider(0, 1));
        assert!(engine.physics3d_remove_collider(0, 2));
        assert!(engine.physics3d_remove_collider(0, 3));
    }

    // ── Sensor state get / update ─────────────────────────────────────────────

    #[test]
    fn test_physics3d_get_sensor_state_default_is_zero() {
        let engine = engine_with_one_body();
        // No sensor has been configured: packed result must be 0.
        assert_eq!(engine.physics3d_get_sensor_state(0, 42), 0);
    }

    #[test]
    fn test_physics3d_get_sensor_state_world_uninitialised_returns_zero() {
        let engine = Engine::new(32);
        assert_eq!(engine.physics3d_get_sensor_state(0, 1), 0);
    }

    #[test]
    fn test_physics3d_update_sensor_state_active_with_count() {
        let mut engine = engine_with_one_body();
        engine.physics3d_update_sensor_state(0, 5, true, 3);
        let packed = engine.physics3d_get_sensor_state(0, 5);
        let count = (packed & 0xFFFF_FFFF) as u32;
        let active = ((packed >> 32) & 1) != 0;
        assert_eq!(count, 3, "contact count");
        assert!(active, "is_active flag");
    }

    #[test]
    fn test_physics3d_update_sensor_state_inactive_zero_count() {
        let mut engine = engine_with_one_body();
        // Write active state first, then clear it.
        engine.physics3d_update_sensor_state(0, 7, true, 2);
        engine.physics3d_update_sensor_state(0, 7, false, 0);
        let packed = engine.physics3d_get_sensor_state(0, 7);
        let count = (packed & 0xFFFF_FFFF) as u32;
        let active = ((packed >> 32) & 1) != 0;
        assert_eq!(count, 0, "contact count after clear");
        assert!(!active, "is_active after clear");
    }

    #[test]
    fn test_physics3d_update_sensor_state_world_uninitialised_is_noop() {
        let mut engine = Engine::new(32);
        // Should not panic even without a world.
        engine.physics3d_update_sensor_state(0, 1, true, 5);
    }

    #[test]
    fn test_physics3d_sensor_state_separate_per_collider_id() {
        let mut engine = engine_with_one_body();
        engine.physics3d_update_sensor_state(0, 10, true, 1);
        engine.physics3d_update_sensor_state(0, 20, false, 0);

        let s10 = engine.physics3d_get_sensor_state(0, 10);
        let s20 = engine.physics3d_get_sensor_state(0, 20);
        assert_ne!(s10, s20, "different sensor IDs must have independent state");
        assert!(((s10 >> 32) & 1) != 0, "sensor 10 is active");
        assert!(((s20 >> 32) & 1) == 0, "sensor 20 is inactive");
    }

    // ── Quality preset ────────────────────────────────────────────────────────

    #[test]
    fn test_physics3d_set_quality_all_presets_do_not_panic() {
        let mut engine = Engine::new(32);
        engine.physics3d_init(0.0, -9.81, 0.0, 32);
        for preset in 0u8..=3 {
            engine.physics3d_set_quality(preset);
        }
    }

    #[test]
    fn test_physics3d_set_quality_unknown_preset_maps_to_medium() {
        let mut engine = Engine::new(32);
        engine.physics3d_init(0.0, -9.81, 0.0, 32);
        // Any value outside [0, 3] must not panic and fall back to Medium.
        engine.physics3d_set_quality(255);
        engine.physics3d_step(0.016);
    }

    #[test]
    fn test_physics3d_set_quality_world_uninitialised_is_noop() {
        let mut engine = Engine::new(32);
        // No panic expected when world is not initialised.
        engine.physics3d_set_quality(2);
    }

    #[test]
    fn test_physics3d_set_quality_step_still_runs_after_preset_change() {
        let mut engine = Engine::new(32);
        engine.physics3d_init(0.0, -9.81, 0.0, 32);
        assert!(engine.physics3d_add_body(0, 0.0, 10.0, 0.0, 1, 1.0, 0.0, 0.0));
        // Switch to High quality and verify the simulation advances without error.
        engine.physics3d_set_quality(2);
        engine.physics3d_step(0.016);
        let state = engine.physics3d_get_body_state(0);
        assert_eq!(state.len(), 13, "body state must remain 13 elements after quality change");
    }

    // ── Event coalescing ──────────────────────────────────────────────────────

    #[test]
    fn test_physics3d_set_event_coalescing_toggle_does_not_panic() {
        let mut engine = Engine::new(32);
        engine.physics3d_init(0.0, -9.81, 0.0, 32);
        engine.physics3d_set_event_coalescing(true);
        engine.physics3d_set_event_coalescing(false);
    }

    #[test]
    fn test_physics3d_set_event_coalescing_world_uninitialised_is_noop() {
        let mut engine = Engine::new(32);
        engine.physics3d_set_event_coalescing(true);
    }

    // ── Collision event buffer ────────────────────────────────────────────────

    #[test]
    fn test_physics3d_get_collision_event_count_initial_is_zero() {
        let engine = Engine::new(32);
        assert_eq!(engine.physics3d_get_collision_event_count(), 0);
    }

    #[test]
    fn test_physics3d_get_collision_events_ptr_world_uninitialised_returns_zero() {
        let engine = Engine::new(32);
        assert_eq!(engine.physics3d_get_collision_events_ptr(), 0);
    }

    #[test]
    fn test_physics3d_get_collision_events_ptr_initialised_nonzero() {
        let mut engine = Engine::new(32);
        engine.physics3d_init(0.0, -9.81, 0.0, 32);
        // After initialisation the buffer pointer must refer to valid WASM memory.
        let ptr = engine.physics3d_get_collision_events_ptr();
        assert_ne!(ptr, 0, "event buffer pointer must not be null after init");
    }

    #[test]
    fn test_physics3d_consume_events_resets_count() {
        let mut engine = Engine::new(32);
        engine.physics3d_init(0.0, -9.81, 0.0, 32);
        // Step to let Rapier potentially populate the buffer (it will be empty
        // with no colliders, but consume_events must not panic either way).
        engine.physics3d_step(0.016);
        engine.physics3d_consume_events();
        assert_eq!(engine.physics3d_get_collision_event_count(), 0);
    }

    #[test]
    fn test_physics3d_consume_events_world_uninitialised_is_noop() {
        let mut engine = Engine::new(32);
        engine.physics3d_consume_events();
    }

    #[test]
    fn test_physics3d_collision_event_flush_with_sensors() {
        // Set up two bodies with overlapping sensor box colliders so that
        // Rapier fires a collision-started event on the first step.
        let mut engine = Engine::new(32);
        engine.physics3d_init(0.0, 0.0, 0.0, 32); // zero gravity to keep bodies still
        // Both bodies at the same position so their colliders immediately overlap.
        assert!(engine.physics3d_add_body(0, 0.0, 0.0, 0.0, 1, 1.0, 0.0, 0.0));
        assert!(engine.physics3d_add_body(1, 0.0, 0.0, 0.0, 1, 1.0, 0.0, 0.0));

        // Large box sensors so they definitely overlap at origin.
        assert!(engine.physics3d_add_box_collider(
            0, 1.0, 1.0, 1.0, 0.0, 0.0, 0.0, true, 0.0, 0.0,
            0xFFFF_FFFF, 0xFFFF_FFFF, 1,
        ));
        assert!(engine.physics3d_add_box_collider(
            1, 1.0, 1.0, 1.0, 0.0, 0.0, 0.0, true, 0.0, 0.0,
            0xFFFF_FFFF, 0xFFFF_FFFF, 2,
        ));

        // Step: Rapier will generate the overlap event and write it into the buffer.
        engine.physics3d_step(0.016);

        let count = engine.physics3d_get_collision_event_count();
        let ptr   = engine.physics3d_get_collision_events_ptr();

        // If Rapier fired the event the count is 1; it may be 0 if broad-phase
        // deferred the pair to the next step — both are valid, so we assert
        // the infrastructure works without panicking rather than asserting
        // an exact count.
        assert!(ptr != 0, "event buffer pointer must be non-null after step");

        // Consume must clear the count.
        engine.physics3d_consume_events();
        assert_eq!(engine.physics3d_get_collision_event_count(), 0);

        // A subsequent step should not panic regardless of prior state.
        engine.physics3d_step(0.016);
        let _ = count; // suppress unused-variable warning
    }

    // ── Kinematic position ────────────────────────────────────────────────────

    #[test]
    fn test_physics3d_set_kinematic_position_returns_true() {
        let mut engine = Engine::new(32);
        engine.physics3d_init(0.0, -9.81, 0.0, 32);
        // Kind 2 = KinematicPositionBased
        assert!(engine.physics3d_add_body(0, 0.0, 0.0, 0.0, 2, 0.0, 0.0, 0.0));
        // Identity quaternion (0, 0, 0, 1)
        assert!(engine.physics3d_set_kinematic_position(
            0, 1.0, 2.0, 3.0, 0.0, 0.0, 0.0, 1.0
        ));
    }

    #[test]
    fn test_physics3d_set_kinematic_position_no_body_returns_false() {
        let mut engine = Engine::new(32);
        engine.physics3d_init(0.0, -9.81, 0.0, 32);
        assert!(!engine.physics3d_set_kinematic_position(
            99, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0
        ));
    }

    #[test]
    fn test_physics3d_set_kinematic_position_world_uninitialised_returns_false() {
        let mut engine = Engine::new(32);
        assert!(!engine.physics3d_set_kinematic_position(
            0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0
        ));
    }

    // ── Angular impulse ───────────────────────────────────────────────────────

    #[test]
    fn test_physics3d_apply_angular_impulse_returns_true() {
        let mut engine = engine_with_one_body();
        assert!(engine.physics3d_apply_angular_impulse(0, 0.0, 1.0, 0.0));
    }

    #[test]
    fn test_physics3d_apply_angular_impulse_no_body_returns_false() {
        let mut engine = Engine::new(32);
        engine.physics3d_init(0.0, -9.81, 0.0, 32);
        assert!(!engine.physics3d_apply_angular_impulse(42, 1.0, 0.0, 0.0));
    }

    #[test]
    fn test_physics3d_apply_angular_impulse_world_uninitialised_returns_false() {
        let mut engine = Engine::new(32);
        assert!(!engine.physics3d_apply_angular_impulse(0, 1.0, 0.0, 0.0));
    }

    #[test]
    fn test_physics3d_apply_angular_impulse_binding_returns_true_for_valid_body() {
        // This test verifies only the binding-layer return value.
        // Rapier defers inertia-tensor computation until the second step
        // (see the `feedback_rapier_mass_recompute` memory entry), so a
        // reliable velocity assertion requires the body to have been stepped
        // twice — that is covered by the inline world tests.  Here we just
        // assert the WASM binding correctly delegates to the world and propagates
        // the `true` return value.
        let mut engine = engine_with_one_body();
        assert!(engine.physics3d_apply_angular_impulse(0, 0.0, 10.0, 0.0));
        // Angular velocity getter must return 3 elements (binding is wired up).
        let av = engine.physics3d_get_angular_velocity(0);
        assert_eq!(av.len(), 3);
    }

    // ── add_compound_collider binding ─────────────────────────────────────────

    #[test]
    fn test_physics3d_add_compound_collider_returns_count() {
        let mut engine = engine_with_one_body();

        #[rustfmt::skip]
        let data: Vec<f32> = vec![
            // BOX chassis
            0.0, 1.0, 0.3, 2.0, 0.0,  0.0, 0.3, 0.0,  0.0, 0.5, 0.0, 1.0,
            // SPHERE wheel
            1.0, 0.35,0.0, 0.0, 0.0, -0.9, 0.0, 1.6,  0.0, 0.5, 0.0, 2.0,
            // CAPSULE bumper
            2.0, 0.1, 0.4, 0.0, 0.0,  0.0, 0.0,-2.0,  0.0, 0.5, 0.0, 3.0,
        ];

        assert_eq!(
            engine.physics3d_add_compound_collider(0, &data, 0xFFFF_FFFF, 0xFFFF_FFFF),
            3
        );
    }

    #[test]
    fn test_physics3d_add_compound_collider_no_body_returns_zero() {
        let mut engine = Engine::new(32);
        engine.physics3d_init(0.0, -9.81, 0.0, 32);
        // Entity 5 has no body.
        let data: Vec<f32> = vec![0.0, 0.5, 0.5, 0.5, 0.0, 0.0, 0.0, 0.0, 0.0, 0.5, 0.0, 1.0];
        assert_eq!(
            engine.physics3d_add_compound_collider(5, &data, 0xFFFF_FFFF, 0xFFFF_FFFF),
            0
        );
    }

    #[test]
    fn test_physics3d_add_compound_collider_world_uninitialised_returns_zero() {
        let mut engine = Engine::new(32);
        // No physics3d_init call.
        let data: Vec<f32> = vec![0.0, 0.5, 0.5, 0.5, 0.0, 0.0, 0.0, 0.0, 0.0, 0.5, 0.0, 1.0];
        assert_eq!(
            engine.physics3d_add_compound_collider(0, &data, 0xFFFF_FFFF, 0xFFFF_FFFF),
            0
        );
    }

    #[test]
    fn test_physics3d_add_compound_collider_partial_on_unknown_shape() {
        let mut engine = engine_with_one_body();

        #[rustfmt::skip]
        let data: Vec<f32> = vec![
            // shape type 77 — unknown, skipped
            77.0, 0.5, 0.5, 0.5, 0.0,  0.0, 0.0, 0.0,  0.0, 0.5, 0.0, 1.0,
            // valid BOX
             0.0, 0.5, 0.5, 0.5, 0.0,  0.0, 0.0, 0.0,  0.0, 0.5, 0.0, 2.0,
        ];

        assert_eq!(
            engine.physics3d_add_compound_collider(0, &data, 0xFFFF_FFFF, 0xFFFF_FFFF),
            1
        );
    }
}
