/**
 * @file `useTransform()` — ergonomic transform composable for actors.
 *
 * ## Architecture: two-phase transform pipeline
 *
 * The WASM TransformSystem uses a **write-local / read-world** model:
 *
 * ### Phase 1 — local writes (any time during the frame)
 * - `translate_entity(idx, dx, dy)` — adds a delta to local position
 * - `set_entity_local_position(idx, x, y)` — sets local position absolutely
 * - `set_entity_local_rotation(idx, angle)` — sets local rotation
 * - `set_entity_local_scale(idx, sx, sy)` — sets local scale
 *
 * None of these update world transforms immediately.
 *
 * ### Registration prerequisite
 * Before any write or read can work, the entity **must** be registered in
 * the TransformSystem via `add_entity_transform(idx, x, y, rot, sx, sy)`.
 * Without this call, all bridge functions are silent no-ops.
 * `useTransform()` handles this registration automatically at spawn time.
 *
 * ### Phase 2 — world propagation (once per frame, phase 5 of `_runFrame`)
 * `update_transforms()` walks the parent-child hierarchy and propagates
 * local→world values. Only after this call do `get_entity_world_x/y/rotation`
 * return up-to-date values.
 *
 * ### Frame loop order
 * ```
 * onBeforeUpdate  → user logic (reads world from previous frame)
 * physics step    → physics integration
 * update_transforms() ← phase 5: propagates local→world
 * onUpdate        → user logic (reads current-frame world values,
 *                              writes local via translate/setPosition)
 * onAfterUpdate / onRender
 * ```
 *
 * ### Consequence for onUpdate
 * `world.x/y` read inside `onUpdate` reflects the state AFTER the previous
 * frame's writes (not the writes done in the same `onUpdate` call). This
 * is a one-frame lag, identical to most game engines. For immediate feedback,
 * track position separately in a component.
 *
 * @example
 * ```typescript
 * const KartActor = defineActor(KartPrefab, () => {
 *   const t = useTransform()
 *   onUpdate((dt) => {
 *     t.translate(velocity.x * dt, velocity.y * dt)
 *     html.syncWorldPosition(t.world.x, t.world.y)  // one frame behind translate
 *   })
 * })
 * ```
 */

import { _getActorEntityId, _getActorEngine } from "./define-actor";
import { getWasmBridge, WasmBridgeImpl } from "../../engine/wasm-bridge";
import { GwenComposableError, ComposableErrorCodes } from "../../engine/engine-errors";
import { entityIndex, type EntityId } from "../../engine/engine-api";

/** Sentinel index passed to `set_entity_parent` to signal "detach from parent". */
const DETACH_SENTINEL = 0xffffffff;

/**
 * Returns a `TransformHandle` for reading and writing the current actor's transform.
 *
 * Must be called synchronously inside a `defineActor()` factory.
 *
 * @throws {Error} If called outside an active actor spawn context.
 *
 * @example
 * ```typescript
 * const Actor = defineActor(Prefab, () => {
 *   const t = useTransform()
 *   onUpdate((dt) => {
 *     t.translate(velocity.x * dt, velocity.y * dt)
 *   })
 *   return {}
 * })
 * ```
 */
export function useTransform(): TransformHandle {
  let entityId: EntityId;
  let idx: number;

  try {
    entityId = _getActorEntityId();
    _getActorEngine(); // Verify we're in actor context
    idx = entityIndex(entityId);
  } catch {
    throw new GwenComposableError(
      ComposableErrorCodes.OUTSIDE_ACTOR_CONTEXT,
      "[GWEN] useTransform() must be called synchronously inside a defineActor() factory. " +
        "Use it to capture the entity ID and engine reference at actor spawn time.",
    );
  }

  const bridgeOwner = getWasmBridge();
  const bridge = bridgeOwner.engine();
  const parentBridge = bridgeOwner instanceof WasmBridgeImpl ? bridgeOwner : null;

  // Register the entity in the WASM TransformSystem if not already present.
  // Without this call, translate_entity / get_entity_world_x are no-ops.
  bridge.add_entity_transform?.(idx, 0, 0, 0, 1, 1);

  // Stable world-transform view — created once per actor spawn, not on every
  // `transform.world` access. Getter functions close over `bridge` and `idx`
  // exactly like the other methods, so WASM reads happen lazily on property access.
  const world = Object.freeze({
    get x() {
      return (bridge.get_entity_world_x?.(idx) as number) ?? 0;
    },
    get y() {
      return (bridge.get_entity_world_y?.(idx) as number) ?? 0;
    },
    get z() {
      return 0;
    },
    get rotation() {
      return (bridge.get_entity_world_rotation?.(idx) as number) ?? 0;
    },
    get scaleX() {
      return 1;
    },
    get scaleY() {
      return 1;
    },
  });

  return {
    translate(dx, dy) {
      bridge.translate_entity?.(idx, dx, dy ?? 0);
    },

    setPosition(x, y) {
      bridge.set_entity_local_position?.(idx, x, y ?? 0);
    },

    rotateTo(angle) {
      bridge.set_entity_local_rotation?.(idx, angle);
    },

    rotate(delta) {
      const current = (bridge.get_entity_local_rotation?.(idx) as number) ?? 0;
      bridge.set_entity_local_rotation?.(idx, current + delta);
    },

    scaleTo(sx, sy) {
      bridge.set_entity_local_scale?.(idx, sx, sy ?? sx);
    },

    get world() {
      return world;
    },

    get hasParent() {
      return (bridge.has_entity_parent?.(idx) as boolean) ?? false;
    },

    setParent(handleOrId, keepWorldPos = false) {
      const parentId = typeof handleOrId === "bigint" ? handleOrId : handleOrId.entityId;
      const parentIndex = entityIndex(parentId);
      if (parentBridge) {
        parentBridge.setEntityParent(idx, parentIndex, keepWorldPos);
        return;
      }
      bridge.set_entity_parent(idx, parentIndex, keepWorldPos);
    },

    detach(keepWorldPos = false) {
      if (!bridge.set_entity_parent) return;
      if (parentBridge) {
        parentBridge.setEntityParent(idx, DETACH_SENTINEL, keepWorldPos);
        return;
      }
      bridge.set_entity_parent(idx, DETACH_SENTINEL, keepWorldPos);
    },
  };
}

/**
 * Handle returned by `useTransform()`.
 *
 * Provides ergonomic access to entity transform operations via the WASM bridge.
 */
export interface TransformHandle {
  /** Move entity by (dx, dy) — single WASM call. */
  translate(dx: number, dy: number): void;
  /** Set local position to absolute (x, y). */
  setPosition(x: number, y: number): void;
  /** Set local rotation to `angle` radians. */
  rotateTo(angle: number): void;
  /** Add `delta` radians to local rotation. */
  rotate(delta: number): void;
  /** Set local scale. `sy` defaults to `sx` if omitted. */
  scaleTo(sx: number, sy?: number): void;
  /** World transform values — updated each frame by `update_transforms()`. */
  readonly world: {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly rotation: number;
    readonly scaleX: number;
    readonly scaleY: number;
  };
  /** True if this entity has a parent in the TransformSystem. */
  readonly hasParent: boolean;
  /** Set a new parent. */
  setParent(handleOrId: { entityId: EntityId } | EntityId, keepWorldPos?: boolean): void;
  /** Detach from parent, becoming a root entity. */
  detach(keepWorldPos?: boolean): void;
}
