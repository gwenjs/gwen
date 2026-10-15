import { fileURLToPath, pathToFileURL } from "node:url";

import { Physics3DErrorCodes } from "@gwenjs/physics3d";
import { describe, expect, it } from "vitest";

/**
 * Physics3d glue classification.
 * `result` means the glue throws `takeObject` (a wasm-bindgen `Result`).
 * `infallible` names the mechanism that keeps the call from panicking.
 * `known-panic` is issue 110: a TypeScript input can reach a Rust panic, or the
 * path was not proven. No physics3d export returns a `Result` yet. A later PR
 * flips a row to `result` when it converts the export.
 * An export matching the physics3d name rule that is missing from the table fails.
 * A row that is not `result` while the glue throws also fails.
 */
type ExportRow =
  | { kind: "result" }
  | { kind: "infallible"; why: string }
  | { kind: "known-panic"; issue: number };

function infallible(why: string): { kind: "infallible"; why: string } {
  return { kind: "infallible", why };
}

function knownPanic(issue: number): { kind: "known-panic"; issue: number } {
  return { kind: "known-panic", issue };
}

const ISSUE = 110;

const JOINT_ADD =
  "a missing body returns u32::MAX at the entity_handles.get let-else (world.rs:2475-2485); ImpulseJointSet::insert has no assert (impulse_joint_set.rs:232-272) and Graph::add_edge only asserts on an invalid node index (graph.rs:220-228); NaN or inf only reach the step";
const JOINT_SET =
  "joint_handles.get and impulse_joint_set.get_mut return early with false (world.rs:2715-2720); the generic_joint setter indexes the fixed motors array with AngX";
const BODY_SETTER =
  "entity_handles.get and rigid_body_set.get_mut return early with false; the rapier RigidBody setter has no assert, unwrap or expect (rigid_body.rs); NaN or inf only reach the step";
const BODY_GETTER =
  "entity_handles.get and rigid_body_set.get return early with an empty Vec or a sentinel; the getter reads stored fields";
const COLLIDER_SHAPE =
  "the body lookup returns false at world.rs:701-704; the parry shape constructor has no assert (cuboid.rs, ball.rs, capsule.rs); insert_with_parent expects a body that entity_handles keeps in sync (collider_set.rs:121); NaN, inf or negative sizes only reach the step";

