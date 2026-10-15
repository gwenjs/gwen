//! Observable physics3d character controller and joint export behaviour.
//!
//! Native only. Run with `--features physics3d`. Exports are reached through the public `Engine`
//! methods that JavaScript calls. Pool and registry state, which `Engine` does not expose, is
//! checked on a bare `PhysicsWorld3D`. A refused call is checked against a twin world that never
//! saw the call: after the same steps both must end bit for bit identical.

#![cfg(feature = "physics3d")]

use gwen_core::bindings::Engine;
use gwen_core::physics3d::world::MAX_CC_ENTITIES;
use gwen_core::physics3d::{
    InvalidColliderReason, InvalidJointReason, Physics3DError, PhysicsWorld3D,
};

const ALL: u32 = 0xFFFF_FFFF;
const NAN: f32 = f32::NAN;
const INF: f32 = f32::INFINITY;

type Outcome = Result<(), Physics3DError>;

fn invalid_collider(reason: InvalidColliderReason) -> Physics3DError {
    Physics3DError::InvalidCollider { reason }
}

/// Slot 0 is a static floor, slot 1 a kinematic character with a box collider above it, slots 2
/// and 3 two dynamic balls, slot 4 a kinematic body without collider.
fn scene() -> Result<Engine, Physics3DError> {
    let mut e = Engine::new(16).map_err(Physics3DError::Core)?;
    e.physics3d_init(0.0, -9.81, 0.0, 16);
    e.physics3d_add_body(0, 0.0, -0.5, 0.0, 0, 1.0, 0.0, 0.0)?;
    e.physics3d_add_box_collider(
        0, 20.0, 0.5, 20.0, 0.0, 0.0, 0.0, false, 0.5, 0.0, ALL, ALL, 1,
    )?;
    e.physics3d_add_body(1, 0.0, 3.0, 0.0, 2, 1.0, 0.0, 0.0)?;
    e.physics3d_add_box_collider(
        1, 0.5, 0.5, 0.5, 0.0, 0.0, 0.0, false, 0.5, 0.0, ALL, ALL, 2,
    )?;
    e.physics3d_add_body(2, 6.0, 3.0, 0.0, 1, 1.0, 0.0, 0.0)?;
    e.physics3d_add_sphere_collider(2, 0.5, 0.0, 0.0, 0.0, false, 0.5, 0.0, ALL, ALL, 3)?;
    e.physics3d_add_body(3, 7.0, 3.0, 0.0, 1, 1.0, 0.0, 0.0)?;
    e.physics3d_add_sphere_collider(3, 0.5, 0.0, 0.0, 0.0, false, 0.5, 0.0, ALL, ALL, 4)?;
    e.physics3d_add_body(4, -6.0, 3.0, 0.0, 2, 1.0, 0.0, 0.0)?;
    Ok(e)
}

/// Steps 60 frames, then returns the bit pattern of every body state.
fn fingerprint(e: &mut Engine) -> Result<Vec<u32>, Physics3DError> {
    for _ in 0..60 {
        e.physics3d_step(0.016)?;
    }
    let mut bits = Vec::new();
    for slot in 0..=6 {
        bits.push(slot);
        bits.extend(
            e.physics3d_get_body_state(slot)?
                .iter()
                .map(|v| v.to_bits()),
        );
    }
    Ok(bits)
}

/// Runs `op` on one scene and nothing on a twin, then compares both after the same steps.
fn refused(expected: Physics3DError, op: impl FnOnce(&mut Engine) -> Outcome) -> Outcome {
    let mut touched = scene()?;
    let mut untouched = scene()?;
    assert_eq!(op(&mut touched), Err(expected));
    assert_eq!(fingerprint(&mut touched)?, fingerprint(&mut untouched)?);
    Ok(())
}

fn add_cc(e: &mut Engine, slot: u32) -> Result<u32, Physics3DError> {
    e.physics3d_add_character_controller(slot, 0.35, 45.0, 0.02, 0.2, true, true)
}

