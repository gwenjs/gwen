import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { GwenError } from "@gwenjs/schema";

import { defineActor } from "../../src/actor/runtime/define-actor.js";
import { definePrefab } from "../../src/actor/runtime/define-prefab.js";
import { useTransform } from "../../src/actor/runtime/use-transform.js";
import {
  CoreErrorCodes,
  GwenWasmError,
  GwenWasmPanicError,
  type CoreWasmErrorCode,
} from "../../src/engine/engine-errors.js";
import { createEngine } from "../../src/engine/engine-factory.js";
import type { GwenEngine } from "../../src/engine/engine-types.js";
import { toGwenWasmError, WasmBridgeImpl } from "../../src/engine/wasm-bridge.js";
import { createRealEngine, type RealEngineHandle } from "./harness.js";

const DETACH = 0xffffffff;
const prefab = definePrefab([]);

async function useLight(
  maxEntities: number,
  body: (handle: RealEngineHandle) => Promise<void>,
): Promise<RealEngineHandle> {
  const handle = await createRealEngine({ variant: "light", maxEntities });
  try {
    await body(handle);
  } finally {
    await handle.dispose();
  }
  return handle;
}

function lightUrls(): { jsUrl: string; wasmUrl: string } {
  const jsPath = fileURLToPath(new URL("../../wasm/light/gwen_core.js", import.meta.url));
  const wasmPath = fileURLToPath(new URL("../../wasm/light/gwen_core_bg.wasm", import.meta.url));
  const wasmBytes = readFileSync(wasmPath);
  return {
    jsUrl: pathToFileURL(jsPath).href,
    wasmUrl: `data:application/wasm;base64,${wasmBytes.toString("base64")}`,
  };
}

function expectWasmError(error: unknown, code: CoreWasmErrorCode, exportName: string): void {
  expect(error).toBeInstanceOf(GwenWasmError);
  expect(error).toBeInstanceOf(GwenError);
  expect(error).toMatchObject({ name: "GwenWasmError", code, exportName });
}

async function expectNextFrame(engine: GwenEngine): Promise<void> {
  const before = engine.frameCount;
  await engine.advance(1 / 60);
  expect(engine.frameCount).toBe(before + 1);
  expect(engine.state).not.toBe("faulted");
}

