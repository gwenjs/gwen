/**
 * Tests for @gwenjs/physics2d — Physics2DPlugin
 *
 * Strategy: mock the WASM module entirely so tests run in Node.js
 * without a browser or real .wasm file.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";

// ─── Helpers & mocks ─────────────────────────────────────────────────────────

function makeMockWasmPlugin() {
  const sensorCounts = new Map<string, number>();

  return {
    physics_init: vi.fn(),
    physics_add_rigid_body: vi.fn().mockReturnValue(42),
    physics_add_box_collider: vi.fn(),
    physics_add_ball_collider: vi.fn(),
    physics_remove_rigid_body: vi.fn(),
    physics_load_tilemap_chunk_body: vi.fn().mockReturnValue(777),
    physics_unload_tilemap_chunk_body: vi.fn(),
    physics_apply_impulse: vi.fn(),
    physics_set_linear_velocity: vi.fn(),
    physics_set_kinematic_position: vi.fn(),
    physics_set_event_coalescing: vi.fn(),
    physics_set_quality: vi.fn(),
    physics_set_global_ccd_enabled: vi.fn(),
    physics_consume_event_metrics: vi.fn().mockReturnValue([1, 0, 0, 1]),
    physics_get_linear_velocity: vi.fn().mockReturnValue([]),
    physics_get_sensor_state: vi.fn((entityIndex: number, sensorId: number) => {
      const key = `${entityIndex}:${sensorId}`;
      const count = sensorCounts.get(key) ?? 0;
      return [count, count > 0 ? 1 : 0];
    }),
    physics_update_sensor_state: vi.fn((entityIndex: number, sensorId: number, started: number) => {
      const key = `${entityIndex}:${sensorId}`;
      const current = sensorCounts.get(key) ?? 0;
      const next = started === 1 ? current + 1 : Math.max(0, current - 1);
      sensorCounts.set(key, next);
    }),
    physics_step: vi.fn(),
    physics_get_position: vi.fn().mockReturnValue([]),
    physics_get_collision_events_ptr: vi.fn().mockReturnValue(0),
    physics_get_collision_event_count: vi.fn().mockReturnValue(0),
    stats: vi.fn().mockReturnValue('{"bodies":0,"colliders":0}'),
    bridge_schema_version: vi.fn().mockReturnValue(PHYSICS2D_BRIDGE_SCHEMA_VERSION),
    free: vi.fn(),
  };
}

/**
 * Creates a mock GwenEngine suitable for testing the new RFC-001 plugin API.
 * Services are stored in `_provided` and hooks in `_hookHandlers` for inspection.
 */
function makeMockEngine(_wasm: any) {
  const provided: Record<string, unknown> = {};
  const hookHandlers: Record<string, ((...args: any[]) => void)[]> = {};
  return {
    provide: vi.fn((key: string, value: unknown) => {
      provided[key] = value;
    }),
    isAlive: () => true,
    disposables: { add() {} },
    hooks: {
      hook: vi.fn((name: string, handler: (...args: any[]) => void) => {
        hookHandlers[name] = hookHandlers[name] ?? [];
        hookHandlers[name].push(handler);
      }),
      callHook: vi.fn(async (_name: string, ..._args: any[]) => undefined),
      /** Trigger a registered hook from tests. */
      _trigger: async (name: string, ...args: any[]) => {
        for (const h of hookHandlers[name] ?? []) await h(...args);
      },
    },
    _provided: provided,
    _hookHandlers: hookHandlers,
  };
}

function makeMockBridge(wasm: any) {
  return {
    isActive: vi.fn().mockReturnValue(true),
    hasPhysics: vi.fn().mockReturnValue(true),
    getPhysicsBridge: vi.fn().mockReturnValue(wasm),
    getLinearMemory: vi.fn().mockReturnValue({ buffer: new ArrayBuffer(65536) }),
    getEntityGeneration: vi.fn((_slot: number) => 0),
  };
}

function makeMockBus(transformBuf?: ArrayBuffer, eventsBuf?: ArrayBuffer) {
  const tb = transformBuf ?? new ArrayBuffer(10_000 * 20);
  const eb = eventsBuf ?? new ArrayBuffer(8 + 256 * 19);
  return {
    get: vi.fn((pluginId: string, channelName: string) => {
      if (pluginId === "physics2d" && channelName === "transform") return { buffer: tb };
      if (pluginId === "physics2d" && channelName === "events") return { buffer: eb };
      return undefined;
    }),
    _transformBuf: tb,
    _eventsBuf: eb,
  };
}

// ── Mock getWasmBridge ───────────────────────────────────────────────────────

vi.mock("@gwenjs/core/internal", async (importOriginal) => {
  const original = await importOriginal<typeof import("@gwenjs/core/internal")>();
  return { ...original, getWasmBridge: vi.fn() };
});

import { createEntityId } from "@gwenjs/core";
import { engineContext, getWasmBridge } from "@gwenjs/core/internal";
import { Physics2DPlugin } from "../src";
import { physics2D } from "../src/plugin/index.js";

function slotId(slot: number) {
  return createEntityId(slot, 0);
}
import {
  BODY_TYPE,
  PHYSICS2D_BRIDGE_SCHEMA_VERSION,
  readCollisionEventsFromBuffer,
} from "../src/types";

// ── Helpers: lifecycle via the new plugin interface ───────────────────────────

/**
 * Wires the mock bridge into getWasmBridge and calls plugin.setup().
 */
async function initPlugin(
  plugin: ReturnType<typeof Physics2DPlugin>,
  mockBridge: ReturnType<typeof makeMockBridge>,
  mockEngine: ReturnType<typeof makeMockEngine>,
) {
  (getWasmBridge as Mock).mockReturnValue(mockBridge);
  engineContext.set(mockEngine as never, true);
  (mockEngine as { memory: unknown }).memory = {
    view(desc: { name: string; type: string; ptr: () => number; length: () => number }) {
      let cached: DataView | Float32Array | Uint32Array | null = null;
      return {
        name: desc.name,
        epoch: 0,
        get array() {
          const mem = mockBridge.getLinearMemory();
          if (cached !== null && cached.byteLength !== 0 && cached.buffer === mem.buffer) {
            return cached;
          }
          const ptr = desc.ptr();
          const length = desc.length();
          if (desc.type === "f32") cached = new Float32Array(mem.buffer, ptr, length);
          else if (desc.type === "u32") cached = new Uint32Array(mem.buffer, ptr, length);
          else cached = new DataView(mem.buffer, ptr, length);
          return cached;
        },
        dispose() {},
      };
    },
  };
  await plugin.setup!(mockEngine as any);
}

/** Registers `handle` in the owner map so collider calls are not stale. */
function ownColliderHandle(
  engine: ReturnType<typeof makeMockEngine>,
  wasm: ReturnType<typeof makeMockWasmPlugin>,
  handle: number,
): void {
  wasm.physics_add_rigid_body.mockReturnValueOnce(handle);
  const physics = engine._provided["physics2d"] as import("../src").Physics2DAPI;
  physics.addRigidBody(slotId(1), "dynamic", 0, 0);
}

