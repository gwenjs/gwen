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
  __destroy_into_raw: infallible(
    "the light glue zeroes __wbg_ptr and returns it; this method does not call Rust",
  ),
  free: infallible(
    "the glue zeroes __wbg_ptr, then calls the generated drop; Engine has no Drop impl",
  ),
  "Symbol(Symbol.dispose)": infallible(
    "the light glue assigns Symbol.dispose to free at gwen_core.js:915",
  ),
  "Symbol(nodejs.dispose)": infallible(
    "wasm-bindgen aliases this name to Symbol.dispose, which the glue assigns to free",
  ),
  add_component: result(),
  add_entity_transform: infallible(
    "get_entity_generation uses records.get and unwrap_or(u32::MAX) at bindings.rs:605-608; add_transform inserts that key then reads it at transform.rs:321-322",
  ),
  alloc_shared_buffer: infallible(
    "a zero length, a rejected layout, or a null alloc_zeroed each return 0 at bindings.rs:929-939",
  ),
  bulk_destroy: infallible(
    "an index past records fails is_alive at entity.rs:121-122 and is skipped at bindings.rs:3565-3566",
  ),
  bulk_spawn_with_transforms: result(),
  count_entities: infallible("returns the stored live count at bindings.rs:176-177; no argument"),
  create_entity: result(),
  delete_entity: infallible(
    "deallocate returns false when the index is past records at entity.rs:98-99; a stale generation returns false at entity.rs:105-106",
  ),
  dirty_transform_count: infallible(
    "DirtySet::len is dense.len() at dirty_set.rs:67-68; the as u32 cast truncates",
  ),
  free_shared_buffer: result(),
  get_component_raw: infallible(
    "a dead entity returns an empty Vec at bindings.rs:286-290; get_location uses slice get at storage.rs:217-220; the column slice at archetype.rs:108-114 runs only for that stored row",
  ),
  get_components_bulk: result(),
  get_entity_generation: infallible(
    "records.get, then unwrap_or(u32::MAX) at bindings.rs:605-608 and entity.rs:145-146",
  ),
  get_entity_local_rotation: infallible("HashMap get, then unwrap_or(0.0) at bindings.rs:867-872"),
  get_entity_local_x: infallible("HashMap get, then unwrap_or(0.0) at bindings.rs:817-822"),
  get_entity_local_y: infallible("HashMap get, then unwrap_or(0.0) at bindings.rs:827-832"),
  get_entity_world_rotation: infallible("HashMap get, then unwrap_or(0.0) at bindings.rs:857-862"),
  get_entity_world_x: infallible("HashMap get, then unwrap_or(0.0) at bindings.rs:837-842"),
  get_entity_world_y: infallible("HashMap get, then unwrap_or(0.0) at bindings.rs:847-852"),
  get_query_result_capacity: infallible(
    "returns the buffer length cast to u32 at bindings.rs:682-683; the cast truncates",
  ),
  get_query_result_ptr: infallible("returns Vec::as_ptr at bindings.rs:673-674; no index"),
  has_component: infallible(
    "a dead entity returns false at bindings.rs:268-272; get_location uses slice get at storage.rs:195-200; graph.get indexes the stored archetype id at archetype_graph.rs:109-110",
  ),
  has_entity_parent: infallible("HashMap get, then unwrap_or(false) at bindings.rs:877-882"),
  is_alive: infallible("an index past records returns false at entity.rs:121-122"),
  mark_entity_teleport: infallible(
    "get_entity_generation then mark_pending_snap at bindings.rs:1057-1059; a missing node is a no-op at transform.rs:417-420",
  ),
  query_entities: infallible(
    "an unknown type id is skipped by bit_index at query.rs:26-28; archetype ids come from the graph list at storage.rs:360-365",
  ),
  query_entities_to_buffer: result(),
  query_read_bulk: result(),
  query_write_bulk: result(),
  register_component_type: infallible(
    "no argument; the counter starts at 0 at bindings.rs:131 and the body adds 1 at bindings.rs:198-199. The light build is wasm-pack --release and profile.release does not set overflow-checks, so that add wraps. A debug build panics when the add overflows u32",
  ),
  remove_component: infallible(
    "a dead entity returns false at bindings.rs:248-252; a missing location returns None at storage.rs:150; the next index is that stored archetype id at storage.rs:152",
  ),
  remove_entity_from_query: infallible(
    "bindings.rs:598-599 forwards the index to QuerySystem::remove_entity, which ignores it at query.rs:172-174",
  ),
  set_components_bulk: result(),
  set_entity_local_position: infallible(
    "a missing transform is None and the call returns at bindings.rs:790-794; set_position stores the Vec2 at transform.rs:160-162",
  ),
  set_entity_local_rotation: infallible(
    "a missing transform is None and the call returns at bindings.rs:799-803",
  ),
  set_entity_local_scale: infallible(
    "a missing transform is None and the call returns at bindings.rs:808-812",
  ),
  set_entity_parent: result(),
  stats: infallible("formats the stored live count at bindings.rs:3278-3279; no argument"),
  sync_transforms_to_buffer: result(),
  translate_entity: infallible(
    "a missing transform is None and the call returns at bindings.rs:780-785; the f32 add does not trap",
  ),
  transform_history_commit: result(),
  transform_history_ptr: infallible(
    "buffer greater than 1 or an empty buffer returns 0 at bindings.rs:1038-1048; a stored buffer returns as_ptr cast to usize at bindings.rs:1050",
  ),
  update_entity_archetype: infallible(
    "both parameters are unused; the body is empty at bindings.rs:590-592",
  ),
  update_transforms: infallible(
    "update walks a cloned id list with HashMap gets at transform.rs:424-459; the hierarchy walk is a loop at transform.rs:479-495",
  ),
};

const JS_ENTITY_ID: Record<string, ExportRow> = {
  constructor: infallible(
    "JsEntityId has no wasm_bindgen constructor at bindings.rs:54-67; new JsEntityId() does not enter Rust",
  ),
  __destroy_into_raw: infallible(
    "the light glue zeroes __wbg_ptr and returns it; this method does not call Rust",
  ),
  free: infallible(
    "the glue zeroes __wbg_ptr, then calls the generated drop; JsEntityId has no Drop impl",
  ),
  "Symbol(Symbol.dispose)": infallible(
    "the light glue assigns Symbol.dispose to free at gwen_core.js:958",
  ),
  "Symbol(nodejs.dispose)": infallible(
    "wasm-bindgen aliases this name to Symbol.dispose, which the glue assigns to free",
  ),
  generation: infallible("returns the stored field at bindings.rs:65-66"),
  index: infallible("returns the stored field at bindings.rs:58-59"),
  "static __wrap": infallible(
    "the glue stores ptr >>> 0 on the object at gwen_core.js:923-928; the method does not call Rust",
  ),
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
      "transform_history_commit",
    ]);
  });
});
