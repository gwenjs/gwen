/**
 * @fileoverview Rigid body creation, removal, and state management.
 *
 * Handles both local (TypeScript) and WASM (Rapier3D) backend modes.
 */

import type {
  Physics3DAPI,
  Physics3DBodyHandle,
  Physics3DBodyOptions,
  Physics3DEntityId,
} from "../types";
import type { Physics3DColliderOptions } from "../types";
import type { PluginContext } from "./plugin-context";
import { callPhysics3DExport } from "./wasm-errors";
import { entitySlot, guardAlive, guardOwned, noteOwnerChange, ownedSlot } from "./entity-owner";
import { vec3, quat, kindToU8, kindFromU8, parseBodyState, cloneState } from "./physics3d-utils";

// ─── Local simulation ─────────────────────────────────────────────────────────

export function createBodyLocal(
  ctx: PluginContext,
  entityId: Physics3DEntityId,
  options: Physics3DBodyOptions = {},
): Physics3DBodyHandle {
  const slot = entitySlot(entityId);
  const handle: Physics3DBodyHandle = {
    bodyId: ctx.nextBodyId++,
    entityId,
    kind: options.kind ?? "dynamic",
    mass: Math.max(0.0001, options.mass ?? 1),
    linearDamping: Math.max(0, options.linearDamping ?? 0),
    angularDamping: Math.max(0, options.angularDamping ?? 0),
  };
  ctx.bodyByEntity.set(slot, handle);
  noteOwnerChange(ctx, slot);
  ctx.stateByEntity.set(slot, {
    position: vec3(options.initialPosition),
    rotation: quat(options.initialRotation),
    linearVelocity: vec3(options.initialLinearVelocity),
    angularVelocity: vec3(options.initialAngularVelocity),
  });

  // Apply fixedRotation: lock all rotation axes in local mode
  if (options.fixedRotation) {
    const cur = ctx.localAxisLocks.get(slot) ?? {
      tx: false,
      ty: false,
      tz: false,
      rx: false,
      ry: false,
      rz: false,
    };
    ctx.localAxisLocks.set(slot, { ...cur, rx: true, ry: true, rz: true });
  }

  return handle;
}

export function removeBodyLocal(ctx: PluginContext, entityId: Physics3DEntityId): boolean {
  const slot = entitySlot(entityId);
  ctx.stateByEntity.delete(slot);
  ctx.localColliders.delete(slot);
  ctx.localForces.delete(slot);
  ctx.localTorques.delete(slot);
  ctx.localAxisLocks.delete(slot);
  ctx.localSleeping.delete(slot);
  ctx.localGravityScales.delete(slot);
  const removed = ctx.bodyByEntity.delete(slot);
  if (removed) noteOwnerChange(ctx, slot);
  return removed;
}

