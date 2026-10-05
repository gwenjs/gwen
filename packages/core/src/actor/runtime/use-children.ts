/**
 * @file `useChildren()` — actor ownership composable.
 *
 * Registers owned child actors on the current actor. Children are automatically
 * despawned (or released if pooled) when the parent is despawned or released.
 *
 * @example
 * ```ts
 * export const PlayerActor = defineActor(PlayerPrefab, () => {
 *   const children = useChildren()
 *
 *   onStart(() => {
 *     children.add(WeaponActor, { props: { damage: 10 } })
 *   })
 * })
 * ```
 */

import type { ActorDefinition, PlaceHandle } from "./types";
import type { EntityId } from "../../engine/engine-api";
import { entityIndex } from "../../engine/engine-api";
import {
  GwenComposableError,
  GwenActorError,
  ComposableErrorCodes,
  ActorErrorCodes,
} from "../../engine/engine-errors";
import { _getActorContext } from "./define-actor";
import { _applyTransformOpts } from "./place";
import type { PlaceOptions } from "./place";
import { _actorRegistry, _instanceRegistry, _ownerRegistry } from "./define-actor";

// ─── Public types ─────────────────────────────────────────────────────────────

/**
 * Handle returned by `useChildren()`. Manages the ownership of child actors
 * spawned or adopted by the current actor.
 */
export interface ChildrenHandle {
  /**
   * Spawn an actor definition and take ownership of the resulting instance.
   * The child is despawned (or released if pooled) when the parent is despawned
   * or released back to its pool.
   *
   * @param def - The actor definition to spawn.
   * @param opts - Optional placement options (position, rotation, scale, parent transform, props).
   * @returns A typed PlaceHandle for the spawned child.
   */
  add<Props, API>(def: ActorDefinition<Props, API>, opts?: PlaceOptions<Props>): PlaceHandle<API>;

  /**
   * Take ownership of an already-spawned actor handle.
   * If the handle is already owned by another parent, ownership is transferred
   * and a dev warning is emitted.
   *
   * @param handle - An existing PlaceHandle to adopt.
   * @throws {GwenActorError} If adopting would create a circular ownership chain.
   */
  adopt<API>(handle: PlaceHandle<API>): void;

  /**
   * Release ownership of a child without destroying it.
   * The child continues to live independently after the parent is despawned.
   *
   * @param handle - The child handle to detach.
   */
  detach<API>(handle: PlaceHandle<API>): void;

  /**
   * Read-only view of all currently owned child handles.
   */
  readonly all: ReadonlySet<PlaceHandle<unknown>>;
}

// ─── Circular ownership detection ─────────────────────────────────────────────

/**
 * Returns true if `candidate` is an ancestor of `of` in the live ownership chain.
 * Only traverses live entities (present in `_instanceRegistry`) to avoid false
 * positives from stale entries across engine lifetimes.
 */
function _isAncestor(candidate: EntityId, of: EntityId): boolean {
  let current: EntityId | undefined = of;
  while (current !== undefined) {
    // Only follow the ownership link if the current entity is actually alive.
    if (!_instanceRegistry.has(current)) break;
    const ownerId = _ownerRegistry.get(current);
    if (ownerId === candidate) return true;
    current = ownerId;
  }
  return false;
}

// ─── useChildren ──────────────────────────────────────────────────────────────

/**
 * Register an ownership scope for the current actor.
 * Children added via the returned handle are automatically despawned or released
 * when this actor is despawned or released back to its pool.
 *
 * Must be called inside a `defineActor()` factory. Throws `GwenComposableError`
 * if called outside an actor context.
 *
 * @returns A ChildrenHandle to manage owned children.
 * @throws {GwenComposableError} If called outside an actor factory.
 *
 * @example
 * ```ts
 * export const PlayerActor = defineActor(PlayerPrefab, () => {
 *   const children = useChildren()
 *
 *   onStart(() => {
 *     // Spawn + own in one call
 *     const weapon = children.add(WeaponActor, { props: { damage: 10 } })
 *
 *     // Adopt an existing actor (e.g. picked up from the ground)
 *     children.adopt(droppedWeaponHandle)
 *
 *     // Detach without destroying (e.g. player drops the weapon)
 *     children.detach(weapon)
 *   })
 * })
 * ```
 */
