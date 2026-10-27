import { afterEach, describe, expect, it } from "vitest";
import { errorDocsUrl, GwenError } from "@gwenjs/schema";
import {
  CoreErrorCodes,
  createEngine,
  defineComponent,
  GwenWasmError,
  GwenWasmPanicError,
  Types,
  type GwenEngine,
} from "../../src/index.js";
import { defineSystem, useQuery } from "../../src/system/index.js";
import {
  LINK_ERROR_WASM,
  NO_MEMORY_WASM,
  wasmDataUrl,
} from "../integration-wasm/fixtures/transform-reader.js";
const C = CoreErrorCodes;
const engines: GwenEngine[] = [];
const Mark = defineComponent({ name: "QueryGrammarMark", schema: { v: Types.f32 } });
afterEach(async () => {
  for (const engine of engines.splice(0)) await engine.stop();
});
function thrown(run: () => void): unknown {
  try {
    run();
    return undefined;
  } catch (error) {
    return error;
  }
}
async function thrownAsync(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
    return undefined;
  } catch (error) {
    return error;
  }
}
function sentence(text: string): string {
  return text.endsWith(".") || text.endsWith("?") || text.endsWith("!") ? text : `${text}.`;
}
function devHint(text: string): string | undefined {
  return __GWEN_DEV__ ? text : undefined;
}
function expectGrammar(
  error: unknown,
  code: string,
  what: string,
  composable?: string | undefined,
  hint?: string | undefined,
): GwenError {
  expect(error).toBeInstanceOf(GwenError);
  if (!(error instanceof GwenError)) throw new Error("expected GwenError");
  expect(error.code).toBe(code);
  expect(error.composable).toBe(composable);
  expect(error.hint).toBe(hint);
  const where = composable !== undefined ? `${composable}()` : "GWEN";
  const fix = hint !== undefined ? `\nFix: ${hint}` : "";
  expect(error.message).toBe(`[${where}] ${what}${fix}\nSee ${errorDocsUrl(code)} (${code})`);
  return error;
}
function expectCause(
  error: unknown,
  code: string,
  what: string,
  cause: unknown,
  composable?: string,
): GwenError {
  const gwen = expectGrammar(error, code, what, composable);
  expect(gwen.cause).toBe(cause);
  return gwen;
}
function invalid(error: unknown, composable: string): void {
  expectGrammar(error, C.QUERY_INVALID, "Query is invalid.", composable);
}
async function open(maxEntities: number): Promise<GwenEngine> {
  const engine = await createEngine({ maxEntities });
  engines.push(engine);
  return engine;
}
async function mountQuery(engine: GwenEngine, label: string) {
  let query: ReturnType<typeof useQuery<[typeof Mark]>> | undefined;
  await engine.use(
    defineSystem(label, () => {
      query = useQuery([Mark]);
    })(),
  );
  if (query === undefined) throw new Error("query was not captured");
  await engine.startExternal();
  return query;
}
function causeOf(error: unknown): Error {
  expect(error).toBeInstanceOf(GwenError);
  if (!(error instanceof GwenError)) throw new Error("expected GwenError");
  expect(error.cause).toBeInstanceOf(Error);
  if (!(error.cause instanceof Error)) throw new Error("expected Error cause");
  return error.cause;
}
describe("wasm and query error grammar", () => {
  it("a GwenWasmError message is [GWEN] <rust text>. then See with its code", async () => {
    const engine = await open(1);
    engine.createEntity();
    const caught = thrown(() => engine.createEntity());
    expect(caught).toBeInstanceOf(GwenWasmError);
    if (!(caught instanceof GwenWasmError)) return;
    expect(caught.exportName).toBe("create_entity");
    const cause = causeOf(caught);
    expect(cause.message).toBe("Entity limit reached: 1");
    expectCause(caught, C.ENTITY_LIMIT_REACHED, "Entity limit reached: 1.", cause);
  });
  it("a Rust text that already ends with a period gets no second period", () => {
    const see = `See ${errorDocsUrl(C.ENTITY_LIMIT_REACHED)} (${C.ENTITY_LIMIT_REACHED})`;
    const built = (text: string): GwenWasmError =>
      new GwenWasmError(C.ENTITY_LIMIT_REACHED, text, "create_entity", undefined);
    expect(built("Already.").message).toBe(`[GWEN] Already.\n${see}`);
    expect(built("Sure?").message).toBe(`[GWEN] Sure?\n${see}`);
    expect(built("Stop!").message).toBe(`[GWEN] Stop!\n${see}`);
    expect(built("").message).toBe(`[GWEN] .\n${see}`);
  });
  it("a RuntimeError from engine:before-update poisons the next createEntity as CORE:WASM_PANIC", async () => {
    const engine = await open(4);
    const trap = new WebAssembly.RuntimeError("unreachable");
    engine.hooks.hook("engine:before-update", () => {
      throw trap;
    });
    await engine.advance(1 / 60);
    const bridge = engine.tryInject("wasm:bridge");
    if (bridge === undefined) throw new Error("wasm bridge missing");
    const caught = thrown(() => bridge.createEntity());
    expect(caught).toBeInstanceOf(GwenWasmPanicError);
    if (!(caught instanceof GwenWasmPanicError)) return;
    expect(caught.exportName).toBeUndefined();
    expectCause(caught, C.WASM_PANIC, "unreachable.", trap);
  });
  it("loadWasmModule of a module without memory throws CORE:WASM_MODULE_NO_MEMORY naming engine.loadWasmModule", async () => {
    const engine = await open(4);
    const hint = devHint('Add (export "memory" (memory ...)) to the WASM module.');
    const caught = await thrownAsync(() =>
      engine.loadWasmModule({
        name: "bare",
        url: wasmDataUrl(NO_MEMORY_WASM),
        channels: [{ name: "commands", direction: "ts→wasm", capacity: 1, itemByteSize: 4 }],
      }),
    );
    expectGrammar(
      caught,
      C.WASM_MODULE_NO_MEMORY,
      'Channel "commands" was declared but module "bare" does not export memory.',
      "engine.loadWasmModule",
      hint,
    );
  });
  it("a failed fetch and a link error throw CORE:WASM_LOAD_ERROR and keep the cause", async () => {
    const engine = await open(4);
    const fetchUrl = "http://127.0.0.1:1/missing.wasm";
    const fetchCaught = await thrownAsync(() =>
      engine.loadWasmModule({ name: "missing", url: fetchUrl }),
    );
    const fetchCause = causeOf(fetchCaught);
    expectCause(
      fetchCaught,
      C.WASM_LOAD_ERROR,
      sentence(`Failed to load WASM module "missing" from "${fetchUrl}": ${fetchCause.message}`),
      fetchCause,
      "engine.loadWasmModule",
    );
    const linkUrl = wasmDataUrl(LINK_ERROR_WASM);
    const linkCaught = await thrownAsync(() =>
      engine.loadWasmModule({ name: "link", url: linkUrl }),
    );
    const linkCause = causeOf(linkCaught);
    expect(linkCause).toBeInstanceOf(TypeError);
    expectCause(
      linkCaught,
      C.WASM_LOAD_ERROR,
      sentence(`Failed to instantiate WASM module "link" from "${linkUrl}": ${linkCause.message}`),
      linkCause,
      "engine.loadWasmModule",
    );
  });
  it("a released query and an out-of-range entityId throw CORE:QUERY_INVALID with the caller composable", async () => {
    const engine = await open(4);
    const first = engine.createEntity();
    const second = engine.createEntity();
    engine.addComponent(first, Mark, { v: 1 });
    engine.addComponent(second, Mark, { v: 2 });
    const query = await mountQuery(engine, "query-grammar");
    let saw = 0;
    let held: { get(def: typeof Mark): unknown } | undefined;
    for (const chunk of query) {
      saw += 1;
      expect(chunk.count).toBe(2);
      expect(new Set([chunk.entityId(0), chunk.entityId(chunk.count - 1)])).toEqual(
        new Set([first, second]),
      );
      const below = thrown(() => chunk.entityId(-1));
      const above = thrown(() => chunk.entityId(chunk.count));
      invalid(below, "QueryChunk.entityId");
      invalid(above, "QueryChunk.entityId");
      held = chunk;
    }
    expect(saw).toBe(1);
    if (held === undefined) throw new Error("chunk was not captured");
    const chunk = held;
    const stale = thrown(() => chunk.get(Mark));
    invalid(stale, "QueryChunk.get");
    const heldIter = query[Symbol.iterator]();
    await engine.stop();
    const eachError = thrown(() => query.each());
    const countError = thrown(() => {
      void query.count;
    });
    const iterError = thrown(() => {
      for (const item of query) void item;
    });
    invalid(eachError, "Query.each");
    invalid(countError, "Query.count");
    invalid(iterError, "useQuery");
    const nextError = thrown(() => {
      heldIter.next();
    });
    invalid(nextError, "useQuery");
  });
  it("chunk.get of a component outside the query throws CORE:QUERY_INVALID naming QueryChunk.get", async () => {
    const engine = await open(4);
    const Spare = defineComponent({ name: "QueryGrammarSpare", schema: { v: Types.f32 } });
    engine.addComponent(engine.createEntity(), Mark, { v: 1 });
    const query = await mountQuery(engine, "query-outside");
    let saw = 0;
    let caught: unknown;
    for (const chunk of query) {
      saw += 1;
      caught = thrown(() => chunk.get(Spare as typeof Mark));
    }
    expect(saw).toBe(1);
    invalid(caught, "QueryChunk.get");
  });
  it("a memory view with length 0 throws CORE:MEMORY_VIEW_INVALID", async () => {
    const engine = await open(4);
    const view = engine.memory.view({ name: "scratch", type: "u8", ptr: () => 0, length: () => 0 });
    const caught = thrown(() => {
      void view.array;
    });
    expectGrammar(
      caught,
      C.MEMORY_VIEW_INVALID,
      'Memory view "scratch" is invalid: length must be > 0.',
    );
  });
});