export function advanceLocalState(ctx: PluginContext, deltaSeconds: number): void {
  for (const [slot, handle] of ctx.bodyByEntity.entries()) {
    const state = ctx.stateByEntity.get(slot);
    if (!state) continue;

    // Skip sleeping bodies — they do not integrate
    if (ctx.localSleeping.has(slot)) continue;

    if (handle.kind === "dynamic") {
      // Per-body gravity scale (default 1.0)
      const gs = ctx.localGravityScales.get(slot) ?? 1.0;
      state.linearVelocity = {
        x: state.linearVelocity.x + ctx.cfg.gravity.x * gs * deltaSeconds,
        y: state.linearVelocity.y + ctx.cfg.gravity.y * gs * deltaSeconds,
        z: state.linearVelocity.z + ctx.cfg.gravity.z * gs * deltaSeconds,
      };

      // Apply accumulated forces: F = m*a → a = F/m → Δv = a*dt
      const force = ctx.localForces.get(slot);
      if (force) {
        const invMass = 1 / handle.mass;
        state.linearVelocity = {
          x: state.linearVelocity.x + force.x * invMass * deltaSeconds,
          y: state.linearVelocity.y + force.y * invMass * deltaSeconds,
          z: state.linearVelocity.z + force.z * invMass * deltaSeconds,
        };
        ctx.localForces.delete(slot);
      }

      // Apply accumulated torques: τ = I*α → α = τ/I (use unit inertia for local mode)
      const torque = ctx.localTorques.get(slot);
      if (torque) {
        const invInertia = 1 / handle.mass; // simplified unit-sphere inertia
        state.angularVelocity = {
          x: state.angularVelocity.x + torque.x * invInertia * deltaSeconds,
          y: state.angularVelocity.y + torque.y * invInertia * deltaSeconds,
          z: state.angularVelocity.z + torque.z * invInertia * deltaSeconds,
        };
        ctx.localTorques.delete(slot);
      }
    }

    if (handle.kind === "fixed") continue;

    // Apply axis locks: zero out locked velocity components before damping/integration
    const locks = ctx.localAxisLocks.get(slot);
    if (locks) {
      if (locks.tx) state.linearVelocity = { ...state.linearVelocity, x: 0 };
      if (locks.ty) state.linearVelocity = { ...state.linearVelocity, y: 0 };
      if (locks.tz) state.linearVelocity = { ...state.linearVelocity, z: 0 };
      if (locks.rx) state.angularVelocity = { ...state.angularVelocity, x: 0 };
      if (locks.ry) state.angularVelocity = { ...state.angularVelocity, y: 0 };
      if (locks.rz) state.angularVelocity = { ...state.angularVelocity, z: 0 };
    }

    if (handle.linearDamping > 0) {
      const f = Math.max(0, 1 - handle.linearDamping * deltaSeconds);
      state.linearVelocity = {
        x: state.linearVelocity.x * f,
        y: state.linearVelocity.y * f,
        z: state.linearVelocity.z * f,
      };
    }

    if (handle.angularDamping > 0) {
      const f = Math.max(0, 1 - handle.angularDamping * deltaSeconds);
      state.angularVelocity = {
        x: state.angularVelocity.x * f,
        y: state.angularVelocity.y * f,
        z: state.angularVelocity.z * f,
      };
    }

    state.position = {
      x: state.position.x + state.linearVelocity.x * deltaSeconds,
      y: state.position.y + state.linearVelocity.y * deltaSeconds,
      z: state.position.z + state.linearVelocity.z * deltaSeconds,
    };

    // Integrate angular velocity into the orientation quaternion.
    const av = state.angularVelocity;
    const omega = Math.sqrt(av.x * av.x + av.y * av.y + av.z * av.z);
    if (omega > 1e-10) {
      const halfAngle = omega * deltaSeconds * 0.5;
      const sinH = Math.sin(halfAngle) / omega;
      const cosH = Math.cos(halfAngle);
      const dqx = av.x * sinH;
      const dqy = av.y * sinH;
      const dqz = av.z * sinH;
      const dqw = cosH;
      const q = state.rotation;
      const nx = q.w * dqx + q.x * dqw + q.y * dqz - q.z * dqy;
      const ny = q.w * dqy - q.x * dqz + q.y * dqw + q.z * dqx;
      const nz = q.w * dqz + q.x * dqy - q.y * dqx + q.z * dqw;
      const nw = q.w * dqw - q.x * dqx - q.y * dqy - q.z * dqz;
      const rlen = Math.sqrt(nx * nx + ny * ny + nz * nz + nw * nw);
      if (rlen > 0) {
        state.rotation = { x: nx / rlen, y: ny / rlen, z: nz / rlen, w: nw / rlen };
      }
    }
  }
}

// ─── WASM body operations ──────────────────────────────────────────────────────

export function createBodyWasm(
  ctx: PluginContext,
  entityId: Physics3DEntityId,
  options: Physics3DBodyOptions = {},
): Physics3DBodyHandle {
  const handle: Physics3DBodyHandle = {
    bodyId: ctx.nextBodyId++,
    entityId,
    kind: options.kind ?? "dynamic",
    mass: Math.max(0.0001, options.mass ?? 1),
    linearDamping: Math.max(0, options.linearDamping ?? 0),
    angularDamping: Math.max(0, options.angularDamping ?? 0),
  };
  const idx = entitySlot(entityId);
  // `createBody` removes the previous owner of the slot first, so BODY_ALREADY_EXISTS here
  // means the TypeScript registry and Rust disagree. The typed error propagates.
  callPhysics3DExport(ctx, "physics3d_add_body", () =>
    ctx.wasmBridge!.physics3d_add_body!(
      idx,
      options.initialPosition?.x ?? 0,
      options.initialPosition?.y ?? 0,
      options.initialPosition?.z ?? 0,
      kindToU8(handle.kind),
      handle.mass,
      handle.linearDamping,
      handle.angularDamping,
    ),
  );

  // The body exists in Rust from here. A later rejected call must not leave it unowned.
  try {
    applyWasmBodyOptions(ctx, idx, options);
  } catch (err: unknown) {
    try {
      ctx.wasmBridge!.physics3d_remove_body!(idx);
    } catch {
      // The first error is the one to report.
    }
    throw err;
  }

  ctx.bodyByEntity.set(idx, handle);
  noteOwnerChange(ctx, idx);
  return handle;
}