export function useChildren(): ChildrenHandle {
  const ctx = _getActorContext();
  if (!ctx) {
    throw new GwenComposableError(
      ComposableErrorCodes.OUTSIDE_ACTOR_CONTEXT,
      `[GWEN] useChildren() must be called inside a defineActor() factory function. Code: ${ComposableErrorCodes.OUTSIDE_ACTOR_CONTEXT}`,
    );
  }

  const { instance, engine } = ctx;
  if (!instance._children) instance._children = new Set();
  const owned: Set<EntityId> = instance._children;
  const parentId: EntityId = instance.entityId;

  const _handles = new Map<EntityId, PlaceHandle<unknown>>();

  function _registerOwnership(childId: EntityId): void {
    const existingOwnerId = _ownerRegistry.get(childId);
    if (existingOwnerId !== undefined && existingOwnerId !== parentId) {
      if (__GWEN_DEV__) {
        engine.logger
          .child("gwen:children")
          .warn(
            `Actor ${String(childId)} adopted — ownership transferred from parent ${String(existingOwnerId)}`,
          );
      }
      const prevOwnerInstance = _instanceRegistry.get(existingOwnerId);
      prevOwnerInstance?._children?.delete(childId);
    }
    owned.add(childId);
    _ownerRegistry.set(childId, parentId);
  }

  return {
    add<Props, API>(
      def: ActorDefinition<Props, API>,
      opts: PlaceOptions<Props> = {},
    ): PlaceHandle<API> {
      const entityId = def._plugin.spawn(
        ...((opts.props === undefined ? [] : [opts.props]) as Props extends void
          ? []
          : [props: Props]),
      );

      if (
        opts.at !== undefined ||
        opts.rotation !== undefined ||
        opts.scale !== undefined ||
        opts.parent !== undefined
      ) {
        const bridge = engine.getPlacementBridge();
        _applyTransformOpts(bridge, entityId, opts);
      }

      _registerOwnership(entityId);

      const inst = def._instances.get(entityId);
      const handle: PlaceHandle<API> = {
        entityId,
        api: inst?.api as API,
        moveTo(pos) {
          const [x = 0, y = 0] = pos;
          engine.getPlacementBridge().set_entity_local_position(entityIndex(entityId), x, y);
        },
        despawn() {
          def._plugin.despawn(entityId);
        },
      };
      _handles.set(entityId, handle as PlaceHandle<unknown>);
      return handle;
    },

    adopt<API>(handle: PlaceHandle<API>): void {
      if (handle === null || handle === undefined) {
        throw new GwenActorError(
          ActorErrorCodes.CIRCULAR_OWNERSHIP,
          `[GWEN] useChildren().adopt(): circular ownership detected — actor ${String(parentId)} cannot adopt a null/undefined handle. Code: ${ActorErrorCodes.CIRCULAR_OWNERSHIP}`,
        );
      }

      const childId = handle.entityId;

      if (childId === parentId || _isAncestor(childId, parentId)) {
        throw new GwenActorError(
          ActorErrorCodes.CIRCULAR_OWNERSHIP,
          `[GWEN] useChildren().adopt(): circular ownership detected — actor ${String(childId)} is an ancestor of ${String(parentId)}. Code: ${ActorErrorCodes.CIRCULAR_OWNERSHIP}`,
        );
      }

      _registerOwnership(childId);
      _handles.set(childId, handle as PlaceHandle<unknown>);
    },

    detach<API>(handle: PlaceHandle<API>): void {
      const childId = handle.entityId;
      if (!owned.has(childId)) {
        if (__GWEN_DEV__) {
          engine.logger
            .child("gwen:children")
            .warn(
              `[gwen:children] Attempted to detach actor ${String(childId)} that is not owned by this parent.`,
            );
        }
        return;
      }
      owned.delete(childId);
      _ownerRegistry.delete(childId);
      _handles.delete(childId);
    },

    get all(): ReadonlySet<PlaceHandle<unknown>> {
      return new Set(_handles.values()) as ReadonlySet<PlaceHandle<unknown>>;
    },
  };
}
