/**
 * @file Layout placement composables — `placeActor`, `placeGroup`, `placePrefab`.
 *
 * These composables are only valid inside a `defineLayout()` factory. They register
 * each placed entity with the active layout context so `LayoutHandle.dispose()` can
 * bulk-destroy all owned entities in a single WASM call.
 *
 * Architecture:
 * - `_withLayoutContext(fn)` sets a module-level context used by all composables.
 * - `_isInLayoutContext()` guards public composables; they throw if called outside.
 * - Each `place*` composable calls the appropriate spawn method then registers the
 *   entity ID with the active context.
 *
 * @example
 * ```typescript
 * export const MyLayout = defineLayout(() => {
 *   const player = placeActor(PlayerActor, { at: [0, 0], props: { hp: 100 } })
 *   const group  = placeGroup({ at: [200, 0] })
 *   const tile   = placePrefab(TilePrefab, { at: [0, 0], parent: group })
 *   return { player }
 * })
 * ```
 */

import { useEngine } from "../../engine/context";
import { getWasmBridge, WasmBridgeImpl } from "../../engine/wasm-bridge";
import type { PlaceHandle, ActorDefinition } from "./types";
import type { PrefabDefinition, PrefabOverrides } from "./define-prefab";
import type { ComponentDef } from "../../system/runtime/define-system";
import type { EntityId } from "../../engine/engine-api";
import { entityIndex } from "../../engine/engine-api";
import { spawnActor } from "./spawn-tuple";
import type { PlacementBridge } from "../../engine/engine-types";
import { ContextSlot } from "../../engine/context-slot";
import { GwenComposableError, ComposableErrorCodes } from "../../engine/engine-errors";

// ─── Layout context ───────────────────────────────────────────────────────────

/** State of the layout being built. `queue` is set only for a deferred (progressive) load. */
interface LayoutContext {
  readonly entities: EntityId[];
  readonly queue: Array<() => void> | undefined;
  /** Records an entity id as soon as it exists. Built once per layout, not per `place*` call. */
  readonly register: (entityId: EntityId) => void;
}

const _layoutCtx = new ContextSlot<LayoutContext>();

/**
 * Run `fn` inside an active layout context.
 *
 * Immediate (default): each `place*` call spawns at once and its entity id lands in `entities`.
 * Deferred: each `place*` call records its spawn in `queue` (call order) and returns a handle
 * that is usable once that spawn has run. `entities` fills as the queued spawns run.
 *
 * @internal Used by `useLayout`.
 */
export function _withLayoutContext<T>(
  fn: () => T,
  options: { deferred?: boolean; entities?: EntityId[] } = {},
): { result: T; entities: EntityId[]; queue: Array<() => void> | undefined } {
  // The caller may pass `entities` so it still owns them when `fn` throws.
  const entities: EntityId[] = options.entities ?? [];
  const queue: Array<() => void> | undefined = options.deferred ? [] : undefined;
  const register = (entityId: EntityId): void => {
    entities.push(entityId);
  };
  const result = _layoutCtx.run({ entities, queue, register }, fn);
  return { result, entities, queue };
}

/**
 * Returns `true` if currently inside a `_withLayoutContext` call.
 * @internal
 */
export function _isInLayoutContext(): boolean {
  return _layoutCtx.isActive();
}

/**
 * Spawn now (immediate layout) or record the spawn (deferred layout).
 *
 * `build` calls `register` as soon as the entity exists, so an entity whose later setup
 * throws is already owned by the layout and gets destroyed with it.
 *
 * A deferred handle throws a coded error when read before its spawn has run.
 */
function _place<API>(
  build: (register: (entityId: EntityId) => void) => PlaceHandle<API>,
): PlaceHandle<API> {
  const ctx = _layoutCtx.get()!;
  const queue = ctx.queue;
  if (queue === undefined) {
    return build(ctx.register);
  }

  let spawned: PlaceHandle<API> | undefined;
  const spawnedHandle = (member: string): PlaceHandle<API> => {
    if (spawned === undefined) {
      throw new GwenComposableError(
        ComposableErrorCodes.LAYOUT_HANDLE_NOT_SPAWNED,
        `[GWEN] "${member}" of a layout handle was read before its entity was spawned. ` +
          "With useLayout({ chunkSize }) entities spawn one chunk per frame, after the layout " +
          "factory returns. Read handles after load() resolves, or pass them only as `parent` " +
          "to entities placed after them.",
      );
    }
    return spawned;
  };
  queue.push(() => {
    spawned = build(ctx.register);
  });
  return {
    get entityId() {
      return spawnedHandle("entityId").entityId;
    },
    get api() {
      return spawnedHandle("api").api;
    },
    moveTo(pos) {
      spawnedHandle("moveTo()").moveTo(pos);
    },
    despawn() {
      spawnedHandle("despawn()").despawn();
    },
  };
}

// ─── WASM transform helpers ───────────────────────────────────────────────────

/**
 * Apply transform options (position, rotation, scale, parent) to an entity.
 * Registers the entity in the TransformSystem if any option is provided.
 * @internal Used by `placeActor`, `placeGroup`, `placePrefab`, and `useChildren`.
 */