/** Initial state, rotation lock and solver iterations of a body that Rust just registered. */
function applyWasmBodyOptions(
  ctx: PluginContext,
  idx: number,
  options: Physics3DBodyOptions,
): void {
  const hasInitRot = options.initialRotation && Object.keys(options.initialRotation).length > 0;
  const hasInitVel =
    options.initialLinearVelocity && Object.keys(options.initialLinearVelocity).length > 0;
  const hasInitAng =
    options.initialAngularVelocity && Object.keys(options.initialAngularVelocity).length > 0;
  if (hasInitRot || hasInitVel || hasInitAng) {
    const p = options.initialPosition ?? {};
    const r = options.initialRotation ?? {};
    const lv = options.initialLinearVelocity ?? {};
    const av = options.initialAngularVelocity ?? {};
    callPhysics3DExport(ctx, "physics3d_set_body_state", () =>
      ctx.wasmBridge!.physics3d_set_body_state!(
        idx,
        p.x ?? 0,
        p.y ?? 0,
        p.z ?? 0,
        r.x ?? 0,
        r.y ?? 0,
        r.z ?? 0,
        r.w ?? 1,
        lv.x ?? 0,
        lv.y ?? 0,
        lv.z ?? 0,
        av.x ?? 0,
        av.y ?? 0,
        av.z ?? 0,
      ),
    );
  }

  if (options.fixedRotation) {
    callPhysics3DExport(ctx, "physics3d_lock_rotations", () =>
      ctx.wasmBridge!.physics3d_lock_rotations?.(idx, true, true, true),
    );
  }

  if (options.quality !== undefined) {
    const QUALITY_ITER_MAP: Record<import("../types/config").Physics3DQualityPreset, number> = {
      low: 0,
      medium: 0,
      high: 1,
      esport: 2,
    };
    const iters = QUALITY_ITER_MAP[options.quality] ?? 0;
    if (iters > 0) {
      callPhysics3DExport(ctx, "physics3d_set_body_solver_iterations", () =>
        ctx.wasmBridge!.physics3d_set_body_solver_iterations?.(idx, iters),
      );
    }
  }
}

export function removeBodyWasm(ctx: PluginContext, entityId: Physics3DEntityId): boolean {
  const slot = entitySlot(entityId);
  if (!ctx.bodyByEntity.has(slot)) return false;
  callPhysics3DExport(ctx, "physics3d_remove_body", () =>
    ctx.wasmBridge!.physics3d_remove_body!(slot),
  );
  ctx.bodyByEntity.delete(slot);
  ctx.localColliders.delete(slot);
  noteOwnerChange(ctx, slot);
  return true;
}

// ─── Unified body API ─────────────────────────────────────────────────────────

/**
 * Create a unified body (dispatches to local or WASM backend).
 * The `addColliderFn` callback is used to attach declared colliders.
 */
export function createBody(
  ctx: PluginContext,
  entityId: Physics3DEntityId,
  options: Physics3DBodyOptions = {},
  addColliderFn: (entityId: Physics3DEntityId, opts: Physics3DColliderOptions) => boolean,
): Physics3DBodyHandle {
  const { eid, slot } = guardAlive(ctx, entityId, "createBody");
  // Replace any previous owner on this slot. A live id keeps today's replace behaviour.
  if (ctx.bodyByEntity.has(slot)) {
    if (ctx.backendMode === "wasm") removeBodyWasm(ctx, eid);
    else removeBodyLocal(ctx, eid);
  }
  entityId = eid;
  const handle =
    ctx.backendMode === "wasm"
      ? createBodyWasm(ctx, entityId, options)
      : createBodyLocal(ctx, entityId, options);

  // Attach declared colliders. A rejected collider removes the new body: the caller got
  // no handle, so a body left behind could not be released.
  try {
    for (const [idx, colliderOpts] of (options.colliders ?? []).entries()) {
      const resolved = { ...colliderOpts };
      if (resolved.colliderId === undefined) resolved.colliderId = idx;
      addColliderFn(entityId, resolved);
    }
  } catch (err: unknown) {
    try {
      if (ctx.backendMode === "wasm") removeBodyWasm(ctx, entityId);
      else removeBodyLocal(ctx, entityId);
    } catch {
      // The first error is the one to report.
    }
    throw err;
  }

  return handle;
}

