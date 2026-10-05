/**
 * Plugin contract and minimal engine interface for GWEN.
 *
 * Defined in `@gwenjs/schema` so `@gwenjs/kit` can reference `GwenPlugin`
 * without depending on `@gwenjs/core`, eliminating the future circular
 * dependency risk when built-in modules (actor, system, scene) are extracted
 * from core into kit-authored GwenModules.
 *
 * The full `GwenEngine` interface in `@gwenjs/core` extends `GwenEngineBase`.
 *
 * @module
 */

import type { IGwenLogger } from "./logger-structured.js";
import type { DisposableRegistryBase } from "./disposable.js";

/**
 * Extensible map of all GWEN runtime hook event names to their handler signatures.
 *
 * Populated by declaration merging. Core engine hooks are added by `@gwenjs/core`.
 * Plugin packages add their own hooks the same way:
 *
 * ```ts
 * declare module "@gwenjs/schema" {
 *   interface GwenRuntimeHooks {
 *     "my-plugin:event": (payload: MyPayload) => void;
 *   }
 * }
 * ```
 */
export interface GwenRuntimeHooks {}

/**
 * Minimal hook bus surface exposed to plugins via `GwenEngineBase.hooks`.
 *
 * The full `Hookable<GwenRuntimeHooks>` in `@gwenjs/core` satisfies this
 * interface structurally — no explicit `extends` needed.
 *
 * Callback types come from `GwenRuntimeHooks`. An event name that is not
 * declared there is a compile error. There is no string fallback.
 *
 * @example
 * ```ts
 * setup(engine: GwenEngineBase) {
 *   engine.hooks.hook('engine:init', () => { ... })
 * }
 * ```
 */
export interface HookBusBase {
  /** Register a typed listener for a declared hook event. */
  hook<K extends keyof GwenRuntimeHooks>(event: K, fn: GwenRuntimeHooks[K]): void;

  /** Remove a typed listener for a declared hook event. */
  removeHook<K extends keyof GwenRuntimeHooks>(event: K, fn: GwenRuntimeHooks[K]): void;
}

/**
 * Minimal engine interface exposed to plugins.
 *
 * Plugin `setup()` functions receive `GwenEngineBase`, not the full
 * `GwenEngine`. This keeps plugins decoupled from the ECS internals:
 *
 * - `provide` / `inject` / `tryInject` — service registry
 * - `hooks` — event bus (emit/subscribe)
 * - `logger` — structured logger
 * - `run` — execute a callback within the engine's composable context
 * - `disposables` — register cleanup callbacks for automatic teardown
 *
 * Plugin authors who need ECS operations inside `setup()` should register
 * a scene or actor instead — direct `addComponent` / `createEntity` calls in
 * `setup()` are an architectural anti-pattern.
 *
 * @example
 * ```ts
 * import { definePlugin } from '@gwenjs/kit'
 *
 * export const AudioPlugin = definePlugin((opts: AudioOptions) => ({
 *   name: 'AudioPlugin',
 *   setup(engine: GwenEngineBase) {
 *     const log = engine.logger.child('AudioPlugin')
 *     const manager = new AudioManager(opts)
 *     engine.provide('audio', manager)
 *     engine.hooks.hook('engine:stop', () => manager.suspend())
 *     engine.disposables.add('audio-manager', createDisposable(() => manager.dispose()))
 *     log.info('audio ready')
 *   },
 * }))
 * ```
 */
export interface GwenEngineBase {
  /**
   * Register a value in the typed service registry.
   * Retrievable via `inject()` or `tryInject()` from any context.
   *
   * @param key - Unique service key.
   * @param value - Service implementation.
   */
  provide(key: string, value: unknown): void;

  /**
   * Retrieve a registered service by key.
   *
   * @param key - The key used during `provide()`.
   * @returns The registered value.
   * @throws {GwenPluginNotFoundError} if no service is registered for `key`.
   */
  inject(key: string): unknown;

  /**
   * Retrieve a registered service by key, returning `undefined` if absent.
   *
   * Prefer `tryInject` over a try/catch around `inject()` for optional services.
   *
   * @param key - The key used during `provide()`.
   * @returns The registered value, or `undefined`.
   */
  tryInject(key: string): unknown | undefined;

  /** Hook bus for subscribing to engine lifecycle and custom game events. */
  readonly hooks: HookBusBase;

  /**
   * Structured logger for this engine instance.
   * Call `.child('@my/plugin')` to get a scoped logger that tags all entries
   * with your plugin name.
   */
  readonly logger: IGwenLogger;

