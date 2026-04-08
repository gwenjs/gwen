/**
 * @file EngineStats declaration merging for @gwenjs/renderer-core.
 *
 * This file contains only TypeScript declaration merging — no runtime code.
 * Importing any symbol from `@gwenjs/renderer-core` automatically augments
 * `@gwenjs/core` with a `renderers` field on EngineStats.
 */

import type { RendererStats } from "./stats.js";

declare module "@gwenjs/core" {
  interface EngineStats {
    /**
     * Renderer stats snapshot. Only populated when `import.meta.env.DEV || engine.debug`.
     * `undefined` in production builds without debug mode.
     */
    renderers?: RendererStats;
  }
}
