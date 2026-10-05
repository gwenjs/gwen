import { fileURLToPath, pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Light-variant classification of every own method on `Engine` and `JsEntityId`.
 * `result` returns `Result<_, CoreError>`. Everything else is infallible.
 * An export that is not in this table fails the test.
 */
const ENGINE: Record<string, "infallible" | "result"> = {
  constructor: "result",
  __destroy_into_raw: "infallible",
  free: "infallible",
  "Symbol(Symbol.dispose)": "infallible",
  add_component: "result",
  add_entity_transform: "infallible",
  alloc_shared_buffer: "infallible",
  bulk_destroy: "infallible",
  bulk_spawn_with_transforms: "result",
  count_entities: "infallible",
  create_entity: "result",
  delete_entity: "infallible",
  delta_time: "infallible",
  dirty_transform_count: "infallible",
  frame_count: "infallible",
  free_shared_buffer: "infallible",
  get_component_raw: "infallible",
  get_components_bulk: "infallible",
  get_entity_generation: "infallible",
  get_entity_local_rotation: "infallible",
  get_entity_local_x: "infallible",
  get_entity_local_y: "infallible",
  get_entity_world_rotation: "infallible",
  get_entity_world_x: "infallible",
  get_entity_world_y: "infallible",
  get_query_result_capacity: "infallible",
  get_query_result_ptr: "infallible",
  has_component: "infallible",
  has_entity_parent: "infallible",
  is_alive: "infallible",
  query_entities: "infallible",
  query_entities_to_buffer: "result",
  query_read_bulk: "infallible",
  query_write_bulk: "result",
  register_component_type: "infallible",
  remove_component: "infallible",
  remove_entity_from_query: "infallible",
  reset_frame: "infallible",
  set_components_bulk: "result",
  set_entity_local_position: "infallible",
  set_entity_local_rotation: "infallible",
  set_entity_local_scale: "infallible",
  set_entity_parent: "result",
  should_sleep: "infallible",
  sleep_time_ms: "infallible",
  stats: "infallible",
  sync_transforms_from_buffer: "result",
  sync_transforms_to_buffer: "result",
  sync_transforms_to_buffer_sparse: "infallible",
  tick: "infallible",
  total_time: "infallible",
  translate_entity: "infallible",
  update_entity_archetype: "infallible",
  update_transforms: "infallible",
};

const JS_ENTITY_ID: Record<string, "infallible" | "result"> = {
  constructor: "infallible",
  __destroy_into_raw: "infallible",
  free: "infallible",
  "Symbol(Symbol.dispose)": "infallible",
  generation: "infallible",
  index: "infallible",
  "static __wrap": "infallible",
};

type WasmCtor = new (...args: never[]) => unknown;

function ownMethods(ctor: WasmCtor): string[] {
  const proto = ctor.prototype as object;
  const prototypeNames = [
    ...Object.getOwnPropertyNames(proto),
    ...Object.getOwnPropertySymbols(proto).map((symbol) => String(symbol)),
  ];
  const staticNames = Object.getOwnPropertyNames(ctor).filter((name) => {
    if (name === "prototype" || name === "length" || name === "name") return false;
    const value = (ctor as unknown as Record<string, unknown>)[name];
    return typeof value === "function";
  });
  return [...prototypeNames, ...staticNames.map((name) => `static ${name}`)];
}

function expectInventory(actual: string[], table: Record<string, "infallible" | "result">): void {
  const unlisted = actual.filter((name) => table[name] === undefined).sort();
  const missing = Object.keys(table)
    .filter((name) => !actual.includes(name))
    .sort();
  expect(unlisted, `unlisted exports: ${unlisted.join(", ")}`).toEqual([]);
  expect(missing, `table entries absent from the glue: ${missing.join(", ")}`).toEqual([]);
  for (const name of actual) {
    expect(table[name] === "infallible" || table[name] === "result").toBe(true);
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
      .filter(([, kind]) => kind === "result")
      .map(([name]) => name)
      .sort();
    expect(resultExports).toEqual([
      "add_component",
      "bulk_spawn_with_transforms",
      "constructor",
      "create_entity",
      "query_entities_to_buffer",
      "query_write_bulk",
      "set_components_bulk",
      "set_entity_parent",
      "sync_transforms_from_buffer",
      "sync_transforms_to_buffer",
    ]);
  });
});