export function removeBody(ctx: PluginContext, entityId: Physics3DEntityId): boolean {
  if (!ownedSlot(ctx, entityId)) return false;
  return ctx.backendMode === "wasm"
    ? removeBodyWasm(ctx, entityId)
    : removeBodyLocal(ctx, entityId);
}

export function hasBody(ctx: PluginContext, entityId: Physics3DEntityId): boolean {
  return ownedSlot(ctx, entityId) !== null;
}

// ─── Body state getters/setters ────────────────────────────────────────────────

export function getBodyKind(ctx: PluginContext): Physics3DAPI["getBodyKind"] {
  return (entityId) => {
    const owned = guardOwned(ctx, entityId, "getBodyKind");
    if (!owned) return undefined;
    const slot = owned.slot;
    if (ctx.backendMode === "wasm") {
      if (!ctx.bodyByEntity.has(slot)) return undefined;
      return kindFromU8(
        callPhysics3DExport(ctx, "physics3d_get_body_kind", () =>
          ctx.wasmBridge!.physics3d_get_body_kind!(slot),
        ),
      );
    }
    return ctx.bodyByEntity.get(slot)?.kind;
  };
}

export function setBodyKind(ctx: PluginContext): Physics3DAPI["setBodyKind"] {
  return (entityId, kind) => {
    const owned = guardOwned(ctx, entityId, "setBodyKind");
    if (!owned) return false;
    const slot = owned.slot;
    const handle = ctx.bodyByEntity.get(slot);
    if (!handle) return false;
    if (ctx.backendMode === "wasm") {
      // Rust first: a rejected call leaves the registry kind as it was.
      const done = callPhysics3DExport(ctx, "physics3d_set_body_kind", () =>
        ctx.wasmBridge!.physics3d_set_body_kind!(slot, kindToU8(kind)),
      );
      if (done) handle.kind = kind;
      return done;
    }
    handle.kind = kind;
    return true;
  };
}

export function getBodyState(ctx: PluginContext): Physics3DAPI["getBodyState"] {
  return (entityId) => {
    const owned = guardOwned(ctx, entityId, "getBodyState");
    if (!owned) return undefined;
    const slot = owned.slot;
    if (ctx.backendMode === "wasm") {
      if (!ctx.bodyByEntity.has(slot)) return undefined;
      const arr = callPhysics3DExport(ctx, "physics3d_get_body_state", () =>
        ctx.wasmBridge!.physics3d_get_body_state!(slot),
      );
      if (arr.length < 13) return undefined;
      return parseBodyState(arr);
    }
    const state = ctx.stateByEntity.get(slot);
    return state ? cloneState(state) : undefined;
  };
}

export function setBodyState(ctx: PluginContext): Physics3DAPI["setBodyState"] {
  return (entityId, patch) => {
    const owned = guardOwned(ctx, entityId, "setBodyState");
    if (!owned) return false;
    const slot = owned.slot;
    if (ctx.backendMode === "wasm") {
      if (!ctx.bodyByEntity.has(slot)) return false;
      const idx = slot;
      const arr = callPhysics3DExport(ctx, "physics3d_get_body_state", () =>
        ctx.wasmBridge!.physics3d_get_body_state!(idx),
      );
      if (arr.length < 13) return false;
      const cur = parseBodyState(arr);
      const p = patch.position ? { ...cur.position, ...patch.position } : cur.position;
      const r = patch.rotation ? { ...cur.rotation, ...patch.rotation } : cur.rotation;
      const lv = patch.linearVelocity
        ? { ...cur.linearVelocity, ...patch.linearVelocity }
        : cur.linearVelocity;
      const av = patch.angularVelocity
        ? { ...cur.angularVelocity, ...patch.angularVelocity }
        : cur.angularVelocity;
      return callPhysics3DExport(ctx, "physics3d_set_body_state", () =>
        ctx.wasmBridge!.physics3d_set_body_state!(
          idx,
          p.x,
          p.y,
          p.z,
          r.x,
          r.y,
          r.z,
          r.w,
          lv.x,
          lv.y,
          lv.z,
          av.x,
          av.y,
          av.z,
        ),
      );
    }
    const current = ctx.stateByEntity.get(slot);
    if (!current) return false;
    if (patch.position) current.position = { ...current.position, ...patch.position };
    if (patch.rotation) current.rotation = { ...current.rotation, ...patch.rotation };
    if (patch.linearVelocity)
      current.linearVelocity = { ...current.linearVelocity, ...patch.linearVelocity };
    if (patch.angularVelocity)
      current.angularVelocity = { ...current.angularVelocity, ...patch.angularVelocity };
    return true;
  };
}