/** Owners stay hidden until the step hook clears ownerChangedSinceStep. */
async function publishOwners(
  engine: ReturnType<typeof makeMockEngine>,
  slots: number[],
): Promise<void> {
  const physics = engine._provided["physics2d"] as import("../src").Physics2DAPI;
  for (const slot of slots) physics.addRigidBody(slotId(slot), "dynamic", 0, 0);
  await engine.hooks._trigger("engine:before-update", 0.016);
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe("Physics2DPlugin", () => {
  let mockWasmPlugin: ReturnType<typeof makeMockWasmPlugin>;
  let mockEngine: ReturnType<typeof makeMockEngine>;
  let mockBridge: ReturnType<typeof makeMockBridge>;
  let _mockBus: ReturnType<typeof makeMockBus>;

  beforeEach(() => {
    mockWasmPlugin = makeMockWasmPlugin();
    mockBridge = makeMockBridge(mockWasmPlugin);
    _mockBus = makeMockBus();
    mockEngine = makeMockEngine(mockWasmPlugin);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── Identity ──────────────────────────────────────────────────────────────

  it("has correct name", () => {
    const plugin = Physics2DPlugin();
    expect(plugin.name).toBe("@gwenjs/physics2d");
  });

  it("has a provides.physics key", () => {
    const plugin = Physics2DPlugin();
    expect(plugin.provides).toHaveProperty("physics");
  });

  // ── physics2D() helper ────────────────────────────────────────────────────

  it("physics2D() returns a plugin object with name and setup", () => {
    const p = physics2D();
    expect(p).toHaveProperty("name", "@gwenjs/physics2d");
    expect(p).toHaveProperty("setup");
  });

  // ── setup ─────────────────────────────────────────────────────────────────

  it("setup initializes physics via wasm.physics_init", async () => {
    const plugin = Physics2DPlugin({ gravity: -20, gravityX: 1, maxEntities: 500 });
    await initPlugin(plugin, mockBridge, mockEngine);
    expect(mockWasmPlugin.physics_init).toHaveBeenCalledWith(1, -20, 500);
  });

  it("setup registers the physics service", async () => {
    const plugin = Physics2DPlugin();
    await initPlugin(plugin, mockBridge, mockEngine);
    expect(mockEngine.provide).toHaveBeenCalledWith("physics2d", expect.any(Object));
    expect(mockEngine._provided["physics2d"]).toBeDefined();
    expect(mockWasmPlugin.physics_set_event_coalescing).toHaveBeenCalledWith(1);
    expect(mockWasmPlugin.physics_set_quality).toHaveBeenCalledWith(1);
    expect(mockWasmPlugin.physics_set_global_ccd_enabled).toHaveBeenCalledWith(0);
  });

  it("setup enables global CCD for qualityPreset=high", async () => {
    const plugin = Physics2DPlugin({ qualityPreset: "high" });
    await initPlugin(plugin, mockBridge, mockEngine);
    expect(mockWasmPlugin.physics_set_global_ccd_enabled).toHaveBeenCalledWith(1);
  });

  it("setup respects explicit ccdEnabled override", async () => {
    const plugin = Physics2DPlugin({ qualityPreset: "high", ccdEnabled: false });
    await initPlugin(plugin, mockBridge, mockEngine);
    expect(mockWasmPlugin.physics_set_global_ccd_enabled).toHaveBeenCalledWith(0);
  });

  // ── onBeforeUpdate ────────────────────────────────────────────────────────

  it("onBeforeUpdate calls wasm.physics_step with deltaTime", async () => {
    const plugin = Physics2DPlugin();
    await initPlugin(plugin, mockBridge, mockEngine);
    await mockEngine.hooks._trigger("engine:before-update", 0.016);
    expect(mockWasmPlugin.physics_step).toHaveBeenCalledWith(0.016);
  });

  // ── teardown ──────────────────────────────────────────────────────────────

  it("teardown is safe to call before setup", () => {
    const plugin = Physics2DPlugin();
    expect(() => plugin.teardown!()).not.toThrow();
  });

  // ── Physics2DAPI — addRigidBody ───────────────────────────────────────────

  it("addRigidBody delegates to wasm with encoded bodyType (dynamic=1)", async () => {
    const plugin = Physics2DPlugin();
    await initPlugin(plugin, mockBridge, mockEngine);
    const physics = mockEngine._provided["physics2d"] as {
      addRigidBody: (...a: unknown[]) => unknown;
    };
    physics.addRigidBody(slotId(5), "dynamic", 1.0, 2.0);
    expect(mockWasmPlugin.physics_add_rigid_body).toHaveBeenCalledWith(
      5,
      1.0,
      2.0,
      BODY_TYPE.dynamic,
      1.0,
      1.0,
      0.0,
      0.0,
      0.0,
      0.0,
      undefined,
      undefined,
    );
  });

  it("addRigidBody delegates fixed body (type=0)", async () => {
    const plugin = Physics2DPlugin();
    await initPlugin(plugin, mockBridge, mockEngine);
    const physics = mockEngine._provided["physics2d"] as {
      addRigidBody: (...a: unknown[]) => unknown;
    };
    physics.addRigidBody(slotId(3), "fixed", 0, 0);
    expect(mockWasmPlugin.physics_add_rigid_body).toHaveBeenCalledWith(
      3,
      0,
      0,
      BODY_TYPE.fixed,
      1.0,
      1.0,
      0.0,
      0.0,
      0.0,
      0.0,
      undefined,
      undefined,
    );
  });

  it("addRigidBody delegates kinematic body (type=2)", async () => {
    const plugin = Physics2DPlugin();
    await initPlugin(plugin, mockBridge, mockEngine);
    const physics = mockEngine._provided["physics2d"] as {
      addRigidBody: (...a: unknown[]) => unknown;
    };
    physics.addRigidBody(slotId(7), "kinematic", 5, 5);
    expect(mockWasmPlugin.physics_add_rigid_body).toHaveBeenCalledWith(
      7,
      5,
      5,
      BODY_TYPE.kinematic,
      1.0,
      1.0,
      0.0,
      0.0,
      0.0,
      0.0,
      undefined,
      undefined,
    );
  });

  // ── Physics2DAPI — colliders ──────────────────────────────────────────────

  it("addBoxCollider delegates with default restitution/friction", async () => {
    const plugin = Physics2DPlugin();
    await initPlugin(plugin, mockBridge, mockEngine);
    const physics = mockEngine._provided["physics2d"] as {
      addBoxCollider: (...a: unknown[]) => unknown;
    };
    ownColliderHandle(mockEngine, mockWasmPlugin, 0);
    physics.addBoxCollider(0, 1.0, 2.0);
    expect(mockWasmPlugin.physics_add_box_collider).toHaveBeenCalledWith(
      0,
      1.0,
      2.0,
      0,
      0.5,
      0,
      1.0,
      0xffffffff,
      0xffffffff,
      undefined,
      undefined,
      undefined,
      0,
    );
  });

  it("addBallCollider delegates with custom options", async () => {
    const plugin = Physics2DPlugin();
    await initPlugin(plugin, mockBridge, mockEngine);
    const physics = mockEngine._provided["physics2d"] as {
      addBallCollider: (...a: unknown[]) => unknown;
    };
    ownColliderHandle(mockEngine, mockWasmPlugin, 0);
    physics.addBallCollider(0, 0.5, { restitution: 0.8, friction: 0.1 });
    expect(mockWasmPlugin.physics_add_ball_collider).toHaveBeenCalledWith(
      0,
      0.5,
      0.8,
      0.1,
      0,
      1.0,
      0xffffffff,
      0xffffffff,
      undefined,
      undefined,
      undefined,
    );
  });

  it("addBoxCollider forwards offset options to wasm when provided", async () => {
    const plugin = Physics2DPlugin();
    await initPlugin(plugin, mockBridge, mockEngine);
    const physics = mockEngine._provided["physics2d"] as {
      addBoxCollider: (...a: unknown[]) => unknown;
    };
    ownColliderHandle(mockEngine, mockWasmPlugin, 15);

    physics.addBoxCollider(15, 0.28, 0.28, {
      isSensor: true,
      offsetY: 0.34,
      colliderId: 0xf007,
    });

    expect(mockWasmPlugin.physics_add_box_collider).toHaveBeenCalledWith(
      15,
      0.28,
      0.28,
      0,
      0.5,
      1,
      1.0,
      0xffffffff,
      0xffffffff,
      0xf007,
      undefined,
      0.34,
      0,
    );
  });

  it("addBoxCollider keeps colliderId path when no offset is provided", async () => {
    const plugin = Physics2DPlugin();
    await initPlugin(plugin, mockBridge, mockEngine);
    const physics = mockEngine._provided["physics2d"] as {
      addBoxCollider: (...a: unknown[]) => unknown;
    };
    ownColliderHandle(mockEngine, mockWasmPlugin, 15);

    physics.addBoxCollider(15, 0.28, 0.28, {
      isSensor: true,
      colliderId: 0xf007,
    });

    expect(mockWasmPlugin.physics_add_box_collider).toHaveBeenCalledWith(
      15,
      0.28,
      0.28,
      0,
      0.5,
      1,
      1.0,
      0xffffffff,
      0xffffffff,
      0xf007,
      undefined,
      undefined,
      0,
    );
  });

  it("does not emit debug logs when debug option is disabled", async () => {
    const logSpy = vi.spyOn(console, "debug").mockImplementation(() => undefined);
    const plugin = Physics2DPlugin({ debug: false });
    await initPlugin(plugin, mockBridge, mockEngine);

    const physics = mockEngine._provided["physics2d"] as {
      addRigidBody: (...a: unknown[]) => unknown;
    };
    physics.addRigidBody(slotId(1), "dynamic", 0, 0);

    const hasPhysicsDebugLog = logSpy.mock.calls.some((call) =>
      String(call[0]).includes("@gwenjs/physics2d"),
    );
    expect(hasPhysicsDebugLog).toBe(false);
    logSpy.mockRestore();
  });

  it("emits strategic debug logs when debug option is enabled", async () => {
    const logSpy = vi.spyOn(console, "debug").mockImplementation(() => undefined);
    const plugin = Physics2DPlugin({ debug: true });
    await initPlugin(plugin, mockBridge, mockEngine);

    const physics = mockEngine._provided["physics2d"] as {
      addRigidBody: (...a: unknown[]) => unknown;
    };
    physics.addRigidBody(slotId(1), "dynamic", 0, 0);

    const hasPhysicsDebugLog = logSpy.mock.calls.some((call) =>
      String(call[0]).includes("@gwenjs/physics2d"),
    );
    expect(hasPhysicsDebugLog).toBe(true);
    logSpy.mockRestore();
  });

  // ── Physics2DAPI — removeBody & applyImpulse ──────────────────────────────

  it("removeBody delegates to wasm", async () => {
    const plugin = Physics2DPlugin();
    await initPlugin(plugin, mockBridge, mockEngine);
    const physics = mockEngine._provided["physics2d"] as import("../src").Physics2DAPI;
    physics.addRigidBody(slotId(42), "dynamic", 0, 0);
    physics.removeBody(slotId(42));
    expect(mockWasmPlugin.physics_remove_rigid_body).toHaveBeenCalledWith(42);
  });

  it("applyImpulse delegates with correct args", async () => {
    const plugin = Physics2DPlugin();
    await initPlugin(plugin, mockBridge, mockEngine);
    const physics = mockEngine._provided["physics2d"] as import("../src").Physics2DAPI;
    physics.addRigidBody(slotId(10), "dynamic", 0, 0);
    physics.applyImpulse(slotId(10), 5.0, -3.0);
    expect(mockWasmPlugin.physics_apply_impulse).toHaveBeenCalledWith(10, 5.0, -3.0);
  });

  // ── Physics2DAPI — getCollisionEvents ─────────────────────────────────────

  it("getCollisionEventsBatch returns an empty batch when ring buffer is empty", async () => {
    const plugin = Physics2DPlugin();
    await initPlugin(plugin, mockBridge, mockEngine);
    const physics = mockEngine._provided["physics2d"] as {
      getCollisionEventsBatch: () => {
        count: number;
        droppedSinceLastRead: number;
        events: unknown[];
      };
    };
    expect(physics.getCollisionEventsBatch()).toEqual(
      expect.objectContaining({ count: 0, droppedSinceLastRead: 0, events: [] }),
    );
  });

  it("getCollisionEvents reads events from binary ring buffer", async () => {
    const memory = mockBridge.getLinearMemory();
    const eb = memory.buffer;
    const view = new DataView(eb);
    mockWasmPlugin.physics_get_collision_events_ptr.mockReturnValue(0);
    mockWasmPlugin.physics_get_collision_event_count.mockReturnValue(2);

    // Event 0
    view.setUint32(0, 1, true); // slotA
    view.setUint32(4, 2, true); // slotB
    view.setUint32(8, 0, true); // type (0 = Started)
    view.setUint32(12, 0, true); // flags (collider IDs)

    // Event 1
    view.setUint32(16, 3, true); // slotA
    view.setUint32(20, 4, true); // slotB
    view.setUint32(24, 1, true); // type (1 = Stopped)
    view.setUint32(28, 0, true); // flags

    const plugin = Physics2DPlugin();
    await initPlugin(plugin, mockBridge, mockEngine);
    const physics = mockEngine._provided["physics2d"] as {
      getCollisionEventsBatch: () => { events: unknown[] };
    };

    const events = physics.getCollisionEventsBatch().events;
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual(expect.objectContaining({ started: true }));
    expect(events[1]).toEqual(expect.objectContaining({ started: false }));
  });

  it("getCollisionEventsBatch reuses the same decoded batch object within a frame", async () => {
    mockWasmPlugin.physics_get_collision_event_count.mockReturnValue(1);

    const plugin = Physics2DPlugin();
    await initPlugin(plugin, mockBridge, mockEngine);
    const physics = mockEngine._provided["physics2d"] as {
      getCollisionEventsBatch: (...args: unknown[]) => {
        events: unknown[];
        count: number;
      };
    };

    const first = physics.getCollisionEventsBatch();
    const second = physics.getCollisionEventsBatch();
    expect(second).toBe(first);
    expect(second.events).toBe(first.events);
  });

  it("getCollisionEventsBatch supports a max option without re-draining the buffer", async () => {
    mockWasmPlugin.physics_get_collision_event_count.mockReturnValue(2);

    const plugin = Physics2DPlugin();
    await initPlugin(plugin, mockBridge, mockEngine);
    const physics = mockEngine._provided["physics2d"] as {
      getCollisionEventsBatch: (opts?: { max?: number }) => {
        count: number;
        events: unknown[];
      };
    };

    expect(physics.getCollisionEventsBatch({ max: 1 }).count).toBe(1);
    expect(physics.getCollisionEventsBatch({ max: 1 }).events).toHaveLength(1);
    expect(physics.getCollisionEventsBatch().count).toBe(2);
    expect(physics.getCollisionEventsBatch().events).toHaveLength(2);
  });

  it("getCollisionContacts resolves raw slot events to EntityId contacts", async () => {
    const memory = mockBridge.getLinearMemory();
    const view = new DataView(memory.buffer);
    mockWasmPlugin.physics_get_collision_events_ptr.mockReturnValue(0);
    mockWasmPlugin.physics_get_collision_event_count.mockReturnValue(1);

    view.setUint32(0, 5, true); // slotA
    view.setUint32(4, 7, true); // slotB
    view.setUint32(8, 0, true); // started
    view.setUint32(12, 0, true);

    const plugin = Physics2DPlugin();
    await initPlugin(plugin, mockBridge, mockEngine);
    await publishOwners(mockEngine, [5, 7]);
    const physics = mockEngine._provided["physics2d"] as {
      getCollisionContacts: (...a: unknown[]) => unknown;
    };

    expect(physics.getCollisionContacts()).toEqual([
      expect.objectContaining({
        entityA: createEntityId(5, 0),
        entityB: createEntityId(7, 0),
        started: true,
      }),
    ]);
  });

  it("getCollisionContacts skips events when a slot has no owner", async () => {
    const memory = mockBridge.getLinearMemory();
    const view = new DataView(memory.buffer);
    mockWasmPlugin.physics_get_collision_events_ptr.mockReturnValue(0);
    mockWasmPlugin.physics_get_collision_event_count.mockReturnValue(1);

    view.setUint32(0, 1, true);
    view.setUint32(4, 2, true);
    view.setUint32(8, 0, true);
    view.setUint32(12, 0, true);

    const plugin = Physics2DPlugin();
    await initPlugin(plugin, mockBridge, mockEngine);
    const physics = mockEngine._provided["physics2d"] as {
      getCollisionContacts: (...a: unknown[]) => unknown[];
    };

    expect(physics.getCollisionContacts()).toEqual([]);
  });

  // ── Physics2DAPI — getPosition ────────────────────────────────────────────

  it("getPosition returns null for unknown entity (empty array)", async () => {
    mockWasmPlugin.physics_get_position.mockReturnValue([]);
    const plugin = Physics2DPlugin();
    await initPlugin(plugin, mockBridge, mockEngine);
    const physics = mockEngine._provided["physics2d"] as {
      getPosition: (...a: unknown[]) => unknown;
    };
    expect(physics.getPosition(slotId(999))).toBeNull();
  });

  it("getPosition returns { x, y, rotation } when found", async () => {
    mockWasmPlugin.physics_get_position.mockReturnValue([3.0, 7.5, 1.57]);
    const plugin = Physics2DPlugin();
    await initPlugin(plugin, mockBridge, mockEngine);
    const physics = mockEngine._provided["physics2d"] as import("../src").Physics2DAPI;
    physics.addRigidBody(slotId(0), "dynamic", 0, 0);
    expect(physics.getPosition(slotId(0))).toEqual({ x: 3.0, y: 7.5, rotation: 1.57 });
  });
});

// ─── readCollisionEventsFromBuffer ────────────────────────────────────────────

describe("readCollisionEventsFromBuffer", () => {
  it("buffer vide → []", () => {
    const buf = new ArrayBuffer(8 + 256 * 11);
    expect(readCollisionEventsFromBuffer(buf)).toEqual([]);
  });

  it("1 manually written event → read correctly", () => {
    const buf = new ArrayBuffer(8 + 256 * 11);
    const view = new DataView(buf);
    view.setUint32(0, 1, true);
    view.setUint32(4, 0, true);
    view.setUint32(8 + 2, 5, true);
    view.setUint32(8 + 6, 3, true);
    view.setUint8(8 + 10, 1);
    const events = readCollisionEventsFromBuffer(buf);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ started: true });
  });

  it("advances read_head after reading", () => {
    const buf = new ArrayBuffer(8 + 256 * 11);
    const view = new DataView(buf);
    view.setUint32(0, 1, true);
    view.setUint32(4, 0, true);
    readCollisionEventsFromBuffer(buf);
    expect(view.getUint32(4, true)).toBe(1);
  });

  it("double call → 2nd call returns []", () => {
    const buf = new ArrayBuffer(8 + 256 * 11);
    const view = new DataView(buf);
    view.setUint32(0, 1, true);
    view.setUint32(4, 0, true);
    view.setUint32(8 + 2, 5, true);
    view.setUint32(8 + 6, 3, true);
    view.setUint8(8 + 10, 1);
    readCollisionEventsFromBuffer(buf);
    expect(readCollisionEventsFromBuffer(buf)).toEqual([]);
  });

  it("write_head wrap-around", () => {
    const buf = new ArrayBuffer(8 + 2 * 11);
    const view = new DataView(buf);
    view.setUint32(0, 1, true);
    view.setUint32(4, 0, true);
    view.setUint32(8 + 2, 42, true);
    view.setUint32(8 + 6, 7, true);
    view.setUint8(8 + 10, 0);
    const events = readCollisionEventsFromBuffer(buf);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ started: false });
  });
});

