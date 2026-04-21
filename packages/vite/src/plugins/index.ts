import { gwenWasmPlugin } from "./wasm.js";
import { gwenAutoImportsPlugin } from "./auto-imports.js";
import { gwenTypesPlugin } from "./types-writer.js";
import { gwenVirtualPlugin } from "./virtual-env.js";
import { gwenActorPlugin } from "./actor.js";
import { gwenLayoutPlugin } from "./layout.js";
import { gwenSceneRouterPlugin } from "./scene-router.js";
import { gwenTweenPlugin } from "./tween.js";
import { gwenHooksPlugin } from "./hooks.js";
import { gwenOptimizerPlugin } from "./optimizer.js";
import { gwenSystemPlugin } from "./system.js";
import { gwenAsyncContextPlugin } from "./async-context.js";
import { gwenQueryHoistPlugin } from "./query-hoist.js";
import type { GwenViteOptions, GwenOptimizerUserOptions } from "../types.js";
import type { PluginOption } from "vite";

export { gwenWasmPlugin } from "./wasm.js";
export { gwenAutoImportsPlugin, generateAutoImportsModule } from "./auto-imports.js";
export { gwenTypesPlugin } from "./types-writer.js";
export { gwenVirtualPlugin } from "./virtual-env.js";
export { gwenActorPlugin, generateActorsModule, transformActorNames } from "./actor.js";
export {
  gwenLayoutPlugin,
  generateLayoutsModule,
  transformLayoutNames,
  extractLayoutNames,
} from "./layout.js";
export {
  gwenSceneRouterPlugin,
  generateRouterDevtools,
  transformRouterNames,
} from "./scene-router.js";
export { gwenTweenPlugin, extractUsedEasings, type GwenTweenOptions } from "./tween.js";
export { gwenHooksPlugin, extractDefineHooksExports, generateHooksDts } from "./hooks.js";
export type { HooksPluginOptions } from "./hooks.js";
export { gwenSystemPlugin, transformSystemNames } from "./system.js";
export { gwenAsyncContextPlugin, transformAsyncContext } from "./async-context.js";
export { gwenQueryHoistPlugin } from "./query-hoist.js";

/**
 * Composite Vite plugin that wires together all GWEN sub-plugins:
 *
 * - `gwen:wasm` — serves / inlines the WASM binary
 * - `gwen:auto-imports` — virtual module for composable re-exports
 * - `gwen:types` — writes type-template `.d.ts` files
 * - `gwen:virtual` — injects `virtual:gwen/env` constants
 * - `gwen:actor` — actor auto-discovery and name injection
 * - `gwen:layout` — layout virtual module and name injection
 * - `gwen:tween` — easing tree-shake analysis via `virtual:gwen/used-easings`
 * - `gwen:query-hoist` — hoists useQuery arrays and pre-computes cache keys
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
/**
 * Resolve the `optimizer` option from `GwenViteOptions` into concrete
 * `gwenOptimizerPlugin` arguments.
 *
 * - `false / undefined` → detect mode, no extra options
 * - `true`              → transform mode, default options
 * - `{ ... }`           → transform mode, forwarded options
 */
function resolveOptimizerOptions(
  opt: GwenViteOptions["optimizer"],
): Parameters<typeof gwenOptimizerPlugin>[0] {
  if (!opt) return { mode: "detect" };
  if (opt === true) return { mode: "transform" };
  const { componentsDir, tier, debug } = opt as GwenOptimizerUserOptions;
  return { mode: "transform", componentsDir, tier, debug };
}

export function gwenVitePlugin(options: GwenViteOptions = {}): PluginOption {
  return [
    gwenWasmPlugin(options),
    gwenAutoImportsPlugin(options),
    gwenTypesPlugin(options),
    gwenVirtualPlugin(options),
    gwenActorPlugin(options),
    gwenLayoutPlugin(options),
    gwenSceneRouterPlugin(options),
    gwenTweenPlugin(options),
    gwenHooksPlugin(options),
    gwenSystemPlugin(),
    gwenQueryHoistPlugin(),
    gwenOptimizerPlugin(resolveOptimizerOptions(options.optimizer)),
    gwenAsyncContextPlugin(),
  ];
}
