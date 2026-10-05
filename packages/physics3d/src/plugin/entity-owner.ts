import type { EntityId, GwenEngine } from "@gwenjs/core";
import { GwenError } from "@gwenjs/schema";

import { Physics3DErrorCodes } from "../errors/codes";
import type { Physics3DBodyHandle, Physics3DEntityId } from "../types";
import type { PluginContext } from "./plugin-context";

/** Thrown when a Physics3D call targets an entity that is not alive. */
export class Physics3DStaleEntityError extends GwenError {
  readonly entityId: EntityId;
  readonly operation: string;

  constructor(entityId: EntityId, operation: string) {
    super(
      Physics3DErrorCodes.STALE_ENTITY,
      `[${Physics3DErrorCodes.STALE_ENTITY}] ${operation} rejected a stale entity`,
    );
    this.name = "Physics3DStaleEntityError";
    this.entityId = entityId;
    this.operation = operation;
  }
}

/** number/string n → BigInt(n), generation 0. A bigint is kept as-is. */
export function normalizeEntityId(id: Physics3DEntityId): EntityId {
  if (typeof id === "bigint") return id as EntityId;
  return BigInt(id) as EntityId;
}

export function entitySlot(id: EntityId): number {
  return Number(id & 0xffffffffn);
}

function sameEntity(stored: Physics3DEntityId, id: EntityId): boolean {
  return normalizeEntityId(stored) === id;
}

/**
 * A real engine always has `isAlive`. Unit mocks that omit it are not treated as dead,
 * so existing fixture ids keep today's "no body" results.
 */
export function isDeadEntity(engine: GwenEngine | null, id: EntityId): boolean {
  if (!engine || typeof engine.isAlive !== "function") return false;
  return !engine.isAlive(id);
}

export function noteOwnerChange(ctx: PluginContext, slot: number): void {
  ctx.ownerChangedSinceStep.add(slot);
}

export function clearOwnerChanges(ctx: PluginContext): void {
  ctx.ownerChangedSinceStep.clear();
}

/** Owner record only. Drops slots with no owner or changed since the last step. */
export function ownerEntityId(ctx: PluginContext, slot: number): EntityId | undefined {
  if (ctx.ownerChangedSinceStep.has(slot)) return undefined;
  const handle = ctx.bodyByEntity.get(slot);
  if (!handle) return undefined;
  return normalizeEntityId(handle.entityId);
}

export function ownedSlot(
  ctx: PluginContext,
  id: Physics3DEntityId,
): { eid: EntityId; slot: number; handle: Physics3DBodyHandle } | null {
  const eid = normalizeEntityId(id);
  const slot = entitySlot(eid);
  const handle = ctx.bodyByEntity.get(slot);
  if (!handle || !sameEntity(handle.entityId, eid)) return null;
  return { eid, slot, handle };
}

/**
 * Fast path when `id` owns the slot.
 * Throws when the id is dead. Returns null when it is alive but has no body.
 */
export function guardOwned(
  ctx: PluginContext,
  id: Physics3DEntityId,
  operation: string,
): { eid: EntityId; slot: number; handle: Physics3DBodyHandle } | null {
  const eid = normalizeEntityId(id);
  const slot = entitySlot(eid);
  const handle = ctx.bodyByEntity.get(slot);
  if (handle && sameEntity(handle.entityId, eid)) return { eid, slot, handle };
  if (isDeadEntity(ctx._engine, eid)) throw new Physics3DStaleEntityError(eid, operation);
  return null;
}

/** Throws when `id` is dead. Does not require a body. */
export function guardAlive(
  ctx: PluginContext,
  id: Physics3DEntityId,
  operation: string,
): { eid: EntityId; slot: number } {
  const eid = normalizeEntityId(id);
  if (isDeadEntity(ctx._engine, eid)) throw new Physics3DStaleEntityError(eid, operation);
  return { eid, slot: entitySlot(eid) };
}
