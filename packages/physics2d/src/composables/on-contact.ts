/**
 * @file onContact() — subscribes to collision events for one actor entity.
 */
import { useEngine } from "@gwenjs/core";
import type { GwenEngine } from "@gwenjs/core";
import { GwenContextError, GwenContextErrorCodes } from "@gwenjs/kit";
import { _getActorContext } from "@gwenjs/core/internal";
import type { EntityId } from "@gwenjs/schema";
import {
  clearEngineContacts as clearCoreEngineContacts,
  createContactRegistry,
  onContact as coreOnContact,
} from "@gwenjs/physics-core";
import type { CollisionContact } from "../types";

let contactEmitDepth = 0;
const pendingContactClears: Array<{ engine: GwenEngine; entityId: bigint }> = [];

function dropContactEntries(
  entries: Array<{ readonly entityId: EntityId | undefined }>,
  entityId: bigint,
): void {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry !== undefined && entry.entityId === entityId) entries.splice(index, 1);
  }
}

function flushContactClears(): void {
  const pending = pendingContactClears.splice(0, pendingContactClears.length);
  for (const item of pending) {
    const entries = createContactRegistry().peek(item.engine)?.entries;
    if (entries === undefined) continue;
    dropContactEntries(entries, item.entityId);
  }
}

/**
 * @internal Called by the physics2d plugin per contact to emit into the shared registry.
 * Removals requested during `emit` wait until the walk finishes, so a callback that
 * destroys its entity does not splice the list the iterator is walking.
 */
export function _dispatchContactEvent(event: CollisionContact): void {
  contactEmitDepth += 1;
  try {
    createContactRegistry().peek(useEngine("Physics2DPlugin"))?.emit(event);
  } finally {
    contactEmitDepth -= 1;
    if (contactEmitDepth === 0) flushContactClears();
  }
}

/**
 * Subscribes to collision contact events for the current actor entity.
 *
 * Events are dispatched once per frame after the physics step.
 * Pass `entityId` explicitly outside an actor. Inside a `defineActor` factory
 * the id is the actor being spawned.
 *
 * @returns A function that removes this callback.
 * @throws {GwenContextError} `CORE:OUTSIDE_ENGINE_CONTEXT` when no engine is current.
 * @throws {GwenContextError} `CORE:OUTSIDE_ACTOR_CONTEXT` when neither an actor nor `entityId` is set.
 */
export function onContact(
  callback: (contact: CollisionContact) => void,
  entityId?: EntityId,
): () => void {
  useEngine("onContact");
  const id = entityId ?? _getActorContext()?.entityId;
  if (id === undefined) {
    throw new GwenContextError(GwenContextErrorCodes.OUTSIDE_ACTOR_CONTEXT, "onContact", {
      hint: __GWEN_DEV__
        ? "Call onContact() inside defineActor(), or pass { entityId }."
        : undefined,
    });
  }
  return coreOnContact(callback, id);
}

/** @internal Remove this engine's contact callbacks for one entity. */
export function _clearContactCallbacks(entityId: bigint): void {
  const engine = useEngine("Physics2DPlugin");
  const entries = createContactRegistry().peek(engine)?.entries;
  if (entries === undefined) return;
  if (contactEmitDepth > 0) {
    pendingContactClears.push({ engine, entityId });
    return;
  }
  dropContactEntries(entries, entityId);
}

/** @internal Drop contact and sensor callbacks owned by `engine`. */
export function clearEngineContacts(engine: GwenEngine): void {
  clearCoreEngineContacts(engine);
}
