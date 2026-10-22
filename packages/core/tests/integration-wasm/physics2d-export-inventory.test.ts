import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

import { Physics2DErrorCodes } from "@gwenjs/physics2d";
import { describe, expect, it } from "vitest";

/**
 * Physics2d glue classification.
 * `result` means the glue throws `takeObject` (a wasm-bindgen `Result`).
 * `infallible` names the mechanism that keeps the call from panicking.
 * `known-panic` is a row that can still abort the instance. Issue 217 moves
 * `physics_step` and the three queries to `result` (`PHYSICS2D:INVALID_QUERY`,
 * `PHYSICS2D:INVALID_STEP_DELTA`).
 * An export matching the physics2d name rule that is missing from the table fails.
 */
type ExportRow =
  | { kind: "result" }
  | { kind: "infallible"; why: string }
  | { kind: "known-panic"; issue: number };

function infallible(why: string): { kind: "infallible"; why: string } {
  return { kind: "infallible", why };
}

function result(): { kind: "result" } {
  return { kind: "result" };
}

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
  physics_point_query: result(),
  physics_query_radius: result(),
  physics_query_rect: result(),
  physics_remove_rigid_body: result(),
  physics_set_event_coalescing: infallible("the body ignores the argument"),
  physics_set_fixed_rotation: result(),
  physics_set_global_ccd_enabled: infallible("the body ignores the argument"),
  physics_set_kinematic_position: result(),
  physics_set_linear_damping: result(),
  physics_set_linear_velocity: result(),
  physics_set_max_linear_velocity: infallible(
    "returns 0 or 1 from physics_set_max_linear_velocity; a refused value keeps the previous cap in set_max_linear_velocity",
  ),
  physics_set_quality: result(),
  physics_step: result(),
  physics_take_disabled_slots: infallible(
    "drains [slot, code] pairs recorded by guard_dynamic_bodies via physics_take_disabled_slots; an empty drain returns Vec::new from take_disabled_slots",
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

type Physics2dGlue = {
  Engine: WasmCtor;
  initSync: (input: { module: Uint8Array }) => unknown;
};

type Physics2dEngine = {
  free: () => void;
  physics_init: (gravX: number, gravY: number, maxEntities: number) => void;
  physics_point_query: (x: number, y: number, membership: number, filter: number) => Uint32Array;
  physics_query_radius: (
    x: number,
    y: number,
    radius: number,
    membership: number,
    filter: number,
  ) => Uint32Array;
  physics_query_rect: (
    x: number,
    y: number,
    hw: number,
    hh: number,
    membership: number,
    filter: number,
  ) => Uint32Array;
  physics_step: (delta: number) => void;
};

async function loadPhysics2dGlue(): Promise<Physics2dGlue> {
  const jsPath = fileURLToPath(new URL("../../wasm/physics2d/gwen_core.js", import.meta.url));
  const loaded: unknown = await import(pathToFileURL(jsPath).href);
  if (!isPhysics2dGlue(loaded)) {
    throw new Error("physics2d glue is missing Engine");
  }
  return loaded;
}

function isPhysics2dGlue(value: unknown): value is Physics2dGlue {
  if (typeof value !== "object" || value === null) return false;
  return (
    typeof Reflect.get(value, "Engine") === "function" &&
    typeof Reflect.get(value, "initSync") === "function"
  );
}

function physics2dWasmBytes(): Uint8Array<ArrayBuffer> {
  const wasmPath = fileURLToPath(
    new URL("../../wasm/physics2d/gwen_core_bg.wasm", import.meta.url),
  );
  const file = readFileSync(wasmPath);
  const bytes = new Uint8Array(file.byteLength);
  bytes.set(file);
  return bytes;
}

function openPhysics2dEngine(glue: Physics2dGlue, maxEntities: number): Physics2dEngine {
  const ctor: unknown = glue.Engine;
  if (!isPhysics2dEngineCtor(ctor)) {
    throw new Error("physics2d glue Engine cannot build a query engine");
  }
  return new ctor(maxEntities);
}

function isPhysics2dEngineCtor(
  value: unknown,
): value is new (maxEntities: number) => Physics2dEngine {
  if (typeof value !== "function") return false;
  const proto: unknown = Reflect.get(value, "prototype");
  if (typeof proto !== "object" || proto === null) return false;
  return (
    typeof Reflect.get(proto, "free") === "function" &&
    typeof Reflect.get(proto, "physics_init") === "function" &&
    typeof Reflect.get(proto, "physics_point_query") === "function" &&
    typeof Reflect.get(proto, "physics_query_radius") === "function" &&
    typeof Reflect.get(proto, "physics_query_rect") === "function" &&
    typeof Reflect.get(proto, "physics_step") === "function"
  );
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

    const glue = await loadPhysics2dGlue();
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

  it("has no known-panic row", async () => {
    const knownPanic = Object.values(PHYSICS2D).filter((row) => row.kind === "known-panic");
    expect(knownPanic).toEqual([]);
    expect(errorCode("INVALID_QUERY")).toBe("PHYSICS2D:INVALID_QUERY");
    expect(errorCode("INVALID_STEP_DELTA")).toBe("PHYSICS2D:INVALID_STEP_DELTA");

    const glue = await loadPhysics2dGlue();
    glue.initSync({ module: physics2dWasmBytes() });
    const engine = openPhysics2dEngine(glue, 32);
    try {
      engine.physics_init(0, -9.81, 32);
      expect(thrownWasmCode(() => engine.physics_point_query(Number.NaN, 0, 0, 0))).toBe(
        "PHYSICS2D:INVALID_QUERY",
      );
      expect(thrownWasmCode(() => engine.physics_query_radius(Number.NaN, 0, 1, 0, 0))).toBe(
        "PHYSICS2D:INVALID_QUERY",
      );
      expect(thrownWasmCode(() => engine.physics_query_rect(Number.NaN, 0, 1, 1, 0, 0))).toBe(
        "PHYSICS2D:INVALID_QUERY",
      );
      expect(thrownWasmCode(() => engine.physics_step(Number.NaN))).toBe(
        "PHYSICS2D:INVALID_STEP_DELTA",
      );
    } finally {
      engine.free();
    }
  });
});

function errorCode(key: string): unknown {
  if (!Object.hasOwn(Physics2DErrorCodes, key)) return undefined;
  const value: unknown = Reflect.get(Physics2DErrorCodes, key);
  return value;
}

function thrownWasmCode(run: () => unknown): unknown {
  try {
    run();
  } catch (err: unknown) {
    if (typeof err !== "object" || err === null) return undefined;
    return Reflect.get(err, "code");
  }
  return undefined;
}

function glueThrows(mod: object, ctor: WasmCtor, name: string): boolean {
  const onProto = Object.getOwnPropertyDescriptor(ctor.prototype as object, name)?.value;
  const onModule = Reflect.get(mod, name);
  const fn = typeof onProto === "function" ? onProto : onModule;
  if (typeof fn !== "function") return false;
  return Function.prototype.toString.call(fn).includes("throw takeObject");
}