/// A bare world with `count` kinematic bodies on slots `0..count`.
fn world_with_bodies(count: u32) -> PhysicsWorld3D {
    let mut world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
    for slot in 0..count {
        world.add_body(slot, slot as f32, 3.0, 0.0, 2, 1.0, 0.0, 0.0);
    }
    world
}

fn world_add_cc(world: &mut PhysicsWorld3D, slot: u32) -> Result<u32, Physics3DError> {
    world.add_character_controller(slot, 0.35, 45.0, 0.02, 0.2, true, true)
}

// --- character controller: add ---

#[test]
fn add_character_controller_returns_compact_slots_in_order() -> Outcome {
    let mut world = world_with_bodies(3);
    assert_eq!(world_add_cc(&mut world, 2), Ok(0));
    assert_eq!(world_add_cc(&mut world, 0), Ok(1));
    assert_eq!(world_add_cc(&mut world, 1), Ok(2));
    assert_eq!(world.character_controller_count(), 3);
    Ok(())
}

#[test]
fn add_character_controller_twice_for_one_entity_reuses_its_slot() -> Outcome {
    let mut world = world_with_bodies(3);
    assert_eq!(world_add_cc(&mut world, 0), Ok(0));
    assert_eq!(world_add_cc(&mut world, 0), Ok(0));
    assert_eq!(world.character_controller_count(), 1);
    // The next entity gets slot 1, not slot 2: the second call did not take a slot.
    assert_eq!(world_add_cc(&mut world, 1), Ok(1));
    assert_eq!(world.character_controller_count(), 2);
    Ok(())
}

#[test]
fn add_character_controller_without_a_world_returns_not_initialized() -> Outcome {
    let mut e = Engine::new(4).map_err(Physics3DError::Core)?;
    assert_eq!(add_cc(&mut e, 0), Err(Physics3DError::WorldNotInitialized));
    Ok(())
}

#[test]
fn add_character_controller_on_a_missing_body_returns_body_not_found() -> Outcome {
    let mut world = world_with_bodies(1);
    assert_eq!(
        world_add_cc(&mut world, 99),
        Err(Physics3DError::BodyNotFound { slot: 99 })
    );
    assert_eq!(world.character_controller_count(), 0);
    refused(Physics3DError::BodyNotFound { slot: 99 }, |e| {
        add_cc(e, 99).map(|_| ())
    })
}

#[test]
fn full_pool_refuses_before_any_insert() -> Outcome {
    let max = MAX_CC_ENTITIES as u32;
    let mut world = world_with_bodies(max + 2);
    for slot in 0..max {
        assert_eq!(world_add_cc(&mut world, slot), Ok(slot));
    }
    assert_eq!(world.character_controller_count(), MAX_CC_ENTITIES);
    assert_eq!(
        world_add_cc(&mut world, max),
        Err(Physics3DError::CharacterControllerLimitReached { max })
    );
    assert_eq!(
        world_add_cc(&mut world, max + 1),
        Err(Physics3DError::CharacterControllerLimitReached { max })
    );
    // Nothing was inserted for the refused entities.
    assert_eq!(world.character_controller_count(), MAX_CC_ENTITIES);
    // Freeing one slot lets the next entity in, and it takes the freed slot.
    assert_eq!(world.remove_character_controller(5), Ok(()));
    assert_eq!(world.character_controller_count(), MAX_CC_ENTITIES - 1);
    assert_eq!(world_add_cc(&mut world, max), Ok(5));
    assert_eq!(world.character_controller_count(), MAX_CC_ENTITIES);
    Ok(())
}

#[test]
fn full_pool_still_accepts_a_second_add_for_a_registered_entity() -> Outcome {
    let max = MAX_CC_ENTITIES as u32;
    let mut world = world_with_bodies(max);
    for slot in 0..max {
        assert_eq!(world_add_cc(&mut world, slot), Ok(slot));
    }
    assert_eq!(world_add_cc(&mut world, 7), Ok(7));
    assert_eq!(world.character_controller_count(), MAX_CC_ENTITIES);
    Ok(())
}

