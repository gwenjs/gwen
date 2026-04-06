import { describe, it, expect, vi, beforeEach } from 'vitest';

const physics3dInit = vi.fn();
const physics3dStep = vi.fn();

const mockBridge = {
  variant: 'physics3d' as const,
  getPhysicsBridge: vi.fn(() => ({
    physics3d_init: physics3dInit,
    physics3d_step: physics3dStep,
  })),
  getEntityGeneration: vi.fn((_index: number) => 0),
};

vi.mock('@gwenjs/core', () => ({
  getWasmBridge: () => mockBridge,
}));

import { Physics3DPlugin, type Physics3DAPI, type Physics3DConfig } from '../src/index';
import type { GwenEngine } from '@gwenjs/core';

describe('Physics3D entity API (foundation)', () => {
  beforeEach(() => {
    physics3dInit.mockReset();
    physics3dStep.mockReset();
    mockBridge.getPhysicsBridge.mockClear();
  });

  function setup(config?: Physics3DConfig) {
    const plugin = Physics3DPlugin(config);

    const services = new Map<string, unknown>();
    const hookMap = new Map<string, (...args: unknown[]) => unknown>();
    const offSpy = vi.fn();

    const engine = {
      provide: vi.fn((name: string, value: unknown) => {
        services.set(name, value);
      }),
      inject: vi.fn((name: string) => services.get(name)),
      hooks: {
        hook: vi.fn((name: string, callback: (...args: unknown[]) => unknown) => {
          hookMap.set(name, callback);
          return offSpy;
        }),
        callHook: vi.fn(),
      },
      getEntityGeneration: vi.fn(() => 0),
      query: vi.fn(() => []),
      getComponent: vi.fn(),
      wasmBridge: null,
    } as unknown as GwenEngine;

    plugin.setup(engine);

    const service = services.get('physics3d') as Physics3DAPI;
    if (!service) {
      throw new Error('physics3d service not registered');
    }

    return { plugin, service, hookMap, offSpy };
  }

  it('creates/replaces/removes entity-attached bodies', () => {
    const { service } = setup();

    expect(service.getBodyCount()).toBe(0);

    const a = service.createBody(1n, { kind: 'dynamic' });
    expect(service.hasBody(1n)).toBe(true);
    expect(service.getBodyCount()).toBe(1);
    expect(a.entityId).toBe(1n);

    const b = service.createBody(1n, { kind: 'fixed' });
    expect(b.bodyId).toBeGreaterThan(a.bodyId);
    expect(service.getBodyCount()).toBe(1);
    expect(service.getBodyKind(1n)).toBe('fixed');

    expect(service.removeBody(1n)).toBe(true);
    expect(service.removeBody(1n)).toBe(false);
    expect(service.hasBody(1n)).toBe(false);
    expect(service.getBodyKind(1n)).toBeUndefined();
    expect(service.getBodyState(1n)).toBeUndefined();
    expect(service.getBodyCount()).toBe(0);
  });

  it('can update body kind at runtime', () => {
    const { service } = setup();
    service.createBody(13n, { kind: 'dynamic' });

    expect(service.getBodyKind(13n)).toBe('dynamic');
    expect(service.setBodyKind(13n, 'kinematic')).toBe(true);
    expect(service.getBodyKind(13n)).toBe('kinematic');
    expect(service.setBodyKind(13n, 'fixed')).toBe(true);
    expect(service.getBodyKind(13n)).toBe('fixed');
  });

  it('setBodyKind returns false for missing body', () => {
    const { service } = setup();
    expect(service.setBodyKind(404n, 'dynamic')).toBe(false);
  });

  it('returns body state snapshot with defaults and custom initial values', () => {
    const { service } = setup();

    service.createBody(2n);
    const defaultState = service.getBodyState(2n);
    expect(defaultState).toEqual({
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      linearVelocity: { x: 0, y: 0, z: 0 },
      angularVelocity: { x: 0, y: 0, z: 0 },
    });

    service.createBody(3n, {
      initialPosition: { x: 1, y: 2, z: 3 },
      initialRotation: { x: 0, y: 1, z: 0, w: 0 },
      initialLinearVelocity: { x: 4, y: 5, z: 6 },
      initialAngularVelocity: { x: 7, y: 8, z: 9 },
    });

    const customState = service.getBodyState(3n);
    expect(customState).toEqual({
      position: { x: 1, y: 2, z: 3 },
      rotation: { x: 0, y: 1, z: 0, w: 0 },
      linearVelocity: { x: 4, y: 5, z: 6 },
      angularVelocity: { x: 7, y: 8, z: 9 },
    });

    // Snapshot must be cloned and not mutate internal state.
    if (customState) {
      customState.position.x = 123;
    }
    expect(service.getBodyState(3n)?.position.x).toBe(1);
  });

  it('supports partial body state updates via setBodyState', () => {
    const { service } = setup();

    service.createBody(10n, {
      initialPosition: { x: 1, y: 2, z: 3 },
      initialLinearVelocity: { x: 4, y: 5, z: 6 },
    });

    expect(
      service.setBodyState(10n, {
        position: { y: 20 },
        linearVelocity: { z: 60 },
      }),
    ).toBe(true);

    expect(service.getBodyState(10n)).toEqual({
      position: { x: 1, y: 20, z: 3 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      linearVelocity: { x: 4, y: 5, z: 60 },
      angularVelocity: { x: 0, y: 0, z: 0 },
    });
  });

  it('setBodyState returns false for missing body', () => {
    const { service } = setup();
    expect(service.setBodyState(404n, { position: { x: 1 } })).toBe(false);
  });

  it('setBodyState can patch rotation without resetting untouched fields', () => {
    const { service } = setup();
    service.createBody(11n, {
      initialRotation: { x: 0.1, y: 0.2, z: 0.3, w: 0.4 },
    });

    expect(service.setBodyState(11n, { rotation: { w: 1 } })).toBe(true);
    expect(service.getBodyState(11n)?.rotation).toEqual({
      x: 0.1,
      y: 0.2,
      z: 0.3,
      w: 1,
    });
  });

  it('applyImpulse updates local linear velocity', () => {
    const { service } = setup();
    service.createBody(12n, {
      initialLinearVelocity: { x: 1, y: 0, z: 0 },
    });

    expect(service.applyImpulse(12n, { x: 2, y: -1 })).toBe(true);
    expect(service.getBodyState(12n)?.linearVelocity).toEqual({
      x: 3,
      y: -1,
      z: 0,
    });
  });

  it('applyImpulse is mass-aware (delta-v = impulse / mass)', () => {
    const { service } = setup();
    service.createBody(120n, {
      mass: 2,
      initialLinearVelocity: { x: 0, y: 0, z: 0 },
    });

    expect(service.applyImpulse(120n, { x: 2 })).toBe(true);
    expect(service.getLinearVelocity(120n)?.x).toBeCloseTo(1, 6);
  });

  it('applyImpulse returns false for missing body', () => {
    const { service } = setup();
    expect(service.applyImpulse(999n, { x: 1 })).toBe(false);
  });

  it('supports getLinearVelocity / setLinearVelocity', () => {
    const { service } = setup();
    service.createBody(14n, {
      initialLinearVelocity: { x: 1, y: 2, z: 3 },
    });

    expect(service.getLinearVelocity(14n)).toEqual({ x: 1, y: 2, z: 3 });
    expect(service.setLinearVelocity(14n, { y: 20 })).toBe(true);
    expect(service.getLinearVelocity(14n)).toEqual({ x: 1, y: 20, z: 3 });
  });

  it('supports getAngularVelocity / setAngularVelocity', () => {
    const { service } = setup();
    service.createBody(15n, {
      initialAngularVelocity: { x: 0.5, y: 1, z: 1.5 },
    });

    expect(service.getAngularVelocity(15n)).toEqual({ x: 0.5, y: 1, z: 1.5 });
    expect(service.setAngularVelocity(15n, { z: 9 })).toBe(true);
    expect(service.getAngularVelocity(15n)).toEqual({ x: 0.5, y: 1, z: 9 });
  });

  it('get/set linear velocity handles missing body safely', () => {
    const { service } = setup();
    expect(service.getLinearVelocity(404n)).toBeUndefined();
    expect(service.setLinearVelocity(404n, { x: 1 })).toBe(false);
  });

  it('get/set angular velocity handles missing body safely', () => {
    const { service } = setup();
    expect(service.getAngularVelocity(405n)).toBeUndefined();
    expect(service.setAngularVelocity(405n, { y: 2 })).toBe(false);
  });

  it('auto-removes body on entity:destroyed hook', () => {
    const { service, hookMap } = setup();

    service.createBody(99n, { kind: 'kinematic' });
    expect(service.hasBody(99n)).toBe(true);

    const onDestroyed = hookMap.get('entity:destroy');
    expect(onDestroyed).toBeTypeOf('function');

    onDestroyed?.(99n);
    expect(service.hasBody(99n)).toBe(false);
    expect(service.getBodyState(99n)).toBeUndefined();
    expect(service.getBodyCount()).toBe(0);
  });

  it('cleans hook subscription and local registry on plugin destroy', () => {
    const { plugin, service, offSpy } = setup();

    service.createBody(7n);
    expect(service.getBodyCount()).toBe(1);

    plugin.teardown!();

    expect(offSpy).toHaveBeenCalledTimes(1);
    expect(service.getBodyCount()).toBe(0);
    expect(service.isReady()).toBe(false);
  });

  it('exposes manual step bridge when initialized', () => {
    const { service } = setup({ gravity: { x: 0, y: 0, z: 0 } });

    service.createBody(50n, {
      initialPosition: { x: 0, y: 0, z: 0 },
      initialLinearVelocity: { x: 10, y: 0, z: 0 },
    });

    service.step(1 / 60);
    expect(physics3dStep).toHaveBeenCalledWith(1 / 60);
    expect(service.getBodyState(50n)?.position.x).toBeCloseTo(10 / 60, 6);
  });

  it('auto-steps during onBeforeUpdate with positive delta', () => {
    const { plugin, service } = setup({ gravity: { x: 0, y: 0, z: 0 } });
    service.createBody(51n, {
      initialPosition: { x: 0, y: 1, z: 0 },
      initialLinearVelocity: { x: 0, y: -2, z: 0 },
    });

    plugin.onBeforeUpdate!(1 / 120);
    expect(physics3dStep).toHaveBeenCalledWith(1 / 120);
    expect(service.getBodyState(51n)?.position.y).toBeCloseTo(1 - 2 / 120, 6);
  });

  it('setLinearVelocity affects subsequent integration', () => {
    const { service } = setup({ gravity: { x: 0, y: 0, z: 0 } });
    service.createBody(52n, {
      initialPosition: { x: 0, y: 0, z: 0 },
      initialLinearVelocity: { x: 0, y: 0, z: 0 },
    });

    service.setLinearVelocity(52n, { x: 6 });
    service.step(0.5);

    expect(service.getBodyState(52n)?.position.x).toBeCloseTo(3, 6);
    expect(service.getLinearVelocity(52n)?.x).toBeCloseTo(6, 6);
  });

  it('angular velocity set/read persists across step', () => {
    const { service } = setup({ gravity: { x: 0, y: 0, z: 0 } });
    service.createBody(53n);
    service.setAngularVelocity(53n, { x: 2, y: 3, z: 4 });

    service.step(0.25);
    expect(service.getAngularVelocity(53n)).toEqual({ x: 2, y: 3, z: 4 });
  });

  it('applies gravity to dynamic bodies during step', () => {
    const { service } = setup({ gravity: { x: 0, y: -10, z: 0 } });
    service.createBody(60n, {
      kind: 'dynamic',
      initialPosition: { x: 0, y: 0, z: 0 },
      initialLinearVelocity: { x: 0, y: 0, z: 0 },
    });

    service.step(0.5);
    const state = service.getBodyState(60n);
    expect(state?.linearVelocity.y).toBeCloseTo(-5, 6);
    expect(state?.position.y).toBeCloseTo(-2.5, 6);
  });

  it('applies linear damping during integration', () => {
    const { service } = setup({ gravity: { x: 0, y: 0, z: 0 } });
    service.createBody(63n, {
      kind: 'dynamic',
      linearDamping: 1,
      initialPosition: { x: 0, y: 0, z: 0 },
      initialLinearVelocity: { x: 10, y: 0, z: 0 },
    });

    service.step(0.5);
    expect(service.getLinearVelocity(63n)?.x).toBeCloseTo(5, 6);
    expect(service.getBodyState(63n)?.position.x).toBeCloseTo(2.5, 6);
  });

  it('applies angular damping during integration', () => {
    const { service } = setup({ gravity: { x: 0, y: 0, z: 0 } });
    service.createBody(64n, {
      kind: 'kinematic',
      angularDamping: 2,
      initialAngularVelocity: { x: 0, y: 4, z: 0 },
    });

    service.step(0.25);
    expect(service.getAngularVelocity(64n)?.y).toBeCloseTo(2, 6);
  });

  it('does not move fixed bodies during step', () => {
    const { service } = setup({ gravity: { x: 0, y: -10, z: 0 } });
    service.createBody(61n, {
      kind: 'fixed',
      initialPosition: { x: 3, y: 4, z: 5 },
      initialLinearVelocity: { x: 10, y: 10, z: 10 },
    });

    service.step(1);
    expect(service.getBodyState(61n)).toEqual({
      position: { x: 3, y: 4, z: 5 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      linearVelocity: { x: 10, y: 10, z: 10 },
      angularVelocity: { x: 0, y: 0, z: 0 },
    });
  });

  it('changing kind from fixed to dynamic re-enables gravity/integration', () => {
    const { service } = setup({ gravity: { x: 0, y: -10, z: 0 } });
    service.createBody(62n, {
      kind: 'fixed',
      initialPosition: { x: 0, y: 0, z: 0 },
      initialLinearVelocity: { x: 0, y: 0, z: 0 },
    });

    service.step(0.5);
    expect(service.getBodyState(62n)?.position.y).toBeCloseTo(0, 6);

    service.setBodyKind(62n, 'dynamic');
    service.step(0.5);
    const state = service.getBodyState(62n);
    expect(state?.linearVelocity.y).toBeCloseTo(-5, 6);
    expect(state?.position.y).toBeCloseTo(-2.5, 6);
  });

  it('does not auto-step for zero or negative delta', () => {
    const { plugin } = setup();

    plugin.onBeforeUpdate!(0);
    plugin.onBeforeUpdate!(-0.01);
    expect(physics3dStep).not.toHaveBeenCalled();
  });

  it('does not auto-step after destroy', () => {
    const { plugin } = setup();
    plugin.teardown!();

    plugin.onBeforeUpdate!(1 / 60);
    expect(physics3dStep).not.toHaveBeenCalled();
  });
});
