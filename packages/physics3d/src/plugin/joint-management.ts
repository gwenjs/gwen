/**
 * @fileoverview Joint (constraint) creation and management.
 *
 * Supports fixed, revolute, prismatic, ball, and spring joints.
 */

import type { EntityId } from '@gwenjs/core';
import type {
  Physics3DAPI,
  FixedJointOpts,
  RevoluteJointOpts,
  PrismaticJointOpts,
  BallJointOpts,
  SpringJointOpts,
  JointHandle3D,
  JointId,
} from '../types';
import { toEntityIndex } from './physics3d-utils';
import { emitLocalJointWarning, makeDummyJoint, makeJointHandle } from './plugin-helpers';
import type { PluginContext } from './plugin-context';

export function createJointMethods(ctx: PluginContext): Pick<
  Physics3DAPI,
  | 'addFixedJoint'
  | 'addRevoluteJoint'
  | 'addPrismaticJoint'
  | 'addBallJoint'
  | 'addSpringJoint'
  | 'removeJoint'
  | 'setJointMotorVelocity'
  | 'setJointMotorPosition'
  | 'setJointEnabled'
> {
  return {
    addFixedJoint(opts: FixedJointOpts): JointHandle3D {
      const slotA = toEntityIndex(opts.bodyA as EntityId);
      const slotB = toEntityIndex(opts.bodyB as EntityId);
      const a = opts.anchorA ?? {};
      const b = opts.anchorB ?? {};

      if (ctx.backendMode === 'wasm') {
        const id =
          ctx.wasmBridge!.physics3d_add_fixed_joint?.(
            slotA, slotB,
            a.x ?? 0, a.y ?? 0, a.z ?? 0,
            b.x ?? 0, b.y ?? 0, b.z ?? 0,
          ) ?? 0xffffffff;
        if (id === 0xffffffff) {
          emitLocalJointWarning();
          return makeDummyJoint();
        }
        return makeJointHandle(id);
      }

      emitLocalJointWarning();
      return makeDummyJoint();
    },

    addRevoluteJoint(opts: RevoluteJointOpts): JointHandle3D {
      const slotA = toEntityIndex(opts.bodyA as EntityId);
      const slotB = toEntityIndex(opts.bodyB as EntityId);
      const a = opts.anchorA ?? {};
      const b = opts.anchorB ?? {};
      const axis = opts.axis ?? {};
      const useLimits = opts.limits !== undefined;
      const limitMin = opts.limits?.[0] ?? 0;
      const limitMax = opts.limits?.[1] ?? 0;

      if (ctx.backendMode === 'wasm') {
        const id =
          ctx.wasmBridge!.physics3d_add_revolute_joint?.(
            slotA, slotB,
            a.x ?? 0, a.y ?? 0, a.z ?? 0,
            b.x ?? 0, b.y ?? 0, b.z ?? 0,
            axis.x ?? 0, axis.y ?? 1, axis.z ?? 0,
            useLimits, limitMin, limitMax,
          ) ?? 0xffffffff;
        if (id === 0xffffffff) {
          emitLocalJointWarning();
          return makeDummyJoint();
        }
        return makeJointHandle(id);
      }

      emitLocalJointWarning();
      return makeDummyJoint();
    },

    addPrismaticJoint(opts: PrismaticJointOpts): JointHandle3D {
      const slotA = toEntityIndex(opts.bodyA as EntityId);
      const slotB = toEntityIndex(opts.bodyB as EntityId);
      const a = opts.anchorA ?? {};
      const b = opts.anchorB ?? {};
      const axis = opts.axis ?? {};
      const useLimits = opts.limits !== undefined;
      const limitMin = opts.limits?.[0] ?? 0;
      const limitMax = opts.limits?.[1] ?? 0;

      if (ctx.backendMode === 'wasm') {
        const id =
          ctx.wasmBridge!.physics3d_add_prismatic_joint?.(
            slotA, slotB,
            a.x ?? 0, a.y ?? 0, a.z ?? 0,
            b.x ?? 0, b.y ?? 0, b.z ?? 0,
            axis.x ?? 0, axis.y ?? 1, axis.z ?? 0,
            useLimits, limitMin, limitMax,
          ) ?? 0xffffffff;
        if (id === 0xffffffff) {
          emitLocalJointWarning();
          return makeDummyJoint();
        }
        return makeJointHandle(id);
      }

      emitLocalJointWarning();
      return makeDummyJoint();
    },

    addBallJoint(opts: BallJointOpts): JointHandle3D {
      const slotA = toEntityIndex(opts.bodyA as EntityId);
      const slotB = toEntityIndex(opts.bodyB as EntityId);
      const a = opts.anchorA ?? {};
      const b = opts.anchorB ?? {};
      const useConeLimit = opts.coneAngle !== undefined;
      const coneAngle = opts.coneAngle ?? 0;

      if (ctx.backendMode === 'wasm') {
        const id =
          ctx.wasmBridge!.physics3d_add_ball_joint?.(
            slotA, slotB,
            a.x ?? 0, a.y ?? 0, a.z ?? 0,
            b.x ?? 0, b.y ?? 0, b.z ?? 0,
            useConeLimit, coneAngle,
          ) ?? 0xffffffff;
        if (id === 0xffffffff) {
          emitLocalJointWarning();
          return makeDummyJoint();
        }
        return makeJointHandle(id);
      }

      emitLocalJointWarning();
      return makeDummyJoint();
    },

    addSpringJoint(opts: SpringJointOpts): JointHandle3D {
      const slotA = toEntityIndex(opts.bodyA as EntityId);
      const slotB = toEntityIndex(opts.bodyB as EntityId);
      const a = opts.anchorA ?? {};
      const b = opts.anchorB ?? {};

      if (ctx.backendMode === 'wasm') {
        const id =
          ctx.wasmBridge!.physics3d_add_spring_joint?.(
            slotA, slotB,
            a.x ?? 0, a.y ?? 0, a.z ?? 0,
            b.x ?? 0, b.y ?? 0, b.z ?? 0,
            opts.restLength, opts.stiffness, opts.damping,
          ) ?? 0xffffffff;
        if (id === 0xffffffff) {
          emitLocalJointWarning();
          return makeDummyJoint();
        }
        return makeJointHandle(id);
      }

      emitLocalJointWarning();
      return makeDummyJoint();
    },

    removeJoint(id: JointId): void {
      if (ctx.backendMode !== 'wasm') return;
      ctx.wasmBridge!.physics3d_remove_joint?.(id as number);
    },

    setJointMotorVelocity(id: JointId, velocity: number, maxForce: number): void {
      if (ctx.backendMode !== 'wasm') return;
      ctx.wasmBridge!.physics3d_set_joint_motor_velocity?.(id as number, velocity, maxForce);
    },

    setJointMotorPosition(id: JointId, target: number, stiffness: number, damping: number): void {
      if (ctx.backendMode !== 'wasm') return;
      ctx.wasmBridge!.physics3d_set_joint_motor_position?.(id as number, target, stiffness, damping);
    },

    setJointEnabled(id: JointId, enabled: boolean): void {
      if (ctx.backendMode !== 'wasm') return;
      ctx.wasmBridge!.physics3d_set_joint_enabled?.(id as number, enabled);
    },
  };
}
