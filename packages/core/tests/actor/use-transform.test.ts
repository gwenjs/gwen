import { stubComponent } from "../helpers/stub-component";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { EntityId } from "../../src/engine/engine-api";
import { createEngine } from "../../src/engine/gwen-engine";
import { definePrefab } from "../../src/actor/runtime/define-prefab";
import { defineActor } from "../../src/actor/runtime/define-actor";
import { useTransform } from "../../src/actor/runtime/use-transform";
import { defineLayout, placeActor, useLayout } from "@gwenjs/core/actor";
import { WasmBridgeImpl } from "../../src/engine/wasm-bridge";

// Helper to create a minimal mock WASM engine (stateless — all writes are no-ops)
function createMockEngine() {
  return {
    add_entity_transform: () => {},
    update_transforms: () => {},
    translate_entity: () => {},
    set_entity_local_position: () => {},
    set_entity_local_rotation: () => {},
    get_entity_local_rotation: () => 0,
    set_entity_local_scale: () => {},
    get_entity_world_x: () => 0,
    get_entity_world_y: () => 0,
    get_entity_world_rotation: () => 0,
    has_entity_parent: () => false,
    set_entity_parent: () => {},
  };
}

// Stateful mock that simulates local→world propagation without hierarchy.
// Since all entities are roots, local position == world position after update_transforms.
function createStatefulMockEngine() {
  type Pos = { x: number; y: number };
  const local = new Map<number, Pos>();
  let transformsUpToDate = false;

  return {
    add_entity_transform(idx: number, x: number, y: number) {
      local.set(idx, { x, y });
      transformsUpToDate = false;
    },
    update_transforms() {
      transformsUpToDate = true;
    },
    translate_entity(idx: number, dx: number, dy: number) {
      const p = local.get(idx) ?? { x: 0, y: 0 };
      local.set(idx, { x: p.x + dx, y: p.y + dy });
      transformsUpToDate = false;
    },
    set_entity_local_position(idx: number, x: number, y: number) {
      local.set(idx, { x, y });
      transformsUpToDate = false;
    },
    get_entity_world_x(idx: number) {
      // World == local for root entities (no hierarchy); only valid after update_transforms
      return transformsUpToDate ? (local.get(idx)?.x ?? 0) : 0;
    },
    get_entity_world_y(idx: number) {
      return transformsUpToDate ? (local.get(idx)?.y ?? 0) : 0;
    },
    set_entity_local_rotation: () => {},
    get_entity_local_rotation: () => 0,
    set_entity_local_scale: () => {},
    get_entity_world_rotation: () => 0,
    has_entity_parent: () => false,
    set_entity_parent: () => {},
  };
}

const Pos = stubComponent("Position");
const Prefab = definePrefab([{ def: Pos, defaults: { x: 0, y: 0 } }]);

// ─── Regression guards ────────────────────────────────────────────────────────
// These tests lock in the two bugs discovered in production:
//   1. useTransform() must call add_entity_transform — without it, all bridge
//      calls (translate, world reads) are silent no-ops in the WASM TransformSystem.
//   2. update_transforms() must be called each frame loop — without it,
//      get_entity_world_x/y always return 0 regardless of translate() calls.

describe("useTransform — registration in TransformSystem (regression)", () => {
  let bridge: WasmBridgeImpl;

  beforeEach(() => {
    bridge = new WasmBridgeImpl();
    bridge._injectMock(createMockEngine() as any);
  });

  it("calls add_entity_transform on spawn so translate/world are not silent no-ops", async () => {
    const engine = await createEngine({ _bridge: bridge });
    const wasmEngine = bridge.engine();
    const spy = vi.spyOn(wasmEngine, "add_entity_transform").mockImplementation(() => {});

    const Actor = defineActor(Prefab, () => {
      useTransform();
    });
    await engine.use(Actor._plugin);
    await engine.run(() => Actor._plugin.spawn());

    expect(spy).toHaveBeenCalledWith(expect.any(Number), 0, 0, 0, 1, 1);
  });
});