// ─── Impulse / Velocity / Kinematic ────────────────────────────────────────────

export function createApplyImpulse(ctx: PluginContext): Physics3DAPI["applyImpulse"] {
  return (entityId, impulse) => {
    const owned = guardOwned(ctx, entityId, "applyImpulse");
    if (!owned) return false;
    const slot = owned.slot;
    if (ctx.backendMode === "wasm") {
      if (!ctx.bodyByEntity.has(slot)) return false;
      return callPhysics3DExport(ctx, "physics3d_apply_impulse", () =>
        ctx.wasmBridge!.physics3d_apply_impulse!(
          slot,
          impulse.x ?? 0,
          impulse.y ?? 0,
          impulse.z ?? 0,
        ),
      );
    }
    const state = ctx.stateByEntity.get(slot);
    const handle = ctx.bodyByEntity.get(slot);
    if (!state || !handle) return false;
    const invMass = 1 / handle.mass;
    state.linearVelocity = {
      x: state.linearVelocity.x + (impulse.x ?? 0) * invMass,
      y: state.linearVelocity.y + (impulse.y ?? 0) * invMass,
      z: state.linearVelocity.z + (impulse.z ?? 0) * invMass,
    };
    return true;
  };
}

export function createApplyAngularImpulse(ctx: PluginContext): Physics3DAPI["applyAngularImpulse"] {
  return (entityId, impulse) => {
    const owned = guardOwned(ctx, entityId, "applyAngularImpulse");
    if (!owned) return false;
    const slot = owned.slot;
    if (ctx.backendMode === "wasm") {
      if (!ctx.bodyByEntity.has(slot)) return false;
      return callPhysics3DExport(ctx, "physics3d_apply_angular_impulse", () =>
        ctx.wasmBridge!.physics3d_apply_angular_impulse!(
          slot,
          impulse.x ?? 0,
          impulse.y ?? 0,
          impulse.z ?? 0,
        ),
      );
    }
    const state = ctx.stateByEntity.get(slot);
    const handle = ctx.bodyByEntity.get(slot);
    if (!state || !handle) return false;
    const invMass = 1 / handle.mass;
    state.angularVelocity = {
      x: state.angularVelocity.x + (impulse.x ?? 0) * invMass,
      y: state.angularVelocity.y + (impulse.y ?? 0) * invMass,
      z: state.angularVelocity.z + (impulse.z ?? 0) * invMass,
    };
    return true;
  };
}

export function createApplyTorque(ctx: PluginContext): Physics3DAPI["applyTorque"] {
  return (entityId, torque) => {
    const owned = guardOwned(ctx, entityId, "applyTorque");
    if (!owned) return false;
    const slot = owned.slot;
    if (ctx.backendMode === "wasm") return false;
    const state = ctx.stateByEntity.get(slot);
    const handle = ctx.bodyByEntity.get(slot);
    if (!state || !handle) return false;
    if (handle.kind === "fixed") return false;
    const invMass = 1 / handle.mass;
    state.angularVelocity = {
      x: state.angularVelocity.x + (torque.x ?? 0) * invMass,
      y: state.angularVelocity.y + (torque.y ?? 0) * invMass,
      z: state.angularVelocity.z + (torque.z ?? 0) * invMass,
    };
    return true;
  };
}

export function createGetLinearVelocity(ctx: PluginContext): Physics3DAPI["getLinearVelocity"] {
  return (entityId) => {
    const owned = guardOwned(ctx, entityId, "getLinearVelocity");
    if (!owned) return undefined;
    const slot = owned.slot;
    if (ctx.backendMode === "wasm") {
      if (!ctx.bodyByEntity.has(slot)) return undefined;
      const arr = callPhysics3DExport(ctx, "physics3d_get_linear_velocity", () =>
        ctx.wasmBridge!.physics3d_get_linear_velocity!(slot),
      );
      if (arr.length < 3) return undefined;
      return { x: arr[0] ?? 0, y: arr[1] ?? 0, z: arr[2] ?? 0 };
    }
    const state = ctx.stateByEntity.get(slot);
    return state ? { ...state.linearVelocity } : undefined;
  };
}

