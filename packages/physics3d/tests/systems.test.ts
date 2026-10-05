/**
 * Tests for Physics3D systems.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHooks } from "hookable";

const physics3dInit = vi.fn();
const physics3dStep = vi.fn();

const mockBridge = {
  variant: "physics3d" as const,
  getPhysicsBridge: vi.fn(() => ({
    physics3d_init: physics3dInit,
    physics3d_step: physics3dStep,
    // No physics3d_add_body — local mode
  })),
};

vi.mock("@gwenjs/core/internal", async (importOriginal) => {
  const original = await importOriginal<typeof import("@gwenjs/core/internal")>();
  const core = await import("@gwenjs/core");
  return { ...original, getWasmBridge: core.getWasmBridge };
});

vi.mock("@gwenjs/core", () => ({
  getWasmBridge: () => mockBridge,
  unpackEntityId: (id: bigint) => ({ index: Number(id & 0xffffffffn), generation: 0 }),
  createEntityId: (index: number, gen: number) => BigInt(index) | (BigInt(gen) << 32n),
  entityIndex: (id: bigint) => Number(id & 0xffffffffn),
  defineSystem: vi.fn((_name: string, factory: () => unknown) => factory()),
  definePlugin: vi.fn((factory: () => unknown) => {
    // Simulate V2 definePlugin: returns a factory function that creates plugin instances
    return function PluginFactory() {
      const def = factory() as Record<string, unknown>;
      return {
        name: def.name,
        setup(engine: unknown) {
          (def.setup as (engine: unknown) => void)?.(engine);
        },
        teardown() {
          (def.teardown as () => void)?.();
        },
      };
    };
  }),
}));

import type { ComponentDef } from "@gwenjs/core/system";
import { createPhysicsKinematicSyncSystem, SENSOR_ID_FOOT, SENSOR_ID_HEAD } from "../src/systems";

// ─── V2 mock engine factory ────────────────────────────────────────────────────

function createMockEngine(services: Record<string, unknown> = {}): any {
  const svc = new Map<string, unknown>(Object.entries(services));
  const hooks = createHooks();
  return {
    provide: (key: string, value: unknown) => {
      svc.set(key, value);
    },
    inject: (key: string) => {
      const v = svc.get(key);
      if (v === undefined) throw new Error(`No service: ${key}`);
      return v;
    },
    tryInject: (key: string) => svc.get(key) ?? null,
    use: vi.fn().mockResolvedValue(undefined),
    unuse: vi.fn().mockResolvedValue(undefined),
    hooks,
    createLiveQuery: vi.fn(() => [][Symbol.iterator]()),
    getComponent: vi.fn(),
    run: (fn: () => any) => fn(),
    activate: vi.fn(),
    deactivate: vi.fn(),
    maxEntities: 1000,
    targetFPS: 60,
    maxDeltaSeconds: 0.1,
    variant: "light",
    deltaTime: 0,
    frameCount: 0,
    getFPS: () => 0,
    getStats: () => ({ fps: 0, deltaTime: 0, frameCount: 0 }),
  };
}

describe("SENSOR_ID constants", () => {
  it("SENSOR_ID_FOOT is 0xf007", () => {
    expect(SENSOR_ID_FOOT).toBe(0xf007);
  });

  it("SENSOR_ID_HEAD is 0xf008", () => {
    expect(SENSOR_ID_HEAD).toBe(0xf008);
  });
});

describe("createPhysicsKinematicSyncSystem", () => {
  const position = { name: "position" } as ComponentDef;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makePhysicsMock() {
    return {
      hasBody: vi.fn(() => true),
      getBodyKind: vi.fn(() => "kinematic"),
      setKinematicPosition: vi.fn(() => true),
    };
  }

  interface LiveQueryEntity {
    readonly id: bigint;
    get(name: unknown): unknown;
  }

  function liveEntity(id: bigint, get: (name: unknown) => unknown): LiveQueryEntity {
    return { id, get };
  }

  function makeEngine(
    entities: readonly LiveQueryEntity[],
    physicsMock: ReturnType<typeof makePhysicsMock>,
  ) {
    const engine = createMockEngine({ physics3d: physicsMock });
    (engine.createLiveQuery as ReturnType<typeof vi.fn>).mockImplementation(() =>
      entities[Symbol.iterator](),
    );
    return engine;
  }

  it("factory returns a plugin with the correct name", () => {
    const factory = createPhysicsKinematicSyncSystem({ positionComponent: position });
    const instance = factory() as any;
    expect(instance.name).toBe("Physics3DKinematicSyncSystem");
  });

  it("resolves physics3d service on setup", () => {
    const factory = createPhysicsKinematicSyncSystem({ positionComponent: position });
    const instance = factory() as any;
    const physics = makePhysicsMock();
    const engine = createMockEngine({ physics3d: physics });

    instance.setup(engine);

    expect(engine.tryInject).toBeDefined();
  });

  it("syncs kinematic entity positions on engine:before-update", () => {
    const factory = createPhysicsKinematicSyncSystem({ positionComponent: position });
    const instance = factory() as any;
    const physics = makePhysicsMock();
    const entityId = 1n;
    const engine = makeEngine([liveEntity(entityId, () => ({ x: 1, y: 2, z: 3 }))], physics);
    engine.tryInject = vi.fn(() => physics);

    instance.setup(engine);
    engine.hooks.callHook("engine:before-update", 0);

    expect(physics.setKinematicPosition).toHaveBeenCalledWith(
      entityId,
      { x: 1, y: 2, z: 3 },
      undefined,
    );
  });

  it("skips entities without a body", () => {
    const factory = createPhysicsKinematicSyncSystem({ positionComponent: position });
    const instance = factory() as any;
    const physics = makePhysicsMock();
    physics.hasBody.mockReturnValue(false);
    const engine = makeEngine([liveEntity(1n, () => ({ x: 0, y: 0, z: 0 }))], physics);
    engine.tryInject = vi.fn(() => physics);

    instance.setup(engine);
    engine.hooks.callHook("engine:before-update", 0);

    expect(physics.setKinematicPosition).not.toHaveBeenCalled();
  });

  it("skips non-kinematic bodies", () => {
    const factory = createPhysicsKinematicSyncSystem({ positionComponent: position });
    const instance = factory() as any;
    const physics = makePhysicsMock();
    physics.getBodyKind.mockReturnValue("dynamic");
    const engine = makeEngine([liveEntity(1n, () => ({ x: 0, y: 0, z: 0 }))], physics);
    engine.tryInject = vi.fn(() => physics);

    instance.setup(engine);
    engine.hooks.callHook("engine:before-update", 0);

    expect(physics.setKinematicPosition).not.toHaveBeenCalled();
  });

  it("skips entities missing the position component", () => {
    const factory = createPhysicsKinematicSyncSystem({ positionComponent: position });
    const instance = factory() as any;
    const physics = makePhysicsMock();
    const engine = makeEngine([liveEntity(1n, () => null)], physics);
    engine.tryInject = vi.fn(() => physics);

    instance.setup(engine);
    engine.hooks.callHook("engine:before-update", 0);

    expect(physics.setKinematicPosition).not.toHaveBeenCalled();
  });

  it("syncs rotation when rotationComponent is configured", () => {
    const transform3d = { name: "transform3d" } as ComponentDef;
    const rotation3d = { name: "rotation3d" } as ComponentDef;
    const factory = createPhysicsKinematicSyncSystem({
      positionComponent: transform3d,
      rotationComponent: rotation3d,
    });
    const instance = factory() as any;
    const physics = makePhysicsMock();
    const engine = makeEngine(
      [
        liveEntity(1n, (name) => {
          if (name === transform3d) return { x: 0, y: 1, z: 0 };
          if (name === rotation3d) return { x: 0, y: 0.707, z: 0, w: 0.707 };
          return null;
        }),
      ],
      physics,
    );
    engine.tryInject = vi.fn(() => physics);

    instance.setup(engine);
    engine.hooks.callHook("engine:before-update", 0);

    expect(physics.setKinematicPosition).toHaveBeenCalledWith(
      1n,
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 0.707, z: 0, w: 0.707 },
    );
    expect(engine.createLiveQuery).toHaveBeenCalledWith([transform3d, rotation3d]);
  });

  it("does not query a component by the string name transform3d", () => {
    expect(() => createPhysicsKinematicSyncSystem()).toThrow(TypeError);
  });

  it("clears physics reference on teardown", () => {
    const factory = createPhysicsKinematicSyncSystem({ positionComponent: position });
    const instance = factory() as any;
    const physics = makePhysicsMock();
    const engine = makeEngine([liveEntity(1n, () => ({ x: 0, y: 0, z: 0 }))], physics);
    engine.tryInject = vi.fn(() => physics);

    instance.setup(engine);
    instance.teardown();
    engine.hooks.callHook("engine:before-update", 0);

    // After teardown, physics is null so setKinematicPosition should not be called
    expect(physics.setKinematicPosition).not.toHaveBeenCalled();
  });

  it("does not sync on engine:before-update before setup", () => {
    const factory = createPhysicsKinematicSyncSystem({ positionComponent: position });
    const instance = factory() as any;
    const physics = makePhysicsMock();
    const engine = createMockEngine({ physics3d: physics });

    // The hook is not registered until setup.
    engine.hooks.callHook("engine:before-update", 0);
    expect(instance.name).toBe("Physics3DKinematicSyncSystem");
    expect(physics.setKinematicPosition).not.toHaveBeenCalled();
  });
});
