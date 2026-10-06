/**
 * @file onContact() — subscribes to collision events for one actor entity.
 */
import { GwenContextError, useEngine, createEngineLocal } from "@gwenjs/core";
import type { GwenEngine } from "@gwenjs/core";
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
  const cbs = contacts.peek(useEngine())?.byEntity.get(String(entityId));
  if (!cbs) return;
  for (const cb of cbs) cb(event);
}

/**
 * Subscribes to collision contact events for the current actor entity.
 *
 * Events are dispatched once per frame after the physics step.
 * Pass `entityId` explicitly in tests. Inside an actor factory the id is the
 * one stored for this engine.
 *
 * @throws {GwenContextError} `CORE:OUTSIDE_ENGINE_CONTEXT` when no engine is current.
 * @throws {GwenContextError} `ACTOR_SETUP_ONLY` when neither an actor nor `entityId` is set.
 */
export function onContact(callback: (contact: ContactEvent) => void, entityId?: bigint): void {
  const engine = useEngine();
  const registry = contacts.get(engine);
  const id = entityId ?? registry.setupEntityId;
  if (id === null) {
    throw new GwenContextError(
      "[GWEN] onContact() must run inside an actor factory, or be given an entityId.",
      "ACTOR_SETUP_ONLY",
    );
  }
  const key = String(id);
  const list = registry.byEntity.get(key);
  if (list) list.push(callback);
  else registry.byEntity.set(key, [callback]);
}

/** @internal Remove this engine's contact callbacks for one entity. */
export function _clearContactCallbacks(entityId: bigint): void {
  contacts.peek(useEngine())?.byEntity.delete(String(entityId));
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
