import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { createRealEngine } from "./harness.js";
import {
  JS_ENTITY_ID,
  LIGHT_DTS,
  LIGHT_JS,
  LIGHT_WASM,
  PHYSICS2D_DTS_EXTRA,
  PHYSICS2D_FREE_JS,
  PHYSICS2D_FREE_WASM,
  PHYSICS2D_JS_EXTRA,
  PHYSICS2D_WASM_EXTRA,
  PHYSICS3D_DTS_EXTRA,
  PHYSICS3D_FREE_JS,
  PHYSICS3D_FREE_WASM,
  PHYSICS3D_JS_EXTRA,
  PHYSICS3D_WASM_EXTRA,
} from "./wasm-export-signatures.js";

const VARIANTS = ["light", "physics2d", "physics3d"] as const;
type Variant = (typeof VARIANTS)[number];

const JS_EXTRA = {
  physics2d: PHYSICS2D_JS_EXTRA,
  physics3d: PHYSICS3D_JS_EXTRA,
} as const;

const WASM_EXTRA = {
  physics2d: PHYSICS2D_WASM_EXTRA,
  physics3d: PHYSICS3D_WASM_EXTRA,
} as const;

const FREE_JS = {
  physics2d: PHYSICS2D_FREE_JS,
  physics3d: PHYSICS3D_FREE_JS,
} as const;

const FREE_WASM = {
  physics2d: PHYSICS2D_FREE_WASM,
  physics3d: PHYSICS3D_FREE_WASM,
} as const;

// Free functions exported by wasm-bindgen, outside the Engine and JsEntityId classes.
const FREE_FUNCTIONS = new Set([
  "find_path_2d",
  "get_collision_event_count",
  "get_collision_events_ptr",
  "get_path_buffer_ptr",
  "find_path_3d",
  "get_path_buffer_ptr_3d",
  "init_navgrid_3d",
]);

// Glue module exports that are not compiled Rust functions.
const GLUE_RUNTIME = new Set(["Engine", "JsEntityId", "default", "initSync"]);

const VALTYPE: Record<number, string> = {
  0x7f: "i32",
  0x7e: "i64",
  0x7d: "f32",
  0x7c: "f64",
  0x7b: "v128",
  0x70: "funcref",
  0x6f: "externref",
};

interface WasmCtor {
  new (...args: never[]): object;
  prototype: object;
}

function readLeb(bytes: Uint8Array, cursor: { i: number }): number {
  let result = 0;
  let shift = 0;
  let byte = 0;
  do {
    const next = bytes[cursor.i];
    if (next === undefined) throw new Error("wasm ended inside a leb128");
    cursor.i += 1;
    byte = next;
    result |= (byte & 0x7f) << shift;
    shift += 7;
  } while ((byte & 0x80) !== 0);
  return result >>> 0;
}

function valtypes(bytes: Uint8Array, cursor: { i: number }): string[] {
  const count = readLeb(bytes, cursor);
  const out: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const code = bytes[cursor.i];
    if (code === undefined) throw new Error("wasm ended inside a valtype");
    cursor.i += 1;
    const name = VALTYPE[code];
    if (name === undefined) throw new Error(`unknown wasm valtype ${code}`);
    out.push(name);
  }
  return out;
}

function skipImport(bytes: Uint8Array, cursor: { i: number }, kind: number): void {
  if (kind !== 0) {
    throw new Error(`wasm import is not a function (kind ${kind})`);
  }
  readLeb(bytes, cursor);
}

