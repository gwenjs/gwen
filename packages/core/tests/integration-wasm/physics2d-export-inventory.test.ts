import { fileURLToPath, pathToFileURL } from "node:url";

import { Physics2DErrorCodes } from "@gwenjs/physics2d";
import { describe, expect, it } from "vitest";

/**
 * Physics2d glue classification.
 * `result` means the glue throws `takeObject` (a wasm-bindgen `Result`).
 * `infallible` names the mechanism that keeps the call from panicking.
 * `known-panic` is issue 217. `physics_step` reaches `PhysicsPipeline::step`
 * and the three queries reach Rapier shapes. Those calls stay unaudited.
 * An export matching the physics2d name rule that is missing from the table fails.
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

const ISSUE = 217;

const PHYSICS2D: Record<string, ExportRow> = {
  find_path_2d: result(),
  get_collision_event_count: infallible("returns 0"),
  get_collision_events_ptr: infallible("returns a null pointer"),
  get_path_buffer_ptr: infallible("returns the address of the static path buffer"),
  path_find_2d: result(),
  path_get_result_ptr: infallible("returns the address of the static path buffer"),
  physics2d_bulk_apply_impulse: result(),
  physics2d_bulk_sync_from_rapier: result(),
  physics2d_bulk_sync_to_rapier: result(),
  physics_add_ball_collider: result(),
  physics_add_box_collider: result(),
  physics_add_rigid_body: result(),
  physics_apply_impulse: result(),
  physics_bulk_step_kinematics: result(),
  physics_consume_event_metrics: infallible("returns a four-zero Vec and reads no world"),
  physics_get_collision_event_count: infallible(
    "returns the event buffer length, or 0 when the world is absent",
  ),
  physics_get_collision_events_ptr: infallible(
    "returns the event buffer pointer, or null when the world is absent",
  ),
  physics_get_linear_velocity: result(),
  physics_get_position: result(),
  physics_get_sensor_state: infallible("get_sensor_state returns the constant pair (0, false)"),
  physics_init: infallible(
    "PhysicsWorld::new stores the gravity vector and builds empty Rapier sets",
  ),
  physics_load_tilemap_chunk_body: result(),
  physics_point_query: knownPanic(ISSUE),
  physics_query_radius: knownPanic(ISSUE),
  physics_query_rect: knownPanic(ISSUE),
  physics_remove_rigid_body: result(),
  physics_set_event_coalescing: infallible("the body ignores the argument"),
  physics_set_fixed_rotation: result(),
  physics_set_global_ccd_enabled: infallible("the body ignores the argument"),
  physics_set_kinematic_position: result(),
  physics_set_linear_damping: result(),
  physics_set_linear_velocity: result(),
  physics_set_quality: result(),
  physics_step: knownPanic(ISSUE),
  physics_take_disabled_slots: infallible(
    "returns Vec::new at world.rs:751 via bindings.rs:1300; no slot is recorded",
  ),
  physics_unload_tilemap_chunk_body: result(),
  physics_update_sensor_state: infallible("the body ignores its arguments"),
};

const PHYSICS_NAME =
  /^(?:physics_|physics2d_|path_|find_path_2d$|get_path_buffer_ptr$|get_collision_events_ptr$|get_collision_event_count$)/;

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
  return names.filter((name) => PHYSICS_NAME.test(name));
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

describe("physics2d export inventory", () => {
  it("classifies every physics2d export and the new PHYSICS2D codes", async () => {
    expect(Physics2DErrorCodes.NOT_INITIALIZED).toBe("PHYSICS2D:NOT_INITIALIZED");
    expect(Physics2DErrorCodes.BODY_NOT_FOUND).toBe("PHYSICS2D:BODY_NOT_FOUND");
    expect(Physics2DErrorCodes.BODY_ALREADY_EXISTS).toBe("PHYSICS2D:BODY_ALREADY_EXISTS");
    expect(Physics2DErrorCodes.INVALID_BODY_KIND).toBe("PHYSICS2D:INVALID_BODY_KIND");
    expect(Physics2DErrorCodes.BUFFER_LENGTH_MISMATCH).toBe("PHYSICS2D:BUFFER_LENGTH_MISMATCH");
    expect(Physics2DErrorCodes.TILEMAP_CHUNK_ALREADY_LOADED).toBe(
      "PHYSICS2D:TILEMAP_CHUNK_ALREADY_LOADED",
    );
    expect(Physics2DErrorCodes.TILEMAP_CHUNK_NOT_LOADED).toBe("PHYSICS2D:TILEMAP_CHUNK_NOT_LOADED");
    expect(Physics2DErrorCodes.INVALID_PATH_REQUEST).toBe("PHYSICS2D:INVALID_PATH_REQUEST");
    expect(Physics2DErrorCodes.STALE_BODY_HANDLE).toBe("PHYSICS2D:STALE_BODY_HANDLE");
    expect(errorCode("INVALID_QUERY")).toBe("PHYSICS2D:INVALID_QUERY");
    expect(errorCode("INVALID_STEP_DELTA")).toBe("PHYSICS2D:INVALID_STEP_DELTA");

    const jsPath = fileURLToPath(new URL("../../wasm/physics2d/gwen_core.js", import.meta.url));
    const glue = (await import(pathToFileURL(jsPath).href)) as { Engine: WasmCtor };
    const actual = [
      ...new Set([
        ...physicsNames(ownMethods(glue.Engine)),
        ...physicsNames(moduleFunctions(glue)),
      ]),
    ].sort();

    const unlisted = actual.filter((name) => PHYSICS2D[name] === undefined);
    const missing = Object.keys(PHYSICS2D)
      .filter((name) => !actual.includes(name))
      .sort();
    expect(unlisted, `unlisted exports: ${unlisted.join(", ")}`).toEqual([]);
    expect(missing, `table entries absent from the glue: ${missing.join(", ")}`).toEqual([]);
    for (const [name, row] of Object.entries(PHYSICS2D)) {
      requireReason(name, row);
      if (row.kind === "result") {
        expect(glueThrows(glue, glue.Engine, name), name).toBe(true);
      }
    }
  });

  it("has no known-panic row", () => {
    const knownPanic = Object.values(PHYSICS2D).filter((row) => row.kind === "known-panic");
    expect(knownPanic).toEqual([]);
  });
});

function errorCode(key: string): unknown {
  if (!Object.hasOwn(Physics2DErrorCodes, key)) return undefined;
  const value: unknown = Reflect.get(Physics2DErrorCodes, key);
  return value;
}

function glueThrows(mod: object, ctor: WasmCtor, name: string): boolean {
  const onProto = Object.getOwnPropertyDescriptor(ctor.prototype as object, name)?.value;
  const onModule = Reflect.get(mod, name);
  const fn = typeof onProto === "function" ? onProto : onModule;
  if (typeof fn !== "function") return false;
  return Function.prototype.toString.call(fn).includes("throw takeObject");
}
