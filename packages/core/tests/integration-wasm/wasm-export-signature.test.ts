import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { createRealEngine, type RealEngineHandle } from "./harness.js";
import {
  LIGHT_JS,
  LIGHT_WASM,
  PHYSICS2D_JS_EXTRA,
  PHYSICS2D_WASM_EXTRA,
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
  if (kind === 0 || kind === 1 || kind === 3 || kind === 4) {
    readLeb(bytes, cursor);
    return;
  }
  if (kind === 2) {
    readLeb(bytes, cursor);
    cursor.i += 1;
    return;
  }
  throw new Error(`unknown wasm import kind ${kind}`);
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
        if (!name.startsWith("engine_") && !name.startsWith("physics")) continue;
        const signature = types[funcs[index - importFuncs] ?? -1];
        if (signature === undefined) throw new Error(`wasm export ${name} has no type`);
        lines.push(`${name} ${signature}`);
      }
    }
    cursor.i = end;
  }

  return lines.sort();
}

async function glueLines(variant: Variant): Promise<string[]> {
  const jsPath = fileURLToPath(new URL(`../../wasm/${variant}/gwen_core.js`, import.meta.url));
  const glue = (await import(pathToFileURL(jsPath).href)) as { Engine: WasmCtor };
  const proto = glue.Engine.prototype as Record<string, unknown>;
  return Object.getOwnPropertyNames(proto)
    .filter((name) => name !== "constructor")
    .sort()
    .map((name) => {
      const fn = proto[name];
      if (typeof fn !== "function") throw new Error(`${variant} Engine.${name} is not a function`);
      const source = Function.prototype.toString.call(fn);
      const head = source.slice(0, source.indexOf("{"));
      const params = head.match(/\(([^)]*)\)/)?.[1]?.trim() ?? "";
      return `${name}(${params})`;
    });
}

function expectedJs(variant: Variant): string[] {
  if (variant === "light") return [...LIGHT_JS];
  return [...LIGHT_JS, ...JS_EXTRA[variant]].sort();
}

function expectedWasm(variant: Variant): string[] {
  if (variant === "light") return [...LIGHT_WASM];
  return [...LIGHT_WASM, ...WASM_EXTRA[variant]].sort();
}

async function stop(handle: RealEngineHandle): Promise<void> {
  await handle.dispose();
  expect(handle.engine.state).toBe("stopped");
}

describe("WASM export signatures", () => {
  it("glue parameters and wasm types match for light, physics2d and physics3d", async () => {
    for (const variant of VARIANTS) {
      expect(await glueLines(variant), `${variant} glue`).toEqual(expectedJs(variant));
      expect(wasmExportSignatures(variant), `${variant} wasm`).toEqual(expectedWasm(variant));
    }
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
      await stop(handle);
    }
  });
});