// ─── BODY_TYPE constant ───────────────────────────────────────────────────────

describe("BODY_TYPE", () => {
  it("fixed = 0", () => expect(BODY_TYPE.fixed).toBe(0));
  it("dynamic = 1", () => expect(BODY_TYPE.dynamic).toBe(1));
  it("kinematic = 2", () => expect(BODY_TYPE.kinematic).toBe(2));
});

// ─── prefab:instantiate extensions ───────────────────────────────────────────

describe("Physics2DPlugin — prefab:instantiate hook", () => {
  let mockWasmPlugin: ReturnType<typeof makeMockWasmPlugin>;
  let mockBridge: ReturnType<typeof makeMockBridge>;
  let _mockBus: ReturnType<typeof makeMockBus>;

  // entityId with slot index = 1 (generation = 0)
  const entityId = createEntityId(1, 0);

  beforeEach(() => {
    mockWasmPlugin = makeMockWasmPlugin();
    mockBridge = makeMockBridge(mockWasmPlugin);
    _mockBus = makeMockBus();
  });

  afterEach(() => vi.clearAllMocks());

  async function boot() {
    const plugin = Physics2DPlugin();
    const engine = makeMockEngine(mockWasmPlugin);
    await initPlugin(plugin, mockBridge, engine);
    return { engine };
  }

  it("ne fait rien si extensions.physics est absent", async () => {
    const { engine } = await boot();

    await engine.hooks._trigger("prefab:instantiate", entityId, {});

    expect(mockWasmPlugin.physics_add_rigid_body).not.toHaveBeenCalled();
    expect(mockWasmPlugin.physics_add_ball_collider).not.toHaveBeenCalled();
    expect(mockWasmPlugin.physics_add_box_collider).not.toHaveBeenCalled();
  });

  it("ne fait rien si extensions est vide", async () => {
    const { engine } = await boot();

    await engine.hooks._trigger("prefab:instantiate", entityId, undefined);

    expect(mockWasmPlugin.physics_add_rigid_body).not.toHaveBeenCalled();
  });

  it("creates a ball collider if radius is provided", async () => {
    const { engine } = await boot();

    await engine.hooks._trigger("prefab:instantiate", entityId, {
      physics: { bodyType: "kinematic", colliders: [{ shape: "ball", radius: 14 }] },
    });

    expect(mockWasmPlugin.physics_add_rigid_body).toHaveBeenCalledTimes(1);
    expect(mockWasmPlugin.physics_add_ball_collider).toHaveBeenCalledTimes(1);
    expect(mockWasmPlugin.physics_add_box_collider).not.toHaveBeenCalled();
    // radius converted: 14 / 50 = 0.28, defaults: restitution=0, friction=0, isSensor=0, density=1
    expect(mockWasmPlugin.physics_add_ball_collider).toHaveBeenCalledWith(
      42,
      14 / 50,
      0,
      0,
      0,
      1.0,
      0xffffffff,
      0xffffffff,
      0,
      undefined,
      undefined,
    );
  });

  it("creates a box collider if hw + hh are provided", async () => {
    const { engine } = await boot();

    await engine.hooks._trigger("prefab:instantiate", entityId, {
      physics: { bodyType: "dynamic", colliders: [{ shape: "box", hw: 20, hh: 10 }] },
    });

    expect(mockWasmPlugin.physics_add_rigid_body).toHaveBeenCalledTimes(1);
    expect(mockWasmPlugin.physics_add_box_collider).toHaveBeenCalledTimes(1);
    expect(mockWasmPlugin.physics_add_ball_collider).not.toHaveBeenCalled();
    expect(mockWasmPlugin.physics_add_box_collider).toHaveBeenCalledWith(
      42,
      20 / 50,
      10 / 50,
      0,
      0,
      0,
      1.0,
      0xffffffff,
      0xffffffff,
      0,
      undefined,
      undefined,
      0,
    );
  });

  it("initialises position to (0,0) by default in addRigidBody", async () => {
    const { engine } = await boot();

    await engine.hooks._trigger("prefab:instantiate", entityId, {
      physics: { bodyType: "kinematic", colliders: [{ shape: "ball", radius: 5 }] },
    });

    // Position is always 0/0 — no ECS lookup is performed in the new implementation.
    expect(mockWasmPlugin.physics_add_rigid_body).toHaveBeenCalledWith(
      1,
      0,
      0,
      BODY_TYPE.kinematic,
      1.0,
      1.0,
      0.0,
      0.0,
      0.0,
      0.0,
      undefined,
      undefined,
    );
  });

  it("uses restitution and friction if provided", async () => {
    const { engine } = await boot();

    await engine.hooks._trigger("prefab:instantiate", entityId, {
      physics: {
        bodyType: "dynamic",
        colliders: [{ shape: "ball", radius: 8, restitution: 0.5, friction: 0.3 }],
      },
    });

    expect(mockWasmPlugin.physics_add_ball_collider).toHaveBeenCalledWith(
      42,
      8 / 50,
      0.5,
      0.3,
      0,
      1.0,
      0xffffffff,
      0xffffffff,
      0,
      undefined,
      undefined,
    );
  });

  it("defaults to restitution=0 and friction=0", async () => {
    const { engine } = await boot();

    await engine.hooks._trigger("prefab:instantiate", entityId, {
      physics: { bodyType: "kinematic", colliders: [{ shape: "ball", radius: 6 }] },
    });

    expect(mockWasmPlugin.physics_add_ball_collider).toHaveBeenCalledWith(
      42,
      6 / 50,
      0,
      0,
      0,
      1.0,
      0xffffffff,
      0xffffffff,
      0,
      undefined,
      undefined,
    );
  });

  it("does not create a collider when colliders[] is empty", async () => {
    const { engine } = await boot();

    await engine.hooks._trigger("prefab:instantiate", entityId, {
      physics: { bodyType: "kinematic", colliders: [] },
    });

    expect(mockWasmPlugin.physics_add_rigid_body).toHaveBeenCalledTimes(1); // body is created
    expect(mockWasmPlugin.physics_add_ball_collider).not.toHaveBeenCalled();
    expect(mockWasmPlugin.physics_add_box_collider).not.toHaveBeenCalled();
  });

  it("the hook is properly registered via engine.hooks.hook", async () => {
    const { engine } = await boot();
    expect(engine.hooks.hook).toHaveBeenCalledWith("prefab:instantiate", expect.any(Function));
  });

  it("mass and gravityScale are passed to add_rigid_body", async () => {
    const { engine } = await boot();
    await engine.hooks._trigger("prefab:instantiate", entityId, {
      physics: {
        bodyType: "dynamic",
        mass: 5.0,
        gravityScale: 0.5,
        colliders: [{ shape: "ball", radius: 10 }],
      },
    });
    expect(mockWasmPlugin.physics_add_rigid_body).toHaveBeenCalledWith(
      1,
      0,
      0,
      BODY_TYPE.dynamic,
      5.0,
      0.5,
      0.0,
      0.0,
      0.0,
      0.0,
      undefined,
      undefined,
    );
  });

  it("ccdEnabled per-body override is passed to add_rigid_body", async () => {
    const { engine } = await boot();
    await engine.hooks._trigger("prefab:instantiate", entityId, {
      physics: {
        bodyType: "dynamic",
        ccdEnabled: true,
        colliders: [{ shape: "ball", radius: 10 }],
      },
    });
    expect(mockWasmPlugin.physics_add_rigid_body).toHaveBeenCalledWith(
      1,
      0,
      0,
      BODY_TYPE.dynamic,
      1.0,
      1.0,
      0.0,
      0.0,
      0.0,
      0.0,
      1,
      undefined,
    );
  });

  it("additionalSolverIterations is passed to add_rigid_body", async () => {
    const { engine } = await boot();
    await engine.hooks._trigger("prefab:instantiate", entityId, {
      physics: {
        bodyType: "dynamic",
        additionalSolverIterations: 6,
        colliders: [{ shape: "ball", radius: 10 }],
      },
    });
    expect(mockWasmPlugin.physics_add_rigid_body).toHaveBeenCalledWith(
      1,
      0,
      0,
      BODY_TYPE.dynamic,
      1.0,
      1.0,
      0.0,
      0.0,
      0.0,
      0.0,
      undefined,
      6,
    );
  });

  it("linearDamping and angularDamping are passed", async () => {
    const { engine } = await boot();
    await engine.hooks._trigger("prefab:instantiate", entityId, {
      physics: {
        bodyType: "dynamic",
        linearDamping: 0.3,
        angularDamping: 0.1,
        colliders: [{ shape: "ball", radius: 10 }],
      },
    });
    expect(mockWasmPlugin.physics_add_rigid_body).toHaveBeenCalledWith(
      1,
      0,
      0,
      BODY_TYPE.dynamic,
      1.0,
      1.0,
      0.3,
      0.1,
      0.0,
      0.0,
      undefined,
      undefined,
    );
  });

  it("initialVelocity is converted from pixels to metres", async () => {
    const { engine } = await boot();
    await engine.hooks._trigger("prefab:instantiate", entityId, {
      physics: {
        bodyType: "dynamic",
        initialVelocity: { vx: 100, vy: -200 },
        colliders: [{ shape: "ball", radius: 10 }],
      },
    });
    expect(mockWasmPlugin.physics_add_rigid_body).toHaveBeenCalledWith(
      1,
      0,
      0,
      BODY_TYPE.dynamic,
      1.0,
      1.0,
      0.0,
      0.0,
      2.0,
      -4.0,
      undefined,
      undefined,
    );
  });

  it("isSensor=true is passed to the collider (1)", async () => {
    const { engine } = await boot();
    await engine.hooks._trigger("prefab:instantiate", entityId, {
      physics: { bodyType: "kinematic", colliders: [{ shape: "ball", radius: 8, isSensor: true }] },
    });
    expect(mockWasmPlugin.physics_add_ball_collider).toHaveBeenCalledWith(
      42,
      8 / 50,
      0,
      0,
      1,
      1.0,
      0xffffffff,
      0xffffffff,
      0,
      undefined,
      undefined,
    );
  });

  it("isSensor absent → defaults to 0", async () => {
    const { engine } = await boot();
    await engine.hooks._trigger("prefab:instantiate", entityId, {
      physics: { bodyType: "kinematic", colliders: [{ shape: "ball", radius: 8 }] },
    });
    expect(mockWasmPlugin.physics_add_ball_collider).toHaveBeenCalledWith(
      42,
      8 / 50,
      0,
      0,
      0,
      1.0,
      0xffffffff,
      0xffffffff,
      0,
      undefined,
      undefined,
    );
  });

  it("density is passed to the box collider", async () => {
    const { engine } = await boot();
    await engine.hooks._trigger("prefab:instantiate", entityId, {
      physics: {
        bodyType: "dynamic",
        colliders: [{ shape: "box", hw: 10, hh: 5, density: 2.5 }],
      },
    });
    expect(mockWasmPlugin.physics_add_box_collider).toHaveBeenCalledWith(
      42,
      10 / 50,
      5 / 50,
      0,
      0,
      0,
      2.5,
      0xffffffff,
      0xffffffff,
      0,
      undefined,
      undefined,
      0,
    );
  });

  it("creates vNext colliders from colliders[]", async () => {
    const { engine } = await boot();

    await engine.hooks._trigger("prefab:instantiate", entityId, {
      physics: {
        bodyType: "dynamic",
        colliders: [
          { shape: "box", hw: 20, hh: 10, friction: 0.3 },
          { shape: "ball", radius: 8, isSensor: true },
        ],
      },
    });

    expect(mockWasmPlugin.physics_add_box_collider).toHaveBeenCalledWith(
      42,
      20 / 50,
      10 / 50,
      0,
      0.3,
      0,
      1.0,
      0xffffffff,
      0xffffffff,
      0,
      undefined,
      undefined,
      0,
    );
    expect(mockWasmPlugin.physics_add_ball_collider).toHaveBeenCalledWith(
      42,
      8 / 50,
      0,
      0,
      1,
      1.0,
      0xffffffff,
      0xffffffff,
      1,
      undefined,
      undefined,
    );
  });

  it("defaults to bodyType=dynamic on vNext schema", async () => {
    const { engine } = await boot();

    await engine.hooks._trigger("prefab:instantiate", entityId, {
      physics: {
        colliders: [{ shape: "ball", radius: 6 }],
      },
    });

    expect(mockWasmPlugin.physics_add_rigid_body).toHaveBeenCalledWith(
      1,
      0,
      0,
      BODY_TYPE.dynamic,
      1.0,
      1.0,
      0.0,
      0.0,
      0.0,
      0.0,
      undefined,
      undefined,
    );
  });

  it("material preset `ice` est resolu pour le schema vNext", async () => {
    const { engine } = await boot();

    await engine.hooks._trigger("prefab:instantiate", entityId, {
      physics: {
        colliders: [{ shape: "ball", radius: 8, material: "ice" }],
      },
    });

    expect(mockWasmPlugin.physics_add_ball_collider).toHaveBeenCalledWith(
      42,
      8 / 50,
      0,
      0.02,
      0,
      1.0,
      0xffffffff,
      0xffffffff,
      0,
      undefined,
      undefined,
    );
  });

  it("material custom object est resolu et les overrides explicites restent prioritaires", async () => {
    const { engine } = await boot();

    await engine.hooks._trigger("prefab:instantiate", entityId, {
      physics: {
        colliders: [
          {
            shape: "box",
            hw: 10,
            hh: 5,
            material: { friction: 0.9, restitution: 0.1, density: 2.0 },
            friction: 0.7,
          },
        ],
      },
    });

    expect(mockWasmPlugin.physics_add_box_collider).toHaveBeenCalledWith(
      42,
      10 / 50,
      5 / 50,
      0.1,
      0.7,
      0,
      2.0,
      0xffffffff,
      0xffffffff,
      0,
      undefined,
      undefined,
      0,
    );
  });
});