function wasmExportSignatures(variant: Variant): string[] {
  const wasmPath = fileURLToPath(
    new URL(`../../wasm/${variant}/gwen_core_bg.wasm`, import.meta.url),
  );
  const bytes = readFileSync(wasmPath);
  const cursor = { i: 8 };
  const types: string[] = [];
  let importFuncs = 0;
  const funcs: number[] = [];
  const lines: string[] = [];

  while (cursor.i < bytes.length) {
    const id = bytes[cursor.i];
    if (id === undefined) break;
    cursor.i += 1;
    const size = readLeb(bytes, cursor);
    const end = cursor.i + size;
    if (id === 1) {
      const count = readLeb(bytes, cursor);
      for (let i = 0; i < count; i += 1) {
        if (bytes[cursor.i] !== 0x60) throw new Error("wasm type section is not a functype");
        cursor.i += 1;
        const params = valtypes(bytes, cursor);
        const results = valtypes(bytes, cursor);
        types.push(`(${params.join(",")})->(${results.join(",")})`);
      }
    } else if (id === 2) {
      const count = readLeb(bytes, cursor);
      for (let i = 0; i < count; i += 1) {
        const moduleLen = readLeb(bytes, cursor);
        cursor.i += moduleLen;
        const nameLen = readLeb(bytes, cursor);
        cursor.i += nameLen;
        const kind = bytes[cursor.i];
        if (kind === undefined) throw new Error("wasm ended inside an import");
        cursor.i += 1;
        if (kind === 0) importFuncs += 1;
        skipImport(bytes, cursor, kind);
      }
    } else if (id === 3) {
      const count = readLeb(bytes, cursor);
      for (let i = 0; i < count; i += 1) funcs.push(readLeb(bytes, cursor));
    } else if (id === 7) {
      const count = readLeb(bytes, cursor);
      for (let i = 0; i < count; i += 1) {
        const length = readLeb(bytes, cursor);
        const name = Buffer.from(bytes.subarray(cursor.i, cursor.i + length)).toString();
        cursor.i += length;
        const kind = bytes[cursor.i];
        if (kind === undefined) throw new Error("wasm ended inside an export");
        cursor.i += 1;
        const index = readLeb(bytes, cursor);
        if (kind !== 0) continue;
        if (
          !name.startsWith("engine_") &&
          !name.startsWith("physics") &&
          !name.startsWith("jsentityid_") &&
          !FREE_FUNCTIONS.has(name)
        ) {
          continue;
        }
        const signature = types[funcs[index - importFuncs] ?? -1];
        if (signature === undefined) throw new Error(`wasm export ${name} has no type`);
        lines.push(`${name} ${signature}`);
      }
    }
    cursor.i = end;
  }

  return lines.sort();
}

function paramsOf(fn: object): string {
  const source = Function.prototype.toString.call(fn);
  const head = source.slice(0, source.indexOf("{"));
  return head.match(/\(([^)]*)\)/)?.[1]?.trim() ?? "";
}

function freeLines(glue: Record<string, unknown>, label: string): string[] {
  return Object.keys(glue)
    .filter((name) => !GLUE_RUNTIME.has(name))
    .sort()
    .map((name) => {
      const fn = glue[name];
      if (typeof fn !== "function") throw new Error(`${label}.${name} is not a function`);
      return `${name}(${paramsOf(fn)})`;
    });
}

function prototypeLines(proto: object, label: string): string[] {
  return Object.getOwnPropertyNames(proto)
    .filter((name) => name !== "constructor")
    .sort()
    .map((name) => {
      const desc = Object.getOwnPropertyDescriptor(proto, name);
      const fn = desc?.get ?? desc?.value;
      if (typeof fn !== "function") throw new Error(`${label}.${name} is not a function`);
      const prefix = desc?.get !== undefined ? "get " : "";
      return `${prefix}${name}(${paramsOf(fn)})`;
    });
}

async function glueLines(variant: Variant): Promise<string[]> {
  const jsPath = fileURLToPath(new URL(`../../wasm/${variant}/gwen_core.js`, import.meta.url));
  const glue = (await import(pathToFileURL(jsPath).href)) as {
    Engine: WasmCtor;
    JsEntityId: WasmCtor;
  } & Record<string, unknown>;
  return [
    ...prototypeLines(glue.Engine.prototype, `${variant} Engine`),
    ...prototypeLines(glue.JsEntityId.prototype, `${variant} JsEntityId`),
    ...freeLines(glue, `${variant} glue`),
  ].sort();
}

const DTS_EXTRA = {
  physics2d: PHYSICS2D_DTS_EXTRA,
  physics3d: PHYSICS3D_DTS_EXTRA,
} as const;

