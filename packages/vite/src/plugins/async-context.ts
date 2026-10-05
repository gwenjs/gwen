import { createTransformer } from "unctx/transform";
import type { Plugin } from "vite";

/**
 * The unctx transformer configured for GWEN's async context functions.
 *
 * Instruments `await` calls inside async functions passed to:
 * - `onEnter(async () => { ... })` — scene entry lifecycle
 * - `onExit(async () => { ... })` — scene exit lifecycle
 * - `withAsyncContext(async () => { ... })` — opt-in for actors and custom callbacks
 *
 * Each `await expr` is replaced with a save/restore pattern:
 * ```
 * (([__temp,__restore]=__executeAsync(()=>expr)),__temp=await __temp,__restore(),__temp)
 * ```
 *
 * `__executeAsync` is imported from `@gwenjs/core/internal` (GWEN's own engine context),
 * not from `unctx` directly.
 *
 * @internal
 */
const transformer = createTransformer({
  asyncFunctions: ["onEnter", "onExit", "withAsyncContext"],
  helperModule: "@gwenjs/core/internal",
  helperName: "executeAsync",
});

/**
 * Transforms a source file to propagate engine context across `await`
 * boundaries in `onEnter`, `onExit`, and `withAsyncContext` callbacks.
 *
 * Returns `undefined` if the file contains no relevant function calls or no
 * `await` expressions that need instrumentation.
 *
 * @param code - TypeScript/JavaScript source code.
 * @param id - File path (used for source map generation).
 * @returns Transformed code and high-resolution source map, or `undefined`.
 *
 * @example Input:
 * ```ts
 * onEnter(async () => {
 *   await loadAssets()
 *   useEngine()
 * })
 * ```
 *
 * @example Output (abbreviated):
 * ```ts
 * import { executeAsync as __executeAsync } from "@gwenjs/core/internal"
 * onEnter(async () => {
 *   let __temp, __restore
 *   ;(([__temp,__restore]=__executeAsync(()=>loadAssets())),await __temp,__restore())
 *   useEngine()
 * })
 * ```
 */
export function transformAsyncContext(
  code: string,
  id: string,
): { code: string; map: ReturnType<import("magic-string").default["generateMap"]> } | undefined {
  if (!transformer.shouldTransform(code)) return undefined;
  const result = transformer.transform(code);
  if (!result) return undefined;
  return {
    code: result.code,
    map: result.magicString.generateMap({ hires: true, source: id }),
  };
}

/**
 * Vite plugin that automatically instruments async `onEnter`, `onExit`, and
 * `withAsyncContext` callbacks to preserve the GWEN engine context across
 * `await` boundaries.
 *
 * **How it works:**
 * GWEN's engine context (backed by unctx) is synchronous — after any `await`,
 * the context is lost. This plugin wraps each `await` with `executeAsync` from
 * `@gwenjs/core/internal`, which captures the current engine reference before suspension
 * and restores it after the microtask resolves.
 *
 * **What is transformed:**
 * - `onEnter(async () => { await ...; useEngine() })` — automatic, zero user action
 * - `onExit(async () => { await ...; useEngine() })` — automatic, zero user action
 * - `withAsyncContext(async () => { await ...; useEngine() })` — opt-in escape hatch
 *
 * **What is NOT transformed:**
 * - `onUpdate`, `onRender`, `onBeforeUpdate`, `onAfterUpdate` — synchronous by design
 * - Files inside `node_modules`
 *
 * **Requirements:**
 * - This plugin must be present in your Vite config (included in `gwenVitePlugin()`)
 * - The scene router must wrap lifecycle calls in `engineContext.callAsync()` so
 *   the context is active when the instrumented function starts
 *
 * @example vite.config.ts (automatic via gwenVitePlugin):
 * ```ts
 * import { defineConfig } from 'vite'
 * import { gwenVitePlugin } from '@gwenjs/vite'
 *
 * export default defineConfig({
 *   plugins: [gwenVitePlugin()],
 * })
 * ```
 *
 * @example With plugin, async onEnter just works:
 * ```ts
 * const GameScene = defineScene('game', () => {
 *   onEnter(async () => {
 *     await loadGameAssets()
 *     useHTML().mount('hud')  // ✅ context restored automatically
 *   })
 * })
 * ```
 */
export function gwenAsyncContextPlugin(): Plugin {
  return {
    name: "gwen:async-context",
    enforce: "pre",
    transform(code: string, id: string) {
      if (id.includes("node_modules")) return;
      const result = transformAsyncContext(code, id);
      if (!result) return;
      return result;
    },
  };
}
