/**
 * Tests for the Physics3D plugin in 'wasm' backend mode.
 *
 * These tests mock the full WASM bridge surface (including physics3d_add_body and friends)
 * to verify that the plugin delegates all body operations to the WASM layer when available,
 * and does NOT run the local TS simulation in that mode.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const physics3dInit = vi.fn();
const physics3dStep = vi.fn();
const physics3dAddBody = vi.fn().mockReturnValue(true);
const physics3dRemoveBody = vi.fn().mockReturnValue(true);
const physics3dHasBody = vi.fn().mockReturnValue(false);

// Mutable state store keyed by entityIndex
const wasmBodyState = new Map<number, Float32Array>();
const wasmLinVel = new Map<number, Float32Array>();
const wasmAngVel = new Map<number, Float32Array>();
const wasmKind = new Map<number, number>();

const physics3dGetBodyState = vi.fn((idx: number) => {
  const s = wasmBodyState.get(idx);
  return s ?? new Float32Array(13);
});
const physics3dSetBodyState = vi.fn(
  (
    idx: number,
    px: number,
    py: number,
    pz: number,
    qx: number,
    qy: number,
    qz: number,
    qw: number,
    vx: number,
    vy: number,
    vz: number,
    ax: number,
    ay: number,
    az: number,
  ) => {
    wasmBodyState.set(idx, new Float32Array([px, py, pz, qx, qy, qz, qw, vx, vy, vz, ax, ay, az]));
    wasmLinVel.set(idx, new Float32Array([vx, vy, vz]));
    wasmAngVel.set(idx, new Float32Array([ax, ay, az]));
    return true;
  },
);
const physics3dGetLinearVelocity = vi.fn((idx: number) => {
  return wasmLinVel.get(idx) ?? new Float32Array(3);
});
const physics3dSetLinearVelocity = vi.fn((idx: number, vx: number, vy: number, vz: number) => {
  const v = new Float32Array([vx, vy, vz]);
  wasmLinVel.set(idx, v);
  // Sync into body state
  const s = wasmBodyState.get(idx) ?? new Float32Array(13);
  s[7] = vx;
  s[8] = vy;
  s[9] = vz;
  wasmBodyState.set(idx, s);
  return true;
});
const physics3dGetAngularVelocity = vi.fn((idx: number) => {
  return wasmAngVel.get(idx) ?? new Float32Array(3);
});
const physics3dSetAngularVelocity = vi.fn((idx: number, ax: number, ay: number, az: number) => {
  const v = new Float32Array([ax, ay, az]);
  wasmAngVel.set(idx, v);
  return true;
});
const physics3dApplyImpulse = vi.fn().mockReturnValue(true);
const physics3dAddForce = vi.fn();
const physics3dAddTorque = vi.fn();
const physics3dAddForceAtPoint = vi.fn();
const physics3dSetGravityScale = vi.fn();
const physics3dGetGravityScale = vi.fn().mockReturnValue(2.0);
const physics3dLockTranslations = vi.fn();
const physics3dLockRotations = vi.fn();
const physics3dSetBodySleeping = vi.fn();
const physics3dIsBodySleeping = vi.fn().mockReturnValue(false);
const physics3dWakeAll = vi.fn();

// Group B — RFC-08: Joints
const physics3dAddFixedJoint = vi.fn().mockReturnValue(1);
const physics3dAddRevoluteJoint = vi.fn().mockReturnValue(2);
const physics3dAddPrismaticJoint = vi.fn().mockReturnValue(3);
const physics3dAddBallJoint = vi.fn().mockReturnValue(4);
const physics3dAddSpringJoint = vi.fn().mockReturnValue(5);
const physics3dRemoveJoint = vi.fn();
const physics3dSetJointMotorVelocity = vi.fn();
const physics3dSetJointMotorPosition = vi.fn();
const physics3dSetJointEnabled = vi.fn();
const physics3dGetBodyKind = vi.fn((idx: number) => wasmKind.get(idx) ?? 1);
const physics3dSetBodyKind = vi.fn((idx: number, kind: number) => {
  wasmKind.set(idx, kind);
  return true;
});
const physics3dAddBoxCollider = vi.fn().mockReturnValue(true);
const physics3dAddMeshCollider = vi.fn().mockReturnValue(true);
const physics3dAddConvexCollider = vi.fn().mockReturnValue(true);

// Group C — RFC-07: Spatial queries
const physics3dCastRay = vi.fn();
const physics3dCastShape = vi.fn();
const physics3dOverlapShape = vi.fn().mockReturnValue(0);
const physics3dProjectPoint = vi.fn();

// Group D — RFC-09: Character Controller
const physics3dAddCharacterController = vi.fn().mockReturnValue(0); // slot 0
const physics3dCharacterControllerMove = vi.fn();
const physics3dRemoveCharacterController = vi.fn();

const mockBridge = {
  variant: 'physics3d' as const,
  getLinearMemory: vi.fn(() => ({
    buffer: new SharedArrayBuffer(65536),
    byteLength: 65536,
  })),
  getPhysicsBridge: vi.fn(() => ({
    physics3d_init: physics3dInit,
    physics3d_step: physics3dStep,
    physics3d_add_body: physics3dAddBody,
    physics3d_remove_body: physics3dRemoveBody,
    physics3d_has_body: physics3dHasBody,
    physics3d_get_body_state: physics3dGetBodyState,
    physics3d_set_body_state: physics3dSetBodyState,
    physics3d_get_linear_velocity: physics3dGetLinearVelocity,
    physics3d_set_linear_velocity: physics3dSetLinearVelocity,
    physics3d_get_angular_velocity: physics3dGetAngularVelocity,
    physics3d_set_angular_velocity: physics3dSetAngularVelocity,
    physics3d_apply_impulse: physics3dApplyImpulse,
    physics3d_get_body_kind: physics3dGetBodyKind,
    physics3d_set_body_kind: physics3dSetBodyKind,
    physics3d_add_box_collider: physics3dAddBoxCollider,
    physics3d_add_mesh_collider: physics3dAddMeshCollider,
    physics3d_add_convex_collider: physics3dAddConvexCollider,
    physics3d_add_force: physics3dAddForce,
    physics3d_add_torque: physics3dAddTorque,
    physics3d_add_force_at_point: physics3dAddForceAtPoint,
    physics3d_set_gravity_scale: physics3dSetGravityScale,
    physics3d_get_gravity_scale: physics3dGetGravityScale,
    physics3d_lock_translations: physics3dLockTranslations,
    physics3d_lock_rotations: physics3dLockRotations,
    physics3d_set_body_sleeping: physics3dSetBodySleeping,
    physics3d_is_body_sleeping: physics3dIsBodySleeping,
    physics3d_wake_all: physics3dWakeAll,
    physics3d_cast_ray: physics3dCastRay,
    physics3d_cast_shape: physics3dCastShape,
    physics3d_overlap_shape: physics3dOverlapShape,
    physics3d_project_point: physics3dProjectPoint,
    physics3d_add_character_controller: physics3dAddCharacterController,
    physics3d_character_controller_move: physics3dCharacterControllerMove,
    physics3d_remove_character_controller: physics3dRemoveCharacterController,
    physics3d_add_fixed_joint: physics3dAddFixedJoint,
    physics3d_add_revolute_joint: physics3dAddRevoluteJoint,
    physics3d_add_prismatic_joint: physics3dAddPrismaticJoint,
    physics3d_add_ball_joint: physics3dAddBallJoint,
    physics3d_add_spring_joint: physics3dAddSpringJoint,
    physics3d_remove_joint: physics3dRemoveJoint,
    physics3d_set_joint_motor_velocity: physics3dSetJointMotorVelocity,
    physics3d_set_joint_motor_position: physics3dSetJointMotorPosition,
    physics3d_set_joint_enabled: physics3dSetJointEnabled,
  })),
};

vi.mock('@gwenjs/core', () => ({
  getWasmBridge: () => mockBridge,
}));

import { Physics3DPlugin, type Physics3DAPI } from '../src/index';
import type { GwenEngine } from '@gwenjs/core';

describe('Physics3D plugin — WASM backend mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    wasmBodyState.clear();
    wasmLinVel.clear();
    wasmAngVel.clear();
    wasmKind.clear();
    physics3dAddBody.mockReturnValue(true);
    physics3dRemoveBody.mockReturnValue(true);
    physics3dGetBodyState.mockImplementation(
      (idx: number) => wasmBodyState.get(idx) ?? new Float32Array(13),
    );
  });

  function setup() {
    const plugin = Physics3DPlugin();
    const services = new Map<string, unknown>();
    const engine = {
      provide: vi.fn((name: string, v: unknown) => services.set(name, v)),
      inject: vi.fn((name: string) => services.get(name)),
      hooks: {
        hook: vi.fn(() => vi.fn()),
        callHook: vi.fn(),
      },
      getEntityGeneration: vi.fn(() => 0),
      query: vi.fn(() => []),
      getComponent: vi.fn(),
      wasmBridge: null,
    } as unknown as GwenEngine;
    plugin.setup(engine);
    const service = services.get('physics3d') as Physics3DAPI;
    return { plugin, service };
  }

  it('detects WASM backend and delegates createBody to physics3d_add_body', () => {
    const { service } = setup();

    service.createBody(10, { kind: 'dynamic', mass: 5 });

    expect(physics3dAddBody).toHaveBeenCalledWith(10, 0, 0, 0, 1 /* dynamic */, 5, 0, 0);
    expect(service.hasBody(10)).toBe(true);
    expect(service.getBodyCount()).toBe(1);
  });

  it('delegates createBody with initial position', () => {
    const { service } = setup();
    service.createBody(11, { initialPosition: { x: 1, y: 2, z: 3 } });

    expect(physics3dAddBody).toHaveBeenCalledWith(11, 1, 2, 3, 1, expect.any(Number), 0, 0);
  });

  it('calls physics3d_set_body_state for initial rotation/velocity', () => {
    const { service } = setup();
    service.createBody(12, {
      initialPosition: { x: 0, y: 0, z: 0 },
      initialRotation: { x: 0, y: 1, z: 0, w: 0 },
      initialLinearVelocity: { x: 5, y: 0, z: 0 },
    });

    expect(physics3dSetBodyState).toHaveBeenCalledWith(12, 0, 0, 0, 0, 1, 0, 0, 5, 0, 0, 0, 0, 0);
  });

  it('delegates removeBody to physics3d_remove_body', () => {
    const { service } = setup();
    service.createBody(20);
    expect(service.removeBody(20)).toBe(true);
    expect(physics3dRemoveBody).toHaveBeenCalledWith(20);
    expect(service.hasBody(20)).toBe(false);
  });

  it('removeBody returns false for unknown entity', () => {
    const { service } = setup();
    expect(service.removeBody(404)).toBe(false);
    expect(physics3dRemoveBody).not.toHaveBeenCalled();
  });

  it('getBodyState delegates to physics3d_get_body_state', () => {
    const { service } = setup();
    wasmBodyState.set(30, new Float32Array([1, 2, 3, 0, 0, 0, 1, 4, 5, 6, 7, 8, 9]));
    service.createBody(30);

    const state = service.getBodyState(30);
    expect(state?.position).toEqual({ x: 1, y: 2, z: 3 });
    expect(state?.rotation).toEqual({ x: 0, y: 0, z: 0, w: 1 });
    expect(state?.linearVelocity).toEqual({ x: 4, y: 5, z: 6 });
    expect(state?.angularVelocity).toEqual({ x: 7, y: 8, z: 9 });
    expect(physics3dGetBodyState).toHaveBeenCalledWith(30);
  });

  it('getBodyState returns undefined for unknown entity', () => {
    const { service } = setup();
    expect(service.getBodyState(404)).toBeUndefined();
  });

  it('setBodyState delegates to WASM after merging patch', () => {
    const { service } = setup();
    wasmBodyState.set(31, new Float32Array([1, 2, 3, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0]));
    service.createBody(31);

    service.setBodyState(31, { position: { y: 99 }, linearVelocity: { x: 7 } });

    expect(physics3dSetBodyState).toHaveBeenCalledWith(31, 1, 99, 3, 0, 0, 0, 1, 7, 0, 0, 0, 0, 0);
  });

  it('getLinearVelocity / setLinearVelocity delegate to WASM', () => {
    const { service } = setup();
    wasmLinVel.set(40, new Float32Array([3, 4, 5]));
    service.createBody(40);

    expect(service.getLinearVelocity(40)).toEqual({ x: 3, y: 4, z: 5 });

    service.setLinearVelocity(40, { y: 99 });
    expect(physics3dSetLinearVelocity).toHaveBeenCalledWith(40, 3, 99, 5);
  });

  it('getAngularVelocity / setAngularVelocity delegate to WASM', () => {
    const { service } = setup();
    wasmAngVel.set(41, new Float32Array([1, 2, 3]));
    service.createBody(41);

    expect(service.getAngularVelocity(41)).toEqual({ x: 1, y: 2, z: 3 });

    service.setAngularVelocity(41, { z: 9 });
    expect(physics3dSetAngularVelocity).toHaveBeenCalledWith(41, 1, 2, 9);
  });

  it('applyImpulse delegates to WASM', () => {
    const { service } = setup();
    service.createBody(50);

    expect(service.applyImpulse(50, { x: 5, y: -1, z: 0 })).toBe(true);
    expect(physics3dApplyImpulse).toHaveBeenCalledWith(50, 5, -1, 0);
  });

  it('applyImpulse returns false for missing body', () => {
    const { service } = setup();
    expect(service.applyImpulse(999, { x: 1 })).toBe(false);
    expect(physics3dApplyImpulse).not.toHaveBeenCalled();
  });

  it('getBodyKind / setBodyKind delegate to WASM', () => {
    const { service } = setup();
    wasmKind.set(60, 1); // dynamic
    service.createBody(60);

    expect(service.getBodyKind(60)).toBe('dynamic');

    service.setBodyKind(60, 'fixed');
    expect(physics3dSetBodyKind).toHaveBeenCalledWith(60, 0 /* fixed */);
  });

  it('does NOT run local advanceLocalState during step in wasm mode', () => {
    const { service } = setup();
    wasmBodyState.set(70, new Float32Array(13)); // all zeros
    service.createBody(70, { initialLinearVelocity: { x: 10 } });

    service.step(1);

    expect(physics3dStep).toHaveBeenCalledWith(1);
    // In wasm mode, position is whatever WASM reports (all-zeros mock); local sim is NOT run.
    const state = service.getBodyState(70);
    // WASM mock returns zeros — local integration would have set position.x=10
    expect(state?.position.x).toBe(0);
    expect(physics3dGetBodyState).toHaveBeenCalled();
  });

  it('step calls physics3d_step with the provided delta', () => {
    const { service } = setup();
    service.step(1 / 30);
    expect(physics3dStep).toHaveBeenCalledWith(1 / 30);
  });
});