describe("WASM coded errors", () => {
  it("createEntity at the cap is ENTITY_LIMIT_REACHED and the bridge stays usable", async () => {
    const maxEntities = 4;
    const handle = await useLight(maxEntities, async ({ engine, bridge }) => {
      let caught: unknown;
      try {
        for (let n = 0; n < maxEntities + 1; n += 1) {
          bridge.createEntity();
        }
      } catch (error: unknown) {
        caught = error;
      }

      expectWasmError(caught, CoreErrorCodes.ENTITY_LIMIT_REACHED, "create_entity");
      expect((caught as GwenWasmError).message).toContain(String(maxEntities));
      expect(bridge.countEntities()).toBe(maxEntities);
      expect(bridge.isAlive(0, 0)).toBe(true);
      expect(bridge.deleteEntity(3, 0)).toBe(true);
      expect(bridge.createEntity().index).toBe(3);
      await expectNextFrame(engine);
    });
    expect(handle.engine.state).toBe("stopped");
  });

  it("the 129th component type is refused before any write", async () => {
    const handle = await useLight(4, async ({ engine, bridge }) => {
      const entity = bridge.createEntity();
      const bytes = new Uint8Array([1, 2, 3, 4]);
      const lanes = new Uint8Array([0]);
      for (let index = 0; index < 128; index += 1) {
        const typeId = bridge.registerComponent(lanes);
        expect(bridge.addComponent(entity.index, entity.generation, typeId, bytes)).toBe(true);
      }

      let caught: unknown;
      try {
        bridge.registerComponent(lanes);
      } catch (error: unknown) {
        caught = error;
      }

      expectWasmError(caught, CoreErrorCodes.COMPONENT_TYPE_LIMIT_REACHED, "register_component");
      expect(bridge.hasComponent(entity.index, entity.generation, 128)).toBe(false);
      expect(bridge.hasComponent(entity.index, entity.generation, 127)).toBe(true);
      const rewritten = new Uint8Array([4, 3, 2, 1]);
      expect(bridge.addComponent(entity.index, entity.generation, 127, rewritten)).toBe(true);
      expect(Array.from(bridge.getComponentRaw(entity.index, entity.generation, 127))).toEqual([
        4, 3, 2, 1,
      ]);
      expect(bridge.countEntities()).toBe(1);
      expect(bridge.createEntity().index).toBe(1);
      await expectNextFrame(engine);
    });
    expect(handle.engine.state).toBe("stopped");
  });

  it("setEntityParent refuses a self-parent and a cycle without changing the hierarchy", async () => {
    const handle = await useLight(8, async ({ engine, bridge }) => {
      const wasm = bridge.engine();
      const indices = [0, 1, 2].map(() => {
        const id = bridge.createEntity();
        wasm.add_entity_transform(id.index, id.index, 0, 0, 1, 1);
        return id.index;
      });
      const [root, mid, leaf] = indices as [number, number, number];
      bridge.setEntityParent(mid, root, false);
      bridge.setEntityParent(leaf, mid, false);

      let selfParent: unknown;
      try {
        bridge.setEntityParent(mid, mid, false);
      } catch (error: unknown) {
        selfParent = error;
      }
      expectWasmError(selfParent, CoreErrorCodes.INVALID_PARENT, "set_entity_parent");
      expect(wasm.has_entity_parent(mid)).toBe(true);
      expect(wasm.has_entity_parent(root)).toBe(false);
      await expectNextFrame(engine);

      let cycle: unknown;
      try {
        bridge.setEntityParent(root, leaf, true);
      } catch (error: unknown) {
        cycle = error;
      }
      expectWasmError(cycle, CoreErrorCodes.INVALID_PARENT, "set_entity_parent");
      expect(wasm.has_entity_parent(root)).toBe(false);
      expect(wasm.has_entity_parent(mid)).toBe(true);
      expect(wasm.has_entity_parent(leaf)).toBe(true);
      await expectNextFrame(engine);

      bridge.setEntityParent(leaf, DETACH, false);
      expect(wasm.has_entity_parent(leaf)).toBe(false);
      expect(wasm.has_entity_parent(mid)).toBe(true);
      expect(bridge.countEntities()).toBe(3);
      await expectNextFrame(engine);
    });
    expect(handle.engine.state).toBe("stopped");
  });

  it("useTransform().setParent maps INVALID_PARENT and actor spawns stay allocated", async () => {
    const handle = await useLight(8, async ({ engine, bridge }) => {
      const Actor = defineActor(prefab, () => ({ transform: useTransform() }));
      await engine.use(Actor._plugin);

      const parentId = Actor._plugin.spawn();
      const childId = Actor._plugin.spawn();
      const parent = Actor._instances.get(parentId)?.api?.transform;
      const child = Actor._instances.get(childId)?.api?.transform;
      if (parent === undefined || child === undefined) {
        throw new Error("actor factory did not return a transform");
      }

      let selfParent: unknown;
      try {
        child.setParent(childId);
      } catch (error: unknown) {
        selfParent = error;
      }
      expectWasmError(selfParent, CoreErrorCodes.INVALID_PARENT, "set_entity_parent");
      expect(child.hasParent).toBe(false);
      await expectNextFrame(engine);

      child.setParent(parentId);
      expect(child.hasParent).toBe(true);

      let cycle: unknown;
      try {
        parent.setParent(childId);
      } catch (error: unknown) {
        cycle = error;
      }
      expectWasmError(cycle, CoreErrorCodes.INVALID_PARENT, "set_entity_parent");
      expect(parent.hasParent).toBe(false);
      expect(child.hasParent).toBe(true);
      await expectNextFrame(engine);

      child.detach();
      expect(child.hasParent).toBe(false);
      expect(bridge.countEntities()).toBe(2);
      const extra = bridge.createEntity();
      expect(bridge.isAlive(extra.index, extra.generation)).toBe(true);
      expect(bridge.countEntities()).toBe(3);
      await expectNextFrame(engine);
    });
    expect(handle.engine.state).toBe("stopped");
  });

  it("Engine::new outside the range is INVALID_MAX_ENTITIES and a later init works", async () => {
    const bridge = new WasmBridgeImpl();
    const urls = lightUrls();
    let caught: unknown;
    try {
      await bridge.init("light", { maxEntities: 0, ...urls });
    } catch (error: unknown) {
      caught = error;
    }
    expectWasmError(caught, CoreErrorCodes.INVALID_MAX_ENTITIES, "new");

    await bridge.init("light", { maxEntities: 2, ...urls });
    const created = bridge.createEntity();
    expect(created.index).toBe(0);
    expect(created.generation).toBe(0);
    expect(bridge.countEntities()).toBe(1);
    const engine = await createEngine({ variant: "light", maxEntities: 2, _bridge: bridge });
    try {
      await expectNextFrame(engine);
    } finally {
      await engine.stop();
    }
    expect(engine.state).toBe("stopped");
  });

  it("syncTransformsToBuffer above capacity is INVALID_MAX_ENTITIES and writes nothing", async () => {
    const handle = await useLight(4, async ({ engine, bridge }) => {
      const ptr = bridge.allocSharedBuffer(4 * 32);
      let caught: unknown;
      try {
        bridge.syncTransformsToBuffer(ptr, 5);
      } catch (error: unknown) {
        caught = error;
      }
      expectWasmError(caught, CoreErrorCodes.INVALID_MAX_ENTITIES, "sync_transforms_to_buffer");
      bridge.syncTransformsToBuffer(ptr, 1);
      expect(bridge.createEntity().index).toBe(0);
      expect(bridge.countEntities()).toBe(1);
      await expectNextFrame(engine);
    });
    expect(handle.engine.state).toBe("stopped");
  });

  it("ENTITY_LIMIT_REACHED from before-update stays an error and the next frame runs", async () => {
    const seen: Array<{ level: string; error?: unknown }> = [];
    const handle = await useLight(4, async ({ engine }) => {
      engine.errors.on((event) => {
        seen.push(event);
      });
      await engine.startExternal();
      let once = false;
      engine.hooks.hook("engine:before-update", () => {
        if (once) return;
        once = true;
        throw new GwenWasmError(
          CoreErrorCodes.ENTITY_LIMIT_REACHED,
          "Entity limit reached: 4",
          "create_entity",
          new Error("Entity limit reached: 4"),
        );
      });

      await engine.advance(1 / 60);
      expect(engine.state).toBe("running");
      expect(seen.filter((event) => event.level === "fatal")).toHaveLength(0);
      const recoverable = seen.find((event) => event.error instanceof GwenWasmError);
      expect(recoverable?.level).toBe("error");
      expect(recoverable?.error).toMatchObject({ code: CoreErrorCodes.ENTITY_LIMIT_REACHED });

      const before = engine.frameCount;
      await engine.advance(1 / 60);
      expect(engine.frameCount).toBe(before + 1);
      expect(engine.state).toBe("running");
    });
    expect(handle.engine.state).toBe("stopped");
  });

  it("a trap inside Engine::new stays poisoned only until the next init", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gwen-glue-"));
    const jsPath = join(dir, "glue.js");
    writeFileSync(
      jsPath,
      [
        "export function initSync() {",
        "  return { memory: new WebAssembly.Memory({ initial: 1 }) };",
        "}",
        "export class Engine {",
        "  constructor() { throw new WebAssembly.RuntimeError('trap in new'); }",
        "}",
        "",
      ].join("\n"),
    );
    const wasmBytes = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
    const bridge = new WasmBridgeImpl();
    let caught: unknown;
    try {
      await bridge.init("light", {
        maxEntities: 2,
        jsUrl: pathToFileURL(jsPath).href,
        wasmUrl: `data:application/wasm;base64,${Buffer.from(wasmBytes).toString("base64")}`,
      });
    } catch (error: unknown) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(GwenWasmPanicError);

    let poisoned: unknown;
    try {
      bridge.createEntity();
    } catch (error: unknown) {
      poisoned = error;
    }
    expect(poisoned).toBeInstanceOf(GwenWasmPanicError);

    await bridge.init("light", { maxEntities: 2, ...lightUrls() });
    const created = bridge.createEntity();
    expect(created.index).toBe(0);
    expect(created.generation).toBe(0);
    const engine = await createEngine({ variant: "light", maxEntities: 2, _bridge: bridge });
    try {
      await expectNextFrame(engine);
    } finally {
      await engine.stop();
    }
    expect(engine.state).toBe("stopped");
  });

  it("a wrongly sized bulk buffer throws both sizes and the next frame runs", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 4 });
    const other = await createRealEngine({ variant: "light", maxEntities: 4 });
    const { engine, bridge } = handle;
    try {
      const entity = bridge.createEntity();
      const typeId = bridge.registerComponent(new Uint8Array([0]));
      const original = new Uint8Array([1, 2, 3, 4]);
      expect(bridge.addComponent(entity.index, entity.generation, typeId, original)).toBe(true);

      let caught: unknown;
      try {
        bridge.queryWriteBulk(
          new Uint32Array([entity.index]),
          new Uint32Array([entity.generation]),
          typeId,
          new Float32Array([9, 9]),
        );
      } catch (error: unknown) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(GwenWasmError);
      expect(caught).toBeInstanceOf(GwenError);
      if (!(caught instanceof GwenWasmError)) {
        throw new Error("expected GwenWasmError");
      }
      expect(caught.code).toBe(CoreErrorCodes.BUFFER_LENGTH_MISMATCH);
      expect(caught.exportName).toBe("query_write_bulk");
      expect(caught.message).toContain("data");
      expect(caught.message).toContain("expected");
      expect(caught.message).toContain("actual");
      expect(caught.message).toContain("4");
      expect(caught.message).toContain("8");
      expect(Array.from(bridge.getComponentRaw(entity.index, entity.generation, typeId))).toEqual([
        1, 2, 3, 4,
      ]);
      expect(bridge.countEntities()).toBe(1);

      let spawnCaught: unknown;
      try {
        bridge.bulkSpawnWithTransforms(new Float32Array([1, 2, 3, 4, 5]), new Float32Array([0, 0]));
      } catch (error: unknown) {
        spawnCaught = error;
      }
      expect(spawnCaught).toBeInstanceOf(GwenWasmError);
      expect(spawnCaught).toBeInstanceOf(GwenError);
      if (!(spawnCaught instanceof GwenWasmError)) {
        throw new Error("expected GwenWasmError");
      }
      expect(spawnCaught.code).toBe(CoreErrorCodes.BUFFER_LENGTH_MISMATCH);
      expect(spawnCaught.exportName).toBe("bulk_spawn_with_transforms");
      expect(spawnCaught.message).toBe("buffer positions length mismatch: expected 6, actual 5");
      expect(bridge.countEntities()).toBe(1);
      expect(bridge.isAlive(entity.index, entity.generation)).toBe(true);
      expect(other.bridge.countEntities()).toBe(0);
      const spawned = bridge.bulkSpawnWithTransforms(
        new Float32Array([8, 9]),
        new Float32Array([0.25]),
      );
      expect(spawned.length).toBe(1);
      expect(bridge.countEntities()).toBe(2);
      await expectNextFrame(engine);
    } finally {
      await handle.dispose();
      await other.dispose();
    }
  });

  it("get_components_bulk rejects a shorter generation list and the next frame runs", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 4 });
    const other = await createRealEngine({ variant: "light", maxEntities: 4 });
    const { engine, bridge } = handle;
    try {
      const entity = bridge.createEntity();
      const typeId = bridge.registerComponent(new Uint8Array([0]));
      const original = new Uint8Array([1, 2, 3, 4]);
      expect(bridge.addComponent(entity.index, entity.generation, typeId, original)).toBe(true);
      const out = new Uint8Array([9, 9, 9, 9, 9, 9, 9, 9]);

      let caught: unknown;
      try {
        bridge
          .engine()
          .get_components_bulk(
            new Uint32Array([entity.index, entity.index]),
            new Uint32Array([entity.generation]),
            typeId,
            out,
          );
      } catch (error: unknown) {
        caught = toGwenWasmError(error, "get_components_bulk", () => {});
      }

      expectWasmError(caught, CoreErrorCodes.BUFFER_LENGTH_MISMATCH, "get_components_bulk");
      if (!(caught instanceof GwenWasmError)) {
        throw new Error("expected GwenWasmError");
      }
      expect(caught.message).toBe("buffer gens length mismatch: expected 2, actual 1");
      expect(Array.from(out)).toEqual([9, 9, 9, 9, 9, 9, 9, 9]);
      expect(Array.from(bridge.getComponentRaw(entity.index, entity.generation, typeId))).toEqual([
        1, 2, 3, 4,
      ]);
      expect(bridge.countEntities()).toBe(1);
      const readOut = new Uint8Array(4);
      bridge
        .engine()
        .get_components_bulk(
          new Uint32Array([entity.index]),
          new Uint32Array([entity.generation]),
          typeId,
          readOut,
        );
      expect(Array.from(readOut)).toEqual([1, 2, 3, 4]);
      expect(other.bridge.createEntity().index).toBe(0);
      await expectNextFrame(engine);
      await expectNextFrame(other.engine);
    } finally {
      await handle.dispose();
      await other.dispose();
    }
  });

  it("query_read_bulk rejects mismatched output buffers and the next frame runs", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 4 });
    const { engine, bridge } = handle;
    try {
      const entity = bridge.createEntity();
      const typeId = bridge.registerComponent(new Uint8Array([0]));
      const original = new Uint8Array([1, 2, 3, 4]);
      expect(bridge.addComponent(entity.index, entity.generation, typeId, original)).toBe(true);
      const outSlots = new Uint32Array([7, 7]);
      const outGens = new Uint32Array([7]);
      const out = new Uint8Array([9, 9, 9, 9, 9, 9, 9, 9]);

      let caught: unknown;
      try {
        bridge.engine().query_read_bulk(new Uint32Array([typeId]), typeId, outSlots, outGens, out);
      } catch (error: unknown) {
        caught = toGwenWasmError(error, "query_read_bulk", () => {});
      }

      expectWasmError(caught, CoreErrorCodes.BUFFER_LENGTH_MISMATCH, "query_read_bulk");
      if (!(caught instanceof GwenWasmError)) {
        throw new Error("expected GwenWasmError");
      }
      expect(caught.message).toBe("buffer gens length mismatch: expected 2, actual 1");
      expect(Array.from(outSlots)).toEqual([7, 7]);
      expect(Array.from(outGens)).toEqual([7]);
      expect(Array.from(out)).toEqual([9, 9, 9, 9, 9, 9, 9, 9]);
      expect(Array.from(bridge.getComponentRaw(entity.index, entity.generation, typeId))).toEqual([
        1, 2, 3, 4,
      ]);
      expect(bridge.countEntities()).toBe(1);
      const readSlots = new Uint32Array(1);
      const readGens = new Uint32Array(1);
      const readOut = new Uint8Array(8);
      const read = bridge
        .engine()
        .query_read_bulk(new Uint32Array([typeId]), typeId, readSlots, readGens, readOut);
      expect(Array.from(read)).toEqual([1, 4]);
      expect(Array.from(readOut.subarray(0, 4))).toEqual([1, 2, 3, 4]);
      await expectNextFrame(engine);
    } finally {
      await handle.dispose();
    }
  });

  it("get_components_bulk rejects a longer generation list and the next frame runs", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 4 });
    const other = await createRealEngine({ variant: "light", maxEntities: 4 });
    const { engine, bridge } = handle;
    try {
      const entity = bridge.createEntity();
      const typeId = bridge.registerComponent(new Uint8Array([0]));
      const original = new Uint8Array([1, 2, 3, 4]);
      expect(bridge.addComponent(entity.index, entity.generation, typeId, original)).toBe(true);
      const out = new Uint8Array([9, 9, 9, 9, 9, 9, 9, 9]);

      let caught: unknown;
      try {
        bridge
          .engine()
          .get_components_bulk(
            new Uint32Array([entity.index]),
            new Uint32Array([entity.generation, entity.generation]),
            typeId,
            out,
          );
      } catch (error: unknown) {
        caught = toGwenWasmError(error, "get_components_bulk", () => {});
      }

      expectWasmError(caught, CoreErrorCodes.BUFFER_LENGTH_MISMATCH, "get_components_bulk");
      if (!(caught instanceof GwenWasmError)) {
        throw new Error("expected GwenWasmError");
      }
      expect(caught.message).toBe("buffer gens length mismatch: expected 1, actual 2");
      expect(Array.from(out)).toEqual([9, 9, 9, 9, 9, 9, 9, 9]);
      expect(Array.from(bridge.getComponentRaw(entity.index, entity.generation, typeId))).toEqual([
        1, 2, 3, 4,
      ]);
      expect(bridge.countEntities()).toBe(1);
      const readOut = new Uint8Array(4);
      bridge
        .engine()
        .get_components_bulk(
          new Uint32Array([entity.index]),
          new Uint32Array([entity.generation]),
          typeId,
          readOut,
        );
      expect(Array.from(readOut)).toEqual([1, 2, 3, 4]);
      expect(other.bridge.createEntity().index).toBe(0);
      await expectNextFrame(engine);
      await expectNextFrame(other.engine);
    } finally {
      await handle.dispose();
      await other.dispose();
    }
  });

  it("query_read_bulk rejects a longer generation list and the next frame runs", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 4 });
    const { engine, bridge } = handle;
    try {
      const entity = bridge.createEntity();
      const typeId = bridge.registerComponent(new Uint8Array([0]));
      const original = new Uint8Array([1, 2, 3, 4]);
      expect(bridge.addComponent(entity.index, entity.generation, typeId, original)).toBe(true);
      const outSlots = new Uint32Array([7]);
      const outGens = new Uint32Array([7, 7]);
      const out = new Uint8Array([9, 9, 9, 9, 9, 9, 9, 9]);

      let caught: unknown;
      try {
        bridge.engine().query_read_bulk(new Uint32Array([typeId]), typeId, outSlots, outGens, out);
      } catch (error: unknown) {
        caught = toGwenWasmError(error, "query_read_bulk", () => {});
      }

      expectWasmError(caught, CoreErrorCodes.BUFFER_LENGTH_MISMATCH, "query_read_bulk");
      if (!(caught instanceof GwenWasmError)) {
        throw new Error("expected GwenWasmError");
      }
      expect(caught.message).toBe("buffer gens length mismatch: expected 1, actual 2");
      expect(Array.from(outSlots)).toEqual([7]);
      expect(Array.from(outGens)).toEqual([7, 7]);
      expect(Array.from(out)).toEqual([9, 9, 9, 9, 9, 9, 9, 9]);
      expect(Array.from(bridge.getComponentRaw(entity.index, entity.generation, typeId))).toEqual([
        1, 2, 3, 4,
      ]);
      expect(bridge.countEntities()).toBe(1);
      const readSlots = new Uint32Array(1);
      const readGens = new Uint32Array(1);
      const readOut = new Uint8Array(8);
      const read = bridge
        .engine()
        .query_read_bulk(new Uint32Array([typeId]), typeId, readSlots, readGens, readOut);
      expect(Array.from(read)).toEqual([1, 4]);
      expect(Array.from(readOut.subarray(0, 4))).toEqual([1, 2, 3, 4]);
      await expectNextFrame(engine);
    } finally {
      await handle.dispose();
    }
  });
});