#[test]
fn skin_width_that_rapier_asserts_on_is_refused_and_leaves_the_pool_alone() -> Outcome {
    let mut world = world_with_bodies(2);
    assert_eq!(world_add_cc(&mut world, 0), Ok(0));
    let cases = [
        (NAN, InvalidColliderReason::NonFinite),
        (-INF, InvalidColliderReason::Negative),
        (-1.0, InvalidColliderReason::Negative),
        (-f32::MIN_POSITIVE, InvalidColliderReason::Negative),
    ];
    for (skin, reason) in cases {
        for entity in [0, 1] {
            assert_eq!(
                world.add_character_controller(entity, 0.35, 45.0, skin, 0.2, true, true),
                Err(invalid_collider(reason)),
                "skin {skin} entity {entity}"
            );
        }
    }
    assert_eq!(world.character_controller_count(), 1);
    assert_eq!(world_add_cc(&mut world, 1), Ok(1));
    Ok(())
}

#[test]
fn skin_width_zero_and_tiny_are_accepted() -> Outcome {
    let mut world = world_with_bodies(3);
    for (entity, skin) in [(0, 0.0), (1, -0.0), (2, f32::MIN_POSITIVE)] {
        assert_eq!(
            world.add_character_controller(entity, 0.35, 45.0, skin, 0.2, true, true),
            Ok(entity)
        );
    }
    Ok(())
}

// --- character controller: move and remove ---

#[test]
fn move_without_a_world_returns_not_initialized() -> Outcome {
    let mut e = Engine::new(4).map_err(Physics3DError::Core)?;
    assert_eq!(
        e.physics3d_character_controller_move(0, 1.0, 0.0, 0.0, 0.016),
        Err(Physics3DError::WorldNotInitialized)
    );
    assert_eq!(
        e.physics3d_remove_character_controller(0),
        Err(Physics3DError::WorldNotInitialized)
    );
    Ok(())
}

#[test]
fn move_and_remove_on_a_slot_without_a_controller_return_not_found() -> Outcome {
    let missing = Physics3DError::CharacterControllerNotFound { slot: 1 };
    refused(missing, |e| {
        e.physics3d_character_controller_move(1, 1.0, 0.0, 0.0, 0.016)
    })?;
    refused(missing, |e| e.physics3d_remove_character_controller(1))
}

#[test]
fn move_on_a_controller_whose_body_was_removed_returns_body_not_found() -> Outcome {
    let mut touched = scene()?;
    let mut untouched = scene()?;
    add_cc(&mut touched, 1)?;
    add_cc(&mut untouched, 1)?;
    touched.physics3d_remove_body(1)?;
    untouched.physics3d_remove_body(1)?;
    assert_eq!(
        touched.physics3d_character_controller_move(1, 1.0, 0.0, 0.0, 0.016),
        Err(Physics3DError::BodyNotFound { slot: 1 })
    );
    assert_eq!(fingerprint(&mut touched)?, fingerprint(&mut untouched)?);
    Ok(())
}

/// Bit pattern of the first character-controller state slot of a bare world.
fn cc_slot_bits(world: &PhysicsWorld3D) -> [u32; 5] {
    let mut slot = [0f32; 5];
    // SAFETY: slot 0 is the first five floats of this world's character-controller state buffer,
    // which `cc_state_ptr` points at and which lives as long as `world`.
    unsafe {
        std::ptr::copy_nonoverlapping(world.cc_state_ptr(), slot.as_mut_ptr(), 5);
    }
    slot.map(f32::to_bits)
}

#[test]
fn removed_body_move_is_refused_and_leaves_the_slot() -> Outcome {
    let mut world = world_with_bodies(4);
    assert_eq!(world_add_cc(&mut world, 3), Ok(0));
    assert_eq!(u8::from(world.remove_body(3)), 1);
    let before = cc_slot_bits(&world);
    assert_eq!(
        world.character_controller_move(3, 0.0, -1.0, 0.0, 1.0 / 60.0),
        Err(Physics3DError::BodyNotFound { slot: 3 })
    );
    assert_eq!(cc_slot_bits(&world), before);
    Ok(())
}

