/**
 * @file RFC-005 — Composable-first system definition for @gwenjs/core
 *
 * Provides `defineSystem()` and the lifecycle composables (`onUpdate`, `onBeforeUpdate`,
 * `onAfterUpdate`, `onRender`) for writing game systems without class boilerplate.
 *
 * Systems register their lifecycle callbacks during a synchronous `setup()` phase.
 * Composables (`useEngine()`, `usePhysics2D()`, etc.) are resolved during setup
 * and remain available inside the registered callbacks.
 *
 * @example
 * ```typescript
 * export const playerSystem = defineSystem(() => {
 *   const input = useInput()         // resolved once at setup
 *   const physics = usePhysics2D()   // resolved once at setup
 *   const entities = useQuery([Position, PlayerTag])
 *
 *   onUpdate((dt) => {
 *     for (const e of entities) {
 *       if (input.keyboard.isDown('ArrowRight')) {
 *         physics.setLinearVelocity(e.id, { x: 200 * dt, y: 0 })
 *       }
 *     }
 *   })
 * })
 * ```
 */

import { useEngine } from './context.js';
import type { GwenPlugin, GwenProvides, WasmModuleHandle } from './engine/gwen-engine.js';
import type { EntityId } from './engine/engine-api.js';
import type { ComponentDefinition, ComponentSchema, InferComponent } from './schema.js';

/** A component selector accepted by {@link useQuery}. */
export type ComponentDef = ComponentDefinition<ComponentSchema>;

// ─── Internal types ──────────────────────────────────────────────────────────

/** A frame update callback receiving delta time in seconds. */
type UpdateFn = (dt: number) => void;

/** A render callback (no delta time — called every frame at render phase). */
type RenderFn = () => void;

/**
 * Context used internally by `defineSystem()` and `defineActor()` to collect
 * lifecycle registrations. Only valid while a setup function is executing.
 *
 * @internal
 */
export interface SystemContext {
  onBeforeUpdate(fn: UpdateFn): void;
  onUpdate(fn: UpdateFn): void;
  onAfterUpdate(fn: UpdateFn): void;
  onRender(fn: RenderFn): void;
}

// ─── Module-level context slot ───────────────────────────────────────────────

/** @internal Active system context — set during defineSystem setup, cleared after. */
let _currentSystemContext: SystemContext | null = null;

/**
 * Returns the active system registration context.
 *
 * @internal
 * @throws {Error} If called outside a `defineSystem()` (or `defineActor()`) setup function.
 */
export function _getSystemContext(): SystemContext {
  if (!_currentSystemContext) {
    throw new Error(
      '[GWEN] onUpdate/onRender/onBeforeUpdate/onAfterUpdate must be called ' +
        'inside a defineSystem() setup callback, not inside the lifecycle function itself.',
    );
  }
  return _currentSystemContext;
}

/**
 * Runs `fn` with `ctx` as the active system registration context, then restores
 * the previous context (supporting nested / re-entrant calls).
 *
 * Used internally by `defineSystem()` and `defineActor()` so that lifecycle
 * composables (`onUpdate`, `onRender`, etc.) resolve to the correct context.
 *
 * @internal
 * @param ctx - The {@link SystemContext} to activate for the duration of `fn`
 * @param fn  - The setup function to run inside the context
 *
 * @example
 * ```typescript
 * // Inside defineActor spawn():
 * _withSystemContext(ctx, () => factory(props))
 * ```
 */
export function _withSystemContext(ctx: SystemContext, fn: () => void): void {
  const previous = _currentSystemContext;
  _currentSystemContext = ctx;
  try {
    fn();
  } finally {
    _currentSystemContext = previous;
  }
}

// ─── Lifecycle composables ───────────────────────────────────────────────────

/**
 * Registers a callback to run every frame **before** the physics/WASM step.
 *
 * Must be called synchronously inside a {@link defineSystem} setup callback.
 *
 * @param fn - Callback receiving delta time in seconds
 *
 * @example
 * ```typescript
 * defineSystem(() => {
 *   onBeforeUpdate((dt) => {
 *     // runs before physics each frame
 *   })
 * })
 * ```
 */
export function onBeforeUpdate(fn: UpdateFn): void {
  _getSystemContext().onBeforeUpdate(fn);
}

/**
 * Registers a callback to run every frame **during** the update phase
 * (after the physics/WASM step).
 *
 * Must be called synchronously inside a {@link defineSystem} setup callback.
 *
 * @param fn - Callback receiving delta time in seconds
 *
 * @example
 * ```typescript
 * defineSystem(() => {
 *   onUpdate((dt) => {
 *     // main game logic here
 *   })
 * })
 * ```
 */
