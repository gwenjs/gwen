/**
 * @file RFC-002 — satisfiesPluginContract & definePluginTypes
 */

import type { GwenPlugin } from '@gwenjs/core';

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
 *
 * @since 1.0.0
 */
export function satisfiesPluginContract<Contract extends GwenPlugin>(plugin: Contract): Contract {
  return plugin;
}

// ─── definePluginTypes ───────────────────────────────────────────────────────

/**
 * Options for {@link definePluginTypes}.
 *
 * All fields are optional. Omitting both `provides` and `hooks` causes
 * `definePluginTypes` to return an empty string.
 *
 * @since 1.0.0
 */
export interface PluginTypesOptions {
  /**
   * Key-value map of service keys → TypeScript type names to add to `GwenProvides`.
   * @example { physics2d: 'Physics2DAPI' }
   */
  provides?: Record<string, string>;
  /**
   * Key-value map of hook event names → handler signatures to add to `GwenRuntimeHooks`.
   * @example { 'physics2d:step': '(dt: number) => void' }
   */
  hooks?: Record<string, string>;
  /** Names to import from other packages (for reference in generated types). */
  imports?: string[];
}

/**
 * Generates TypeScript declaration-merging syntax for a plugin package.
 *
 * Call this in a plugin package's build step to produce the `.d.ts` fragment
 * that augments `@gwenjs/core` with the services and hooks your plugin provides.
 *
 * Returns an empty string if neither `provides` nor `hooks` is specified (or
 * both are empty objects).
 *
 * @param options - Service and hook maps to include in the generated declaration.
 * @returns A TypeScript `declare module` string, or `''` if nothing to emit.
 *
 * @example
 * ```typescript
 * import { definePluginTypes } from '@gwenjs/kit'
 *
 * const dts = definePluginTypes({
 *   provides: { physics2d: 'Physics2DAPI' },
 *   hooks: { 'physics2d:step': '(dt: number) => void' },
 * })
 * // Produces:
 * // declare module '@gwenjs/core' {
 * //   interface GwenProvides { physics2d: Physics2DAPI }
 * //   interface GwenRuntimeHooks { 'physics2d:step': (dt: number) => void }
 * // }
 * ```
 *
 * @since 1.0.0
 */
export function definePluginTypes(options: PluginTypesOptions): string {
  const blocks: string[] = [];

  if (options.provides && Object.keys(options.provides).length > 0) {
    const lines = Object.entries(options.provides).map(([k, v]) => `    ${k}: ${v}`);
    blocks.push(`  interface GwenProvides {\n${lines.join('\n')}\n  }`);
  }

  if (options.hooks && Object.keys(options.hooks).length > 0) {
    const lines = Object.entries(options.hooks).map(([k, v]) => `    '${k}': ${v}`);
    blocks.push(`  interface GwenRuntimeHooks {\n${lines.join('\n')}\n  }`);
  }

  if (blocks.length === 0) return '';

  const importLines =
    options.imports && options.imports.length > 0 ? options.imports.join('\n') + '\n\n' : '';
  // `export {}` makes this a module file, enabling proper declaration merging
  // instead of ambient module replacement.
  return `export {}\n\n${importLines}declare module '@gwenjs/core' {\n${blocks.join('\n')}\n}`;
}