#[test]
fn move_returns_ok_and_the_body_follows_the_requested_translation() -> Outcome {
    let mut e = scene()?;
    assert_eq!(add_cc(&mut e, 1), Ok(0));
    e.physics3d_step(0.016)?;
    let before = e.physics3d_get_body_state(1)?;
    assert_eq!(
        e.physics3d_character_controller_move(1, 0.0, -1.0, 0.0, 0.1),
        Ok(())
    );
    e.physics3d_step(0.016)?;
    let after = e.physics3d_get_body_state(1)?;
    // Kinematic bodies ignore gravity: only the controller moves this body, by 0.1 m down.
    assert_eq!(after[0], before[0]);
    assert_eq!(
        (after[1] * 1000.0).round(),
        ((before[1] - 0.1) * 1000.0).round()
    );
    Ok(())
}

#[test]
fn remove_returns_ok_once_then_not_found_and_frees_the_slot() -> Outcome {
    let mut world = world_with_bodies(3);
    assert_eq!(world_add_cc(&mut world, 0), Ok(0));
    assert_eq!(world_add_cc(&mut world, 1), Ok(1));
    assert_eq!(world.remove_character_controller(0), Ok(()));
    assert_eq!(
        world.remove_character_controller(0),
        Err(Physics3DError::CharacterControllerNotFound { slot: 0 })
    );
    assert_eq!(world.character_controller_count(), 1);
    assert_eq!(world_add_cc(&mut world, 2), Ok(0));
    Ok(())
}

// --- joints ---

/// One add call per joint kind on bodies `a` and `b`, anchors at the origin.
fn add_each_joint(e: &mut Engine, a: u32, b: u32) -> Vec<Result<u32, Physics3DError>> {
    vec![
        e.physics3d_add_fixed_joint(a, b, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0),
        e.physics3d_add_revolute_joint(
            a, b, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, false, 0.0, 0.0,
        ),
        e.physics3d_add_prismatic_joint(
            a, b, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, false, 0.0, 0.0,
        ),
        e.physics3d_add_ball_joint(a, b, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0),
        e.physics3d_add_spring_joint(a, b, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 100.0, 1.0),
    ]
}

#[test]
fn add_joint_returns_sequential_ids_for_every_kind() -> Outcome {
    let mut e = scene()?;
    assert_eq!(
        add_each_joint(&mut e, 2, 3),
        vec![Ok(0), Ok(1), Ok(2), Ok(3), Ok(4)]
    );
    Ok(())
}

#[test]
fn add_joint_without_a_world_returns_not_initialized() -> Outcome {
    let mut e = Engine::new(4).map_err(Physics3DError::Core)?;
    assert_eq!(
        add_each_joint(&mut e, 0, 1),
        vec![Err(Physics3DError::WorldNotInitialized); 5]
    );
    Ok(())
}

#[test]
fn add_joint_on_a_missing_body_returns_body_not_found_for_the_first_missing_end() -> Outcome {
    let mut e = scene()?;
    assert_eq!(
        add_each_joint(&mut e, 99, 3),
        vec![Err(Physics3DError::BodyNotFound { slot: 99 }); 5]
    );
    assert_eq!(
        add_each_joint(&mut e, 2, 98),
        vec![Err(Physics3DError::BodyNotFound { slot: 98 }); 5]
    );
    assert_eq!(
        add_each_joint(&mut e, 99, 98),
        vec![Err(Physics3DError::BodyNotFound { slot: 99 }); 5]
    );
    // A refusal does not consume a joint id.
    assert_eq!(
        e.physics3d_add_ball_joint(2, 3, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0),
        Ok(0)
    );
    Ok(())
}

