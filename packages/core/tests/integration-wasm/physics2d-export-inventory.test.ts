import { fileURLToPath, pathToFileURL } from "node:url";

import { Physics2DErrorCodes } from "@gwenjs/physics2d";
import { describe, expect, it } from "vitest";

/**
 * Physics2d glue classification.
 * `result` is unused: no physics2d export returns `Result` yet.
 * `infallible` names the mechanism that keeps the call from panicking.
 * `known-panic` is issue 110: a TypeScript float reaches Rapier or the path
 * search, and this PR does not prove that call cannot panic.
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

const ISSUE = 110;

const PHYSICS2D: Record<string, ExportRow> = {
  find_path_2d: knownPanic(ISSUE),
  get_collision_event_count: infallible("returns 0"),
  get_collision_events_ptr: infallible("returns a null pointer"),
  get_path_buffer_ptr: infallible("returns the address of the static path buffer"),
  path_find_2d: knownPanic(ISSUE),
  path_get_result_ptr: infallible("returns the address of the static path buffer"),
  physics2d_bulk_apply_impulse: infallible(
    "set_components_bulk returns Result and the wrapper discards it",
  ),
  physics2d_bulk_sync_from_rapier: infallible(
    "query_read_bulk returns Result and a mismatch becomes the pair (0, 0)",
  ),
  physics2d_bulk_sync_to_rapier: infallible(
    "set_components_bulk returns Result and the wrapper discards it",
  ),
  physics_add_ball_collider: knownPanic(ISSUE),
  physics_add_box_collider: knownPanic(ISSUE),
  physics_add_rigid_body: knownPanic(ISSUE),
  physics_apply_impulse: knownPanic(ISSUE),
  physics_bulk_step_kinematics: knownPanic(ISSUE),
  physics_consume_event_metrics: infallible("returns a four-zero Vec and reads no world"),
  physics_get_collision_event_count: infallible(
    "returns the event buffer length, or 0 when the world is absent",
  ),
  physics_get_collision_events_ptr: infallible(
    "returns the event buffer pointer, or null when the world is absent",
  ),
  physics_get_linear_velocity: infallible(
    "a missing world or slot returns an empty Vec; the body is read with rigid_body_set.get",
  ),
  physics_get_position: infallible(
    "a missing world or slot returns an empty Vec; the body is read with rigid_body_set.get",
  ),
  physics_get_sensor_state: infallible("get_sensor_state returns the constant pair (0, false)"),
  physics_init: infallible(
    "PhysicsWorld::new stores the gravity vector and builds empty Rapier sets",
  ),
  physics_load_tilemap_chunk_body: knownPanic(ISSUE),
  physics_point_query: knownPanic(ISSUE),
  physics_query_radius: knownPanic(ISSUE),
  physics_query_rect: knownPanic(ISSUE),
  physics_remove_rigid_body: infallible(
    "a missing slot returns before Rapier; remove uses the handle this world inserted",
  ),
  physics_set_event_coalescing: infallible("the body ignores the argument"),
  physics_set_global_ccd_enabled: infallible("the body ignores the argument"),
  physics_set_kinematic_position: knownPanic(ISSUE),
  physics_set_linear_damping: knownPanic(ISSUE),
  physics_set_linear_velocity: knownPanic(ISSUE),
  physics_set_quality: infallible(
    "from_u8 maps any other byte to Medium and the solver count uses NonZeroUsize::new().unwrap_or",
  ),
  physics_step: knownPanic(ISSUE),
  physics_unload_tilemap_chunk_body: infallible(
    "a missing chunk id returns before remove_rigid_body",
  ),
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
    }
  });
});
