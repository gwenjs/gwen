/**
 * @file defineGwenModule — factory for GWEN build-time modules.
 *
 * All module types (`GwenKit`, `GwenModule`, `AutoImport`, etc.) are defined
 * in `@gwenjs/schema`. This file re-exports them and provides the single
 * runtime function: `defineGwenModule()`.
 *
 * Module authors should import from `@gwenjs/kit/module`:
 * ```ts
 * import { defineGwenModule } from '@gwenjs/kit/module'
 * import type { GwenKit } from '@gwenjs/kit/module'
 * ```
 */

export type {
  DeepPartial,
  AutoImport,
  GwenTypeTemplate,
  VitePlugin,
  ViteUserConfig,
  GwenBuildHooks,
  GwenBaseConfig,
  GwenKit,
  GwenModuleDefinition,
  GwenModule,
} from "@gwenjs/schema";

import type { GwenModuleDefinition, GwenModule } from "@gwenjs/schema";

/**
 * Defines a GWEN module — a build-time extension that registers runtime
 * plugins, auto-imports, Vite extensions, and type templates.
 *
 * Modules run in Node.js during `gwen dev`, `gwen build`, or `gwen prepare`.
 * They are the primary way to add capabilities to a GWEN project.
 *
 * @template Options - The typed options shape this module accepts.
 * @param definition - Module definition: metadata, defaults, and `setup` function.
 * @returns A resolved `GwenModule` ready for use in `gwen.config.ts`.
 *
 * @example
 * ```ts
 * import { defineGwenModule } from '@gwenjs/kit/module'
 *
 * export default defineGwenModule<Physics2DOptions>({
 *   meta: { name: '@gwenjs/physics2d', configKey: 'physics2d' },
 *   defaults: { gravity: 9.81, iterations: 8 },
 *   async setup(options, gwen) {
 *     gwen.addPlugin(createPhysics2DPlugin(options))
 *     gwen.addAutoImports([{ name: 'usePhysics2D', from: '@gwenjs/physics2d' }])
 *     gwen.addTypeTemplate({
 *       filename: 'types/physics2d.d.ts',
 *       getContents: () => `declare module '@gwenjs/core' { ... }`,
 *     })
 *   },
 * })
 * ```
 */
export function defineGwenModule<Options extends object = Record<string, unknown>>(
  definition: GwenModuleDefinition<Options>,
): GwenModule<Options> {
  return definition as GwenModule<Options>;
}
