/**
 * Owned-bridge dispose on stop (P-261-1) and held physics services (P-261-2).
 * Real WASM. Dev only (`__GWEN_DEV__`).
 */
import { describe, expect, it } from "vitest";
import { GwenError } from "@gwenjs/schema";

import {
  CoreErrorCodes,
  createEngine,
  GwenEngineStateError,
  setupGwen,
  unpackEntityId,
  type GwenEngine,
} from "../../../src/index.js";
import type { MemoryView } from "../../../src/engine/engine-memory.js";
import { WasmBridgeImpl } from "../../../src/engine/wasm-bridge.js";
import type { CoreVariant } from "../../../src/engine/wasm-bridge-types.js";
import { createRealEngine } from "../harness.js";
import { forceGc, nodeArtefactUrls } from "./helpers.js";
import "../../../../physics2d/src/augment";
import { Physics2DPlugin } from "../../../../physics2d/src/plugin/index";
import "../../../../physics3d/src/augment";
import { Physics3DPlugin } from "../../../../physics3d/src/plugin/index";

const DISPOSED_MESSAGE = [
  "[GWEN] The WASM bridge was disposed by engine.stop().",
  "Fix: Create a new engine; a stopped engine cannot be reused.",
  "See https://gwenjs.github.io/gwen/api/errors#core-engine-disposed (CORE:ENGINE_DISPOSED)",
].join("\n");

function assertGc(): void {
  expect(typeof Reflect.get(globalThis, "gc")).toBe("function");
}

function capture(run: () => unknown): unknown {
  try {
    return run();
  } catch (error: unknown) {
    return error;
  }
}

function expectDisposed(caught: unknown): void {
  expect(caught).toBeInstanceOf(GwenError);
  if (!(caught instanceof GwenError)) return;
  expect(caught.code).toBe(CoreErrorCodes.ENGINE_DISPOSED);
  expect(caught.composable).toBeUndefined();
  expect(caught.message).toBe(DISPOSED_MESSAGE);
}

/** Keep the glue object `create_entity` returns so a test can read `__wbg_ptr`. */
function captureCreateEntity(bridge: WasmBridgeImpl): {
  restore(): void;
  wrapper(): object | undefined;
} {
  const glue = bridge.engine();
  const original = Reflect.get(glue, "create_entity");
  if (typeof original !== "function") {
    return {
      restore(): void {
        return;
      },
      wrapper(): undefined {
        return undefined;
      },
    };
  }
  let held: object | undefined;
  Reflect.set(glue, "create_entity", () => {
    const created: unknown = Reflect.apply(original, glue, []);
    if (typeof created === "object" && created !== null) held = created;
    return created;
  });
  return {
    restore(): void {
      Reflect.set(glue, "create_entity", original);
    },
    wrapper(): object | undefined {
      return held;
    },
  };
}

function holdArray(view: MemoryView<"u8">): WeakRef<Uint8Array> {
  const array = view.array;
  return new WeakRef(array);
}

/** The glue object dies with this call. The test keeps only the WeakRef. */
function holdPhysicsGlue(bridge: WasmBridgeImpl): WeakRef<object> {
  const glue = bridge.getPhysicsBridge();
  return new WeakRef(glue);
}

async function owned(
  variant: CoreVariant,
): Promise<{ engine: GwenEngine; bridge: WasmBridgeImpl }> {
  const engine = await createEngine({ variant });
  return { engine, bridge: engine.inject("wasm:bridge") };
}