describe("frame loop — update_transforms() called each frame (regression)", () => {
  let bridge: WasmBridgeImpl;

  beforeEach(() => {
    bridge = new WasmBridgeImpl();
    bridge._injectMock(createMockEngine() as any);
  });

  it("calls update_transforms() on every engine.advance() tick", async () => {
    const engine = await createEngine({ _bridge: bridge });
    const wasmEngine = bridge.engine();
    const spy = vi.spyOn(wasmEngine, "update_transforms").mockImplementation(() => {});

    await engine.advance(0.016);
    expect(spy).toHaveBeenCalledOnce();

    await engine.advance(0.016);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe("useTransform — end-to-end: translate reflects in world after frame tick", () => {
  let bridge: WasmBridgeImpl;

  beforeEach(() => {
    bridge = new WasmBridgeImpl();
    bridge._injectMock(createStatefulMockEngine() as any);
  });

  it("world.x/y update after translate() + engine.advance()", async () => {
    const engine = await createEngine({ _bridge: bridge });
    let handle: ReturnType<typeof useTransform> | undefined;

    const Actor = defineActor(Prefab, () => {
      handle = useTransform();
    });
    await engine.use(Actor._plugin);
    await engine.run(() => Actor._plugin.spawn());

    // Translate before the frame tick
    handle!.translate(50, 30);

    // update_transforms() runs inside advance() — world should now reflect the translate
    await engine.advance(0.016);

    expect(handle!.world.x).toBe(50);
    expect(handle!.world.y).toBe(30);
  });

  it("setPosition() is reflected in world.x/y after engine.advance()", async () => {
    const engine = await createEngine({ _bridge: bridge });
    let handle: ReturnType<typeof useTransform> | undefined;

    const Actor = defineActor(Prefab, () => {
      handle = useTransform();
    });
    await engine.use(Actor._plugin);
    await engine.run(() => Actor._plugin.spawn());

    handle!.setPosition(100, 200);
    await engine.advance(0.016);

    expect(handle!.world.x).toBe(100);
    expect(handle!.world.y).toBe(200);
  });

  it("successive translates accumulate correctly", async () => {
    const engine = await createEngine({ _bridge: bridge });
    let handle: ReturnType<typeof useTransform> | undefined;

    const Actor = defineActor(Prefab, () => {
      handle = useTransform();
    });
    await engine.use(Actor._plugin);
    await engine.run(() => Actor._plugin.spawn());

    handle!.translate(10, 0);
    await engine.advance(0.016);
    handle!.translate(10, 0);
    await engine.advance(0.016);

    expect(handle!.world.x).toBe(20);
  });
});

describe("useTransform context guard", () => {
  it("throws with descriptive message when called outside defineActor", () => {
    expect(() => useTransform()).toThrow(/useTransform.*defineActor/);
  });
});

describe("useTransform — local write operations", () => {
  let bridge: WasmBridgeImpl;

  beforeEach(() => {
    bridge = new WasmBridgeImpl();
    bridge._injectMock(createMockEngine() as any);
  });

  it("translate() calls translate_entity on the bridge", async () => {
    const engine = await createEngine({ _bridge: bridge });
    const wasmEngine = bridge.engine();
    // Ensure the method exists before spying
    if (!wasmEngine.translate_entity) {
      wasmEngine.translate_entity = () => {};
    }
    const spy = vi.spyOn(wasmEngine, "translate_entity").mockImplementation(() => {});

    const Actor = defineActor(Prefab, () => {
      const t = useTransform();
      t.translate(5, 10);
    });
    await engine.use(Actor._plugin);
    await engine.run(() => Actor._plugin.spawn());

    expect(spy).toHaveBeenCalledWith(expect.any(Number), 5, 10);
  });

  it("setPosition() calls set_entity_local_position on the bridge", async () => {
    const engine = await createEngine({ _bridge: bridge });
    const wasmEngine = bridge.engine();
    // Ensure the method exists before spying
    if (!wasmEngine.set_entity_local_position) {
      wasmEngine.set_entity_local_position = () => {};
    }
    const spy = vi.spyOn(wasmEngine, "set_entity_local_position").mockImplementation(() => {});

    const Actor = defineActor(Prefab, () => {
      const t = useTransform();
      t.setPosition(100, 200);
    });
    await engine.use(Actor._plugin);
    await engine.run(() => Actor._plugin.spawn());

    expect(spy).toHaveBeenCalledWith(expect.any(Number), 100, 200);
  });
});

describe("useTransform — rotation and scale", () => {
  let bridge: WasmBridgeImpl;

  beforeEach(() => {
    bridge = new WasmBridgeImpl();
    bridge._injectMock(createMockEngine() as any);
  });

  it("rotateTo() calls set_entity_local_rotation with the given angle", async () => {
    const engine = await createEngine({ _bridge: bridge });
    const wasmEngine = bridge.engine();
    const spy = vi.spyOn(wasmEngine, "set_entity_local_rotation").mockImplementation(() => {});

    const Actor = defineActor(Prefab, () => {
      const t = useTransform();
      t.rotateTo(Math.PI / 2);
    });
    await engine.use(Actor._plugin);
    await engine.run(() => Actor._plugin.spawn());

    expect(spy).toHaveBeenCalledWith(expect.any(Number), Math.PI / 2);
  });

  it("rotate() reads current rotation and adds delta", async () => {
    const engine = await createEngine({ _bridge: bridge });
    const wasmEngine = bridge.engine();
    vi.spyOn(wasmEngine, "get_entity_local_rotation").mockReturnValue(1.0);
    const writeSpy = vi.spyOn(wasmEngine, "set_entity_local_rotation").mockImplementation(() => {});

    const Actor = defineActor(Prefab, () => {
      const t = useTransform();
      t.rotate(0.5);
    });
    await engine.use(Actor._plugin);
    await engine.run(() => Actor._plugin.spawn());

    expect(writeSpy).toHaveBeenCalledWith(expect.any(Number), 1.5);
  });

  it("scaleTo(sx, sy) calls set_entity_local_scale with both values", async () => {
    const engine = await createEngine({ _bridge: bridge });
    const wasmEngine = bridge.engine();
    const spy = vi.spyOn(wasmEngine, "set_entity_local_scale").mockImplementation(() => {});

    const Actor = defineActor(Prefab, () => {
      const t = useTransform();
      t.scaleTo(2, 3);
    });
    await engine.use(Actor._plugin);
    await engine.run(() => Actor._plugin.spawn());

    expect(spy).toHaveBeenCalledWith(expect.any(Number), 2, 3);
  });

  it("scaleTo(sx) defaults sy to sx for uniform scale", async () => {
    const engine = await createEngine({ _bridge: bridge });
    const wasmEngine = bridge.engine();
    const spy = vi.spyOn(wasmEngine, "set_entity_local_scale").mockImplementation(() => {});

    const Actor = defineActor(Prefab, () => {
      const t = useTransform();
      t.scaleTo(1.5);
    });
    await engine.use(Actor._plugin);
    await engine.run(() => Actor._plugin.spawn());

    expect(spy).toHaveBeenCalledWith(expect.any(Number), 1.5, 1.5);
  });
});

describe("useTransform — hasParent", () => {
  let bridge: WasmBridgeImpl;

  beforeEach(() => {
    bridge = new WasmBridgeImpl();
    bridge._injectMock(createMockEngine() as any);
  });

  it("hasParent returns false when bridge reports no parent", async () => {
    const engine = await createEngine({ _bridge: bridge });
    const wasmEngine = bridge.engine();
    vi.spyOn(wasmEngine, "has_entity_parent").mockReturnValue(false);

    let result: boolean | undefined;
    const Actor = defineActor(Prefab, () => {
      const t = useTransform();
      return { getHasParent: () => t.hasParent };
    });
    await engine.use(Actor._plugin);

    await engine.run(() => {
      const id = Actor._plugin.spawn();
      const api = Actor._instances.get(id)?.api;
      if (api === undefined) throw new Error("missing api");
      result = api.getHasParent();
    });

    expect(result).toBe(false);
  });

  it("hasParent returns true when bridge reports a parent", async () => {
    const engine = await createEngine({ _bridge: bridge });
    const wasmEngine = bridge.engine();
    vi.spyOn(wasmEngine, "has_entity_parent").mockReturnValue(true);

    let result: boolean | undefined;
    const Actor = defineActor(Prefab, () => {
      const t = useTransform();
      return { getHasParent: () => t.hasParent };
    });
    await engine.use(Actor._plugin);

    await engine.run(() => {
      const id = Actor._plugin.spawn();
      const api = Actor._instances.get(id)?.api;
      if (api === undefined) throw new Error("missing api");
      result = api.getHasParent();
    });

    expect(result).toBe(true);
  });
});

describe("useTransform — world read values", () => {
  let bridge: WasmBridgeImpl;

  beforeEach(() => {
    bridge = new WasmBridgeImpl();
    bridge._injectMock(createMockEngine() as any);
  });

  it("world.x and world.y reflect bridge values", async () => {
    const engine = await createEngine({ _bridge: bridge });
    const wasmEngine = bridge.engine();
    vi.spyOn(wasmEngine, "get_entity_world_x").mockReturnValue(42);
    vi.spyOn(wasmEngine, "get_entity_world_y").mockReturnValue(99);

    let handle: ReturnType<typeof useTransform> | undefined;
    const Actor = defineActor(Prefab, () => {
      handle = useTransform();
      return {};
    });
    await engine.use(Actor._plugin);
    await engine.run(() => Actor._plugin.spawn());

    expect(handle!.world.x).toBe(42);
    expect(handle!.world.y).toBe(99);
  });

  it("world.rotation reflects bridge value", async () => {
    const engine = await createEngine({ _bridge: bridge });
    const wasmEngine = bridge.engine();
    vi.spyOn(wasmEngine, "get_entity_world_rotation").mockReturnValue(Math.PI);

    let handle: ReturnType<typeof useTransform> | undefined;
    const Actor = defineActor(Prefab, () => {
      handle = useTransform();
      return {};
    });
    await engine.use(Actor._plugin);
    await engine.run(() => Actor._plugin.spawn());

    expect(handle!.world.rotation).toBe(Math.PI);
  });

  it("world.z is always 0 (2D engine)", async () => {
    const engine = await createEngine({ _bridge: bridge });
    let handle: ReturnType<typeof useTransform> | undefined;
    const Actor = defineActor(Prefab, () => {
      handle = useTransform();
      return {};
    });
    await engine.use(Actor._plugin);
    await engine.run(() => Actor._plugin.spawn());

    expect(handle!.world.z).toBe(0);
  });

  it("world.scaleX and world.scaleY are always 1 (not yet implemented in WASM)", async () => {
    const engine = await createEngine({ _bridge: bridge });
    let handle: ReturnType<typeof useTransform> | undefined;
    const Actor = defineActor(Prefab, () => {
      handle = useTransform();
      return {};
    });
    await engine.use(Actor._plugin);
    await engine.run(() => Actor._plugin.spawn());

    expect(handle!.world.scaleX).toBe(1);
    expect(handle!.world.scaleY).toBe(1);
  });
});

describe("useTransform — setParent / detach", () => {
  let bridge: WasmBridgeImpl;

  beforeEach(() => {
    bridge = new WasmBridgeImpl();
    bridge._injectMock(createMockEngine() as any);
  });

  it("setParent works correctly with high-generation entity id", async () => {
    const engine = await createEngine({ _bridge: bridge });
    const wasmEngine = bridge.engine();
    // Ensure the method exists before spying
    if (!wasmEngine.set_entity_parent) {
      wasmEngine.set_entity_parent = () => {};
    }
    const spy = vi.spyOn(wasmEngine, "set_entity_parent").mockImplementation(() => {});

    // Arrange: parent with generation = 2^21 (triggers precision bug)
    const generation = 2097152n;
    const index = 3n;
    const parentId = (generation << 32n) | index;

    let childEntityId: EntityId | undefined;
    const Child = defineActor(Prefab, () => {
      const t = useTransform();
      return { setParentTo: (id: EntityId) => t.setParent(id) };
    });
    await engine.use(Child._plugin);

    await engine.run(() => {
      childEntityId = Child._plugin.spawn();
      const api = Child._instances.get(childEntityId)?.api;
      if (api === undefined || childEntityId === undefined) throw new Error("missing child");
      api.setParentTo(parentId as EntityId);
    });

    // The bridge call should receive index=3, not a corrupted value.
    expect(spy).toHaveBeenCalledWith(
      Number(childEntityId!) & 0xffffffff,
      3, // should be exactly 3, not corrupted
      false,
    );
  });

  it("setParent() calls set_entity_parent with correct indices", async () => {
    const engine = await createEngine({ _bridge: bridge });
    const wasmEngine = bridge.engine();
    // Ensure the method exists before spying
    if (!wasmEngine.set_entity_parent) {
      wasmEngine.set_entity_parent = () => {};
    }
    const spy = vi.spyOn(wasmEngine, "set_entity_parent").mockImplementation(() => {});

    let childEntityId: EntityId | undefined;
    const Child = defineActor(Prefab, () => {
      const t = useTransform();
      return { setParentTo: (id: EntityId) => t.setParent(id) };
    });
    await engine.use(Child._plugin);

    await engine.run(() => {
      childEntityId = Child._plugin.spawn();
      const api = Child._instances.get(childEntityId)?.api;
      if (api === undefined || childEntityId === undefined) throw new Error("missing child");
      api.setParentTo(99n as EntityId);
    });

    expect(spy).toHaveBeenCalledWith(
      Number(childEntityId!) & 0xffffffff,
      Number(99n) & 0xffffffff,
      false,
    );
  });

  it("detach() calls set_entity_parent with u32::MAX (0xffffffff) as parent index", async () => {
    const engine = await createEngine({ _bridge: bridge });
    const wasmEngine = bridge.engine();
    // Ensure the method exists before spying
    if (!wasmEngine.set_entity_parent) {
      wasmEngine.set_entity_parent = () => {};
    }
    const spy = vi.spyOn(wasmEngine, "set_entity_parent").mockImplementation(() => {});

    let entityId: EntityId | undefined;
    const Actor = defineActor(Prefab, () => {
      const t = useTransform();
      return { doDetach: () => t.detach() };
    });
    await engine.use(Actor._plugin);

    await engine.run(() => {
      entityId = Actor._plugin.spawn();
      const api = Actor._instances.get(entityId)?.api;
      if (api === undefined || entityId === undefined) throw new Error("missing api");
      api.doDetach();
    });

    expect(spy).toHaveBeenCalledWith(Number(entityId!) & 0xffffffff, 0xffffffff, false);
  });
});

describe("useTransform — world reads", () => {
  let bridge: WasmBridgeImpl;

  beforeEach(() => {
    bridge = new WasmBridgeImpl();
    bridge._injectMock(createMockEngine() as any);
  });

  it("world reads return values from the bridge", async () => {
    const engine = await createEngine({ _bridge: bridge });

    let worldHandle: any;
    const SimplePrefab = definePrefab([{ def: Pos, defaults: { x: 0, y: 0 } }]);
    const Actor = defineActor(SimplePrefab, () => {
      worldHandle = useTransform();
      return {};
    });
    await engine.use(Actor._plugin);

    const TestLayout = defineLayout(() => {
      placeActor(Actor, { at: [10, 20] });
      return {};
    });

    await engine.run(async () => {
      const layout = useLayout(TestLayout, { lazy: true });
      await layout.load();
    });

    // world reads should return numbers (mock bridge returns 0 for undefined calls)
    expect(typeof worldHandle?.world.x).toBe("number");
    expect(typeof worldHandle?.world.y).toBe("number");
    expect(typeof worldHandle?.world.rotation).toBe("number");
  });
});