  /**
   * Execute `fn` within the engine's composable context.
   * `useEngine()` and other context-sensitive composables resolve correctly
   * inside `fn`.
   */
  run<T>(fn: () => T): T;

  /**
   * Named LIFO registry of engine-level disposables.
   *
   * Register every resource your plugin acquires here so it is automatically
   * released in the correct order when `engine.teardown()` or `engine.unuse()`
   * is called — without needing to implement `teardown()` manually.
   *
   * @example
   * ```ts
   * import { createDisposable } from '@gwenjs/core'
   *
   * setup(engine) {
   *   const ws = new WebSocket('wss://...')
   *   engine.disposables.add('websocket', createDisposable(() => ws.close()))
   * }
   * ```
   */
  readonly disposables: DisposableRegistryBase;
}

/**
 * Context passed to {@link GwenPlugin.onError} when a frame-level error is caught.
 *
 * Call `context.recover()` to mark the error as handled. If no plugin calls
 * `recover()`, the engine escalates to a fatal error via the error bus.
 */
export interface PluginErrorContext {
  /**
   * The lifecycle phase in which the error occurred.
   */
  phase: "setup" | "teardown" | "onBeforeUpdate" | "onUpdate" | "onAfterUpdate" | "onRender";

  /** Engine frame index at the time of the error. */
  frame: number;

  /**
   * Mark this error as handled.
   * After `recover()` is called, the error is not forwarded to the error bus
   * and the frame loop continues normally.
   */
  recover(): void;
}

/**
 * Runtime plugin contract for GWEN.
 *
 * Implemented by `definePlugin()` factories in `@gwenjs/kit` and by
 * built-in internal plugins (actor system, scene router, tween pool, etc.)
 * in `@gwenjs/core`.
 *
 * **Lifecycle:**
 * 1. `setup(engine)` — called once when `engine.use(plugin)` is awaited.
 *    Acquire resources; register them in `engine.disposables`.
 * 2. `teardown()` — called when `engine.unuse(name)` or `engine.teardown()`.
 *    Optional: prefer `engine.disposables` for cleanup.
 * 3. `onError(error, context)` — called when an error is caught during setup or teardown.
 *    Call `context.recover()` to suppress escalation.
 *
 * @example Minimal plugin:
 * ```ts
 * const plugin: GwenPlugin = {
 *   name: 'my-plugin',
 *   setup(engine) {
 *     engine.provide('myService', new MyService())
 *   },
 * }
 * await engine.use(plugin)
 * ```
 *
 * @example With error handling via definePlugin():
 * ```ts
 * import { definePlugin } from '@gwenjs/kit'
 *
 * export const MyPlugin = definePlugin((opts: { debug?: boolean } = {}) => ({
 *   name: 'MyPlugin',
 *   setup(engine) {
 *     if (opts.debug) engine.logger.child('MyPlugin').info('setup')
 *   },
 *   onError(error, context) {
 *     if (context.phase === 'setup') context.recover()
 *   },
 * }))
 * ```
 */
export interface GwenPlugin {
  /** Unique plugin identifier. Used for deduplication and lookup. */
  name: string;

  /**
   * Called once when the plugin is registered via `engine.use()`.
   *
   * Receive `GwenEngineBase` (not the full `GwenEngine`) — the minimal
   * surface needed for service registration, hook subscription, logging,
   * and disposable management. If you need the full ECS API, retrieve it
   * via `engine.inject('@gwenjs/core/engine')` — but prefer registering
   * actors and systems instead of manipulating ECS directly in `setup()`.
   */
  setup(engine: GwenEngineBase): void | Promise<void>;

  /**
   * Called when the plugin is removed via `engine.unuse()` or during
   * `engine.teardown()`.
   *
   * Optional — prefer registering cleanup via `engine.disposables` in
   * `setup()` so teardown order is guaranteed and explicit.
   */
  teardown?(): void | Promise<void>;

  /**
   * Called when an error is thrown inside this plugin's frame-level hooks.
   *
   * Call `context.recover()` to suppress the error from being forwarded to
   * the engine error bus. If no plugin in the chain calls `recover()`, the
   * engine will emit a fatal event and call `engine.stop()`.
   *
   * @example
   * ```ts
   * onError(error, context) {
   *   if (context.phase === 'setup' && error instanceof DOMException) {
   *     context.recover() // DOM not ready during setup — handled gracefully
   *   }
   * }
   * ```
   */
  onError?(error: unknown, context: PluginErrorContext): void;
}