describe('Physics3D WASM backend — mesh and convex colliders', () => {
  beforeEach(() => {
    physics3dInit.mockReset();
    physics3dAddBody.mockReset().mockReturnValue(true);
    physics3dAddMeshCollider.mockReset().mockReturnValue(true);
    physics3dAddConvexCollider.mockReset().mockReturnValue(true);
  });

  function setupWithBody(entityId: number = 1) {
    const plugin = Physics3DPlugin();
    const services = new Map<string, unknown>();
    const engine = {
      provide: vi.fn((name: string, v: unknown) => services.set(name, v)),
      inject: vi.fn((name: string) => services.get(name)),
      hooks: {
        hook: vi.fn(() => vi.fn()),
        callHook: vi.fn(),
      },
      getEntityGeneration: vi.fn(() => 0),
      query: vi.fn(() => []),
      getComponent: vi.fn(),
      wasmBridge: null,
    } as unknown as GwenEngine;
    plugin.setup(engine);
    const service = services.get('physics3d') as Physics3DAPI;
    service.createBody(entityId);
    return { service };
  }

  it('delegates mesh collider to physics3d_add_mesh_collider in wasm mode', () => {
    const { service } = setupWithBody(1);
    const vertices = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const indices = new Uint32Array([0, 1, 2]);
    const ok = service.addCollider(1, {
      shape: { type: 'mesh', vertices, indices },
      colliderId: 1,
    });
    expect(ok).toBe(true);
    expect(physics3dAddMeshCollider).toHaveBeenCalledOnce();
    const args = physics3dAddMeshCollider.mock.calls[0];
    // args[0] = entityIndex, args[1] = vertices, args[2] = indices
    expect(args[0]).toBe(1); // entityIndex
    expect(args[1]).toBe(vertices);
    expect(args[2]).toBe(indices);
  });

  it('delegates convex collider to physics3d_add_convex_collider in wasm mode', () => {
    const { service } = setupWithBody(2);
    const vertices = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]);
    const ok = service.addCollider(2, {
      shape: { type: 'convex', vertices },
      colliderId: 1,
      density: 2.5,
    });
    expect(ok).toBe(true);
    expect(physics3dAddConvexCollider).toHaveBeenCalledOnce();
    const args = physics3dAddConvexCollider.mock.calls[0];
    // args[0] = entityIndex, args[1] = vertices
    expect(args[0]).toBe(2);
    expect(args[1]).toBe(vertices);
  });

  it('returns false when physics3d_add_mesh_collider returns undefined (absent bridge export)', () => {
    // Simulate older WASM where the method exists but returns undefined (or is genuinely absent).
    // Optional chaining (?.) propagates undefined → ?? false.
    physics3dAddMeshCollider.mockReturnValue(undefined);
    const { service } = setupWithBody(3);
    const ok = service.addCollider(3, {
      shape: {
        type: 'mesh',
        vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        indices: new Uint32Array([0, 1, 2]),
      },
      colliderId: 1,
    });
    // Optional chaining (?.) returns undefined → false
    expect(ok).toBe(false);
  });
});

