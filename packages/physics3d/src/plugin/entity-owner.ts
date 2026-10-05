import type { EntityId, GwenEngine } from "@gwenjs/core";
import { entityIndex } from "@gwenjs/core/internal";
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

export function entitySlot(id: EntityId): number {
  return entityIndex(id);
}

function sameEntity(stored: EntityId, id: EntityId): boolean {
  return stored === id;
}

/** No engine means "not dead". A real engine and every test mock provide `isAlive`. */
export function isDeadEntity(engine: GwenEngine | null, id: EntityId): boolean {
  if (!engine) return false;
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
  return handle.entityId;
}

export function ownedSlot(
  ctx: PluginContext,
  id: Physics3DEntityId,
): { eid: EntityId; slot: number; handle: Physics3DBodyHandle } | null {
  const slot = entitySlot(id);
  const handle = ctx.bodyByEntity.get(slot);
  if (!handle || !sameEntity(handle.entityId, id)) return null;
  return { eid: id, slot, handle };
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
  const slot = entitySlot(id);
  const handle = ctx.bodyByEntity.get(slot);
  if (handle && sameEntity(handle.entityId, id)) return { eid: id, slot, handle };
  if (isDeadEntity(ctx._engine, id)) throw new Physics3DStaleEntityError(id, operation);
  return null;
}

/** Throws when `id` is dead. Does not require a body. */
export function guardAlive(
  ctx: PluginContext,
  id: Physics3DEntityId,
  operation: string,
): { eid: EntityId; slot: number } {
  if (isDeadEntity(ctx._engine, id)) throw new Physics3DStaleEntityError(id, operation);
  return { eid: id, slot: entitySlot(id) };
}
