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
 * export const AudioPlugin = definePlugin((config: AudioConfig) => ({
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

import type { GwenPlugin } from "@gwenjs/schema";
import { GwenErrorCode } from "@gwenjs/schema";
import { GwenComposableError } from "@gwenjs/core";
import type { GwenEngine } from "@gwenjs/core";

export type { GwenEngine };

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
 * Define a GWEN plugin via a factory function.
 *
 * The factory receives optional options and returns a plain object conforming
 * to the {@link GwenPlugin} interface. `definePlugin` wraps the factory and
 * returns a typed factory function. Plugin setup errors are automatically
 * caught, logged, and re-thrown as structured {@link GwenComposableError}s.
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
  factory: (options?: TOptions) => TPlugin,
): GwenPluginFactory<TOptions extends undefined ? void : TOptions, TPlugin> {
  function PluginFactory(options?: TOptions): TPlugin {
    const plugin = factory(options);

    const originalSetup = plugin.setup;
    if (originalSetup) {
      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      plugin.setup = async (engine: GwenEngine) => {
        const log = (engine as any).logger?.child?.(`plugin:${plugin.name}`) ?? null;
        try {
          await originalSetup.call(plugin, engine);
        } catch (err) {
          log?.error("Plugin setup failed", { cause: String(err) });
          throw new GwenComposableError(
            GwenErrorCode.Engine.PLUGIN_SETUP_FAILED,
            `Plugin "${plugin.name}" setup failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      };
    }

    return plugin;
  }

  return PluginFactory as unknown as GwenPluginFactory<
    TOptions extends undefined ? void : TOptions,
    TPlugin
  >;
}