// ─── Physics2DPlugin — onUpdate policy ───────────────────────────────────────

describe("Physics2DPlugin — onUpdate policy", () => {
  let mockWasmPlugin: ReturnType<typeof makeMockWasmPlugin>;
  let mockBridge: ReturnType<typeof makeMockBridge>;

  beforeEach(() => {
    mockWasmPlugin = makeMockWasmPlugin();
    mockBridge = makeMockBridge(mockWasmPlugin);
  });

  afterEach(() => vi.clearAllMocks());

  function seedSingleCollisionEvent(slotA = 1, slotB = 2, started = true) {
    const memory = mockBridge.getLinearMemory();
    const view = new DataView(memory.buffer);
    view.setUint32(0, slotA, true);
    view.setUint32(4, slotB, true);
    view.setUint32(8, started ? 0 : 1, true); // 0=Started, 1=Stopped
    view.setUint32(12, 0xffffffff, true); // No collider IDs (absent)

    mockWasmPlugin.physics_get_collision_events_ptr.mockReturnValue(0);
    mockWasmPlugin.physics_get_collision_event_count.mockReturnValue(1);
  }

  function seedSingleCollisionEventV2(
    slotA: number,
    slotB: number,
    aColliderId: number,
    bColliderId: number,
    started = true,
  ) {
    const memory = mockBridge.getLinearMemory();
    const view = new DataView(memory.buffer);
    view.setUint32(0, slotA, true);
    view.setUint32(4, slotB, true);
    view.setUint32(8, started ? 0 : 1, true);
    const flags = (aColliderId & 0xffff) | ((bColliderId & 0xffff) << 16);
    view.setUint32(12, flags, true);

    mockWasmPlugin.physics_get_collision_events_ptr.mockReturnValue(0);
    mockWasmPlugin.physics_get_collision_event_count.mockReturnValue(1);
  }

  it("en mode pull sans callback opt-in, n emet pas le batch hook", async () => {
    const plugin = Physics2DPlugin({ eventMode: "pull" });
    const engine = makeMockEngine(mockWasmPlugin);
    seedSingleCollisionEvent(3, 4);

    await initPlugin(plugin, mockBridge, engine);
    await engine.hooks._trigger("engine:update", 0.016);

    expect(engine.hooks.callHook).not.toHaveBeenCalledWith(
      "physics:collision:batch",
      expect.anything(),
    );
  });

  it("dispatch le hook enrichi en mode hybrid", async () => {
    const plugin = Physics2DPlugin({ eventMode: "hybrid" });
    const engine = makeMockEngine(mockWasmPlugin);
    seedSingleCollisionEvent(7, 8);
    mockWasmPlugin.physics_consume_event_metrics.mockReturnValue([33, 1, 2, 1]);

    await initPlugin(plugin, mockBridge, engine);
    await publishOwners(engine, [7, 8]);
    await engine.hooks._trigger("engine:update", 0.016);

    expect(engine.hooks.callHook).toHaveBeenCalledWith(
      "physics:collision:batch",
      expect.objectContaining({
        frame: 33,
        droppedCritical: 1,
        droppedNonCritical: 2,
        droppedSinceLastRead: 3,
        count: 1,
      }),
    );
    expect(engine.hooks.callHook).toHaveBeenCalledWith(
      "physics:collision",
      expect.arrayContaining([expect.objectContaining({ started: true })]),
    );
  });

  it("updates sensor state in pull mode using collider ids (no callback required)", async () => {
    const plugin = Physics2DPlugin({ eventMode: "pull" });
    const engine = makeMockEngine(mockWasmPlugin);

    seedSingleCollisionEventV2(7, 8, 0xf007, 0xbeef);

    await initPlugin(plugin, mockBridge, engine);
    await publishOwners(engine, [7, 8]);
    await engine.hooks._trigger("engine:update", 0.016);

    const physics = engine._provided["physics2d"] as import("../src").Physics2DAPI;

    expect(physics.getSensorState(slotId(7), 0xf007).isActive).toBe(true);
    expect(physics.getSensorState(slotId(8), 0xbeef).isActive).toBe(true);
    // pull mode without callbacks should not emit collision hooks, only internal sensor updates
    expect(engine.hooks.callHook).not.toHaveBeenCalledWith(
      "physics:collision:batch",
      expect.anything(),
    );
  });

  it("updates known sensor id for legacy payloads without collider ids", async () => {
    const plugin = Physics2DPlugin({ eventMode: "pull" });
    const engine = makeMockEngine(mockWasmPlugin);
    const entityId = createEntityId(7, 0);

    // Legacy stride payload: no collider ids available
    seedSingleCollisionEvent(7, 8);

    await initPlugin(plugin, mockBridge, engine);
    await engine.hooks._trigger("prefab:instantiate", entityId, {
      physics: {
        colliders: [
          { shape: "box", hw: 10, hh: 10 },
          { shape: "box", hw: 8, hh: 2, isSensor: true, colliderId: 0xf007 },
        ],
      },
    });

    await engine.hooks._trigger("engine:before-update", 0.016);
    await engine.hooks._trigger("engine:update", 0.016);

    const physics = engine._provided["physics2d"] as import("../src").Physics2DAPI;

    expect(physics.getSensorState(slotId(7), 0xf007).isActive).toBe(true);
  });

  it("dispatch aussi quand un callback prefab onCollision est enregistre", async () => {
    const plugin = Physics2DPlugin({ eventMode: "pull" });
    const engine = makeMockEngine(mockWasmPlugin);
    const entityId = createEntityId(7, 0);
    const onCollision = vi.fn();
    seedSingleCollisionEvent(7, 8);

    await initPlugin(plugin, mockBridge, engine);
    await engine.hooks._trigger("prefab:instantiate", entityId, {
      physics: {
        colliders: [{ shape: "ball", radius: 6 }],
        onCollision,
      },
    });
    const physics = engine._provided["physics2d"] as import("../src").Physics2DAPI;
    physics.addRigidBody(slotId(8), "dynamic", 0, 0);
    await engine.hooks._trigger("engine:before-update", 0.016);
    await engine.hooks._trigger("engine:update", 0.016);

    expect(engine.hooks.callHook).toHaveBeenCalledWith(
      "physics:collision",
      expect.arrayContaining([expect.objectContaining({ started: true })]),
    );
    expect(onCollision).toHaveBeenCalled();
  });
});

