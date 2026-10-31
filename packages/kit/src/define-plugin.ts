/**
 * @file definePlugin — factory API for GWEN plugins.
 *
 * Returns a typed factory function. Plugin authors provide a factory that
 * returns a plain object conforming to the {@link GwenPlugin} interface.
 *
 * @example
 * ```typescript
 * import { definePlugin } from '@gwenjs/kit'
 *
 * export const AudioPlugin = definePlugin((config: AudioConfig = {}) => ({
 *   name: 'AudioPlugin',
 *   setup(engine) {
 *     const manager = new AudioManager(config)
 *     engine.provide('audio', manager)
 *   },
 *   teardown() { manager.dispose() },
 * }))
 *
 * // Create an instance:
 * const plugin = AudioPlugin({ volume: 0.8 })
 * await engine.use(plugin)
 * ```
 */

import {
  GWEN_PLUGIN_LIFECYCLE_HOOKS,
  type ForbiddenPluginKey,
  type GwenPlugin,
} from "@gwenjs/schema";

/**
 * A typed factory function returned by {@link definePlugin}.
 *
 * When `Options` is `void` the factory requires no arguments.
 * Otherwise the options argument is optional (defaults are expected inside
 * the factory closure).
 *
 * @typeParam Options - Options the factory accepts (`void` = no options needed).
 * @typeParam P - The plugin type the factory produces.
 */
export type GwenPluginFactory<Options, P extends GwenPlugin> = [Options] extends [void]
  ? () => P
  : (options?: Options) => P;

/**
 * Compile-time message for a key `definePlugin` does not accept.
 * A lifecycle key names the hook to register inside `setup`.
 * Any other extra key names the keys a plugin object may declare.
 */
export type PluginKeyError<K extends PropertyKey> = K extends ForbiddenPluginKey
  ? `"${K}" is never called by the engine. In setup(), use engine.hooks.hook("${(typeof GWEN_PLUGIN_LIFECYCLE_HOOKS)[K]}", …)`
  : `"${K & string}" is not a GwenPlugin key (allowed: name, setup, teardown, onError, requires)`;

/**
 * `TPlugin` with every key outside {@link GwenPlugin} replaced by {@link PluginKeyError}.
 * The factory return is checked against this, so those keys fail at compile time.
 */
export type ExactPlugin<P extends GwenPlugin> = P & {
  [K in Exclude<keyof P, keyof GwenPlugin>]: PluginKeyError<K>;
};

/**
 * Define a GWEN plugin via a factory function.
 *
 * The factory receives optional options and returns a plain object conforming
 * to the {@link GwenPlugin} interface. `definePlugin` returns that object
 * unchanged. A `setup` failure reaches the caller as the original throw.
 *
 * @typeParam TOptions - The type of options the factory accepts. Inferred from
 *   the factory parameter — leave it unspecified for automatic inference.
 * @typeParam TPlugin - The concrete plugin type the factory produces. Inferred
 *   automatically from the factory's return type.
 * @param factory - A function that receives options and returns a `GwenPlugin`
 *   object. The factory is called fresh each time the returned factory function
 *   is invoked, giving every plugin instance its own closure state.
 * @returns A typed {@link GwenPluginFactory}. Call it (with options if required)
 *   to get a plugin instance ready for `engine.use()`.
 *   Keys the engine never calls (`onUpdate`, `onRender`, …) are a type error.
 *   Register that work with `engine.hooks.hook` inside `setup`.
 *
 * @example
 * ```typescript
 * import { definePlugin } from '@gwenjs/kit'
 *
 * export const MyPlugin = definePlugin((opts: { debug?: boolean } = {}) => ({
 *   name: 'MyPlugin',
 *   setup(engine) {
 *     if (opts.debug) console.log('[MyPlugin] setup')
 *   },
 *   teardown() {
 *     if (opts.debug) console.log('[MyPlugin] teardown')
 *   },
 *   onError(error, context) {
 *     if (context.phase === 'onRender') {
 *       context.recover() // suppress — render errors are non-fatal for this plugin
 *     }
 *   },
 * }))
 *
 * // Instantiate and register:
 * const plugin = MyPlugin({ debug: true })
 * await engine.use(plugin)
 * ```
 */
export function definePlugin<TOptions, TPlugin extends GwenPlugin>(
  factory: (options?: TOptions) => ExactPlugin<TPlugin>,
): GwenPluginFactory<TOptions extends undefined ? void : TOptions, TPlugin> {
  function PluginFactory(options?: TOptions): TPlugin {
    return factory(options);
  }

  return PluginFactory as unknown as GwenPluginFactory<
    TOptions extends undefined ? void : TOptions,
    TPlugin
  >;
}