const PHYSICS3D: Record<string, ExportRow> = {
  find_path_3d: infallible(
    "ABI shim: the body returns the constant 0 and reads no argument (pathfinding.rs:210-224)",
  ),
  get_path_buffer_ptr_3d: infallible(
    "returns the address of the thread-local path buffer without dereferencing it (pathfinding.rs:83-87)",
  ),
  physics3d_add_ball_joint: infallible(JOINT_ADD),
  physics3d_add_body: infallible(
    "a duplicate slot returns false at world.rs:592-598; kind_to_body_type has a wildcard arm (world.rs:143-148); the builder and RigidBodySet::insert have no assert for mass, damping or position (rigid_body.rs, arena.rs:295-300)",
  ),
  physics3d_add_box_collider: infallible(COLLIDER_SHAPE),
  physics3d_add_capsule_collider: infallible(COLLIDER_SHAPE),
  physics3d_add_character_controller: infallible(
    "a missing body returns u32::MAX at world.rs:2858-2861; the pool check and slot arithmetic use get, pop and a compare (world.rs:2888-2901); no indexing. It inserts into cc_controllers before the pool check (world.rs:2886), a state bug fixed in PR 4",
  ),
  physics3d_add_compound_collider: infallible(
    "len % 12 is checked before as_chunks::<12>() (world.rs:1356-1361), so chunk[0..11] stay in range; an unknown shape type is skipped by continue (world.rs:1379); f32 to u32 casts saturate",
  ),
  physics3d_add_convex_collider: knownPanic(ISSUE),
  physics3d_add_fixed_joint: infallible(JOINT_ADD),
  physics3d_add_force: infallible(BODY_SETTER),
  physics3d_add_force_at_point: infallible(BODY_SETTER),
  physics3d_add_heightfield_collider: knownPanic(ISSUE),
  physics3d_add_mesh_collider: knownPanic(ISSUE),
  physics3d_add_prismatic_joint: infallible(JOINT_ADD),
  physics3d_add_revolute_joint: infallible(JOINT_ADD),
  physics3d_add_sphere_collider: infallible(COLLIDER_SHAPE),
  physics3d_add_spring_joint: infallible(JOINT_ADD),
  physics3d_add_torque: infallible(BODY_SETTER),
  physics3d_apply_angular_impulse: infallible(BODY_SETTER),
  physics3d_apply_impulse: infallible(BODY_SETTER),
  physics3d_bulk_apply_impulse: infallible(
    "set_components_bulk is a result row of the light inventory (wasm-export-inventory.test.ts:96); its Err is dropped by let _ = (bulk_ops_physics3d.rs:85), so no panic and no error reaches TypeScript",
  ),
  physics3d_bulk_spawn_static_boxes: infallible(
    "every positions_flat and half_extents_flat index is checked against n * 3 first (world.rs:1273-1287), and n * 3 cannot overflow a 32-bit usize because a u32 slice holds under 2^30 items; it overwrites a registered slot (world.rs:1315), a state bug fixed in PR 3",
  ),
  physics3d_bulk_step_kinematic_rotations: infallible(
    "count is the minimum of the four slice lengths (world.rs:1542), so every index i is in range; set_next_kinematic_position has no assert; NaN only reaches the step; a length mismatch is silently ignored, fixed in PR 3",
  ),
  physics3d_bulk_step_kinematics: infallible(
    "count is the minimum of the four slice lengths (world.rs:1495), so every index i is in range; set_next_kinematic_position has no assert; NaN only reaches the step; a length mismatch is silently ignored, fixed in PR 3",
  ),
  physics3d_bulk_sync_from_rapier: infallible(
    "query_read_bulk is a result row of the light inventory (wasm-export-inventory.test.ts:85); every Err becomes (0, 0) and result[0] is read only after the len >= 2 check (bulk_ops_physics3d.rs:35-44)",
  ),
  physics3d_bulk_sync_to_rapier: infallible(
    "set_components_bulk is a result row of the light inventory (wasm-export-inventory.test.ts:96); its Err is dropped by let _ = (bulk_ops_physics3d.rs:65), so no panic and no error reaches TypeScript",
  ),
  physics3d_cast_ray: knownPanic(ISSUE),
  physics3d_cast_shape: knownPanic(ISSUE),
  physics3d_character_controller_move: knownPanic(ISSUE),
  physics3d_consume_events: infallible("the body sets the event count to 0 (events.rs:55-57)"),
  physics3d_find_path_3d: knownPanic(ISSUE),
  physics3d_get_angular_velocity: infallible(BODY_GETTER),
  physics3d_get_body_kind: infallible(
    "entity_handles.get and rigid_body_set.get return 255 early; body_type_to_kind has a wildcard arm (world.rs:155-162)",
  ),
  physics3d_get_body_state: infallible(BODY_GETTER),
  physics3d_get_cc_sab_ptr: infallible(
    "returns the address of the fixed cc_state array without reading it (world.rs:3082-3084)",
  ),
  physics3d_get_collision_event_count: infallible(
    "returns the event buffer length, or 0 when the world is absent (world.rs:509-511)",
  ),
  physics3d_get_collision_events_ptr: infallible(
    "returns the event buffer address, or 0 when the world is absent (world.rs:504-506)",
  ),
  physics3d_get_gravity_scale: infallible(BODY_GETTER),
  physics3d_get_linear_velocity: infallible(BODY_GETTER),
  physics3d_get_max_cc_entities: infallible(
    "returns the constant MAX_CC_ENTITIES (world.rs:3098-3100)",
  ),
  physics3d_get_path_buffer_ptr_3d: infallible(
    "returns the address of the thread-local path buffer without dereferencing it (pathfinding.rs:83-87)",
  ),
  physics3d_get_sensor_state: infallible(
    "HashMap::get then unwrap_or((0, false)); the shift is 32 on a u64 (world.rs:534-541)",
  ),
  physics3d_has_body: infallible("contains_key on a HashMap (world.rs:672-674)"),
  physics3d_init: infallible(
    "PhysicsWorld3D::new stores the three gravity floats and builds empty rapier sets; the max_entities argument is unused (world.rs:318-351)",
  ),
  physics3d_init_navgrid_3d: knownPanic(ISSUE),
  physics3d_is_body_sleeping: infallible(BODY_GETTER),
  physics3d_load_bvh_collider: knownPanic(ISSUE),
  physics3d_lock_rotations: infallible(BODY_SETTER),
  physics3d_lock_translations: infallible(BODY_SETTER),
  physics3d_overlap_shape: knownPanic(ISSUE),
  physics3d_project_point: knownPanic(ISSUE),
  physics3d_rebuild_mesh_collider: knownPanic(ISSUE),
  physics3d_remove_body: infallible(
    "a missing slot returns false (world.rs:662-663); RigidBodySet::remove returns Option (rigid_body_set.rs:88); the joint unwrap at impulse_joint_set.rs:366 holds because insert stores every joint id (impulse_joint_set.rs:240) and a self-loop edge is yielded once (graph.rs:672-675)",
  ),
  physics3d_remove_character_controller: infallible(
    "HashMap::remove and Vec::push only (world.rs:3065-3070)",
  ),
  physics3d_remove_collider: infallible(
    "a missing key returns false (world.rs:1415-1417); ColliderSet::remove returns Option (collider_set.rs:184-190)",
  ),
  physics3d_remove_joint: infallible(
    "a missing id returns false (world.rs:2693-2699); ImpulseJointSet::remove returns Option (impulse_joint_set.rs:316-336)",
  ),
  physics3d_set_angular_velocity: infallible(BODY_SETTER),
  physics3d_set_body_kind: infallible(
    `${BODY_SETTER}; kind_to_body_type has a wildcard arm (world.rs:143-148) and set_body_type compares and assigns (rigid_body.rs:219-232)`,
  ),
  physics3d_set_body_sleeping: infallible(BODY_SETTER),
  physics3d_set_body_solver_iterations: infallible(
    `${BODY_SETTER}; a huge iteration count only slows the step`,
  ),
  physics3d_set_body_state: infallible(
    `${BODY_SETTER}; UnitQuaternion::new_normalize divides by the norm without an assert (unit.rs:131-134)`,
  ),
  physics3d_set_event_coalescing: infallible("the body assigns one bool (world.rs:393-395)"),
  physics3d_set_gravity_scale: infallible(BODY_SETTER),
  physics3d_set_joint_enabled: infallible(JOINT_SET),
  physics3d_set_joint_motor_position: infallible(JOINT_SET),
  physics3d_set_joint_motor_velocity: infallible(JOINT_SET),
  physics3d_set_kinematic_position: infallible(
    `${BODY_SETTER}; UnitQuaternion::new_normalize divides by the norm without an assert (unit.rs:131-134)`,
  ),
  physics3d_set_linear_velocity: infallible(BODY_SETTER),
  physics3d_set_quality: infallible(
    "PhysicsQualityPreset3D::from_u8 has a wildcard arm (components.rs:83-90) and apply_quality_config uses unwrap_or(NonZeroUsize::MIN) (world.rs:356-362)",
  ),
  physics3d_step: knownPanic(ISSUE),
  physics3d_update_heightfield_collider: knownPanic(ISSUE),
  physics3d_update_sensor_state: infallible("one HashMap::insert (world.rs:554-563)"),
  physics3d_wake_all: infallible(
    "iterates rigid_body_set.iter_mut and calls wake_up, which has no assert (rigid_body.rs)",
  ),
};