// ─── LayerRegistry / layers & masks (Sprint 3) ───────────────────────────────

describe("LayerRegistry — layer resolution", () => {
  // We test LayerRegistry indirectly via the plugin's addBoxCollider /
  // addBallCollider bridge calls, which now forward membership + filter.

  let mockWasmPlugin: ReturnType<typeof makeMockWasmPlugin>;
  let mockBridge: ReturnType<typeof makeMockBridge>;
  let _mockBus: ReturnType<typeof makeMockBus>;

  beforeEach(() => {
    mockWasmPlugin = makeMockWasmPlugin();
    mockBridge = makeMockBridge(mockWasmPlugin);
    _mockBus = makeMockBus();
  });

  afterEach(() => vi.clearAllMocks());

  it("no layers config → membership and filter default to 0xFFFFFFFF", async () => {
    const freshEngine = makeMockEngine(mockWasmPlugin);
    await initPlugin(Physics2DPlugin(), mockBridge, freshEngine);
    const freshPhysics = freshEngine._provided["physics2d"] as {
      addBoxCollider: (...a: unknown[]) => void;
    };
    ownColliderHandle(freshEngine, mockWasmPlugin, 0);
    freshPhysics.addBoxCollider(0, 1.0, 1.0);
    expect(mockWasmPlugin.physics_add_box_collider).toHaveBeenCalledWith(
      0,
      1.0,
      1.0,
      0,
      0.5,
      0,
      1.0,
      0xffffffff,
      0xffffffff,
      undefined,
      undefined,
      undefined,
      0,
    );
  });

  it("named layers resolve to correct bitmask", async () => {
    const plugin = Physics2DPlugin({
      layers: { default: 0, player: 1, enemy: 2, ground: 3 },
    });
    const engine = makeMockEngine(mockWasmPlugin);
    await initPlugin(plugin, mockBridge, engine);
    const physics = engine._provided["physics2d"] as {
      addBallCollider: (...a: unknown[]) => void;
    };
    ownColliderHandle(engine, mockWasmPlugin, 0);
    physics.addBallCollider(0, 0.5, {
      membershipLayers: ["player"], // bit 1 → 0b10 = 2
      filterLayers: ["enemy", "ground"], // bit 2 + bit 3 → 0b1100 = 12
    });
    expect(mockWasmPlugin.physics_add_ball_collider).toHaveBeenCalledWith(
      0,
      0.5,
      0,
      0.5,
      0,
      1.0,
      2, // membership: 1 << 1
      12, // filter: (1<<2)|(1<<3)
      undefined,
      undefined,
      undefined,
    );
  });

  it("raw number bitmask is passed through as-is", async () => {
    const plugin = Physics2DPlugin({ layers: { default: 0 } });
    const engine = makeMockEngine(mockWasmPlugin);
    await initPlugin(plugin, mockBridge, engine);
    const physics = engine._provided["physics2d"] as {
      addBoxCollider: (...a: unknown[]) => void;
    };
    ownColliderHandle(engine, mockWasmPlugin, 0);
    physics.addBoxCollider(0, 1.0, 1.0, {
      membershipLayers: 0b0101,
      filterLayers: 0b1010,
    });
    expect(mockWasmPlugin.physics_add_box_collider).toHaveBeenCalledWith(
      0,
      1.0,
      1.0,
      0,
      0.5,
      0,
      1.0,
      5,
      10,
      undefined,
      undefined,
      undefined,
      0,
    );
  });

  it("unknown layer name throws a descriptive error", async () => {
    const plugin = Physics2DPlugin({
      layers: { player: 0, ground: 1 },
    });
    const engine = makeMockEngine(mockWasmPlugin);
    await initPlugin(plugin, mockBridge, engine);
    const physics = engine._provided["physics2d"] as {
      addBallCollider: (...a: unknown[]) => void;
    };
    ownColliderHandle(engine, mockWasmPlugin, 0);
    expect(() => physics.addBallCollider(0, 0.5, { membershipLayers: ["unknown_layer"] })).toThrow(
      /Unknown layer "unknown_layer"/,
    );
    expect(() => physics.addBallCollider(0, 0.5, { membershipLayers: ["unknown_layer"] })).toThrow(
      /player/,
    ); // hint lists known layers
  });

  it("throws on layer bit index out of range", () => {
    expect(() => Physics2DPlugin({ layers: { bad: 32 } })).toThrow(/invalid bit index/);
    expect(() => Physics2DPlugin({ layers: { bad: -1 } })).toThrow(/invalid bit index/);
  });

  it("throws when more than 32 layers are declared", () => {
    const tooMany: Record<string, number> = {};
    for (let i = 0; i < 33; i++) tooMany[`l${i}`] = i % 32; // reuse bits to avoid range error
    // The registry checks count, not unique bits
    expect(() => Physics2DPlugin({ layers: tooMany })).toThrow(/Too many layers/);
  });

  it("colliders[] with membershipLayers resolves correctly via prefab instantiation", async () => {
    const plugin = Physics2DPlugin({
      layers: { player: 1, ground: 3 },
    });
    const engine = makeMockEngine(mockWasmPlugin);
    await initPlugin(plugin, mockBridge, engine);
    const entityId = createEntityId(1, 0);
    await engine.hooks._trigger("prefab:instantiate", entityId, {
      physics: {
        colliders: [
          {
            shape: "ball",
            radius: 8,
            membershipLayers: ["player"], // bit 1 → 2
            filterLayers: ["ground"], // bit 3 → 8
          },
        ],
      },
    });
    expect(mockWasmPlugin.physics_add_ball_collider).toHaveBeenCalledWith(
      expect.any(Number),
      8 / 50,
      0,
      0,
      0,
      1.0,
      2, // membership
      8, // filter
      0,
      undefined,
      undefined,
    );
  });
});