describe('Group A — RFC-09: forces, gravity, locks, sleep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    wasmBodyState.clear();
    wasmLinVel.clear();
    wasmAngVel.clear();
    wasmKind.clear();
    physics3dAddBody.mockReturnValue(true);
    physics3dGetGravityScale.mockReturnValue(2.0);
    physics3dIsBodySleeping.mockReturnValue(false);
  });

  /** Creates a plugin + engine + service and registers one body at the given entity index. */
  function setupWithBody(entityId: number = 10) {
    const plugin = Physics3DPlugin();
    const services = new Map<string, unknown>();
    const engine = {
      provide: vi.fn((name: string, v: unknown) => services.set(name, v)),
      inject: vi.fn((name: string) => services.get(name)),
      hooks: {
        hook: vi.fn(() => vi.fn()),
        callHook: vi.fn(),
      },
      getEntityGeneration: vi.fn(() => 0),
      query: vi.fn(() => []),
      getComponent: vi.fn(),
      wasmBridge: null,
    } as unknown as GwenEngine;
    plugin.setup(engine);
    const service = services.get('physics3d') as Physics3DAPI;
    service.createBody(entityId);
    return { service, entityId };
  }

  it('addForce delegates to physics3d_add_force with correct slot and components', () => {
    const { service, entityId } = setupWithBody(10);

    service.addForce(entityId, { x: 1, y: 2, z: 3 });

    expect(physics3dAddForce).toHaveBeenCalledOnce();
    expect(physics3dAddForce).toHaveBeenCalledWith(10, 1, 2, 3);
  });

  it('addForce uses zero defaults for missing vector components', () => {
    const { service, entityId } = setupWithBody(10);

    service.addForce(entityId, { x: 5 });

    expect(physics3dAddForce).toHaveBeenCalledOnce();
    expect(physics3dAddForce).toHaveBeenCalledWith(10, 5, 0, 0);
  });

  it('addTorque delegates to physics3d_add_torque with correct slot and components', () => {
    const { service, entityId } = setupWithBody(10);

    service.addTorque(entityId, { x: 0, y: 1, z: 0 });

    expect(physics3dAddTorque).toHaveBeenCalledOnce();
    expect(physics3dAddTorque).toHaveBeenCalledWith(10, 0, 1, 0);
  });

  it('addForceAtPoint delegates to physics3d_add_force_at_point with force and point', () => {
    const { service, entityId } = setupWithBody(10);

    service.addForceAtPoint(entityId, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });

    expect(physics3dAddForceAtPoint).toHaveBeenCalledOnce();
    expect(physics3dAddForceAtPoint).toHaveBeenCalledWith(10, 1, 0, 0, 0, 1, 0);
  });

  it('setGravityScale delegates to physics3d_set_gravity_scale with slot and scale', () => {
    const { service, entityId } = setupWithBody(10);

    service.setGravityScale(entityId, 2.5);

    expect(physics3dSetGravityScale).toHaveBeenCalledOnce();
    expect(physics3dSetGravityScale).toHaveBeenCalledWith(10, 2.5);
  });

  it('getGravityScale returns the value reported by physics3d_get_gravity_scale', () => {
    physics3dGetGravityScale.mockReturnValue(3.0);
    const { service, entityId } = setupWithBody(10);

    const scale = service.getGravityScale(entityId);

    expect(scale).toBe(3.0);
    expect(physics3dGetGravityScale).toHaveBeenCalledWith(10);
  });

  it('lockTranslations delegates to physics3d_lock_translations with correct axes', () => {
    const { service, entityId } = setupWithBody(10);

    service.lockTranslations(entityId, true, false, true);

    expect(physics3dLockTranslations).toHaveBeenCalledOnce();
    expect(physics3dLockTranslations).toHaveBeenCalledWith(10, true, false, true);
  });

  it('lockRotations delegates to physics3d_lock_rotations with correct axes', () => {
    const { service, entityId } = setupWithBody(10);

    service.lockRotations(entityId, false, true, false);

    expect(physics3dLockRotations).toHaveBeenCalledOnce();
    expect(physics3dLockRotations).toHaveBeenCalledWith(10, false, true, false);
  });

  it('setBodySleeping(true) delegates to physics3d_set_body_sleeping with sleeping=true', () => {
    const { service, entityId } = setupWithBody(10);

    service.setBodySleeping(entityId, true);

    expect(physics3dSetBodySleeping).toHaveBeenCalledOnce();
    expect(physics3dSetBodySleeping).toHaveBeenCalledWith(10, true);
  });

  it('isBodySleeping returns the value reported by physics3d_is_body_sleeping', () => {
    physics3dIsBodySleeping.mockReturnValue(true);
    const { service, entityId } = setupWithBody(10);

    const sleeping = service.isBodySleeping(entityId);

    expect(sleeping).toBe(true);
    expect(physics3dIsBodySleeping).toHaveBeenCalledWith(10);
  });

  it('wakeAll delegates to physics3d_wake_all once', () => {
    const { service } = setupWithBody(10);

    service.wakeAll();

    expect(physics3dWakeAll).toHaveBeenCalledOnce();
  });

  it('addForce does not throw when called for an entity with no registered body', () => {
    const { service } = setupWithBody(10);

    // Entity 999 was never registered — addForce has no bodyByEntity guard in WASM mode;
    // it still delegates the call to the WASM layer without throwing.
    expect(() => service.addForce(999, { x: 1, y: 2, z: 3 })).not.toThrow();
    expect(physics3dAddForce).toHaveBeenCalledWith(999, 1, 2, 3);
  });
});

