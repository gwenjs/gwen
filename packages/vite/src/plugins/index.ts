import { gwenAutoImportsPlugin } from "./auto-imports.js";
import { gwenVirtualPlugin } from "./virtual-env.js";
import { gwenActorPlugin } from "./actor.js";
import { gwenLayoutPlugin } from "./layout.js";
import { gwenSceneRouterPlugin } from "./scene-router.js";
import { gwenTweenPlugin } from "./tween.js";
import { gwenHooksPlugin } from "./hooks.js";
import { gwenLocalPluginsPlugin } from "./local-plugins.js";
import { gwenLocalModulesPlugin } from "./local-modules.js";
import { gwenDevStripPlugin } from "./dev-strip.js";
import { BUILT_IN_UNITS } from "../pipeline/registry.js";
import { createTransformPipeline } from "../pipeline/transform-pipeline.js";
import type { GwenViteOptions } from "../types.js";
import type { PluginOption } from "vite";

export { gwenAutoImportsPlugin, generateAutoImportsModule } from "./auto-imports.js";
export { gwenVirtualPlugin } from "./virtual-env.js";
export { gwenActorPlugin, generateActorsModule } from "./actor.js";
export {
  gwenLayoutPlugin,
  generateLayoutsModule,
  transformLayoutNames,
  extractLayoutNames,
} from "./layout.js";
export { gwenSceneRouterPlugin, transformRouterNames } from "./scene-router.js";
export { gwenTweenPlugin, extractUsedEasings, type GwenTweenOptions } from "./tween.js";
export { gwenHooksPlugin, extractDefineHooksExports, generateHooksDts } from "./hooks.js";
export type { HooksPluginOptions } from "./hooks.js";
export {
  gwenLocalPluginsPlugin,
  scanLocalPluginFiles,
  generateLocalPluginsModule,
} from "./local-plugins.js";
export {
  gwenLocalModulesPlugin,
  inferModuleName,
  scanLocalModuleFiles,
  generateLocalModulesModule,
} from "./local-modules.js";
export { gwenDevStripPlugin, type GwenDevStripReport } from "./dev-strip.js";

/**
 * Composite Vite plugin that wires together all GWEN sub-plugins:
 *
 * - `gwen:auto-imports` — virtual module for composable re-exports
 * - `gwen:virtual` — injects `virtual:gwen/env` constants
 * - `gwen:actor` — actor auto-discovery and the actors virtual module
 * - `gwen:layout` — layout virtual module and name injection
 * - `gwen:transform-pipeline` — AST units: system and actor names, actor dependency lists, async-context await wrapping, query hoisting
 * - `gwen:scene-router` — scene router virtual module and name injection
 * - `gwen:tween` — easing tree-shake analysis via `virtual:gwen/used-easings`
 * - `gwen:hooks` — generates `hooks.d.ts` from `src/hooks.ts`
 * - `gwen:local-plugins` — auto-discovers `src/plugins/`, generates `virtual:gwen/local-plugins`
 * - `gwen:local-modules` — auto-discovers `src/modules/`, generates `virtual:gwen/local-modules`
 *
 * @param options - Plugin configuration. All sub-options are optional.
 *
 * @example vite.config.ts
 * ```ts
 * import { defineConfig } from 'vite'
 * import { gwenVitePlugin } from '@gwenjs/vite'
 *
 * export default defineConfig({
 *   plugins: [gwenVitePlugin()],
 * })
 * ```
 */
export function gwenVitePlugin(options: GwenViteOptions = {}): PluginOption {
  return [
    createTransformPipeline({ units: BUILT_IN_UNITS, autoImports: options.autoImports ?? [] }),
    gwenAutoImportsPlugin(options),
    gwenVirtualPlugin(),
    gwenActorPlugin(options),
    gwenLayoutPlugin(options),
    gwenSceneRouterPlugin(options),
    gwenTweenPlugin(options),
    gwenHooksPlugin(options),
    gwenLocalPluginsPlugin(options),
    gwenLocalModulesPlugin(options),
    gwenDevStripPlugin(),
  ];
}