export function onUpdate(fn: UpdateFn): void {
  _getSystemContext().onUpdate(fn);
}

/**
 * Registers a callback to run every frame **after** the update phase.
 *
 * Must be called synchronously inside a {@link defineSystem} setup callback.
 *
 * @param fn - Callback receiving delta time in seconds
 *
 * @example
 * ```typescript
 * defineSystem(() => {
 *   onAfterUpdate((dt) => {
 *     // post-update cleanup or sync here
 *   })
 * })
 * ```
 */
export function onAfterUpdate(fn: UpdateFn): void {
  _getSystemContext().onAfterUpdate(fn);
}

/**
 * Registers a callback to run every frame during the **render** phase.
 * No delta time is provided — use for drawing operations only.
 *
 * Must be called synchronously inside a {@link defineSystem} setup callback.
 *
 * @param fn - Render callback
 *
 * @example
 * ```typescript
 * defineSystem(() => {
 *   onRender(() => {
 *     canvas.drawSprite(...)
 *   })
 * })
 * ```
 */
export function onRender(fn: RenderFn): void {
  _getSystemContext().onRender(fn);
}

// ─── defineSystem ─────────────────────────────────────────────────────────────

/**
 * Defines a game system using the composable pattern.
 *
 * The `setup` function runs **once** when the plugin is registered via `engine.use()`.
 * During setup the engine context is active — composables (`useEngine()`, plugin
 * composables, `useQuery()`) may be called to capture references used inside
 * the registered lifecycle callbacks.
 *
 * Returns a {@link GwenPlugin} that can be passed directly to `engine.use()`.
 *
 * @param setup - System setup function. Called once synchronously in engine context.
 * @returns A `GwenPlugin` representing the system.
 *
 * @example
 * ```typescript
 * export const moveSystem = defineSystem(function moveSystem() {
 *   // Composables resolved at setup time:
 *   const entities = useQuery([Position, Velocity])
 *
 *   // Lifecycle callbacks registered at setup time:
 *   onUpdate((dt) => {
 *     for (const e of entities) {
 *       const pos = e.get(Position)
 *       const vel = e.get(Velocity)
 *       e.set(Position, { x: pos.x + vel.vx * dt, y: pos.y + vel.vy * dt })
 *     }
 *   })
 * })
 * ```
 */
export function defineSystem(setup: () => void): GwenPlugin {
  const _beforeUpdate: UpdateFn[] = [];
  const _update: UpdateFn[] = [];
  const _afterUpdate: UpdateFn[] = [];
  const _render: RenderFn[] = [];

  return {
    name: (() => {
      if (!setup.name) {
        console.warn(
          '[GWEN] defineSystem() called with an anonymous function. ' +
            'This makes debugging and plugin deduplication difficult. ' +
            'Please use a named function: defineSystem(function mySystem() { ... })',
        );
        return 'anonymous-system';
      }
      return setup.name;
    })(),

    setup(_engine): void {
      // The engine context is already set by engine.use() wrapping.
      // Activate the system registration context and run the user's setup.
      const ctx: SystemContext = {
        onBeforeUpdate: (fn) => _beforeUpdate.push(fn),
        onUpdate: (fn) => _update.push(fn),
        onAfterUpdate: (fn) => _afterUpdate.push(fn),
        onRender: (fn) => _render.push(fn),
      };
      _withSystemContext(ctx, setup);
    },

    onBeforeUpdate(dt: number): void {
      for (let i = 0; i < _beforeUpdate.length; i++) _beforeUpdate[i]!(dt);
    },

    onUpdate(dt: number): void {
      for (let i = 0; i < _update.length; i++) _update[i]!(dt);
    },

    onAfterUpdate(dt: number): void {
      for (let i = 0; i < _afterUpdate.length; i++) _afterUpdate[i]!(dt);
    },

    onRender(): void {
      for (let i = 0; i < _render.length; i++) _render[i]!();
    },
  };
}

// ─── useQuery ─────────────────────────────────────────────────────────────────

/**
 * Provides read access to a single entity's components during query iteration.
 *
 * Returned by {@link useQuery} on each iteration step. The accessor is valid only
 * for the duration of the current iteration — do not cache it across frames.
 *
 * @example
 * ```typescript
 * onUpdate(() => {
 *   for (const e of entities) {
 *     const pos = e.get(Position)
 *     if (pos) console.log(e.id, pos.x, pos.y)
 *   }
 * })
 * ```
 */
