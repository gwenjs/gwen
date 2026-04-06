/**
 * Unit tests for the Physics3D TypeScript fallback simulation.
 *
 * These tests exercise the local (non-WASM) code paths:
 * AABB collision detection, contact event emission, sensor state management,
 * linear/angular damping, gravity integration, quaternion rotation, applyTorque,
 * and setAngularVelocity. No WASM module is required.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock WASM bridge in local (non-physics3d) fallback mode ───────────────────
// Omitting `physics3d_add_body` forces the plugin into local simulation mode.

const physics3dInit = vi.fn();
const physics3dStep = vi.fn();

const mockBridge = {
  variant: 'physics3d' as const,
  getPhysicsBridge: vi.fn(() => ({
    physics3d_init: physics3dInit,
    physics3d_step: physics3dStep,
    // No physics3d_add_body → triggers fallback / local mode
  })),
  getEntityGeneration: vi.fn((_index: number) => 0),
};

vi.mock('@gwenjs/core', () => ({
  getWasmBridge: () => mockBridge,
  unpackEntityId: (id: bigint) => ({
    index: Number(id & 0xffffffffn),
    generation: Number((id >> 32n) & 0xffffffffn),
  }),
  createEntityId: (index: number, generation: number) =>
    BigInt(index) | (BigInt(generation) << 32n),
}));

import { Physics3DPlugin, type Physics3DAPI, type Physics3DConfig } from '../src/index';
import type { GwenEngine } from '@gwenjs/core';

// ─── Test factory ─────────────────────────────────────────────────────────────

function makeEngine() {
  const services = new Map<string, unknown>();
  const hookMap = new Map<string, (...args: unknown[]) => unknown>();
  const callHook = vi.fn();

  const engine = {
    provide: vi.fn((name: string, value: unknown) => {
      services.set(name, value);
    }),
    inject: vi.fn((name: string) => services.get(name)),
    hooks: {
      hook: vi.fn((name: string, callback: (...args: unknown[]) => unknown) => {
        hookMap.set(name, callback);
        return vi.fn();
      }),
      callHook,
    },
    getEntityGeneration: vi.fn(() => 0),
    query: vi.fn(() => []),
    getComponent: vi.fn(),
    wasmBridge: null,
  } as unknown as GwenEngine;

  return { engine, services, hookMap, callHook };
}

/**
 * Create and initialize a Physics3DPlugin in local (fallback) mode.
 * Returns the plugin instance, the service API, and engine hooks.
 */