// One line per class member (`Engine.`, `JsEntityId.`) and per free function of the glue
// .d.ts, comments stripped, up to the wasm-bindgen init types.
function dtsLines(variant: Variant): string[] {
  const dtsPath = fileURLToPath(new URL(`../../wasm/${variant}/gwen_core.d.ts`, import.meta.url));
  const source = readFileSync(dtsPath, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const end = source.indexOf("export type InitInput");
  if (end === -1) throw new Error(`${variant} glue .d.ts has no InitInput type`);
  const lines: string[] = [];
  let owner: string | null = null;
  for (const raw of source.slice(0, end).split("\n")) {
    const line = raw.trim().replace(/\s+/g, " ");
    if (line === "") continue;
    const cls = /^export class (\w+) \{$/.exec(line);
    if (cls?.[1] !== undefined) {
      owner = cls[1];
    } else if (line === "}") {
      owner = null;
    } else if (owner !== null) {
      lines.push(`${owner}.${line}`);
    } else if (line.startsWith("export function ")) {
      lines.push(line.slice("export function ".length));
    } else {
      throw new Error(`${variant} glue .d.ts has an unexpected line: ${line}`);
    }
  }
  return lines.sort();
}

function expectedDts(variant: Variant): string[] {
  if (variant === "light") return [...LIGHT_DTS];
  return [...LIGHT_DTS, ...DTS_EXTRA[variant]].sort();
}

function expectedJs(variant: Variant): string[] {
  const shared = [...LIGHT_JS, ...JS_ENTITY_ID];
  if (variant === "light") return shared.sort();
  return [...shared, ...JS_EXTRA[variant], ...FREE_JS[variant]].sort();
}

function expectedWasm(variant: Variant): string[] {
  if (variant === "light") return [...LIGHT_WASM];
  return [...LIGHT_WASM, ...WASM_EXTRA[variant], ...FREE_WASM[variant]].sort();
}

describe("WASM export signatures", () => {
  it("rejects a non-function wasm import", () => {
    const cursor = { i: 0 };
    expect(() => skipImport(new Uint8Array([0x00]), cursor, 2)).toThrow(/not a function/);
  });

  // 1 table, 2 memory (above), 3 global, 4 tag. A shared-memory build imports its memory,
  // so this parser, and this suite, would reject it.
  it.each([1, 3, 4])("rejects a wasm import of kind %i", (kind) => {
    const cursor = { i: 0 };
    expect(() => skipImport(new Uint8Array([0x00]), cursor, kind)).toThrow(
      `wasm import is not a function (kind ${kind})`,
    );
  });

  it("reads the type index of a function import", () => {
    const cursor = { i: 0 };
    skipImport(new Uint8Array([0x85, 0x01]), cursor, 0);
    expect(cursor.i).toBe(2);
  });

  it("glue parameters and wasm types match for light, physics2d and physics3d", async () => {
    for (const variant of VARIANTS) {
      expect(await glueLines(variant), `${variant} glue`).toEqual(expectedJs(variant));
      expect(wasmExportSignatures(variant), `${variant} wasm`).toEqual(expectedWasm(variant));
    }
  });

  // Parameter names and wasm types miss a Rust change that keeps both, such as `bool`
  // against `u32`. The glue .d.ts carries the TypeScript type of each parameter.
  it.each(VARIANTS)("glue .d.ts signatures match for %s", (variant) => {
    expect(dtsLines(variant)).toEqual(expectedDts(variant));
  });

  it.each(VARIANTS)("create_entity and the %s step use that signature", async (variant) => {
    const handle = await createRealEngine({ variant, maxEntities: 8 });
    try {
      const raw = handle.bridge.engine();
      const id = raw.create_entity();
      expect(typeof id.index).toBe("number");
      expect(typeof id.generation).toBe("number");
      expect(raw.is_alive(id.index, id.generation)).toBe(true);
      expect(raw.delete_entity(id.index, id.generation)).toBe(true);
      expect(raw.count_entities()).toBe(0);

      if (variant === "physics2d") {
        if (
          raw.physics_init === undefined ||
          raw.physics_step === undefined ||
          raw.physics_get_collision_event_count === undefined
        ) {
          throw new Error(
            "physics2d exports physics_init, physics_step and physics_get_collision_event_count",
          );
        }
        raw.physics_init(0, -10, 8);
        raw.physics_step(1 / 60);
        expect(typeof raw.physics_get_collision_event_count()).toBe("number");
      }

      if (variant === "physics3d") {
        if (
          raw.physics3d_init === undefined ||
          raw.physics3d_step === undefined ||
          raw.physics3d_get_collision_event_count === undefined
        ) {
          throw new Error(
            "physics3d exports physics3d_init, physics3d_step and physics3d_get_collision_event_count",
          );
        }
        raw.physics3d_init(0, -10, 0, 8);
        raw.physics3d_step(1 / 60);
        expect(typeof raw.physics3d_get_collision_event_count()).toBe("number");
      }
    } finally {
      await handle.dispose();
    }
    expect(handle.engine.state).toBe("stopped");
  });
});
