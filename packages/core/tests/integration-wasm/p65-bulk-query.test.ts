import { fileURLToPath, pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { defineComponent, Types } from "../../src/schema.js";
import { useQuery } from "../../src/system/runtime/define-system.js";
import { createRealEngine } from "./harness.js";

const BulkPos = defineComponent({
  name: "P65BulkPos",
  schema: { x: Types.f32, y: Types.f32 },
  defaults: { x: 0, y: 0 },
});

const VecPos = defineComponent({
  name: "P65VecPos",
  schema: { p: Types.vec2 },
  defaults: { p: { x: 0, y: 0 } },
});

interface QueryChunksHost {
  query_chunks?: (this: object, query: number) => unknown;
}

function isEngineClass(value: unknown): value is { prototype: QueryChunksHost } {
  return typeof value === "function" && typeof value.prototype === "object" && value.prototype !== null;
}

async function loadEnginePrototype(): Promise<QueryChunksHost> {
  const jsPath = fileURLToPath(new URL("../../wasm/light/gwen_core.js", import.meta.url));
  const glue: unknown = await import(pathToFileURL(jsPath).href);
  if (typeof glue !== "object" || glue === null || !("Engine" in glue)) {
    throw new Error("light wasm glue has no Engine export");
  }
  if (!isEngineClass(glue.Engine)) {
    throw new Error("light wasm glue Engine has no prototype");
  }
  return glue.Engine.prototype;
}

function watchQueryChunks(proto: QueryChunksHost): { calls: () => number; restore: () => void } {
  const original = proto.query_chunks;
  if (typeof original !== "function") {
    const names = Object.getOwnPropertyNames(proto).sort().join(", ");
    throw new Error(`Engine.prototype.query_chunks is missing. Prototype: ${names}`);
  }
  let calls = 0;
  proto.query_chunks = function (this: object, query: number): unknown {
    calls += 1;
    const result: unknown = original.call(this, query);
    return result;
  };
  return {
    calls: () => calls,
    restore(): void {
      proto.query_chunks = original;
    },
  };
}

describe("p65 bulk query", () => {
  it("reads 10000 written x values in one query_chunks call", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 16_384 });
    let restore = (): void => {};
    try {
      const { engine } = handle;
      for (let index = 0; index < 10_000; index += 1) {
        const id = engine.createEntity();
        engine.addComponent(id, BulkPos, { x: index, y: 0 });
      }

      const watched = watchQueryChunks(await loadEnginePrototype());
      restore = watched.restore;
      const query = engine.run(() => useQuery([BulkPos]));
      const seen = new Set<number>();
      for (const chunk of query) {
        const x = (chunk.get(BulkPos) as { x?: unknown }).x;
        if (!(x instanceof Float32Array)) continue;
        for (let row = 0; row < x.length; row += 1) {
          const value = x[row];
          if (typeof value === "number") seen.add(value);
        }
      }

      expect(seen.size).toBe(10_000);
      expect(seen.has(0)).toBe(true);
      expect(seen.has(9_999)).toBe(true);
      expect(watched.calls()).toBe(1);
    } finally {
      restore();
      await handle.dispose();
    }
  }, 60_000);

  it("chunk.get stays live after memory.grow(1)", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 16_384 });
    try {
      const { engine, bridge } = handle;
      const id = engine.createEntity();
      engine.addComponent(id, BulkPos, { x: 4, y: 0 });
      const query = engine.run(() => useQuery([BulkPos]));

      let live: number | undefined;
      for (const chunk of query) {
        const memory = bridge.getLinearMemory();
        if (memory === null) throw new Error("light wasm did not export memory");
        memory.grow(1);
        const x = (chunk.get(BulkPos) as { x?: unknown }).x;
        if (x instanceof Float32Array) live = x[0];
      }

      expect(live).toBe(4);
    } finally {
      await handle.dispose();
    }
  });

  it("a vec2 column keeps y when x is written", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 16_384 });
    try {
      const { engine } = handle;
      const id = engine.createEntity();
      engine.addComponent(id, VecPos, { p: { x: 1, y: 2 } });
      const query = engine.run(() => useQuery([VecPos]));

      for (const chunk of query) {
        const p = (chunk.get(VecPos) as { p?: { x?: unknown; y?: unknown } }).p;
        expect(ArrayBuffer.isView(p?.x)).toBe(true);
        if (p?.x instanceof Float32Array && p.y instanceof Float32Array) {
          p.x[0] = 5;
          expect(p.y[0]).toBe(2);
          expect(engine.getComponent(id, VecPos)?.p).toEqual({ x: 5, y: 2 });
        }
      }
    } finally {
      await handle.dispose();
    }
  });
});
