import { fileURLToPath, pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Light-variant classification of every own method on `Engine` and `JsEntityId`.
 * `result` returns `Result<_, CoreError>`.
 * `infallible` carries a written reason.
 * `known-panic` names the issue for a panic a TypeScript input can reach.
 * An export that is not in this table fails the test.
 */
type ExportRow =
  | { kind: "result" }
  | { kind: "infallible"; why: string }
  | { kind: "known-panic"; issue: number };

function result(): { kind: "result" } {
  return { kind: "result" };
}

function infallible(why: string): { kind: "infallible"; why: string } {
  return { kind: "infallible", why };
}

const ENGINE: Record<string, ExportRow> = {
  constructor: result(),
  __destroy_into_raw: infallible(""),
  free: infallible(""),
  "Symbol(Symbol.dispose)": infallible(""),
  "Symbol(nodejs.dispose)": infallible(""),
  add_component: result(),
  add_entity_transform: infallible(""),
  alloc_shared_buffer: infallible(""),
  bulk_destroy: infallible(""),
  bulk_spawn_with_transforms: result(),
  count_entities: infallible(""),
  create_entity: result(),
  delete_entity: infallible(""),
  dirty_transform_count: infallible(""),
  free_shared_buffer: result(),
  get_component_raw: infallible(""),
  get_components_bulk: result(),
  get_entity_generation: infallible(""),
  get_entity_local_rotation: infallible(""),
  get_entity_local_x: infallible(""),
  get_entity_local_y: infallible(""),
  get_entity_world_rotation: infallible(""),
  get_entity_world_x: infallible(""),
  get_entity_world_y: infallible(""),
  get_query_result_capacity: infallible(""),
  get_query_result_ptr: infallible(""),
  has_component: infallible(""),
  has_entity_parent: infallible(""),
  is_alive: infallible(""),
  query_entities: infallible(""),
  query_entities_to_buffer: result(),
  query_read_bulk: result(),
  query_write_bulk: result(),
  register_component_type: infallible(""),
  remove_component: infallible(""),
  remove_entity_from_query: infallible(""),
  set_components_bulk: result(),
  set_entity_local_position: infallible(""),
  set_entity_local_rotation: infallible(""),
  set_entity_local_scale: infallible(""),
  set_entity_parent: result(),
  stats: infallible(""),
  sync_transforms_to_buffer: result(),
  translate_entity: infallible(""),
  update_entity_archetype: infallible(""),
  update_transforms: infallible(""),
};

const JS_ENTITY_ID: Record<string, ExportRow> = {
  constructor: infallible(""),
  __destroy_into_raw: infallible(""),
  free: infallible(""),
  "Symbol(Symbol.dispose)": infallible(""),
  "Symbol(nodejs.dispose)": infallible(""),
  generation: infallible(""),
  index: infallible(""),
  "static __wrap": infallible(""),
};

type WasmCtor = new (...args: never[]) => unknown;

function symbolName(symbol: symbol): string {
  const text = String(symbol);
  // wasm-bindgen aliases Symbol.dispose as Symbol.for("nodejs.dispose") on some Node builds.
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
    const value = (ctor as unknown as Record<string, unknown>)[name];
    return typeof value === "function";
  });
  return [...prototypeNames, ...staticNames.map((name) => `static ${name}`)];
}

// Node exposes either Symbol.dispose or Symbol.for("nodejs.dispose") on the glue.
const HOST_DISPOSE = new Set(["Symbol(Symbol.dispose)", "Symbol(nodejs.dispose)"]);

const PLACEHOLDER_WHY = new Set(["infallible", "ok", "none", "n/a"]);

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

function expectInventory(actual: string[], table: Record<string, ExportRow>): void {
  const unlisted = actual.filter((name) => table[name] === undefined).sort();
  const missing = Object.keys(table)
    .filter((name) => !actual.includes(name) && !HOST_DISPOSE.has(name))
    .sort();
  expect(unlisted, `unlisted exports: ${unlisted.join(", ")}`).toEqual([]);
  expect(missing, `table entries absent from the glue: ${missing.join(", ")}`).toEqual([]);
  for (const [name, row] of Object.entries(table)) {
    requireReason(name, row);
  }
  for (const name of actual) {
    expect(table[name]).toBeDefined();
  }
}

describe("WASM export inventory", () => {
  it("classifies every own method of the light Engine and JsEntityId", async () => {
    const jsPath = fileURLToPath(new URL("../../wasm/light/gwen_core.js", import.meta.url));
    const glue = (await import(pathToFileURL(jsPath).href)) as {
      Engine: WasmCtor;
      JsEntityId: WasmCtor;
    };

    expectInventory(ownMethods(glue.Engine), ENGINE);
    expectInventory(ownMethods(glue.JsEntityId), JS_ENTITY_ID);

    const resultExports = Object.entries(ENGINE)
      .filter(([, row]) => row.kind === "result")
      .map(([name]) => name)
      .sort();
    expect(resultExports).toEqual([
      "add_component",
      "bulk_spawn_with_transforms",
      "constructor",
      "create_entity",
      "free_shared_buffer",
      "get_components_bulk",
      "query_entities_to_buffer",
      "query_read_bulk",
      "query_write_bulk",
      "set_components_bulk",
      "set_entity_parent",
      "sync_transforms_to_buffer",
    ]);
  });
});