/**
 * Group B — RFC-08: Joint API delegation tests.
 *
 * Verifies that every joint factory and control method delegates to the
 * correct WASM bridge export with the right argument order and values.
 * All tests use isolated mock state and a two-body setup.
 */
describe('Group B — RFC-08: joints', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    wasmBodyState.clear();
    wasmLinVel.clear();
    wasmAngVel.clear();
    wasmKind.clear();
    physics3dAddBody.mockReturnValue(true);
    physics3dAddFixedJoint.mockReturnValue(1);
    physics3dAddRevoluteJoint.mockReturnValue(2);
    physics3dAddPrismaticJoint.mockReturnValue(3);
    physics3dAddBallJoint.mockReturnValue(4);
    physics3dAddSpringJoint.mockReturnValue(5);
  });

  /**
   * Creates a plugin + engine + service and registers one body at the given entity index.
   *
   * @param entityId - Numeric entity index to register a body for.
   * @returns Object containing the physics service and the entity id used.
   */
  function setupWithBody(entityId: number = 10) {
    const plugin = Physics3DPlugin();
    const services = new Map<string, unknown>();
    const engine = {
      provide: vi.fn((name: string, v: unknown) => services.set(name, v)),
      inject: vi.fn((name: string) => services.get(name)),
      hooks: {
        hook: vi.fn(() => vi.fn()),
        callHook: vi.fn(),
      },
      getEntityGeneration: vi.fn(() => 0),
      query: vi.fn(() => []),
      getComponent: vi.fn(),
      wasmBridge: null,
    } as unknown as GwenEngine;
    plugin.setup(engine);
    const service = services.get('physics3d') as Physics3DAPI;
    service.createBody(entityId);
    return { service, entityId };
  }

  it('addFixedJoint delegates to physics3d_add_fixed_joint with both slots and anchors', () => {
    const { service } = setupWithBody(10);
    // Register a second body at slot 11
    service.createBody(11);

    const handle = service.addFixedJoint({
      bodyA: 10,
      bodyB: 11,
      anchorA: { x: 1, y: 0, z: 0 },
      anchorB: { x: -1, y: 0, z: 0 },
    });

    expect(physics3dAddFixedJoint).toHaveBeenCalledOnce();
    expect(physics3dAddFixedJoint).toHaveBeenCalledWith(10, 11, 1, 0, 0, -1, 0, 0);
    // Mock returns 1, which is the joint handle directly
    expect(handle).toBe(1);
  });

  it('addRevoluteJoint delegates with axis and limits', () => {
    const { service } = setupWithBody(10);
    service.createBody(11);

    service.addRevoluteJoint({
      bodyA: 10,
      bodyB: 11,
      axis: { x: 0, y: 1, z: 0 },
      limits: [-1, 1],
    });

    expect(physics3dAddRevoluteJoint).toHaveBeenCalledOnce();
    expect(physics3dAddRevoluteJoint).toHaveBeenCalledWith(
      10,
      11,
      // anchorA default zeros
      0,
      0,
      0,
      // anchorB default zeros
      0,
      0,
      0,
      // axis
      0,
      1,
      0,
      // useLimits, limitMin, limitMax
      true,
      -1,
      1,
    );
  });

  it('addRevoluteJoint without limits passes useLimits=false and zero bounds', () => {
    const { service } = setupWithBody(10);
    service.createBody(11);

    service.addRevoluteJoint({ bodyA: 10, bodyB: 11 });

    expect(physics3dAddRevoluteJoint).toHaveBeenCalledOnce();
    const args = physics3dAddRevoluteJoint.mock.calls[0];
    // useLimits is argument index 11, limitMin is 12, limitMax is 13
    expect(args[11]).toBe(false);
    expect(args[12]).toBe(0);
    expect(args[13]).toBe(0);
  });

  it('addPrismaticJoint delegates with axis and limits', () => {
    const { service } = setupWithBody(10);
    service.createBody(11);

    service.addPrismaticJoint({
      bodyA: 10,
      bodyB: 11,
      axis: { x: 1, y: 0, z: 0 },
      limits: [0, 5],
    });

    expect(physics3dAddPrismaticJoint).toHaveBeenCalledOnce();
    expect(physics3dAddPrismaticJoint).toHaveBeenCalledWith(
      10,
      11,
      0,
      0,
      0,
      0,
      0,
      0,
      1,
      0,
      0,
      true,
      0,
      5,
    );
  });

  it('addBallJoint delegates with cone limit when coneAngle is provided', () => {
    const { service } = setupWithBody(10);
    service.createBody(11);

    service.addBallJoint({ bodyA: 10, bodyB: 11, coneAngle: Math.PI / 4 });

    expect(physics3dAddBallJoint).toHaveBeenCalledOnce();
    expect(physics3dAddBallJoint).toHaveBeenCalledWith(10, 11, 0, 0, 0, 0, 0, 0, true, Math.PI / 4);
  });

  it('addBallJoint without coneAngle passes useConeLimit=false and coneAngle=0', () => {
    const { service } = setupWithBody(10);
    service.createBody(11);

    service.addBallJoint({ bodyA: 10, bodyB: 11 });

    expect(physics3dAddBallJoint).toHaveBeenCalledOnce();
    const args = physics3dAddBallJoint.mock.calls[0];
    // useConeLimit is argument index 8, coneAngle is 9
    expect(args[8]).toBe(false);
    expect(args[9]).toBe(0);
  });

  it('addSpringJoint delegates with restLength stiffness damping', () => {
    const { service } = setupWithBody(10);
    service.createBody(11);

    service.addSpringJoint({
      bodyA: 10,
      bodyB: 11,
      restLength: 2,
      stiffness: 100,
      damping: 10,
    });

    expect(physics3dAddSpringJoint).toHaveBeenCalledOnce();
    expect(physics3dAddSpringJoint).toHaveBeenCalledWith(10, 11, 0, 0, 0, 0, 0, 0, 2, 100, 10);
  });

  it('addFixedJoint returns dummy handle (0xffffffff) when WASM returns 0xffffffff', () => {
    physics3dAddFixedJoint.mockReturnValueOnce(0xffffffff);
    const { service } = setupWithBody(10);
    service.createBody(11);

    const handle = service.addFixedJoint({ bodyA: 10, bodyB: 11 });

    // When WASM signals an error via 0xffffffff, the plugin returns the dummy handle value
    expect(handle).toBe(0xffffffff);
  });

  it('removeJoint delegates to physics3d_remove_joint with the joint id', () => {
    const { service } = setupWithBody(10);

    service.removeJoint(1);

    expect(physics3dRemoveJoint).toHaveBeenCalledOnce();
    expect(physics3dRemoveJoint).toHaveBeenCalledWith(1);
  });

  it('setJointMotorVelocity delegates to physics3d_set_joint_motor_velocity', () => {
    const { service } = setupWithBody(10);

    service.setJointMotorVelocity(1, 2.5, 100);

    expect(physics3dSetJointMotorVelocity).toHaveBeenCalledOnce();
    expect(physics3dSetJointMotorVelocity).toHaveBeenCalledWith(1, 2.5, 100);
  });

  it('setJointMotorPosition delegates to physics3d_set_joint_motor_position', () => {
    const { service } = setupWithBody(10);

    service.setJointMotorPosition(1, 0.5, 50, 5);

    expect(physics3dSetJointMotorPosition).toHaveBeenCalledOnce();
    expect(physics3dSetJointMotorPosition).toHaveBeenCalledWith(1, 0.5, 50, 5);
  });

  it('setJointEnabled delegates to physics3d_set_joint_enabled for both true and false', () => {
    const { service } = setupWithBody(10);

    service.setJointEnabled(1, false);
    service.setJointEnabled(1, true);

    expect(physics3dSetJointEnabled).toHaveBeenCalledTimes(2);
    expect(physics3dSetJointEnabled).toHaveBeenNthCalledWith(1, 1, false);
    expect(physics3dSetJointEnabled).toHaveBeenNthCalledWith(2, 1, true);
  });
});

