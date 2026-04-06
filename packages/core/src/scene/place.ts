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

import { useEngine } from '../context.js';
import type { PlaceHandle, ActorDefinition } from './types.js';
import type { PrefabDefinition } from '../define-prefab.js';

// ─── Layout context ───────────────────────────────────────────────────────────

let _layoutEntities: bigint[] | null = null;

/**
 * Run `fn` inside an active layout context.
 * @internal Used by `defineLayout`.
 */
export function _withLayoutContext<T>(fn: () => T): { result: T; entities: bigint[] } {
  const prev = _layoutEntities;
  _layoutEntities = [];
  try {
    const result = fn();
    return { result, entities: _layoutEntities };
  } finally {
    _layoutEntities = prev;
  }
}

/**
 * Returns `true` if currently inside a `_withLayoutContext` call.
 * @internal
 */
export function _isInLayoutContext(): boolean {
  return _layoutEntities !== null;
}

function _register(entityId: bigint): void {
  _layoutEntities!.push(entityId);
}

// ─── WASM transform helpers ───────────────────────────────────────────────────

function applyTransform(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  bridge: any,
  entityId: bigint,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  options: PlaceOptions<any>,
): void {
  if (!bridge?.add_entity_transform) return;
  const [x = 0, y = 0] = options.at ?? [0, 0];
  const rotation = options.rotation ?? 0;
  const [sx, sy] = Array.isArray(options.scale)
    ? (options.scale as [number, number])
    : [options.scale ?? 1, options.scale ?? 1];
  const idx = Number(entityId) & 0xffffffff;
  bridge.add_entity_transform(idx, x, y, rotation, sx, sy);
  if (options.parent) {
    const parentIdx = Number(options.parent.entityId) & 0xffffffff;
    bridge.set_entity_parent(idx, parentIdx, false);
  }
}

// ─── PlaceOptions ─────────────────────────────────────────────────────────────

/**
 * Options shared by all placement composables.
 */
export interface PlaceOptions<Props = Record<string, unknown>> {
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
export function placeGroup(options: Omit<PlaceOptions, 'props'> = {}): PlaceHandle<void> {
  if (!_isInLayoutContext()) {
    throw new Error(
      '[GWEN] placeGroup() must be called inside a defineLayout() factory. ' +
        'See https://docs.gwen.sh/layouts for examples.',
    );
  }

  const engine = useEngine();
  const bridge = engine._getPlacementBridge();
  const entityId = engine.createEntity();
  applyTransform(bridge, entityId as unknown as bigint, options);
  _register(entityId as unknown as bigint);

  const handle: PlaceHandle<void> = {
    entityId: entityId as unknown as bigint,
    api: undefined as void,
    moveTo(pos) {
      const [x = 0, y = 0] = pos;
      bridge?.set_entity_local_position?.(Number(entityId) & 0xffffffff, x, y);
    },
    despawn() {
      engine.destroyEntity(entityId);
    },
  };

  return handle;
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
    throw new Error(
      '[GWEN] placeActor() must be called inside a defineLayout() factory. ' +
        'See https://docs.gwen.sh/layouts for examples.',
    );
  }

  const entityId = actorDef._plugin.spawn(options.props) as unknown as bigint;
  const bridge = useEngine()._getPlacementBridge();
  applyTransform(bridge, entityId, options);
  _register(entityId);

  const instance = actorDef._instances?.get(entityId);

  const handle: PlaceHandle<API> = {
    entityId,
    api: instance?.api as API,
    moveTo(pos) {
      const [x = 0, y = 0] = pos;
      bridge?.set_entity_local_position?.(Number(entityId) & 0xffffffff, x, y);
    },
    despawn() {
      actorDef._plugin.despawn(entityId);
    },
  };

  return handle;
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
export function placePrefab(
  prefabDef: PrefabDefinition,
  options: PlaceOptions<Record<string, unknown>> = {},
): PlaceHandle<void> {
  if (!_isInLayoutContext()) {
    throw new Error(
      '[GWEN] placePrefab() must be called inside a defineLayout() factory. ' +
        'See https://docs.gwen.sh/layouts for examples.',
    );
  }

  const engine = useEngine();
  const bridge = engine._getPlacementBridge();
  const id = engine.createEntity();

  for (const { def, defaults } of prefabDef.components ?? []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    engine.addComponent(id, def as any, { ...defaults, ...options.props });
  }

  const entityId = id as unknown as bigint;
  applyTransform(bridge, entityId, options);
  _register(entityId);

  const handle: PlaceHandle<void> = {
    entityId,
    api: undefined as void,
    moveTo(pos) {
      const [x = 0, y = 0] = pos;
      bridge?.set_entity_local_position?.(Number(entityId) & 0xffffffff, x, y);
    },
    despawn() {
      engine.destroyEntity(id);
    },
  };

  return handle;
}