export function createSetLinearVelocity(ctx: PluginContext): Physics3DAPI["setLinearVelocity"] {
  return (entityId, velocity) => {
    const owned = guardOwned(ctx, entityId, "setLinearVelocity");
    if (!owned) return false;
    const slot = owned.slot;
    if (ctx.backendMode === "wasm") {
      if (!ctx.bodyByEntity.has(slot)) return false;
      const arr = callPhysics3DExport(ctx, "physics3d_get_linear_velocity", () =>
        ctx.wasmBridge!.physics3d_get_linear_velocity!(slot),
      );
      const cx = arr[0] ?? 0;
      const cy = arr[1] ?? 0;
      const cz = arr[2] ?? 0;
      return callPhysics3DExport(ctx, "physics3d_set_linear_velocity", () =>
        ctx.wasmBridge!.physics3d_set_linear_velocity!(
          slot,
          velocity.x ?? cx,
          velocity.y ?? cy,
          velocity.z ?? cz,
        ),
      );
    }
    const state = ctx.stateByEntity.get(slot);
    if (!state) return false;
    state.linearVelocity = {
      x: velocity.x ?? state.linearVelocity.x,
      y: velocity.y ?? state.linearVelocity.y,
      z: velocity.z ?? state.linearVelocity.z,
    };
    return true;
  };
}

export function createGetAngularVelocity(ctx: PluginContext): Physics3DAPI["getAngularVelocity"] {
  return (entityId) => {
    const owned = guardOwned(ctx, entityId, "getAngularVelocity");
    if (!owned) return undefined;
    const slot = owned.slot;
    if (ctx.backendMode === "wasm") {
      if (!ctx.bodyByEntity.has(slot)) return undefined;
      const arr = callPhysics3DExport(ctx, "physics3d_get_angular_velocity", () =>
        ctx.wasmBridge!.physics3d_get_angular_velocity!(slot),
      );
      if (arr.length < 3) return undefined;
      return { x: arr[0] ?? 0, y: arr[1] ?? 0, z: arr[2] ?? 0 };
    }
    const state = ctx.stateByEntity.get(slot);
    return state ? { ...state.angularVelocity } : undefined;
  };
}

export function createSetAngularVelocity(ctx: PluginContext): Physics3DAPI["setAngularVelocity"] {
  return (entityId, velocity) => {
    const owned = guardOwned(ctx, entityId, "setAngularVelocity");
    if (!owned) return false;
    const slot = owned.slot;
    if (ctx.backendMode === "wasm") {
      if (!ctx.bodyByEntity.has(slot)) return false;
      const arr = callPhysics3DExport(ctx, "physics3d_get_angular_velocity", () =>
        ctx.wasmBridge!.physics3d_get_angular_velocity!(slot),
      );
      const cx = arr[0] ?? 0;
      const cy = arr[1] ?? 0;
      const cz = arr[2] ?? 0;
      return callPhysics3DExport(ctx, "physics3d_set_angular_velocity", () =>
        ctx.wasmBridge!.physics3d_set_angular_velocity!(
          slot,
          velocity.x ?? cx,
          velocity.y ?? cy,
          velocity.z ?? cz,
        ),
      );
    }
    const state = ctx.stateByEntity.get(slot);
    if (!state) return false;
    state.angularVelocity = {
      x: velocity.x ?? state.angularVelocity.x,
      y: velocity.y ?? state.angularVelocity.y,
      z: velocity.z ?? state.angularVelocity.z,
    };
    return true;
  };
}

export function createSetKinematicPosition(
  ctx: PluginContext,
): Physics3DAPI["setKinematicPosition"] {
  return (entityId, position, rotation) => {
    const owned = guardOwned(ctx, entityId, "setKinematicPosition");
    if (!owned) return false;
    const slot = owned.slot;
    if (ctx.backendMode === "wasm") {
      if (!ctx.bodyByEntity.has(slot)) return false;
      const r = rotation ?? { x: 0, y: 0, z: 0, w: 1 };
      return callPhysics3DExport(ctx, "physics3d_set_kinematic_position", () =>
        ctx.wasmBridge!.physics3d_set_kinematic_position!(
          slot,
          position.x,
          position.y,
          position.z,
          r.x,
          r.y,
          r.z,
          r.w,
        ),
      );
    }
    const state = ctx.stateByEntity.get(slot);
    if (!state) return false;
    state.position = { ...position };
    if (rotation) state.rotation = { ...state.rotation, ...rotation };
    return true;
  };
}