export function _applyTransformOpts(
  bridge: PlacementBridge,
  entityId: EntityId,
  options: PlaceOptions<unknown>,
): void {
  const [x = 0, y = 0] = options.at ?? [0, 0];
  const rotation = options.rotation ?? 0;
  const [sx, sy] = Array.isArray(options.scale)
    ? (options.scale as [number, number])
    : [options.scale ?? 1, options.scale ?? 1];
  const idx = entityIndex(entityId);
  bridge.add_entity_transform(idx, x, y, rotation, sx, sy);
  if (options.parent) {
    const parentIdx = entityIndex(options.parent.entityId);
    const owner = getWasmBridge();
    if (
      owner instanceof WasmBridgeImpl &&
      owner.isActive() &&
      owner.engine() === (bridge as unknown)
    ) {
      owner.setEntityParent(idx, parentIdx, false);
    } else {
      bridge.set_entity_parent(idx, parentIdx, false);
    }
  }
}

// ─── PlaceOptions ─────────────────────────────────────────────────────────────

/**
 * Options shared by all placement composables.
 */
export interface PlaceOptions<Props> {
  /** Local position `[x, y]` or `[x, y, z]`. @default [0, 0] */
  at?: [number, number] | [number, number, number];
  /** Local rotation in radians. @default 0 */
  rotation?: number;
  /** Uniform scale or `[scaleX, scaleY]`. @default 1 */
  scale?: number | [number, number];
  /** Parent handle — this entity's position is relative to the parent's world transform. */
  parent?: PlaceHandle<unknown>;
  /** Props forwarded to the actor or prefab at spawn time. */
  props?: Props;
}

// ─── placeGroup ───────────────────────────────────────────────────────────────

/**
 * Spawn a transform-only group entity — a virtual anchor with no visual representation.
 *
 * @throws {Error} If called outside a `defineLayout()` factory.
 * @example
 * ```typescript
 * const MyLayout = defineLayout(() => {
 *   const group = placeGroup({ at: [100, 200] })
 *   return { group }
 * })
 * ```
 */
export function placeGroup(options: Omit<PlaceOptions<unknown>, "props"> = {}): PlaceHandle<void> {
  if (!_isInLayoutContext()) {
    throw new GwenComposableError(
      ComposableErrorCodes.OUTSIDE_LAYOUT_CONTEXT,
      "[GWEN] placeGroup() must be called inside a defineLayout() factory. " +
        "See https://docs.gwen.sh/layouts for examples.",
    );
  }

  const engine = useEngine();
  return _place<void>((register) => {
    const bridge = engine.getPlacementBridge();
    const entityId = engine.createEntity();
    register(entityId);
    _applyTransformOpts(bridge, entityId, options);
    return {
      entityId,
      api: undefined,
      moveTo(pos) {
        const [x = 0, y = 0] = pos;
        bridge.set_entity_local_position(entityIndex(entityId), x, y);
      },
      despawn() {
        engine.destroyEntity(entityId);
      },
    };
  });
}

// ─── placeActor ───────────────────────────────────────────────────────────────

/**
 * Spawn an actor and return a typed handle with access to the actor's public API.
 *
 * @throws {Error} If called outside a `defineLayout()` factory.
 * @example
 * ```typescript
 * const MyLayout = defineLayout(() => {
 *   const player = placeActor(PlayerActor, { at: [0, 0], props: { hp: 100 } })
 *   return { player }
 * })
 * ```
 */
export function placeActor<Props, API>(
  actorDef: ActorDefinition<Props, API>,
  options: PlaceOptions<Props> = {},
): PlaceHandle<API> {
  if (!_isInLayoutContext()) {
    throw new GwenComposableError(
      ComposableErrorCodes.OUTSIDE_LAYOUT_CONTEXT,
      "[GWEN] placeActor() must be called inside a defineLayout() factory. " +
        "See https://docs.gwen.sh/layouts for examples.",
    );
  }

  const engine = useEngine();
  return _place<API>((register) => {
    const entityId = spawnActor(actorDef._plugin, options.props);
    register(entityId);
    const bridge = engine.getPlacementBridge();
    _applyTransformOpts(bridge, entityId, options);

    const instance = actorDef._instances?.get(entityId);

    return {
      entityId,
      api: instance?.api as API,
      moveTo(pos) {
        const [x = 0, y = 0] = pos;
        bridge.set_entity_local_position(entityIndex(entityId), x, y);
      },
      despawn() {
        actorDef._plugin.despawn(entityId);
      },
    };
  });
}

// ─── placePrefab ──────────────────────────────────────────────────────────────

/**
 * Spawn a prefab entity with optional value overrides.
 *
 * @throws {Error} If called outside a `defineLayout()` factory.
 * @example
 * ```typescript
 * const MyLayout = defineLayout(() => {
 *   const tile = placePrefab(TilePrefab, { at: [0, 0] })
 *   return { tile }
 * })
 * ```
 */
export function placePrefab<E extends readonly ComponentDef[]>(
  prefabDef: PrefabDefinition<E>,
  options: PlaceOptions<PrefabOverrides<E>> = {},
): PlaceHandle<void> {
  if (!_isInLayoutContext()) {
    throw new GwenComposableError(
      ComposableErrorCodes.OUTSIDE_LAYOUT_CONTEXT,
      "[GWEN] placePrefab() must be called inside a defineLayout() factory. " +
        "See https://docs.gwen.sh/layouts for examples.",
    );
  }

  const engine = useEngine();
  return _place<void>((register) => {
    const bridge = engine.getPlacementBridge();
    const entityId = engine.createEntity();
    register(entityId);

    for (const entry of prefabDef.components) {
      engine.addComponent(entityId, entry.def, { ...entry.defaults, ...options.props });
    }

    _applyTransformOpts(bridge, entityId, options);

    return {
      entityId,
      api: undefined,
      moveTo(pos) {
        const [x = 0, y = 0] = pos;
        bridge.set_entity_local_position(entityIndex(entityId), x, y);
      },
      despawn() {
        engine.destroyEntity(entityId);
      },
    };
  });
}