// ─── Physics2DPlugin — tilemap chunk runtime ─────────────────────────────────

describe("Physics2DPlugin — tilemap chunk runtime", () => {
  let mockWasmPlugin: ReturnType<typeof makeMockWasmPlugin>;
  let mockBridge: ReturnType<typeof makeMockBridge>;
  let _mockBus: ReturnType<typeof makeMockBus>;

  beforeEach(() => {
    mockWasmPlugin = makeMockWasmPlugin();
    mockBridge = makeMockBridge(mockWasmPlugin);
    _mockBus = makeMockBus();
  });

  afterEach(() => vi.clearAllMocks());

  it("loadTilemapPhysicsChunk charge un body fixe de chunk puis ses colliders avec offsets", async () => {
    const plugin = Physics2DPlugin();
    const engine = makeMockEngine(mockWasmPlugin);
    await initPlugin(plugin, mockBridge, engine);
    const physics = engine._provided["physics2d"] as import("../src").Physics2DAPI;

    physics.loadTilemapPhysicsChunk(
      {
        key: "0:0",
        chunkX: 0,
        chunkY: 0,
        checksum: "abc123",
        rects: [{ x: 0, y: 0, w: 2, h: 1 }],
        colliders: [{ shape: "box", hw: 16, hh: 8, offsetX: 16, offsetY: 8 }],
      },
      3,
      4,
    );

    expect(mockWasmPlugin.physics_load_tilemap_chunk_body).toHaveBeenCalledWith(
      expect.any(Number),
      expect.any(Number),
      3,
      4,
    );
    expect(mockWasmPlugin.physics_add_box_collider).toHaveBeenCalledWith(
      777,
      16 / 50,
      8 / 50,
      0,
      0.5,
      0,
      1.0,
      0xffffffff,
      0xffffffff,
      0,
      16 / 50,
      8 / 50,
      0,
    );
  });

  it("patchTilemapPhysicsChunk unload puis recharge le chunk", async () => {
    const plugin = Physics2DPlugin();
    const engine = makeMockEngine(mockWasmPlugin);
    await initPlugin(plugin, mockBridge, engine);
    const physics = engine._provided["physics2d"] as import("../src").Physics2DAPI;
    const chunk = {
      key: "1:2",
      chunkX: 1,
      chunkY: 2,
      checksum: "v1",
      rects: [],
      colliders: [{ shape: "ball" as const, radius: 10 }],
    };

    physics.loadTilemapPhysicsChunk(chunk, 0, 0);
    physics.patchTilemapPhysicsChunk({ ...chunk, checksum: "v2" }, 1, 2);
    physics.unloadTilemapPhysicsChunk(chunk.key);

    expect(mockWasmPlugin.physics_unload_tilemap_chunk_body).toHaveBeenCalled();
    expect(mockWasmPlugin.physics_load_tilemap_chunk_body).toHaveBeenCalledTimes(2);
  });

  it("loadTilemapPhysicsChunk applique aussi les presets materiaux", async () => {
    const plugin = Physics2DPlugin();
    const engine = makeMockEngine(mockWasmPlugin);
    await initPlugin(plugin, mockBridge, engine);
    const physics = engine._provided["physics2d"] as import("../src").Physics2DAPI;

    physics.loadTilemapPhysicsChunk(
      {
        key: "2:0",
        chunkX: 2,
        chunkY: 0,
        checksum: "rubber",
        rects: [],
        colliders: [{ shape: "ball", radius: 12, material: "rubber" }],
      },
      0,
      0,
    );

    expect(mockWasmPlugin.physics_add_ball_collider).toHaveBeenCalledWith(
      777,
      12 / 50,
      0.85,
      1.2,
      0,
      1.0,
      0xffffffff,
      0xffffffff,
      0,
      undefined,
      undefined,
    );
  });
});