#[test]
fn a_refused_joint_leaves_the_simulation_untouched() -> Outcome {
    refused(Physics3DError::BodyNotFound { slot: 99 }, |e| {
        e.physics3d_add_fixed_joint(2, 99, 0.0, 0.0, 0.0, 3.0, 0.0, 0.0)
            .map(|_| ())
    })
}

#[test]
fn an_accepted_joint_changes_the_simulation() -> Outcome {
    let mut with = scene()?;
    let mut without = scene()?;
    assert_eq!(
        with.physics3d_add_fixed_joint(2, 3, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0),
        Ok(0)
    );
    assert_ne!(fingerprint(&mut with)?, fingerprint(&mut without)?);
    Ok(())
}

#[test]
fn joint_operations_without_a_world_return_not_initialized() -> Outcome {
    let mut e = Engine::new(4).map_err(Physics3DError::Core)?;
    let not_init = Err(Physics3DError::WorldNotInitialized);
    assert_eq!(e.physics3d_remove_joint(0), not_init);
    assert_eq!(e.physics3d_set_joint_motor_velocity(0, 1.0, 1.0), not_init);
    assert_eq!(
        e.physics3d_set_joint_motor_position(0, 1.0, 1.0, 1.0),
        not_init
    );
    assert_eq!(e.physics3d_set_joint_enabled(0, true), not_init);
    Ok(())
}

#[test]
fn joint_operations_on_an_unknown_id_return_joint_not_found() -> Outcome {
    let unknown = Err(Physics3DError::JointNotFound { joint_id: 9999 });
    refused(Physics3DError::JointNotFound { joint_id: 9999 }, |e| {
        e.physics3d_remove_joint(9999).map(|_| ())
    })?;
    refused(Physics3DError::JointNotFound { joint_id: 9999 }, |e| {
        e.physics3d_set_joint_motor_velocity(9999, 1.0, 1.0)
            .map(|_| ())
    })?;
    refused(Physics3DError::JointNotFound { joint_id: 9999 }, |e| {
        e.physics3d_set_joint_motor_position(9999, 1.0, 1.0, 1.0)
            .map(|_| ())
    })?;
    refused(Physics3DError::JointNotFound { joint_id: 9999 }, |e| {
        e.physics3d_set_joint_enabled(9999, false).map(|_| ())
    })?;
    let mut e = scene()?;
    assert_eq!(e.physics3d_remove_joint(9999), unknown);
    Ok(())
}

#[test]
fn joint_operations_on_a_known_id_return_true() -> Outcome {
    let mut e = scene()?;
    let id = e.physics3d_add_revolute_joint(
        2, 3, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, false, 0.0, 0.0,
    )?;
    assert_eq!(
        e.physics3d_set_joint_motor_velocity(id, 1.0, 10.0),
        Ok(true)
    );
    assert_eq!(
        e.physics3d_set_joint_motor_position(id, 1.0, 10.0, 1.0),
        Ok(true)
    );
    assert_eq!(e.physics3d_set_joint_enabled(id, false), Ok(true));
    assert_eq!(e.physics3d_set_joint_enabled(id, true), Ok(true));
    assert_eq!(e.physics3d_remove_joint(id), Ok(true));
    assert_eq!(
        e.physics3d_remove_joint(id),
        Err(Physics3DError::JointNotFound { joint_id: id })
    );
    assert_eq!(
        e.physics3d_set_joint_enabled(id, true),
        Err(Physics3DError::JointNotFound { joint_id: id })
    );
    Ok(())
}

#[test]
fn removing_a_body_evicts_its_joints() -> Outcome {
    let mut e = scene()?;
    let id = e.physics3d_add_fixed_joint(2, 3, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0)?;
    e.physics3d_remove_body(2)?;
    assert_eq!(
        e.physics3d_remove_joint(id),
        Err(Physics3DError::JointNotFound { joint_id: id })
    );
    Ok(())
}

