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

/**
 * @internal Called by tests to emit one contact into the shared registry.
 * The registry defers a removal requested during `emit`.
 */
export function _dispatchContactEvent(event: CollisionContact): void {
  createContactRegistry().peek(useEngine("Physics2DPlugin"))?.emit(event);
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
export function _clearContactCallbacks(entityId: EntityId): void {
  const engine = useEngine("Physics2DPlugin");
  const registry = createContactRegistry().peek(engine);
  if (registry === undefined) return;
  registry.removeEntity(entityId);
}

/** @internal Drop contact and sensor callbacks owned by `engine`. */
export function clearEngineContacts(engine: GwenEngine): void {
  clearCoreEngineContacts(engine);
}
