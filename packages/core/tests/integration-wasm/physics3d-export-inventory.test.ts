import { fileURLToPath, pathToFileURL } from "node:url";

import { Physics3DErrorCodes } from "@gwenjs/physics3d";
import { describe, expect, it } from "vitest";

/**
 * Physics3d glue classification.
 * `result` means the glue throws `takeObject` (a wasm-bindgen `Result`).
 * `infallible` names the mechanism that keeps the call from panicking.
 * `known-panic` is issue 110: a TypeScript input can reach a Rust panic, or the
 * path was not proven. `physics3d_step` and the three queries return a `Result`
 * for a missing world and stay `known-panic` for the Rapier and parry call.
 * A later PR flips a row to `result` when it converts the export.
 * An export matching the physics3d name rule that is missing from the table fails.
 * A `result` row whose glue does not throw fails.
 * An `infallible` row whose glue throws fails.
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

function result(): { kind: "result" } {
  return { kind: "result" };
}

const ISSUE = 110;

const PHYSICS3D: Record<string, ExportRow> = {
  find_path_3d: infallible(
    "ABI shim: the body returns the constant 0 and reads no argument (pathfinding.rs:210-224)",
  ),
  get_path_buffer_ptr_3d: infallible(
    "returns the address of the thread-local path buffer without dereferencing it (pathfinding.rs:83-87)",
  ),
  physics3d_add_ball_joint: result(),
  physics3d_add_body: result(),
  physics3d_add_box_collider: result(),
  physics3d_add_capsule_collider: result(),
  physics3d_add_character_controller: result(),
  physics3d_add_compound_collider: result(),
  physics3d_add_convex_collider: result(),
  physics3d_add_fixed_joint: result(),
  physics3d_add_force: result(),
  physics3d_add_force_at_point: result(),
  physics3d_add_heightfield_collider: result(),
  physics3d_add_mesh_collider: result(),
  physics3d_add_prismatic_joint: result(),
  physics3d_add_revolute_joint: result(),
  physics3d_add_sphere_collider: result(),
  physics3d_add_spring_joint: result(),
  physics3d_add_torque: result(),
  physics3d_apply_angular_impulse: result(),
  physics3d_apply_impulse: result(),
  physics3d_bulk_apply_impulse: result(),
  physics3d_bulk_spawn_static_boxes: result(),
  physics3d_bulk_step_kinematic_rotations: result(),
  physics3d_bulk_step_kinematics: result(),
  physics3d_bulk_sync_from_rapier: result(),
  physics3d_bulk_sync_to_rapier: result(),
  physics3d_cast_ray: knownPanic(ISSUE),
  physics3d_cast_shape: knownPanic(ISSUE),
  physics3d_character_controller_move: result(),
  physics3d_consume_events: result(),
  physics3d_find_path_3d: result(),
  physics3d_get_angular_velocity: result(),
  physics3d_get_body_kind: result(),
  physics3d_get_body_state: result(),
  physics3d_get_cc_sab_ptr: infallible(
    "returns the address of the fixed cc_state array without reading it (world.rs:3082-3084)",
  ),
  physics3d_get_collision_event_count: infallible(
    "returns the event buffer length, or 0 when the world is absent (world.rs:509-511)",
  ),
  physics3d_get_collision_events_ptr: infallible(
    "returns the event buffer address, or 0 when the world is absent (world.rs:504-506)",
  ),
  physics3d_get_gravity_scale: result(),
  physics3d_get_linear_velocity: result(),
  physics3d_get_max_cc_entities: infallible(
    "returns the constant MAX_CC_ENTITIES (world.rs:3098-3100)",
  ),
  physics3d_get_path_buffer_ptr_3d: infallible(
    "returns the address of the thread-local path buffer without dereferencing it (pathfinding.rs:83-87)",
  ),
  physics3d_get_sensor_state: result(),
  physics3d_has_body: result(),
  physics3d_init: infallible(
    "PhysicsWorld3D::new stores the three gravity floats and builds empty rapier sets; the max_entities argument is unused (world.rs:318-351)",
  ),
  physics3d_init_navgrid_3d: result(),
  physics3d_is_body_sleeping: result(),
  physics3d_load_bvh_collider: result(),
  physics3d_lock_rotations: result(),
  physics3d_lock_translations: result(),
  physics3d_overlap_shape: result(),
  physics3d_project_point: knownPanic(ISSUE),
  physics3d_rebuild_mesh_collider: result(),
  physics3d_remove_body: result(),
  physics3d_remove_character_controller: result(),
  physics3d_remove_collider: result(),
  physics3d_remove_joint: result(),
  physics3d_set_angular_velocity: result(),
  physics3d_set_body_kind: result(),
  physics3d_set_body_sleeping: result(),
  physics3d_set_body_solver_iterations: result(),
  physics3d_set_body_state: result(),
  physics3d_set_event_coalescing: result(),
  physics3d_set_gravity_scale: result(),
  physics3d_set_joint_enabled: result(),
  physics3d_set_joint_motor_position: result(),
  physics3d_set_joint_motor_velocity: result(),
  physics3d_set_kinematic_position: result(),
  physics3d_set_linear_velocity: result(),
  physics3d_set_quality: result(),
  physics3d_step: knownPanic(ISSUE),
  physics3d_update_heightfield_collider: result(),
  physics3d_update_sensor_state: result(),
  physics3d_wake_all: result(),
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
    expect(Physics3DErrorCodes.COLLIDER_ALREADY_EXISTS).toBe("PHYSICS3D:COLLIDER_ALREADY_EXISTS");
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
    expect(Physics3DErrorCodes.INVALID_PATH_REQUEST).toBe("PHYSICS3D:INVALID_PATH_REQUEST");
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
      } else if (row.kind === "infallible") {
        expect(throws, `${name} throws in the glue: flip its row to result`).toBe(false);
      }
    }
  });
});