/// Both ends on one entity, with anchors that disagree: the solver gets an inconsistent
/// constraint. rapier3d-0.22.0 accepts it without a panic and keeps every state finite.
#[test]
fn a_joint_with_both_ends_on_one_entity_keeps_body_states_finite() -> Outcome {
    for kind in 0..5 {
        let mut e = scene()?;
        let added = match kind {
            0 => e.physics3d_add_fixed_joint(2, 2, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0),
            1 => e.physics3d_add_revolute_joint(
                2, 2, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, false, 0.0, 0.0,
            ),
            2 => e.physics3d_add_prismatic_joint(
                2, 2, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, false, 0.0, 0.0,
            ),
            3 => e.physics3d_add_ball_joint(2, 2, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0),
            _ => e.physics3d_add_spring_joint(2, 2, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 100.0, 1.0),
        };
        assert_eq!(added, Ok(0), "kind {kind}");
        let bits = fingerprint(&mut e)?;
        let non_finite: Vec<u32> = bits
            .into_iter()
            .filter(|b| !f32::from_bits(*b).is_finite())
            .collect();
        assert_eq!(non_finite, Vec::<u32>::new(), "kind {kind}");
    }
    Ok(())
}

// --- joints: non-finite values ---

const HOSTILE: [f32; 3] = [NAN, INF, -INF];

fn non_finite() -> Physics3DError {
    Physics3DError::InvalidJoint {
        reason: InvalidJointReason::NonFinite,
    }
}

/// Every float the five add exports take, with sane defaults. Anchors are `[ax, ay, az, bx, by,
/// bz]`; the axis is used by the revolute and prismatic kinds; the limits by the same two kinds;
/// the spring values (rest length, stiffness, damping) by the spring kind.
#[derive(Clone, Copy)]
struct JointArgs {
    anchors: [f32; 6],
    axis: [f32; 3],
    use_limits: bool,
    limits: [f32; 2],
    spring: [f32; 3],
}

impl JointArgs {
    fn sane() -> Self {
        Self {
            anchors: [0.0; 6],
            axis: [0.0, 1.0, 0.0],
            use_limits: false,
            limits: [0.0; 2],
            spring: [1.0, 100.0, 1.0],
        }
    }
}

const KINDS: [&str; 5] = ["fixed", "revolute", "prismatic", "ball", "spring"];

/// Adds one joint of `kind` (index into `KINDS`) on bodies `a` and `b`.
fn add_joint(
    e: &mut Engine,
    kind: usize,
    a: u32,
    b: u32,
    j: &JointArgs,
) -> Result<u32, Physics3DError> {
    let [ax, ay, az, bx, by, bz] = j.anchors;
    let [x, y, z] = j.axis;
    let [lo, hi] = j.limits;
    let [rest, stiffness, damping] = j.spring;
    match kind {
        0 => e.physics3d_add_fixed_joint(a, b, ax, ay, az, bx, by, bz),
        1 => e.physics3d_add_revolute_joint(
            a,
            b,
            ax,
            ay,
            az,
            bx,
            by,
            bz,
            x,
            y,
            z,
            j.use_limits,
            lo,
            hi,
        ),
        2 => e.physics3d_add_prismatic_joint(
            a,
            b,
            ax,
            ay,
            az,
            bx,
            by,
            bz,
            x,
            y,
            z,
            j.use_limits,
            lo,
            hi,
        ),
        3 => e.physics3d_add_ball_joint(a, b, ax, ay, az, bx, by, bz),
        _ => e.physics3d_add_spring_joint(a, b, ax, ay, az, bx, by, bz, rest, stiffness, damping),
    }
}