export interface EntityAccessor {
  /** The entity's unique ID. */
  readonly id: EntityId;
  /**
   * Retrieve the current component data for the given definition.
   *
   * @param def - The component definition to look up
   * @returns The component data, or `undefined` if the entity does not have it
   */
  get<S extends ComponentSchema, D extends ComponentDefinition<S>>(
    def: D,
  ): InferComponent<D> | undefined;
}

/**
 * A live query result — an iterable of entity accessors.
 * Returned by {@link useQuery} inside a {@link defineSystem} setup callback.
 *
 * The iterable is re-evaluated each time you iterate, reflecting the current
 * ECS state at that moment.
 *
 * @typeParam T - Entity accessor type (defaults to {@link EntityAccessor})
 */
export type LiveQuery<T = EntityAccessor> = Iterable<T>;

/**
 * Defines a reactive entity query inside a {@link defineSystem} setup callback.
 *
 * The returned iterable reflects the current ECS state at each iteration —
 * entities that match all supplied component definitions at the time you iterate.
 *
 * @param components - List of component definitions to match
 * @returns A live query iterable of {@link EntityAccessor} objects
 *
 * @throws {GwenContextError} If called outside an active engine context
 *
 * @example
 * ```typescript
 * defineSystem(() => {
 *   const enemies = useQuery([Position, EnemyTag])
 *
 *   onUpdate(() => {
 *     for (const entity of enemies) {
 *       // reflects current ECS state at each iteration
 *       const pos = entity.get(Position)
 *     }
 *   })
 * })
 * ```
 */
export function useQuery(components: ComponentDef[]): LiveQuery {
  const engine = useEngine();
  return engine.createLiveQuery(components);
}

// ─── useService ───────────────────────────────────────────────────────────────

/**
 * Resolves a service registered via {@link GwenEngine.provide} inside the current engine context.
 *
 * This composable is the primary way to access plugin services from within a
 * {@link defineSystem} setup callback. Plugin packages extend the {@link GwenProvides}
 * interface via declaration merging to expose fully-typed, zero-cast service keys.
 *
 * Two call signatures are supported:
 * - **Typed** — when the key is declared in `GwenProvides` via declaration merging,
 *   the return type is inferred automatically (no cast needed).
 * - **Generic fallback** — pass a plain `string` and supply a type parameter `T`
 *   for cases where the plugin has not yet declared its key.
 *
 * @typeParam K - A key of the augmented {@link GwenProvides} map (typed overload)
 * @param key - The service key as registered with `engine.provide(key, value)`
 * @returns The service registered under `key`
 *
 * @throws {GwenContextError} If called outside an active engine context
 * @throws {GwenPluginNotFoundError} If no service has been registered under `key`
 *
 * @example
 * ```typescript
 * // 1. Plugin extends GwenProvides (declaration merging):
 * declare module '@gwenjs/core' {
 *   interface GwenProvides {
 *     physics2d: Physics2DAPI
 *   }
 * }
 *
 * // 2. Plugin registers the service during setup:
 * engine.provide('physics2d', physicsAPI)
 *
 * // 3. System resolves at setup time — fully typed, no cast:
 * export const movementSystem = defineSystem(() => {
 *   const physics = useService('physics2d') // inferred as Physics2DAPI
 *
 *   onUpdate((dt) => {
 *     physics.step(dt)
 *   })
 * })
 * ```
 *
 * @example
 * ```typescript
 * // Generic fallback when GwenProvides is not yet augmented:
 * const myService = useService<MyServiceAPI>('my-service')
 * ```
 */
export function useService<K extends keyof GwenProvides>(key: K): GwenProvides[K];
export function useService<T = unknown>(key: string): T;
export function useService(key: string): unknown {
  return useEngine().inject(key as keyof GwenProvides);
}

// ─── useWasmModule ────────────────────────────────────────────────────────────

/**
 * Returns the handle for a WASM module loaded via the engine.
 *
 * In most cases you should use the plugin's composable (e.g. `usePhysics2D()`)
 * instead of this low-level accessor.
 *
 * @param name - The module name as registered with the engine
 * @returns The WASM module exports
 * @throws {GwenContextError} If called outside an active engine context
 *
 * @example
 * ```typescript
 * const wasm = useWasmModule<PathfinderExports>('pathfinder')
 * wasm.exports.findPath(fromX, fromY, toX, toY)
 * ```
 */
export function useWasmModule<Exports extends WebAssembly.Exports = WebAssembly.Exports>(
  name: string,
): WasmModuleHandle<Exports> {
  const engine = useEngine();
  return engine.getWasmModule<Exports>(name);
}
