import type { GwenPlugin } from "@gwenjs/schema";

// ─── satisfiesPluginContract ─────────────────────────────────────────────────

/**
 * Runtime no-op that enforces a plugin contract at compile time.
 *
 * Use this when a plugin package promises to satisfy a specific contract shape.
 * The type system will raise a compile-time error if the plugin does not match
 * the `Contract` type. At runtime the function is a transparent identity wrapper.
 *
 * @typeParam Contract - The contract type the plugin must satisfy.
 * @param plugin - The plugin instance to check.
 * @returns The same `plugin` value, typed as `Contract`.
 *
 * @example
 * ```typescript
 * import { satisfiesPluginContract, definePlugin } from '@gwenjs/kit'
 * import type { GwenPlugin } from '@gwenjs/kit'
 *
 * interface AudioContract extends GwenPlugin { name: 'AudioPlugin' }
 *
 * const AudioPlugin = definePlugin(() => ({ name: 'AudioPlugin' as const, setup() {} }))
 *
 * // Compile-time check — will error if AudioPlugin() does not match AudioContract:
 * export const instance = satisfiesPluginContract<AudioContract>(AudioPlugin())
 * ```
 */
export function satisfiesPluginContract<Contract extends GwenPlugin>(plugin: Contract): Contract {
  return plugin;
}