/// One `JointArgs` per hostile value in every float position that `kind` reads.
fn hostile_args(kind: usize) -> Vec<(String, JointArgs)> {
    let mut out = Vec::new();
    for v in HOSTILE {
        for i in 0..6 {
            let mut j = JointArgs::sane();
            j.anchors[i] = v;
            out.push((format!("anchor {i} = {v}"), j));
        }
        if kind == 1 || kind == 2 {
            for i in 0..3 {
                let mut j = JointArgs::sane();
                j.axis[i] = v;
                out.push((format!("axis {i} = {v}"), j));
            }
        }
        if kind == 4 {
            for i in 0..3 {
                let mut j = JointArgs::sane();
                j.spring[i] = v;
                out.push((format!("spring {i} = {v}"), j));
            }
        }
    }
    out
}

#[test]
fn add_joint_refuses_a_non_finite_value_and_consumes_nothing() -> Outcome {
    for (kind, name) in KINDS.iter().enumerate() {
        for (what, bad) in hostile_args(kind) {
            let mut touched = scene()?;
            let mut untouched = scene()?;
            assert_eq!(
                add_joint(&mut touched, kind, 2, 3, &bad),
                Err(non_finite()),
                "{name} {what}"
            );
            // No joint id was consumed and no joint exists: the next add is the first.
            let sane = JointArgs::sane();
            assert_eq!(
                add_joint(&mut touched, kind, 2, 3, &sane),
                Ok(0),
                "{name} {what}"
            );
            assert_eq!(
                add_joint(&mut untouched, kind, 2, 3, &sane),
                Ok(0),
                "{name} {what}"
            );
            assert_eq!(
                fingerprint(&mut touched)?,
                fingerprint(&mut untouched)?,
                "{name} {what}"
            );
        }
    }
    Ok(())
}

#[test]
fn add_joint_checks_the_world_then_the_bodies_then_the_values() -> Outcome {
    let mut bad = JointArgs::sane();
    bad.anchors[0] = NAN;
    let mut no_world = Engine::new(4).map_err(Physics3DError::Core)?;
    let mut e = scene()?;
    for (kind, name) in KINDS.iter().enumerate() {
        assert_eq!(
            add_joint(&mut no_world, kind, 0, 1, &bad),
            Err(Physics3DError::WorldNotInitialized),
            "{}",
            name
        );
        assert_eq!(
            add_joint(&mut e, kind, 99, 3, &bad),
            Err(Physics3DError::BodyNotFound { slot: 99 }),
            "{}",
            name
        );
        assert_eq!(
            add_joint(&mut e, kind, 2, 98, &bad),
            Err(Physics3DError::BodyNotFound { slot: 98 }),
            "{}",
            name
        );
        assert_eq!(
            add_joint(&mut e, kind, 2, 3, &bad),
            Err(non_finite()),
            "{}",
            name
        );
    }
    Ok(())
}

#[test]
fn add_joint_accepts_finite_edge_values() -> Outcome {
    let edges = [
        (
            "negative anchors",
            [-5.0, -1.0, -2.0, -3.0, -4.0, -6.0],
            [0.0, 1.0, 0.0],
        ),
        ("zero axis", [0.0; 6], [0.0; 3]),
        ("tiny axis", [0.0; 6], [1e-30; 3]),
    ];
    for (kind, name) in KINDS.iter().enumerate() {
        for (what, anchors, axis) in edges {
            let mut e = scene()?;
            let mut j = JointArgs::sane();
            j.anchors = anchors;
            j.axis = axis;
            j.spring = [-1.0, 0.0, 0.0];
            assert_eq!(add_joint(&mut e, kind, 2, 3, &j), Ok(0), "{} {what}", name);
        }
    }
    Ok(())
}

