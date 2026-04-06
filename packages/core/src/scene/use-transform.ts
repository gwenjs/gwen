/**
 * @file `useTransform()` — ergonomic transform composable for actors.
 *
 * Provides local read/write helpers and world transform reads for the current
 * actor's entity. Must be called synchronously inside a `defineActor()` factory.
 *
 * @example
 * ```typescript
 * const KartActor = defineActor(KartPrefab, () => {
 *   const t = useTransform()
 *   onUpdate((dt) => {
 *     t.translate(velocity.x * dt, velocity.y * dt)
 *     t.rotateTo(heading)
 *   })
 * })
 * ```
 */

import { _getActorEntityId, _getActorEngine } from './define-actor.js';
import { getWasmBridge } from '../engine/wasm-bridge.js';

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
  let entityId: bigint;
  let idx: number;

  try {
    entityId = _getActorEntityId();
    _getActorEngine(); // Verify we're in actor context
    idx = Number(entityId) & 0xffffffff;
  } catch {
    throw new Error(
      '[GWEN] useTransform() must be called synchronously inside a defineActor() factory. ' +
        'Use it to capture the entity ID and engine reference at actor spawn time.',
    );
  }

  const bridge = getWasmBridge().engine();

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
      return {
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
      };
    },

    get hasParent() {
      return (bridge.has_entity_parent?.(idx) as boolean) ?? false;
    },

    setParent(handleOrId, keepWorldPos = false) {
      const parentId =
        typeof handleOrId === 'bigint' ? handleOrId : (handleOrId as { entityId: bigint }).entityId;
      bridge.set_entity_parent?.(idx, Number(parentId) & 0xffffffff, keepWorldPos);
    },

    detach(keepWorldPos = false) {
      bridge.set_entity_parent?.(idx, DETACH_SENTINEL, keepWorldPos);
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
  setParent(handleOrId: { entityId: bigint } | bigint, keepWorldPos?: boolean): void;
  /** Detach from parent, becoming a root entity. */
  detach(keepWorldPos?: boolean): void;
}
