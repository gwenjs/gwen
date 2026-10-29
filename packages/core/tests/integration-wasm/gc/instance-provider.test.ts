/**
 * Isolated instance collection (P-263-2). Real WASM. The gc project sets `__GWEN_DEV__`.
 */
import { describe, expect, it } from "vitest";
import { GwenError } from "@gwenjs/schema";

import { CoreErrorCodes, createEngine, type GwenEngine } from "../../../src/index.js";
import type { MemoryView } from "../../../src/engine/engine-memory.js";
import { forceGc } from "./helpers.js";
import "../../../../physics2d/src/augment";
import { Physics2DPlugin } from "../../../../physics2d/src/plugin/index";
import type { Physics2DAPI } from "../../../../physics2d/src/types/api";

function capture(run: () => unknown): unknown {
  try {
    return run();
  } catch (error: unknown) {
    return error;
  }
}

/** The engine dies with this call. The caller keeps only the WeakRef. */
async function stoppedMemory(): Promise<WeakRef<WebAssembly.Memory>> {
  let engine: GwenEngine | undefined;
  try {
    engine = await createEngine({
      variant: "physics2d",
      wasmInstance: "isolated",
      maxEntities: 32,
    });
    await engine.use(Physics2DPlugin({ gravity: -10, maxEntities: 32 }));
    const bridge = engine.inject("wasm:bridge");
    const memory = bridge.getLinearMemory();
    if (!(memory instanceof WebAssembly.Memory)) throw new Error("no linear memory");
    const ref = new WeakRef(memory);
    const id = engine.createEntity();
    const glue = bridge.engine();
    const view = engine.memory.view({
      name: "held",
      type: "u8",
      ptr: () => 0,
      length: () => 8,
    });
    const heldBytes = view.array.byteLength;
    {
      const physics = engine.inject("physics2d");
      if (physics.getPosition(id) !== null) throw new Error("entity has a body");
    }
    if (String(id).length === 0 || heldBytes < 0 || glue.free === null) {
      throw new Error("held values missing");
    }
    return ref;
  } finally {
    await engine?.stop();
  }
}

/**
 * The engine dies with this call.
 * The caller keeps the view and the physics service across collection.
 */
async function stoppedHeld(): Promise<{
  ref: WeakRef<WebAssembly.Memory>;
  view: MemoryView<"u8">;
  physics: Physics2DAPI;
  id: ReturnType<GwenEngine["createEntity"]>;
}> {
  let engine: GwenEngine | undefined;
  try {
    engine = await createEngine({
      variant: "physics2d",
      wasmInstance: "isolated",
      maxEntities: 32,
    });
    await engine.use(Physics2DPlugin({ gravity: -10, maxEntities: 32 }));
    const bridge = engine.inject("wasm:bridge");
    const memory = bridge.getLinearMemory();
    if (!(memory instanceof WebAssembly.Memory)) throw new Error("no linear memory");
    const ref = new WeakRef(memory);
    const id = engine.createEntity();
    const view = engine.memory.view({
      name: "held",
      type: "u8",
      ptr: () => 0,
      length: () => 8,
    });
    const physics = engine.inject("physics2d");
    if (view.array.byteLength < 8) throw new Error("view missing");
    if (physics.getPosition(id) !== null) throw new Error("entity has a body");
    return { ref, view, physics, id };
  } finally {
    await engine?.stop();
  }
}

describe("isolated wasm instance gc", () => {
  it("isolated: stopping A frees A's instance while B is alive", async () => {
    expect(typeof Reflect.get(globalThis, "gc")).toBe("function");
    let collected = 0;
    for (let n = 0; n < 20; n += 1) {
      const ref = await stoppedMemory();
      await forceGc();
      if (ref.deref() === undefined) collected += 1;
    }
    expect(collected).toBe(20);

    const engineB = await createEngine({
      variant: "physics2d",
      wasmInstance: "isolated",
      maxEntities: 32,
    });
    try {
      await engineB.use(Physics2DPlugin({ gravity: -10, maxEntities: 32 }));
      await engineB.startExternal();
      const refA = await stoppedMemory();
      const before = engineB.getStats().frameCount;
      await engineB.advance(1 / 60);
      expect(engineB.getStats().frameCount).toBeGreaterThan(before);
      expect(engineB.state).toBe("running");
      await forceGc();
      expect(refA.deref()).toBeUndefined();
    } finally {
      await engineB.stop();
    }
  }, 120_000);

  it("isolated: a held view, glue Engine or service does not pin the instance after stop()", async () => {
    expect(typeof Reflect.get(globalThis, "gc")).toBe("function");
    const engineB = await createEngine({
      variant: "physics2d",
      wasmInstance: "isolated",
      maxEntities: 32,
    });
    try {
      await engineB.use(Physics2DPlugin({ gravity: -10, maxEntities: 32 }));
      await engineB.startExternal();
      const held = await stoppedHeld();
      const before = engineB.getStats().frameCount;
      await engineB.advance(1 / 60);
      expect(engineB.getStats().frameCount).toBeGreaterThan(before);
      expect(engineB.state).toBe("running");
      await forceGc();
      expect(held.ref.deref()).toBeUndefined();
      const caught = capture(() => held.physics.getPosition(held.id));
      expect(caught).toBeInstanceOf(GwenError);
      if (!(caught instanceof GwenError)) return;
      expect(caught.code).toBe(CoreErrorCodes.ENGINE_DISPOSED);
      const viewCaught = capture(() => held.view.array);
      expect(viewCaught).toBeInstanceOf(GwenError);
      if (!(viewCaught instanceof GwenError)) return;
      expect(viewCaught.code).toBe(CoreErrorCodes.MEMORY_VIEW_INVALID);
    } finally {
      await engineB.stop();
    }
  }, 120_000);
});