#[test]
fn joint_limits_refuse_nan_only_when_used_and_allow_infinite_sides() -> Outcome {
    for kind in [1, 2] {
        let mut used = JointArgs::sane();
        used.use_limits = true;
        for limits in [[NAN, 1.0], [-1.0, NAN], [NAN, NAN]] {
            let mut e = scene()?;
            used.limits = limits;
            assert_eq!(
                add_joint(&mut e, kind, 2, 3, &used),
                Err(non_finite()),
                "{}",
                KINDS[kind]
            );
            assert_eq!(add_joint(&mut e, kind, 2, 3, &JointArgs::sane()), Ok(0));
        }
        for limits in [[-INF, 1.0], [-1.0, INF], [-INF, INF]] {
            let mut e = scene()?;
            used.limits = limits;
            assert_eq!(
                add_joint(&mut e, kind, 2, 3, &used),
                Ok(0),
                "{}",
                KINDS[kind]
            );
        }
        // Unused limits are never read, so a NaN there is not a refusal.
        let mut unused = JointArgs::sane();
        unused.limits = [NAN, NAN];
        let mut e = scene()?;
        assert_eq!(
            add_joint(&mut e, kind, 2, 3, &unused),
            Ok(0),
            "{}",
            KINDS[kind]
        );
    }
    Ok(())
}

/// A scene with one revolute joint on slots 2 and 3, and its twin built the same way.
fn scene_pair_with_joint() -> Result<(Engine, Engine, u32), Physics3DError> {
    let mut touched = scene()?;
    let mut untouched = scene()?;
    let j = JointArgs::sane();
    let id = add_joint(&mut touched, 1, 2, 3, &j)?;
    assert_eq!(add_joint(&mut untouched, 1, 2, 3, &j), Ok(id));
    Ok((touched, untouched, id))
}

#[test]
fn motor_velocity_refuses_a_non_finite_value_and_changes_nothing() -> Outcome {
    for v in HOSTILE {
        for (what, velocity, force) in [("velocity", v, 10.0), ("max_force", 1.0, v)] {
            let (mut touched, mut untouched, id) = scene_pair_with_joint()?;
            assert_eq!(
                touched.physics3d_set_joint_motor_velocity(id, velocity, force),
                Err(non_finite()),
                "{what} {v}"
            );
            assert_eq!(
                fingerprint(&mut touched)?,
                fingerprint(&mut untouched)?,
                "{what} {v}"
            );
        }
    }
    Ok(())
}

#[test]
fn motor_position_refuses_a_non_finite_value_and_changes_nothing() -> Outcome {
    for v in HOSTILE {
        for (what, args) in [
            ("target", (v, 10.0, 1.0)),
            ("stiffness", (1.0, v, 1.0)),
            ("damping", (1.0, 10.0, v)),
        ] {
            let (mut touched, mut untouched, id) = scene_pair_with_joint()?;
            assert_eq!(
                touched.physics3d_set_joint_motor_position(id, args.0, args.1, args.2),
                Err(non_finite()),
                "{what} {v}"
            );
            assert_eq!(
                fingerprint(&mut touched)?,
                fingerprint(&mut untouched)?,
                "{what} {v}"
            );
        }
    }
    Ok(())
}

#[test]
fn motor_setters_check_the_world_then_the_joint_then_the_values() -> Outcome {
    let mut no_world = Engine::new(4).map_err(Physics3DError::Core)?;
    let not_init = Err(Physics3DError::WorldNotInitialized);
    assert_eq!(
        no_world.physics3d_set_joint_motor_velocity(0, NAN, 1.0),
        not_init
    );
    assert_eq!(
        no_world.physics3d_set_joint_motor_position(0, NAN, 1.0, 1.0),
        not_init
    );
    let mut e = scene()?;
    let unknown = Err(Physics3DError::JointNotFound { joint_id: 9999 });
    assert_eq!(
        e.physics3d_set_joint_motor_velocity(9999, NAN, 1.0),
        unknown
    );
    assert_eq!(
        e.physics3d_set_joint_motor_position(9999, NAN, 1.0, 1.0),
        unknown
    );
    Ok(())
}

#[test]
fn motor_setters_accept_finite_edge_values() -> Outcome {
    let (mut e, _, id) = scene_pair_with_joint()?;
    assert_eq!(
        e.physics3d_set_joint_motor_velocity(id, -1e6, 0.0),
        Ok(true)
    );
    assert_eq!(
        e.physics3d_set_joint_motor_position(id, -1.0, 0.0, 0.0),
        Ok(true)
    );
    Ok(())
}