/**
 * Group C — RFC-07: Spatial Queries (WASM backend mode).
 *
 * Tests cover `castRay`, `castShape`, `overlapShape`, and `projectPoint` on
 * the Physics3D service when running in WASM backend mode. Each test mocks the
 * underlying WASM bridge functions and verifies that the service correctly
 * marshals arguments, parses the flat result arrays, and returns the typed
 * domain objects (or `null` / `[]` on miss / unavailable paths).
 */
describe('Group C — RFC-07: spatial queries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    physics3dAddBody.mockReturnValue(true);
    physics3dOverlapShape.mockReturnValue(0);
  });

  /**
   * Creates a minimal plugin + engine + service instance for spatial-query
   * testing. No body registration is required for these tests.
   */
  function setup() {
    const plugin = Physics3DPlugin();
    const services = new Map<string, unknown>();
    const engine = {
      provide: vi.fn((name: string, v: unknown) => services.set(name, v)),
      inject: vi.fn((name: string) => services.get(name)),
      hooks: {
        hook: vi.fn(() => vi.fn()),
        callHook: vi.fn(),
      },
      getEntityGeneration: vi.fn(() => 0),
      query: vi.fn(() => []),
      getComponent: vi.fn(),
      wasmBridge: null,
    } as unknown as GwenEngine;
    plugin.setup(engine);
    const api = services.get('physics3d') as Physics3DAPI;
    return { api };
  }

  // ─── castRay ─────────────────────────────────────────────────────────────

  it('castRay returns null when WASM returns falsy', () => {
    physics3dCastRay.mockReturnValue(undefined);
    const { api } = setup();

    const result = api.castRay({ x: 0, y: 10, z: 0 }, { x: 0, y: -1, z: 0 }, 100);

    expect(result).toBeNull();
  });

  it('castRay returns null when result[0] === 0 (miss)', () => {
    physics3dCastRay.mockReturnValue([0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const { api } = setup();

    const result = api.castRay({ x: 0, y: 10, z: 0 }, { x: 0, y: -1, z: 0 }, 100);

    expect(result).toBeNull();
  });

  it('castRay returns RayHit with correct fields on hit', () => {
    // [hit=1, entityIdx=5, dist=3.14, nx=0, ny=1, nz=0, px=0, py=5, pz=0]
    physics3dCastRay.mockReturnValue([1, 5, 3.14, 0, 1, 0, 0, 5, 0]);
    const { api } = setup();

    const result = api.castRay({ x: 0, y: 10, z: 0 }, { x: 0, y: -1, z: 0 }, 100);

    expect(result).not.toBeNull();
    expect(result!.distance).toBeCloseTo(3.14);
    expect(result!.normal).toEqual({ x: 0, y: 1, z: 0 });
    expect(result!.point).toEqual({ x: 0, y: 5, z: 0 });
    // entity is entityIndexToId(5) — bridgeRuntime has no getEntityGeneration, so BigInt(5)
    expect(result!.entity).toBeDefined();
  });

  it('castRay passes solid=false as 0 in the last argument', () => {
    physics3dCastRay.mockReturnValue([1, 0, 1, 0, 1, 0, 0, 1, 0]);
    const { api } = setup();

    api.castRay({ x: 0, y: 10, z: 0 }, { x: 0, y: -1, z: 0 }, 50, { solid: false });

    // args: ox, oy, oz, dx, dy, dz, maxDist, layers, mask, solid
    expect(physics3dCastRay).toHaveBeenCalledWith(
      0,
      10,
      0,
      0,
      -1,
      0,
      50,
      expect.any(Number),
      expect.any(Number),
      0, // solid=false → 0
    );
  });

  it('castRay uses default layers=0xffffffff and mask=0xffffffff when no opts given', () => {
    physics3dCastRay.mockReturnValue(undefined);
    const { api } = setup();

    api.castRay({ x: 0, y: 10, z: 0 }, { x: 0, y: -1, z: 0 }, 100);

    const args = physics3dCastRay.mock.calls[0]!;
    expect(args[7]).toBe(0xffffffff);
    expect(args[8]).toBe(0xffffffff);
  });

  // ─── castShape ───────────────────────────────────────────────────────────

  it('castShape returns null when result[0] === 0 (miss)', () => {
    physics3dCastShape.mockReturnValue(Array(15).fill(0));
    const { api } = setup();

    const result = api.castShape(
      { x: 0, y: 5, z: 0 },
      { x: 0, y: 0, z: 0, w: 1 },
      { x: 0, y: -1, z: 0 },
      { type: 'box', halfX: 0.5, halfY: 0.5, halfZ: 0.5 },
      20,
    );

    expect(result).toBeNull();
  });

  it('castShape returns ShapeHit with all fields on hit', () => {
    // [hit=1, entityIdx=7, toi=2.5, nx=0, ny=1, nz=0, px=0, py=2, pz=0, waAx=0, waAy=2.1, waAz=0, waBx=0, waBy=1.9, waBz=0]
    physics3dCastShape.mockReturnValue([1, 7, 2.5, 0, 1, 0, 0, 2, 0, 0, 2.1, 0, 0, 1.9, 0]);
    const { api } = setup();

    const result = api.castShape(
      { x: 0, y: 5, z: 0 },
      { x: 0, y: 0, z: 0, w: 1 },
      { x: 0, y: -1, z: 0 },
      { type: 'box', halfX: 0.5, halfY: 0.5, halfZ: 0.5 },
      20,
    );

    expect(result).not.toBeNull();
    expect(result!.distance).toBeCloseTo(2.5);
    expect(result!.normal).toEqual({ x: 0, y: 1, z: 0 });
    expect(result!.point).toEqual({ x: 0, y: 2, z: 0 });
    expect(result!.witnessA).toEqual({ x: 0, y: 2.1, z: 0 });
    expect(result!.witnessB).toEqual({ x: 0, y: 1.9, z: 0 });
    expect(result!.entity).toBeDefined();
  });

  it('castShape encodes box shape correctly (shapeType=0, halfX/Y/Z)', () => {
    physics3dCastShape.mockReturnValue(undefined);
    const { api } = setup();

    api.castShape(
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 0, w: 1 },
      { x: 1, y: 0, z: 0 },
      { type: 'box', halfX: 1, halfY: 2, halfZ: 3 },
      10,
    );

    // args: px,py,pz, rx,ry,rz,rw, dx,dy,dz, shapeType, p0, p1, p2, maxDist, layers, mask
    const args = physics3dCastShape.mock.calls[0]!;
    expect(args[10]).toBe(0); // box type
    expect(args[11]).toBe(1); // halfX
    expect(args[12]).toBe(2); // halfY
    expect(args[13]).toBe(3); // halfZ
  });

  it('castShape encodes sphere shape correctly (shapeType=1, radius)', () => {
    physics3dCastShape.mockReturnValue(undefined);
    const { api } = setup();

    api.castShape(
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 0, w: 1 },
      { x: 1, y: 0, z: 0 },
      { type: 'sphere', radius: 0.5 },
      10,
    );

    const args = physics3dCastShape.mock.calls[0]!;
    expect(args[10]).toBe(1); // sphere type
    expect(args[11]).toBe(0.5); // radius
    expect(args[12]).toBe(0);
    expect(args[13]).toBe(0);
  });

  // ─── overlapShape ────────────────────────────────────────────────────────

  it('overlapShape returns empty array when scratch buffer is unavailable (mock mode without overlapScratchPtr)', () => {
    const { api } = setup();

    // In WASM mock mode, bridgeRuntime.getLinearMemory() is mocked to return a
    // buffer, but overlapScratchPtr is 0 (never initialised by real WASM init),
    // so the guard `overlapScratchPtr === 0` triggers and the function returns [].
    const result = api.overlapShape(
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 0, w: 1 },
      { type: 'sphere', radius: 1 },
    );

    expect(result).toEqual([]);
    // physics3d_overlap_shape must NOT be called because scratch buffer is unavailable
    expect(physics3dOverlapShape).not.toHaveBeenCalled();
  });

  // ─── projectPoint ────────────────────────────────────────────────────────

  it('projectPoint returns null when result[0] === 0 (miss)', () => {
    physics3dProjectPoint.mockReturnValue([0, 0, 0, 0, 0, 0]);
    const { api } = setup();

    const result = api.projectPoint({ x: 5, y: 5, z: 5 });

    expect(result).toBeNull();
  });

  it('projectPoint returns PointProjection with correct fields on hit', () => {
    // [hit=1, entityIdx=3, projX=1.0, projY=2.0, projZ=3.0, isInside=0]
    physics3dProjectPoint.mockReturnValue([1, 3, 1.0, 2.0, 3.0, 0]);
    const { api } = setup();

    const result = api.projectPoint({ x: 0, y: 0, z: 0 });

    expect(result).not.toBeNull();
    expect(result!.point).toEqual({ x: 1.0, y: 2.0, z: 3.0 });
    expect(result!.isInside).toBe(false);
    expect(result!.entity).toBeDefined();
  });

  it('projectPoint sets isInside=true when result[5] !== 0', () => {
    // [hit=1, entityIdx=3, projX=0, projY=0, projZ=0, isInside=1]
    physics3dProjectPoint.mockReturnValue([1, 3, 0, 0, 0, 1]);
    const { api } = setup();

    const result = api.projectPoint({ x: 0, y: 0, z: 0 });

    expect(result!.isInside).toBe(true);
  });

  it('projectPoint passes solid=false as 0 in the last argument', () => {
    physics3dProjectPoint.mockReturnValue(undefined);
    const { api } = setup();

    api.projectPoint({ x: 1, y: 2, z: 3 }, { solid: false });

    // args: px, py, pz, layers, mask, solid
    const args = physics3dProjectPoint.mock.calls[0]!;
    expect(args[5]).toBe(0); // solid=false → 0
  });
});