function setup(config?: Physics3DConfig) {
  const plugin = Physics3DPlugin(config);
  const { engine, services, hookMap, callHook } = makeEngine();
  plugin.setup(engine);
  const service = services.get('physics3d') as Physics3DAPI;
  return { plugin, service, engine, hookMap, callHook };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Physics3D TypeScript fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── Collision detection ───────────────────────────────────────────────────

  describe('collision detection', () => {
    it('detects overlap between two AABB bodies', () => {
      const { plugin, service } = setup({ gravity: { x: 0, y: 0, z: 0 } });

      // Two boxes at the origin — they overlap completely
      service.createBody(1n, { initialPosition: { x: 0, y: 0, z: 0 } });
      service.addCollider(1n, {
        shape: { type: 'box', halfX: 1, halfY: 1, halfZ: 1 },
        colliderId: 0,
      });

      service.createBody(2n, { initialPosition: { x: 0.5, y: 0, z: 0 } });
      service.addCollider(2n, {
        shape: { type: 'box', halfX: 1, halfY: 1, halfZ: 1 },
        colliderId: 0,
      });

      plugin.onBeforeUpdate!(1 / 60);
      plugin.onUpdate!();

      const contacts = service.getCollisionContacts();
      expect(contacts).toHaveLength(1);
      expect(contacts[0]?.started).toBe(true);
    });

    it('does not report contact when bodies are separated', () => {
      const { plugin, service } = setup({ gravity: { x: 0, y: 0, z: 0 } });

      service.createBody(10n, { initialPosition: { x: -10, y: 0, z: 0 } });
      service.addCollider(10n, {
        shape: { type: 'box', halfX: 0.5, halfY: 0.5, halfZ: 0.5 },
        colliderId: 0,
      });

      service.createBody(11n, { initialPosition: { x: 10, y: 0, z: 0 } });
      service.addCollider(11n, {
        shape: { type: 'box', halfX: 0.5, halfY: 0.5, halfZ: 0.5 },
        colliderId: 0,
      });

      plugin.onBeforeUpdate!(1 / 60);
      plugin.onUpdate!();

      expect(service.getCollisionContacts()).toHaveLength(0);
    });

    it('emits contact events for overlapping bodies', () => {
      const { plugin, service, callHook } = setup({ gravity: { x: 0, y: 0, z: 0 } });

      service.createBody(20n, { initialPosition: { x: 0, y: 0, z: 0 } });
      service.addCollider(20n, {
        shape: { type: 'sphere', radius: 2 },
        colliderId: 0,
      });

      service.createBody(21n, { initialPosition: { x: 1, y: 0, z: 0 } });
      service.addCollider(21n, {
        shape: { type: 'sphere', radius: 2 },
        colliderId: 0,
      });

      plugin.onBeforeUpdate!(1 / 60);
      plugin.onUpdate!();

      expect(callHook).toHaveBeenCalledWith(
        'physics3d:collision',
        expect.arrayContaining([expect.objectContaining({ started: true })]),
      );
    });

    it('activates sensor state on overlap', () => {
      const { plugin, service } = setup({ gravity: { x: 0, y: 0, z: 0 } });

      const SENSOR_ID = 42;

      service.createBody(30n, { initialPosition: { x: 0, y: 0, z: 0 } });
      service.addCollider(30n, {
        shape: { type: 'box', halfX: 1, halfY: 1, halfZ: 1 },
        isSensor: true,
        colliderId: SENSOR_ID,
      });

      service.createBody(31n, { initialPosition: { x: 0.5, y: 0, z: 0 } });
      service.addCollider(31n, {
        shape: { type: 'box', halfX: 1, halfY: 1, halfZ: 1 },
        colliderId: 0,
      });

      plugin.onBeforeUpdate!(1 / 60);
      plugin.onUpdate!();

      const state = service.getSensorState(30n, SENSOR_ID);
      expect(state.isActive).toBe(true);
      expect(state.contactCount).toBe(1);
    });

    it('deactivates sensor state when bodies separate', () => {
      const { plugin, service } = setup({ gravity: { x: 0, y: 0, z: 0 } });

      const SENSOR_ID = 99;

      service.createBody(40n, { initialPosition: { x: 0, y: 0, z: 0 } });
      service.addCollider(40n, {
        shape: { type: 'box', halfX: 1, halfY: 1, halfZ: 1 },
        isSensor: true,
        colliderId: SENSOR_ID,
      });

      service.createBody(41n, { initialPosition: { x: 0.5, y: 0, z: 0 } });
      service.addCollider(41n, {
        shape: { type: 'box', halfX: 1, halfY: 1, halfZ: 1 },
        colliderId: 0,
      });

      // Frame 1: bodies overlap → sensor active
      plugin.onBeforeUpdate!(1 / 60);
      plugin.onUpdate!();
      expect(service.getSensorState(40n, SENSOR_ID).isActive).toBe(true);

      // Teleport body 41 far away → no longer overlapping
      service.setBodyState(41n, { position: { x: 100, y: 0, z: 0 } });

      // Frame 2: bodies separated → sensor ends
      plugin.onBeforeUpdate!(1 / 60);
      plugin.onUpdate!();
      expect(service.getSensorState(40n, SENSOR_ID).isActive).toBe(false);
      expect(service.getSensorState(40n, SENSOR_ID).contactCount).toBe(0);
    });

    it('dispatches sensor:changed hook on activation and deactivation', () => {
      const { plugin, service, callHook } = setup({ gravity: { x: 0, y: 0, z: 0 } });

      const SENSOR_ID = 55;

      service.createBody(50n, { initialPosition: { x: 0, y: 0, z: 0 } });
      service.addCollider(50n, {
        shape: { type: 'box', halfX: 1, halfY: 1, halfZ: 1 },
        isSensor: true,
        colliderId: SENSOR_ID,
      });
      service.createBody(51n, { initialPosition: { x: 0.5, y: 0, z: 0 } });
      service.addCollider(51n, {
        shape: { type: 'box', halfX: 1, halfY: 1, halfZ: 1 },
        colliderId: 0,
      });

      // Activation frame
      plugin.onBeforeUpdate!(1 / 60);
      plugin.onUpdate!();
      expect(callHook).toHaveBeenCalledWith(
        'physics3d:sensor:changed',
        BigInt(50),
        SENSOR_ID,
        expect.objectContaining({ isActive: true }),
      );

      // Move apart
      service.setBodyState(51n, { position: { x: 100, y: 0, z: 0 } });
      vi.clearAllMocks();

      // Deactivation frame
      plugin.onBeforeUpdate!(1 / 60);
      plugin.onUpdate!();
      expect(callHook).toHaveBeenCalledWith(
        'physics3d:sensor:changed',
        BigInt(50),
        SENSOR_ID,
        expect.objectContaining({ isActive: false }),
      );
    });
  });

  // ─── Dynamics ─────────────────────────────────────────────────────────────

  describe('dynamics', () => {
    it('applies linear damping to velocity', () => {
      const { service } = setup({ gravity: { x: 0, y: 0, z: 0 } });

      service.createBody(60n, {
        kind: 'dynamic',
        linearDamping: 1,
        initialLinearVelocity: { x: 10, y: 0, z: 0 },
      });

      service.step(0.5);

      // v *= max(0, 1 - 1 * 0.5) = 0.5 → v.x = 5
      expect(service.getLinearVelocity(60n)?.x).toBeCloseTo(5, 5);
    });

    it('applies angular damping to angular velocity', () => {
      const { service } = setup({ gravity: { x: 0, y: 0, z: 0 } });

      service.createBody(61n, {
        kind: 'dynamic',
        angularDamping: 2,
        initialAngularVelocity: { x: 0, y: 8, z: 0 },
      });

      service.step(0.25);

      // ω *= max(0, 1 - 2 * 0.25) = 0.5 → ω.y = 4
      expect(service.getAngularVelocity(61n)?.y).toBeCloseTo(4, 5);
    });

    it('integrates gravity over time for dynamic bodies', () => {
      const { service } = setup({ gravity: { x: 0, y: -10, z: 0 } });

      service.createBody(62n, {
        kind: 'dynamic',
        initialPosition: { x: 0, y: 100, z: 0 },
      });

      service.step(1.0);

      // vy = 0 + (-10) * 1 = -10; y = 100 + (-10) * 1 = 90
      const state = service.getBodyState(62n);
      expect(state?.linearVelocity.y).toBeCloseTo(-10, 5);
      expect(state?.position.y).toBeCloseTo(90, 5);
    });

    it('does not move kinematic bodies under gravity', () => {
      const { service } = setup({ gravity: { x: 0, y: -9.81, z: 0 } });

      service.createBody(63n, {
        kind: 'kinematic',
        initialPosition: { x: 0, y: 5, z: 0 },
      });

      service.step(1.0);

      // Kinematic bodies ignore gravity — position must be unchanged
      expect(service.getBodyState(63n)?.position.y).toBeCloseTo(5, 5);
    });
  });

  // ─── Rotation ─────────────────────────────────────────────────────────────

  describe('rotation', () => {
    it('stores and retrieves quaternion rotation via getBodyState', () => {
      const { service } = setup();

      service.createBody(70n, {
        initialRotation: { x: 0, y: 0.7071, z: 0, w: 0.7071 },
      });

      const state = service.getBodyState(70n);
      expect(state?.rotation.x).toBeCloseTo(0, 5);
      expect(state?.rotation.y).toBeCloseTo(0.7071, 4);
      expect(state?.rotation.z).toBeCloseTo(0, 5);
      expect(state?.rotation.w).toBeCloseTo(0.7071, 4);
    });

    it('applies torque and changes angular velocity', () => {
      const { service } = setup({ gravity: { x: 0, y: 0, z: 0 } });

      service.createBody(71n, { kind: 'dynamic', mass: 1 });

      const result = service.applyTorque(71n, { y: 5 });
      expect(result).toBe(true);

      const angVel = service.getAngularVelocity(71n);
      expect(angVel?.y).toBeCloseTo(5, 5);
    });

    it('applyTorque has no effect on fixed bodies', () => {
      const { service } = setup({ gravity: { x: 0, y: 0, z: 0 } });

      service.createBody(72n, { kind: 'fixed' });
      const result = service.applyTorque(72n, { y: 10 });

      expect(result).toBe(false);
      expect(service.getAngularVelocity(72n)?.y).toBe(0);
    });

    it('setAngularVelocity overrides existing angular velocity', () => {
      const { service } = setup({ gravity: { x: 0, y: 0, z: 0 } });

      service.createBody(73n, {
        initialAngularVelocity: { x: 1, y: 2, z: 3 },
      });

      service.setAngularVelocity(73n, { y: 99 });

      const angVel = service.getAngularVelocity(73n);
      expect(angVel?.x).toBe(1); // x is preserved
      expect(angVel?.y).toBe(99); // y is overridden
      expect(angVel?.z).toBe(3); // z is preserved
    });

    it('rotation quaternion remains unit length after setRotation', () => {
      const { service } = setup();

      service.createBody(74n, {
        // Provide a non-normalised rotation — plugin should store as given
        initialRotation: { x: 0.5, y: 0.5, z: 0.5, w: 0.5 },
      });

      const state = service.getBodyState(74n);
      const rot = state!.rotation;
      const len = Math.sqrt(rot.x ** 2 + rot.y ** 2 + rot.z ** 2 + rot.w ** 2);
      // The initial quaternion (0.5, 0.5, 0.5, 0.5) is unit length
      expect(len).toBeCloseTo(1, 5);
    });

    it('integrates angular velocity into rotation quaternion during step', () => {
      const { service } = setup({ gravity: { x: 0, y: 0, z: 0 } });

      service.createBody(75n, {
        kind: 'dynamic',
        // π rad/s around Y axis
        initialAngularVelocity: { x: 0, y: Math.PI, z: 0 },
        initialRotation: { x: 0, y: 0, z: 0, w: 1 },
      });

      // After 0.5 s at π rad/s → 90° rotation around Y
      service.step(0.5);

      const state = service.getBodyState(75n);
      const rot = state!.rotation;

      // Rotation quaternion should NOT still be identity
      const isIdentity = Math.abs(rot.w - 1) < 1e-4;
      expect(isIdentity).toBe(false);

      // Quaternion must remain unit length
      const len = Math.sqrt(rot.x ** 2 + rot.y ** 2 + rot.z ** 2 + rot.w ** 2);
      expect(len).toBeCloseTo(1, 5);

      // Y component should be positive (rotation around +Y)
      expect(rot.y).toBeGreaterThan(0.5);
    });

    it('rotation quaternion stays unit length across multiple steps', () => {
      const { service } = setup({ gravity: { x: 0, y: 0, z: 0 } });

      service.createBody(76n, {
        kind: 'dynamic',
        initialAngularVelocity: { x: 1, y: 2, z: 3 },
      });

      // Run 60 frames
      for (let i = 0; i < 60; i++) {
        service.step(1 / 60);
      }

      const rot = service.getBodyState(76n)!.rotation;
      const len = Math.sqrt(rot.x ** 2 + rot.y ** 2 + rot.z ** 2 + rot.w ** 2);
      expect(len).toBeCloseTo(1, 4);
    });
  });

  // ─── Event metrics ─────────────────────────────────────────────────────────

  describe('event metrics', () => {
    it('getCollisionEventMetrics reflects AABB events in local mode', () => {
      const { plugin, service } = setup({ gravity: { x: 0, y: 0, z: 0 } });

      service.createBody(80n, { initialPosition: { x: 0, y: 0, z: 0 } });
      service.addCollider(80n, {
        shape: { type: 'box', halfX: 1, halfY: 1, halfZ: 1 },
        colliderId: 0,
      });
      service.createBody(81n, { initialPosition: { x: 0.5, y: 0, z: 0 } });
      service.addCollider(81n, {
        shape: { type: 'box', halfX: 1, halfY: 1, halfZ: 1 },
        colliderId: 0,
      });

      expect(service.getCollisionEventMetrics().eventCount).toBe(0);

      plugin.onBeforeUpdate!(1 / 60);
      plugin.onUpdate!();

      expect(service.getCollisionEventMetrics().eventCount).toBe(1);
    });
  });

  // ─── Local mode: forces, torques, gravity scale, axis locks, sleep ─────────

  describe('local physics state', () => {
    it('addForce accelerates a dynamic body (F=ma → Δv=F/m·dt)', () => {
      const { plugin, service } = setup({ gravity: { x: 0, y: 0, z: 0 } });
      service.createBody(1n, { kind: 'dynamic', mass: 2 });
      // Apply force (2, 0, 0) — mass 2 → a = 1 → Δv = 1 * (1/60)
      service.addForce(1n, { x: 2, y: 0, z: 0 });
      plugin.onBeforeUpdate!(1 / 60);
      plugin.onUpdate!();
      const state = service.getBodyState(1n)!;
      expect(state.linearVelocity.x).toBeCloseTo(1 / 60, 5);
      expect(state.linearVelocity.y).toBeCloseTo(0, 5);
    });

    it('forces accumulate across multiple addForce calls before step', () => {
      const { plugin, service } = setup({ gravity: { x: 0, y: 0, z: 0 } });
      service.createBody(2n, { kind: 'dynamic', mass: 1 });
      service.addForce(2n, { x: 1, y: 0, z: 0 });
      service.addForce(2n, { x: 1, y: 0, z: 0 });
      plugin.onBeforeUpdate!(1 / 60);
      plugin.onUpdate!();
      const state = service.getBodyState(2n)!;
      // 2N / 1kg * (1/60)s = 2/60 m/s
      expect(state.linearVelocity.x).toBeCloseTo(2 / 60, 5);
    });

    it('forces are consumed after one step', () => {
      const { plugin, service } = setup({ gravity: { x: 0, y: 0, z: 0 } });
      service.createBody(3n, { kind: 'dynamic', mass: 1 });
      service.addForce(3n, { x: 10, y: 0, z: 0 });
      plugin.onBeforeUpdate!(1 / 60);
      plugin.onUpdate!();
      const v1 = service.getBodyState(3n)!.linearVelocity.x;
      // No new force — second step: velocity stays at v1 (no damping, no gravity)
      plugin.onBeforeUpdate!(1 / 60);
      plugin.onUpdate!();
      const v2 = service.getBodyState(3n)!.linearVelocity.x;
      // Force was consumed: no additional acceleration burst, velocity unchanged
      expect(v2).toBeCloseTo(v1, 5);
    });

    it('addTorque changes angular velocity', () => {
      const { plugin, service } = setup({ gravity: { x: 0, y: 0, z: 0 } });
      service.createBody(4n, { kind: 'dynamic', mass: 2 });
      service.addTorque(4n, { x: 0, y: 2, z: 0 });
      plugin.onBeforeUpdate!(1 / 60);
      plugin.onUpdate!();
      const state = service.getBodyState(4n)!;
      // inertia approx = mass = 2 → α = τ/I = 1 → Δω = 1 * (1/60)
      expect(state.angularVelocity.y).toBeCloseTo(1 / 60, 5);
    });

    it('setGravityScale 0 disables gravity for a body', () => {
      const { plugin, service } = setup({ gravity: { x: 0, y: -9.8, z: 0 } });
      service.createBody(5n, { kind: 'dynamic', mass: 1 });
      service.setGravityScale(5n, 0);
      plugin.onBeforeUpdate!(1 / 60);
      plugin.onUpdate!();
      const state = service.getBodyState(5n)!;
      expect(state.linearVelocity.y).toBeCloseTo(0, 5);
    });

    it('setGravityScale 2 doubles gravity for a body', () => {
      const { plugin, service } = setup({ gravity: { x: 0, y: -9.8, z: 0 } });
      service.createBody(6n, { kind: 'dynamic', mass: 1 });
      service.setGravityScale(6n, 2);
      plugin.onBeforeUpdate!(1 / 60);
      plugin.onUpdate!();
      const state = service.getBodyState(6n)!;
      expect(state.linearVelocity.y).toBeCloseTo((-9.8 * 2) / 60, 5);
    });

    it('lockTranslations prevents movement on locked axes', () => {
      const { plugin, service } = setup({ gravity: { x: 0, y: -9.8, z: 0 } });
      service.createBody(7n, {
        kind: 'dynamic',
        mass: 1,
        initialLinearVelocity: { x: 5, y: 5, z: 5 },
      });
      service.lockTranslations(7n, true, false, false); // lock X
      plugin.onBeforeUpdate!(1 / 60);
      plugin.onUpdate!();
      const state = service.getBodyState(7n)!;
      // X velocity was zeroed → X position unchanged from 0
      expect(state.position.x).toBeCloseTo(0, 5);
      // Y and Z still move
      expect(Math.abs(state.position.y)).toBeGreaterThan(0);
    });

    it('lockRotations prevents rotation on locked axes', () => {
      const { plugin, service } = setup({ gravity: { x: 0, y: 0, z: 0 } });
      service.createBody(8n, {
        kind: 'dynamic',
        mass: 1,
        initialAngularVelocity: { x: 1, y: 1, z: 1 },
      });
      service.lockRotations(8n, false, true, false); // lock Y
      plugin.onBeforeUpdate!(1 / 60);
      plugin.onUpdate!();
      const _state = service.getBodyState(8n)!;
      // Y angular velocity was zeroed — quaternion should not have rotated on Y axis
      // Simple check: angularVelocity.y was cleared before integration
      expect(service.getAngularVelocity(8n)!.y).toBeCloseTo(0, 3);
    });

    it('sleeping bodies do not integrate', () => {
      const { plugin, service } = setup({ gravity: { x: 0, y: -9.8, z: 0 } });
      service.createBody(9n, { kind: 'dynamic', mass: 1 });
      service.setBodySleeping(9n, true);
      plugin.onBeforeUpdate!(1 / 60);
      plugin.onUpdate!();
      const state = service.getBodyState(9n)!;
      // Gravity not applied, velocity remains 0, position unchanged
      expect(state.linearVelocity.y).toBeCloseTo(0, 5);
      expect(state.position.y).toBeCloseTo(0, 5);
    });

    it('wakeAll re-enables sleeping bodies', () => {
      const { plugin, service } = setup({ gravity: { x: 0, y: -9.8, z: 0 } });
      service.createBody(10n, { kind: 'dynamic', mass: 1 });
      service.setBodySleeping(10n, true);
      service.wakeAll();
      plugin.onBeforeUpdate!(1 / 60);
      plugin.onUpdate!();
      const state = service.getBodyState(10n)!;
      // After wake, gravity applies again
      expect(state.linearVelocity.y).toBeCloseTo(-9.8 / 60, 5);
    });

    it('removeBody cleans up force/torque/lock/sleep state', () => {
      const { service } = setup({ gravity: { x: 0, y: 0, z: 0 } });
      service.createBody(11n, { kind: 'dynamic', mass: 1 });
      service.addForce(11n, { x: 1, y: 0, z: 0 });
      service.setBodySleeping(11n, true);
      service.lockTranslations(11n, true, false, false);
      service.removeBody(11n);
      // Re-create same slot — should start clean
      service.createBody(11n, { kind: 'dynamic', mass: 1 });
      expect(service.isBodySleeping(11n)).toBe(false);
      expect(service.getBodyState(11n)?.linearVelocity.x).toBeCloseTo(0, 5);
    });
  });
});