describe("bridge dispose", () => {
  it("a held engine.memory.view does not keep its cached array after stop()", async () => {
    const { engine, bridge } = await owned("light");
    try {
      assertGc();
      const id = bridge.createEntity();
      const view = engine.memory.view({
        name: "held",
        type: "u8",
        ptr: () => 0,
        length: () => 8,
      });
      const arrayRef = holdArray(view);
      await engine.stop();
      await forceGc();
      const collected = arrayRef.deref() === undefined;
      expect(collected).toBe(true);
      expect(id.index).toBeGreaterThanOrEqual(0);
      const caught = capture(() => view.array);
      expect(caught).toBeInstanceOf(GwenError);
      if (!(caught instanceof GwenError)) return;
      expect(caught.code).toBe(CoreErrorCodes.MEMORY_VIEW_INVALID);
      expect(caught.message).toContain("engine stopped");
    } finally {
      await engine.stop();
    }
  });

  it("bridge.engine() throws CORE:ENGINE_DISPOSED after stop()", async () => {
    const { engine, bridge } = await owned("light");
    try {
      assertGc();
      await engine.stop();
      expectDisposed(capture(() => bridge.engine()));
    } finally {
      await engine.stop();
    }
  });

  it("getPhysicsBridge() throws CORE:ENGINE_DISPOSED after stop()", async () => {
    const { engine, bridge } = await owned("physics2d");
    try {
      assertGc();
      await engine.stop();
      expectDisposed(capture(() => bridge.getPhysicsBridge()));
    } finally {
      await engine.stop();
    }
  });

  it("any bridge call after dispose throws CORE:ENGINE_DISPOSED", async () => {
    const { engine, bridge } = await owned("light");
    try {
      assertGc();
      await engine.stop();
      expectDisposed(capture(() => bridge.createEntity()));
      expectDisposed(capture(() => bridge.countEntities()));
      expectDisposed(capture(() => bridge.stats()));
    } finally {
      await engine.stop();
    }
  });

  it("a held entity id is a plain object", async () => {
    const { engine, bridge } = await owned("light");
    try {
      assertGc();
      const id = bridge.createEntity();
      expect(Object.getPrototypeOf(id) === Object.prototype).toBe(true);
      expect("free" in id).toBe(false);
    } finally {
      await engine.stop();
    }
  });

  it("caller-owned bridge is not disposed by stop() and is released by bridge.dispose()", async () => {
    const bridge = new WasmBridgeImpl();
    await bridge.init("light", nodeArtefactUrls("light"));
    const engine = await createEngine({ _bridge: bridge });
    try {
      assertGc();
      expect(typeof Reflect.get(bridge, "dispose")).toBe("function");
      await engine.stop();
      expect(bridge.isActive()).toBe(true);
      expect(bridge.countEntities()).toBe(0);
      const dispose = Reflect.get(bridge, "dispose");
      if (typeof dispose !== "function") return;
      Reflect.apply(dispose, bridge, []);
      expect(bridge.isActive()).toBe(false);
      expectDisposed(capture(() => bridge.countEntities()));
    } finally {
      await engine.stop();
      const dispose = Reflect.get(bridge, "dispose");
      if (typeof dispose === "function") Reflect.apply(dispose, bridge, []);
    }
  });

  it("createEngine without _bridge owns and disposes its bridge", async () => {
    const { engine, bridge } = await owned("light");
    try {
      assertGc();
      await engine.stop();
      expectDisposed(capture(() => bridge.engine()));
    } finally {
      await engine.stop();
    }
  });

  it("setupGwen owns and disposes its bridge", async () => {
    const urls = nodeArtefactUrls("light");
    const engine = await setupGwen({ variant: "light", ...urls });
    const bridge = engine.inject("wasm:bridge");
    try {
      assertGc();
      await engine.stop();
      expectDisposed(capture(() => bridge.engine()));
    } finally {
      await engine.stop();
    }
  });

  it("second stop() is a no-op", async () => {
    const { engine, bridge } = await owned("light");
    try {
      assertGc();
      expect(typeof Reflect.get(bridge, "dispose")).toBe("function");
      let disposeCount = 0;
      const original = Reflect.get(bridge, "dispose");
      if (typeof original !== "function") return;
      Reflect.set(bridge, "dispose", () => {
        disposeCount += 1;
        Reflect.apply(original, bridge, []);
      });
      await engine.stop();
      await engine.stop();
      expect(disposeCount).toBe(1);
    } finally {
      await engine.stop();
    }
  });

  it("init() on a disposed bridge rejects CORE:ENGINE_DISPOSED", async () => {
    const bridge = new WasmBridgeImpl();
    await bridge.init("light", nodeArtefactUrls("light"));
    const engine = await createEngine({ _bridge: bridge });
    try {
      assertGc();
      expect(typeof Reflect.get(bridge, "dispose")).toBe("function");
      const dispose = Reflect.get(bridge, "dispose");
      if (typeof dispose !== "function") return;
      Reflect.apply(dispose, bridge, []);
      let caught: unknown;
      try {
        await bridge.init("light", nodeArtefactUrls("light"));
      } catch (error: unknown) {
        caught = error;
      }
      expectDisposed(caught);
    } finally {
      await engine.stop();
      const dispose = Reflect.get(bridge, "dispose");
      if (typeof dispose === "function") Reflect.apply(dispose, bridge, []);
    }
  });

  it("stopping one engine leaves another engine's bridge active", async () => {
    const first = await owned("light");
    const second = await owned("light");
    try {
      assertGc();
      await first.engine.stop();
      expectDisposed(capture(() => first.bridge.countEntities()));
      expect(second.bridge.countEntities()).toBe(0);
    } finally {
      await first.engine.stop();
      await second.engine.stop();
    }
  });

  it("view.dispose() drops the cached array before stop", async () => {
    const { engine } = await owned("light");
    try {
      assertGc();
      const view = engine.memory.view({
        name: "early",
        type: "u8",
        ptr: () => 0,
        length: () => 8,
      });
      const arrayRef = holdArray(view);
      view.dispose();
      await forceGc();
      const collected = arrayRef.deref() === undefined;
      expect(collected).toBe(true);
    } finally {
      await engine.stop();
    }
  });

  it("descriptor ptr and length closures are collectable after stop", async () => {
    const { engine } = await owned("light");
    try {
      assertGc();
      const pinned = pinLength(engine);
      expect(pinned.view.name).toBe("pin");
      await engine.stop();
      await forceGc();
      const collected = pinned.ref.deref() === undefined;
      expect(collected).toBe(true);
    } finally {
      await engine.stop();
    }
  });

  it("createRealEngine().dispose() releases its bridge", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 8 });
    try {
      assertGc();
      await handle.dispose();
      expectDisposed(capture(() => handle.bridge.countEntities()));
    } finally {
      await handle.dispose();
    }
  });

  it("bridge.createEntity frees the glue wrapper", async () => {
    const { engine, bridge } = await owned("light");
    const captured = captureCreateEntity(bridge);
    try {
      assertGc();
      const id = bridge.createEntity();
      const wrapper = captured.wrapper();
      expect(id.index).toBeGreaterThanOrEqual(0);
      expect(wrapper).not.toBeUndefined();
      if (wrapper === undefined) return;
      expect(Reflect.get(wrapper, "__wbg_ptr")).toBe(0);
    } finally {
      captured.restore();
      await engine.stop();
    }
  });

  it("engine.createEntity frees the glue wrapper", async () => {
    const { engine, bridge } = await owned("light");
    const captured = captureCreateEntity(bridge);
    try {
      assertGc();
      const id = engine.createEntity();
      const wrapper = captured.wrapper();
      expect(typeof id).toBe("bigint");
      expect(wrapper).not.toBeUndefined();
      if (wrapper === undefined) return;
      expect(Reflect.get(wrapper, "__wbg_ptr")).toBe(0);
    } finally {
      captured.restore();
      await engine.stop();
    }
  });

  it("dispose() releases the bridge when stop() rejects during starting", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 8 });
    try {
      assertGc();
      handle.engine.hooks.hook("engine:init", async () => {
        await handle.dispose();
      });
      let caught: unknown;
      try {
        await handle.engine.startExternal();
      } catch (error: unknown) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(GwenEngineStateError);
      if (!(caught instanceof GwenEngineStateError)) return;
      expect(caught.from).toBe("starting");
      expect(caught.method).toBe("stop");
      expectDisposed(capture(() => handle.bridge.countEntities()));
    } finally {
      if (handle.bridge.isActive()) handle.bridge.dispose();
      await handle.engine.stop();
    }
  });

  it("a held physics2d service throws CORE:ENGINE_DISPOSED after stop()", async () => {
    const { engine } = await owned("physics2d");
    try {
      assertGc();
      await engine.use(Physics2DPlugin({ gravity: 0, gravityX: 0 }));
      const physics = engine.inject("physics2d");
      const id = engine.createEntity();
      await engine.stop();
      expectDisposed(capture(() => physics.addRigidBody(id, "dynamic", 1, 2)));
      expectDisposed(capture(() => physics.addRigidBody(id, "dynamic", 1, 2)));
    } finally {
      await engine.stop();
    }
  });

  it("a held physics2d read method throws CORE:ENGINE_DISPOSED after stop()", async () => {
    const { engine } = await owned("physics2d");
    try {
      assertGc();
      await engine.use(Physics2DPlugin({ gravity: 0, gravityX: 0 }));
      const physics = engine.inject("physics2d");
      const id = engine.createEntity();
      physics.addRigidBody(id, "dynamic", 3, 4);
      const before = physics.getPosition(id);
      expect(before).not.toBeNull();
      if (before === null) return;
      expect(before.x).toBe(3);
      expect(before.y).toBe(4);
      await engine.stop();
      expectDisposed(capture(() => physics.getPosition(id)));
      expectDisposed(capture(() => physics.getPosition(id)));
    } finally {
      await engine.stop();
    }
  });

  it("a held physics3d service throws CORE:ENGINE_DISPOSED after stop()", async () => {
    const { engine } = await owned("physics3d");
    try {
      assertGc();
      await engine.use(Physics3DPlugin({ gravity: { x: 0, y: 0, z: 0 } }));
      const physics = engine.inject("physics3d");
      const id = engine.createEntity();
      physics.createBody(id, {
        kind: "kinematic",
        initialPosition: { x: 1, y: 2, z: 3 },
      });
      const slot = unpackEntityId(id).index;
      await engine.stop();
      const step = (): number =>
        physics.bulkStepKinematics(
          new Uint32Array([slot]),
          new Float32Array([0]),
          new Float32Array([0]),
          new Float32Array([0]),
          1 / 60,
        );
      expectDisposed(capture(step));
      expectDisposed(capture(step));
    } finally {
      await engine.stop();
    }
  });

  it("a held physics3d service returns 0 after unuse() and throws CORE:ENGINE_DISPOSED after stop()", async () => {
    const { engine } = await owned("physics3d");
    try {
      assertGc();
      await engine.use(Physics3DPlugin({ gravity: { x: 0, y: 0, z: 0 } }));
      const physics = engine.inject("physics3d");
      // vz is longer, so a call that reaches WASM throws instead of returning 0.
      const step = (): number =>
        physics.bulkStepKinematics(
          new Uint32Array([0]),
          new Float32Array([0]),
          new Float32Array([0]),
          new Float32Array([0, 0]),
          0,
        );
      await engine.unuse("@gwenjs/physics3d");
      expect(capture(step)).toBe(0);
      await engine.stop();
      expectDisposed(capture(step));
    } finally {
      await engine.stop();
    }
  });

  it("stopping one engine leaves another engine's physics2d service working", async () => {
    const plugin = Physics2DPlugin({ gravity: 0, gravityX: 0 });
    const a = await owned("physics2d");
    const b = await owned("physics2d");
    try {
      assertGc();
      await a.engine.use(plugin);
      await b.engine.use(plugin);
      const physicsA = a.engine.inject("physics2d");
      const physicsB = b.engine.inject("physics2d");
      const idA = a.engine.createEntity();
      const idB = b.engine.createEntity();
      physicsA.addRigidBody(idA, "dynamic", 1, 2);
      physicsB.addRigidBody(idB, "dynamic", 8, 9);
      const seen = physicsB.getPosition(idB);
      expect(seen).not.toBeNull();
      if (seen === null) return;
      expect(seen.x).toBe(8);
      expect(seen.y).toBe(9);
      await a.engine.stop();
      expect(physicsB.getPosition(idB)).toEqual(seen);
      expectDisposed(capture(() => physicsA.getPosition(idA)));
      expectDisposed(capture(() => physicsA.getPosition(idA)));
    } finally {
      await a.engine.stop();
      await b.engine.stop();
    }
  });

  it("a held physics2d service does not keep the glue physics object after stop()", async () => {
    const { engine, bridge } = await owned("physics2d");
    try {
      assertGc();
      await engine.use(Physics2DPlugin({ gravity: 0, gravityX: 0 }));
      const physics = engine.inject("physics2d");
      const id = engine.createEntity();
      physics.addRigidBody(id, "dynamic", 1, 2);
      const glueRef = holdPhysicsGlue(bridge);
      await engine.stop();
      await forceGc();
      const collected = glueRef.deref() === undefined;
      expect(collected).toBe(true);
      expect(typeof id).toBe("bigint");
      expect(typeof physics.addRigidBody).toBe("function");
    } finally {
      await engine.stop();
    }
  });
});

function pinLength(engine: GwenEngine): { view: MemoryView<"u8">; ref: WeakRef<{ tag: string }> } {
  const sentinel = { tag: "pin" };
  const ref = new WeakRef(sentinel);
  const view = engine.memory.view({
    name: "pin",
    type: "u8",
    ptr: () => 0,
    length: () => sentinel.tag.length,
  });
  return { view, ref };
}