const PHYSICS3D_NAME = /^physics3d_|_3d$/;

const PLACEHOLDER_WHY = new Set(["infallible", "ok", "none", "n/a"]);

type WasmCtor = new (...args: never[]) => unknown;

function symbolName(symbol: symbol): string {
  const text = String(symbol);
  if (text === "Symbol(nodejs.dispose)") return "Symbol(Symbol.dispose)";
  return text;
}

function ownMethods(ctor: WasmCtor): string[] {
  const proto = ctor.prototype as object;
  const prototypeNames = [
    ...Object.getOwnPropertyNames(proto),
    ...Object.getOwnPropertySymbols(proto).map((symbol) => symbolName(symbol)),
  ];
  const staticNames = Object.getOwnPropertyNames(ctor).filter((name) => {
    if (name === "prototype" || name === "length" || name === "name") return false;
    const value: unknown = Reflect.get(ctor, name);
    return typeof value === "function";
  });
  return [...prototypeNames, ...staticNames.map((name) => `static ${name}`)];
}

function moduleFunctions(mod: object): string[] {
  return Object.keys(mod).filter((name) => typeof Reflect.get(mod, name) === "function");
}

function physicsNames(names: string[]): string[] {
  return names.filter((name) => PHYSICS3D_NAME.test(name));
}