/**
 * Group D — RFC-09: CharacterController (WASM backend mode).
 *
 * Verifies that `addCharacterController`, `handle.move`, and
 * `removeCharacterController` correctly delegate to the WASM bridge
 * functions `physics3d_add_character_controller`,
 * `physics3d_character_controller_move`, and
 * `physics3d_remove_character_controller`.
 *
 * Because no real SharedArrayBuffer is set up in this mock environment,
 * `isGrounded` always reads `false` and `groundNormal` always returns `null`.
 */
describe('Group D — RFC-09: character controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    physics3dAddBody.mockReturnValue(true);
    physics3dAddCharacterController.mockReturnValue(0);
  });

  /**
   * Creates a plugin + engine + service with a registered body at `entityId`.
   *
   * @param entityId - Raw entity index to register as a body before returning.
   * @returns Object with the Physics3D API service and the entity id used.
   */
  function setupWithBody(entityId: number = 10) {
    const plugin = Physics3DPlugin();
    const services = new Map<string, unknown>();
    const engine = {
      provide: vi.fn((name: string, v: unknown) => services.set(name, v)),
      inject: vi.fn((name: string) => services.get(name)),
      hooks: {
        hook: vi.fn(() => vi.fn()),
        callHook: vi.fn(),
      },
      getEntityGeneration: vi.fn(() => 0),
      query: vi.fn(() => []),
      getComponent: vi.fn(),
      wasmBridge: null,
    } as unknown as GwenEngine;
    plugin.setup(engine);
    const api = services.get('physics3d') as Physics3DAPI;
    api.createBody(entityId);
    return { api, entityId };
  }

  it('addCharacterController delegates to physics3d_add_character_controller with defaults', () => {
    const { api, entityId } = setupWithBody(10);

    api.addCharacterController(entityId);

    expect(physics3dAddCharacterController).toHaveBeenCalledWith(
      10,
      0.35,
      45,
      0.02,
      0.2,
      true,
      true,
    );
  });

  it('addCharacterController passes custom opts to WASM', () => {
    const { api, entityId } = setupWithBody(10);

    api.addCharacterController(entityId, {
      stepHeight: 0.5,
      slopeLimit: 30,
      skinWidth: 0.05,
      snapToGround: 0.1,
      slideOnSteepSlopes: false,
      applyImpulsesToDynamic: false,
    });

    expect(physics3dAddCharacterController).toHaveBeenCalledWith(
      10,
      0.5,
      30,
      0.05,
      0.1,
      false,
      false,
    );
  });

  it('addCharacterController returns handle with isGrounded=false (no SAB in mock)', () => {
    const { api, entityId } = setupWithBody(10);

    const handle = api.addCharacterController(entityId);

    expect(handle.isGrounded).toBe(false);
  });

  it('addCharacterController returns handle with groundNormal=null (no SAB in mock)', () => {
    const { api, entityId } = setupWithBody(10);

    const handle = api.addCharacterController(entityId);

    expect(handle.groundNormal).toBeNull();
  });

  it('addCharacterController returns handle with groundEntity=null', () => {
    const { api, entityId } = setupWithBody(10);

    const handle = api.addCharacterController(entityId);

    expect(handle.groundEntity).toBeNull();
  });

  it('handle.move calls physics3d_character_controller_move with entityIndex, velocity components, and dt', () => {
    const { api, entityId } = setupWithBody(10);
    const handle = api.addCharacterController(entityId);

    handle.move({ x: 0, y: -5, z: 0 }, 1 / 60);

    expect(physics3dCharacterControllerMove).toHaveBeenCalledWith(10, 0, -5, 0, 1 / 60);
  });

  it('handle.move updates lastTranslation to velocity * dt', () => {
    const { api, entityId } = setupWithBody(10);
    const handle = api.addCharacterController(entityId);

    handle.move({ x: 2, y: 0, z: 0 }, 0.5);

    expect(handle.lastTranslation).toEqual({ x: 1, y: 0, z: 0 });
  });

  it('removeCharacterController delegates to physics3d_remove_character_controller', () => {
    const { api, entityId } = setupWithBody(10);
    api.addCharacterController(entityId);

    api.removeCharacterController(entityId);

    expect(physics3dRemoveCharacterController).toHaveBeenCalledWith(10);
  });

  it('addCharacterController called twice for same entity — second call updates ccRegistrations', () => {
    const { api, entityId } = setupWithBody(10);

    api.addCharacterController(entityId);
    api.addCharacterController(entityId);

    expect(physics3dAddCharacterController).toHaveBeenCalledTimes(2);
  });

  it('addCharacterController when WASM returns 0xffffffff — handle still created', () => {
    physics3dAddCharacterController.mockReturnValueOnce(0xffffffff);
    const { api, entityId } = setupWithBody(10);

    const handle = api.addCharacterController(entityId);

    expect(handle).toBeDefined();
    expect(handle).not.toBeNull();
    expect(physics3dAddCharacterController).toHaveBeenCalled();
    // isGrounded is still false and groundNormal is still null because sabView.view is null
    expect(handle.isGrounded).toBe(false);
    expect(handle.groundNormal).toBeNull();
  });
});
