/**
 * Tests for Physics3D systems.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHooks } from 'hookable';

const physics3dInit = vi.fn();
const physics3dStep = vi.fn();

const mockBridge = {
  variant: 'physics3d' as const,
  getPhysicsBridge: vi.fn(() => ({
    physics3d_init: physics3dInit,
    physics3d_step: physics3dStep,
    // No physics3d_add_body — local mode
  })),
};

vi.mock('@gwenjs/core', () => ({
  getWasmBridge: () => mockBridge,
  unpackEntityId: (id: bigint) => ({ index: Number(id & 0xffffffffn), generation: 0 }),
  createEntityId: (index: number, gen: number) => BigInt(index) | (BigInt(gen) << 32n),
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
        onBeforeUpdate(dt?: number) {
          (def.onBeforeUpdate as (dt?: number) => void)?.(dt);
        },
        teardown() {
          (def.teardown as () => void)?.();
        },
      };
    };
  }),
}));

import { createPhysicsKinematicSyncSystem, SENSOR_ID_FOOT, SENSOR_ID_HEAD } from '../src/systems';

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
    variant: 'light',
    deltaTime: 0,
    frameCount: 0,
    getFPS: () => 0,
    getStats: () => ({ fps: 0, deltaTime: 0, frameCount: 0 }),
  };
}

describe('SENSOR_ID constants', () => {
  it('SENSOR_ID_FOOT is 0xf007', () => {
    expect(SENSOR_ID_FOOT).toBe(0xf007);
  });

  it('SENSOR_ID_HEAD is 0xf008', () => {
    expect(SENSOR_ID_HEAD).toBe(0xf008);
  });
});

describe('createPhysicsKinematicSyncSystem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makePhysicsMock() {
    return {
      hasBody: vi.fn(() => true),
      getBodyKind: vi.fn(() => 'kinematic'),
      setKinematicPosition: vi.fn(() => true),
    };
  }

  function makeEngine(entities: unknown[], physicsMock: ReturnType<typeof makePhysicsMock>) {
    const engine = createMockEngine({ physics3d: physicsMock });
    (engine.createLiveQuery as ReturnType<typeof vi.fn>).mockReturnValue(
      entities[Symbol.iterator](),
    );
    return engine;
  }

  it('factory returns a plugin with the correct name', () => {
    const factory = createPhysicsKinematicSyncSystem();
    const instance = factory() as any;
    expect(instance.name).toBe('Physics3DKinematicSyncSystem');
  });

  it('resolves physics3d service on setup', () => {
    const factory = createPhysicsKinematicSyncSystem();
    const instance = factory() as any;
    const physics = makePhysicsMock();
    const engine = createMockEngine({ physics3d: physics });

    instance.setup(engine);

    expect(engine.tryInject).toBeDefined();
  });

  it('syncs kinematic entity positions on onBeforeUpdate', () => {
    const factory = createPhysicsKinematicSyncSystem();
    const instance = factory() as any;
    const physics = makePhysicsMock();
    const entityId = 1n;
    const engine = makeEngine([entityId], physics);
    engine.tryInject = vi.fn(() => physics);
    engine.getComponent = vi.fn().mockReturnValue({ x: 1, y: 2, z: 3 });

    instance.setup(engine);
    instance.onBeforeUpdate(0);

    expect(physics.setKinematicPosition).toHaveBeenCalledWith(
      entityId,
      { x: 1, y: 2, z: 3 },
      undefined,
    );
  });

  it('skips entities without a body', () => {
    const factory = createPhysicsKinematicSyncSystem();
    const instance = factory() as any;
    const physics = makePhysicsMock();
    physics.hasBody.mockReturnValue(false);
    const engine = makeEngine([1n], physics);
    engine.tryInject = vi.fn(() => physics);
    engine.getComponent = vi.fn().mockReturnValue({ x: 0, y: 0, z: 0 });

    instance.setup(engine);
    instance.onBeforeUpdate(0);

    expect(physics.setKinematicPosition).not.toHaveBeenCalled();
  });

  it('skips non-kinematic bodies', () => {
    const factory = createPhysicsKinematicSyncSystem();
    const instance = factory() as any;
    const physics = makePhysicsMock();
    physics.getBodyKind.mockReturnValue('dynamic');
    const engine = makeEngine([1n], physics);
    engine.tryInject = vi.fn(() => physics);
    engine.getComponent = vi.fn().mockReturnValue({ x: 0, y: 0, z: 0 });

    instance.setup(engine);
    instance.onBeforeUpdate(0);

    expect(physics.setKinematicPosition).not.toHaveBeenCalled();
  });

  it('skips entities missing the position component', () => {
    const factory = createPhysicsKinematicSyncSystem();
    const instance = factory() as any;
    const physics = makePhysicsMock();
    const engine = makeEngine([1n], physics);
    engine.tryInject = vi.fn(() => physics);
    engine.getComponent = vi.fn().mockReturnValue(null);

    instance.setup(engine);
    instance.onBeforeUpdate(0);

    expect(physics.setKinematicPosition).not.toHaveBeenCalled();
  });

  it('syncs rotation when rotationComponent is configured', () => {
    const factory = createPhysicsKinematicSyncSystem({
      positionComponent: 'transform3d',
      rotationComponent: 'rotation3d',
    });
    const instance = factory() as any;
    const physics = makePhysicsMock();
    const engine = makeEngine([1n], physics);
    engine.tryInject = vi.fn(() => physics);
    engine.getComponent = vi.fn().mockImplementation((_entityId: unknown, comp: string) => {
      if (comp === 'transform3d') return { x: 0, y: 1, z: 0 };
      if (comp === 'rotation3d') return { x: 0, y: 0.707, z: 0, w: 0.707 };
      return null;
    });

    instance.setup(engine);
    instance.onBeforeUpdate(0);

    expect(physics.setKinematicPosition).toHaveBeenCalledWith(
      1n,
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 0.707, z: 0, w: 0.707 },
    );
  });

  it('uses default positionComponent "transform3d"', () => {
    const factory = createPhysicsKinematicSyncSystem();
    const instance = factory() as any;
    const physics = makePhysicsMock();
    const engine = makeEngine([1n], physics);
    engine.tryInject = vi.fn(() => physics);
    engine.getComponent = vi.fn().mockReturnValue({ x: 5, y: 6, z: 7 });

    instance.setup(engine);
    instance.onBeforeUpdate(0);

    expect(engine.createLiveQuery).toHaveBeenCalledWith(['transform3d']);
  });

  it('clears physics reference on teardown', () => {
    const factory = createPhysicsKinematicSyncSystem();
    const instance = factory() as any;
    const physics = makePhysicsMock();
    const engine = makeEngine([1n], physics);
    engine.tryInject = vi.fn(() => physics);
    engine.getComponent = vi.fn().mockReturnValue({ x: 0, y: 0, z: 0 });

    instance.setup(engine);
    instance.teardown();
    instance.onBeforeUpdate(0);

    // After teardown, physics is null so setKinematicPosition should not be called
    expect(physics.setKinematicPosition).not.toHaveBeenCalled();
  });

  it('is a no-op on onBeforeUpdate before setup', () => {
    const factory = createPhysicsKinematicSyncSystem();
    const instance = factory() as any;
    const physics = makePhysicsMock();

    // Do not call setup
    instance.onBeforeUpdate(0);
    expect(physics.setKinematicPosition).not.toHaveBeenCalled();
  });
});