function requireReason(name: string, row: ExportRow): void {
  if (row.kind === "result") return;
  if (row.kind === "known-panic") {
    expect(Number.isInteger(row.issue) && row.issue > 0, name).toBe(true);
    return;
  }
  const why = row.why.trim().toLowerCase();
  expect(why.length, name).toBeGreaterThan(0);
  expect(PLACEHOLDER_WHY.has(why), name).toBe(false);
}

function glueThrows(mod: object, ctor: WasmCtor, name: string): boolean {
  const onProto = Object.getOwnPropertyDescriptor(ctor.prototype as object, name)?.value;
  const onModule = Reflect.get(mod, name);
  const fn = typeof onProto === "function" ? onProto : onModule;
  if (typeof fn !== "function") return false;
  return Function.prototype.toString.call(fn).includes("throw takeObject");
}

describe("physics3d export inventory", () => {
  it("classifies every physics3d export and the new PHYSICS3D codes", async () => {
    expect(Physics3DErrorCodes.NOT_INITIALIZED).toBe("PHYSICS3D:NOT_INITIALIZED");
    expect(Physics3DErrorCodes.BODY_NOT_FOUND).toBe("PHYSICS3D:BODY_NOT_FOUND");
    expect(Physics3DErrorCodes.BODY_ALREADY_EXISTS).toBe("PHYSICS3D:BODY_ALREADY_EXISTS");
    expect(Physics3DErrorCodes.INVALID_BODY_KIND).toBe("PHYSICS3D:INVALID_BODY_KIND");
    expect(Physics3DErrorCodes.BUFFER_LENGTH_MISMATCH).toBe("PHYSICS3D:BUFFER_LENGTH_MISMATCH");
    expect(Physics3DErrorCodes.COLLIDER_NOT_FOUND).toBe("PHYSICS3D:COLLIDER_NOT_FOUND");
    expect(Physics3DErrorCodes.INVALID_SHAPE).toBe("PHYSICS3D:INVALID_SHAPE");
    expect(Physics3DErrorCodes.JOINT_NOT_FOUND).toBe("PHYSICS3D:JOINT_NOT_FOUND");
    expect(Physics3DErrorCodes.CHARACTER_CONTROLLER_NOT_FOUND).toBe(
      "PHYSICS3D:CHARACTER_CONTROLLER_NOT_FOUND",
    );
    expect(Physics3DErrorCodes.CHARACTER_CONTROLLER_LIMIT_REACHED).toBe(
      "PHYSICS3D:CHARACTER_CONTROLLER_LIMIT_REACHED",
    );
    expect(Physics3DErrorCodes.NAVGRID_NOT_INITIALIZED).toBe("PHYSICS3D:NAVGRID_NOT_INITIALIZED");
    expect(Physics3DErrorCodes.INVALID_NAVGRID).toBe("PHYSICS3D:INVALID_NAVGRID");
    expect(Physics3DErrorCodes.INVALID_COLLIDER).toBe("PHYSICS3D:INVALID_COLLIDER");
    expect(Physics3DErrorCodes.INVALID_MESH_BUFFER).toBe("PHYSICS3D:INVALID_MESH_BUFFER");
    expect(Physics3DErrorCodes.INVALID_COMPOUND).toBe("PHYSICS3D:INVALID_COMPOUND");
    expect(Physics3DErrorCodes.BVH_LOAD_FAILED).toBe("PHYSICS3D:BVH_LOAD_FAILED");

    const jsPath = fileURLToPath(new URL("../../wasm/physics3d/gwen_core.js", import.meta.url));
    const glue = (await import(pathToFileURL(jsPath).href)) as { Engine: WasmCtor };
    const actual = [
      ...new Set([
        ...physicsNames(ownMethods(glue.Engine)),
        ...physicsNames(moduleFunctions(glue)),
      ]),
    ].sort();

    const unlisted = actual.filter((name) => PHYSICS3D[name] === undefined);
    const missing = Object.keys(PHYSICS3D)
      .filter((name) => !actual.includes(name))
      .sort();
    expect(unlisted, `unlisted exports: ${unlisted.join(", ")}`).toEqual([]);
    expect(missing, `table entries absent from the glue: ${missing.join(", ")}`).toEqual([]);
    for (const [name, row] of Object.entries(PHYSICS3D)) {
      requireReason(name, row);
      const throws = glueThrows(glue, glue.Engine, name);
      if (row.kind === "result") {
        expect(throws, `${name} is a result row but the glue does not throw`).toBe(true);
      } else {
        expect(throws, `${name} throws in the glue: flip its row to result`).toBe(false);
      }
    }
  });
});
