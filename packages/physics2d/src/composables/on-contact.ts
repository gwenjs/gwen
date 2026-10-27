/**
 * @file onContact() — subscribes to collision events for one actor entity.
 */
import { useEngine, createEngineLocal } from "@gwenjs/core";
import { GwenContextError, GwenContextErrorCodes } from "@gwenjs/kit";
import type { GwenEngine } from "@gwenjs/core";
import { _getActorContext } from "@gwenjs/core/internal";
import type { ContactEvent } from "../types";

interface ContactRegistry {
  byEntity: Map<string, ((e: ContactEvent) => void)[]>;
  setupEntityId: bigint | null;
}

const contacts = createEngineLocal<ContactRegistry>(() => ({
  byEntity: new Map(),
  setupEntityId: null,
}));

/**
 * @internal Called by the physics2d plugin per-frame to dispatch contact events.
 */
export function _dispatchContactEvent(entityId: bigint, event: ContactEvent): void {
  const cbs = contacts.peek(useEngine("Physics2DPlugin"))?.byEntity.get(String(entityId));
  if (!cbs) return;
  for (const cb of cbs) cb(event);
}

/**
 * Subscribes to collision contact events for the current actor entity.
 *
 * Events are dispatched once per frame after the physics step.
 * Pass `entityId` explicitly outside an actor. Inside a `defineActor` factory
 * the id is the actor being spawned.
 *
 * @throws {GwenContextError} `CORE:OUTSIDE_ENGINE_CONTEXT` when no engine is current.
 * @throws {GwenContextError} `CORE:OUTSIDE_ACTOR_CONTEXT` when neither an actor nor `entityId` is set.
 */
export function onContact(callback: (contact: ContactEvent) => void, entityId?: bigint): void {
  const engine = useEngine("onContact");
  const registry = contacts.get(engine);
  const id = entityId ?? _getActorContext()?.entityId ?? registry.setupEntityId;
  if (id === null) {
    throw new GwenContextError(GwenContextErrorCodes.OUTSIDE_ACTOR_CONTEXT, "onContact", {
      hint: __GWEN_DEV__
        ? "Call onContact() inside defineActor(), or pass { entityId }."
        : undefined,
    });
  }
  const key = String(id);
  const list = registry.byEntity.get(key);
  if (list) list.push(callback);
  else registry.byEntity.set(key, [callback]);
}

/** @internal Remove this engine's contact callbacks for one entity. */
export function _clearContactCallbacks(entityId: bigint): void {
  contacts.peek(useEngine("Physics2DPlugin"))?.byEntity.delete(String(entityId));
}

/** @internal Drop every contact callback owned by `engine`. */
export function clearEngineContacts(engine: GwenEngine): void {
  const registry = contacts.peek(engine);
  if (!registry) return;
  registry.byEntity.clear();
  registry.setupEntityId = null;
}

/**
 * @internal Bind `onContact()` to the current engine's actor entity.
 */
export function _setCurrentContactEntityId(id: bigint | null): void {
  contacts.use().setupEntityId = id;
}