// ── Physics2DAPI — setLinearDamping, shape queries, oneWay ───────────────────

describe("Physics2DPlugin — shape queries, linear damping & oneWay", () => {
  let mockWasmPlugin: ReturnType<typeof makeMockWasmPlugin>;
  let mockEngine: ReturnType<typeof makeMockEngine>;
  let mockBridge: ReturnType<typeof makeMockBridge>;

  beforeEach(() => {
    mockWasmPlugin = makeMockWasmPlugin();
    mockBridge = makeMockBridge(mockWasmPlugin);
    mockEngine = makeMockEngine(mockWasmPlugin);
  });

  afterEach(() => vi.clearAllMocks());

  // ── setLinearDamping ──────────────────────────────────────────────────────

  it("setLinearDamping delegates to wasm with slot conversion", async () => {
    (mockWasmPlugin as any).physics_set_linear_damping = vi.fn();
    const plugin = Physics2DPlugin();
    await initPlugin(plugin, mockBridge, mockEngine);
    const physics = mockEngine._provided["physics2d"] as import("../src").Physics2DAPI;
    physics.addRigidBody(slotId(10), "dynamic", 0, 0);
    physics.setLinearDamping(slotId(10), 0.3);
    expect((mockWasmPlugin as any).physics_set_linear_damping).toHaveBeenCalledWith(10, 0.3);
  });

  it("setLinearDamping is a no-op when WASM method is absent", async () => {
    const plugin = Physics2DPlugin();
    await initPlugin(plugin, mockBridge, mockEngine);
    const physics = mockEngine._provided["physics2d"] as import("../src").Physics2DAPI;
    expect(() => physics.setLinearDamping(slotId(10), 0.3)).not.toThrow();
  });

  // ── Physics2DAPI — queryRadius ────────────────────────────────────────────

  it("queryRadius returns EntityIds converted from WASM slots", async () => {
    (mockWasmPlugin as any).physics_query_radius = vi.fn().mockReturnValue([42, 7]);
    const plugin = Physics2DPlugin();
    await initPlugin(plugin, mockBridge, mockEngine);
    const physics = mockEngine._provided["physics2d"] as import("../src").Physics2DAPI;
    await publishOwners(mockEngine, [42, 7]);
    const result = physics.queryRadius(1.0, 2.0, 5.0);
    expect((mockWasmPlugin as any).physics_query_radius).toHaveBeenCalledWith(
      1.0,
      2.0,
      5.0,
      0xffffffff,
      0xffffffff,
    );
    expect(result).toEqual([createEntityId(42, 0), createEntityId(7, 0)]);
  });

  it("queryRadius returns empty array when WASM method is absent", async () => {
    const plugin = Physics2DPlugin();
    await initPlugin(plugin, mockBridge, mockEngine);
    const physics = mockEngine._provided["physics2d"] as import("../src").Physics2DAPI;
    expect(physics.queryRadius(0, 0, 1.0)).toEqual([]);
  });

  it("queryRadius forwards numeric layer filters to WASM", async () => {
    (mockWasmPlugin as any).physics_query_radius = vi.fn().mockReturnValue([]);
    const plugin = Physics2DPlugin();
    await initPlugin(plugin, mockBridge, mockEngine);
    const physics = mockEngine._provided["physics2d"] as import("../src").Physics2DAPI;
    physics.queryRadius(0, 0, 1.0, { membershipLayers: 0b0011, filterLayers: 0b0101 });
    expect((mockWasmPlugin as any).physics_query_radius).toHaveBeenCalledWith(
      0,
      0,
      1.0,
      0b0011,
      0b0101,
    );
  });

  it("queryRadius drops slots that have no owner", async () => {
    (mockWasmPlugin as any).physics_query_radius = vi.fn().mockReturnValue([42, 99]);
    const plugin = Physics2DPlugin();
    await initPlugin(plugin, mockBridge, mockEngine);
    const physics = mockEngine._provided["physics2d"] as import("../src").Physics2DAPI;
    await publishOwners(mockEngine, [42]);
    const result = physics.queryRadius(0, 0, 1.0);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(createEntityId(42, 0));
  });

  // ── Physics2DAPI — queryRect ──────────────────────────────────────────────

  it("queryRect returns EntityIds converted from WASM slots", async () => {
    (mockWasmPlugin as any).physics_query_rect = vi.fn().mockReturnValue([5]);
    const plugin = Physics2DPlugin();
    await initPlugin(plugin, mockBridge, mockEngine);
    const physics = mockEngine._provided["physics2d"] as import("../src").Physics2DAPI;
    await publishOwners(mockEngine, [5]);
    const result = physics.queryRect(0, 0, 2.0, 1.0);
    expect((mockWasmPlugin as any).physics_query_rect).toHaveBeenCalledWith(
      0,
      0,
      2.0,
      1.0,
      0xffffffff,
      0xffffffff,
    );
    expect(result).toEqual([createEntityId(5, 0)]);
  });

  it("queryRect returns empty array when WASM method is absent", async () => {
    const plugin = Physics2DPlugin();
    await initPlugin(plugin, mockBridge, mockEngine);
    const physics = mockEngine._provided["physics2d"] as import("../src").Physics2DAPI;
    expect(physics.queryRect(0, 0, 1.0, 1.0)).toEqual([]);
  });

  it("queryRect forwards named layer filters via layerRegistry", async () => {
    (mockWasmPlugin as any).physics_query_rect = vi.fn().mockReturnValue([]);
    const plugin = Physics2DPlugin({ layers: { ground: 0, player: 1 } });
    await initPlugin(plugin, mockBridge, mockEngine);
    const physics = mockEngine._provided["physics2d"] as import("../src").Physics2DAPI;
    physics.queryRect(0, 0, 1.0, 1.0, { membershipLayers: ["ground"], filterLayers: ["player"] });
    expect((mockWasmPlugin as any).physics_query_rect).toHaveBeenCalledWith(
      0,
      0,
      1.0,
      1.0,
      0b01,
      0b10,
    );
  });

  // ── Physics2DAPI — pointQuery ─────────────────────────────────────────────

  it("pointQuery returns EntityIds converted from WASM slots", async () => {
    (mockWasmPlugin as any).physics_point_query = vi.fn().mockReturnValue([3, 8]);
    const plugin = Physics2DPlugin();
    await initPlugin(plugin, mockBridge, mockEngine);
    const physics = mockEngine._provided["physics2d"] as import("../src").Physics2DAPI;
    await publishOwners(mockEngine, [3, 8]);
    const result = physics.pointQuery(4.0, -1.5);
    expect((mockWasmPlugin as any).physics_point_query).toHaveBeenCalledWith(
      4.0,
      -1.5,
      0xffffffff,
      0xffffffff,
    );
    expect(result).toEqual([createEntityId(3, 0), createEntityId(8, 0)]);
  });

  it("pointQuery returns empty array when WASM method is absent", async () => {
    const plugin = Physics2DPlugin();
    await initPlugin(plugin, mockBridge, mockEngine);
    const physics = mockEngine._provided["physics2d"] as import("../src").Physics2DAPI;
    expect(physics.pointQuery(0, 0)).toEqual([]);
  });

  it("pointQuery forwards named layer filters via layerRegistry", async () => {
    (mockWasmPlugin as any).physics_point_query = vi.fn().mockReturnValue([]);
    const plugin = Physics2DPlugin({ layers: { ground: 0, player: 1 } });
    await initPlugin(plugin, mockBridge, mockEngine);
    const physics = mockEngine._provided["physics2d"] as import("../src").Physics2DAPI;
    physics.pointQuery(0, 0, { membershipLayers: ["ground"], filterLayers: ["player"] });
    expect((mockWasmPlugin as any).physics_point_query).toHaveBeenCalledWith(0, 0, 0b01, 0b10);
  });

  // ── Physics2DAPI — addBoxCollider oneWay ──────────────────────────────────

  it("addBoxCollider passes oneWay=1 when oneWay:true", async () => {
    const plugin = Physics2DPlugin();
    await initPlugin(plugin, mockBridge, mockEngine);
    const physics = mockEngine._provided["physics2d"] as import("../src").Physics2DAPI;
    ownColliderHandle(mockEngine, mockWasmPlugin, 0);
    physics.addBoxCollider(0, 1.0, 2.0, { oneWay: true });
    expect(mockWasmPlugin.physics_add_box_collider).toHaveBeenCalledWith(
      0,
      1.0,
      2.0,
      0,
      0.5,
      0,
      1.0,
      0xffffffff,
      0xffffffff,
      undefined,
      undefined,
      undefined,
      1,
    );
  });

  it("addBoxCollider passes oneWay=0 when oneWay:false", async () => {
    const plugin = Physics2DPlugin();
    await initPlugin(plugin, mockBridge, mockEngine);
    const physics = mockEngine._provided["physics2d"] as import("../src").Physics2DAPI;
    ownColliderHandle(mockEngine, mockWasmPlugin, 0);
    physics.addBoxCollider(0, 1.0, 2.0, { oneWay: false });
    expect(mockWasmPlugin.physics_add_box_collider).toHaveBeenCalledWith(
      0,
      1.0,
      2.0,
      0,
      0.5,
      0,
      1.0,
      0xffffffff,
      0xffffffff,
      undefined,
      undefined,
      undefined,
      0,
    );
  });
});
