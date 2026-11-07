// ─── Config ───────────────────────────────────────────────────────────────────

import type { PhysicsConfigBase } from "@gwenjs/physics-core";

export type { QualityPreset } from "@gwenjs/physics-core";
export { QUALITY_PRESET_CODE } from "@gwenjs/physics-core";

export type PhysicsEventMode = "pull" | "hybrid";

/**
 * 2D plugin options. Gravity, layers, quality and the speed cap come from
 * {@link PhysicsConfigBase}. Gravity defaults to `{ x: 0, y: -9.81 }`.
 */
export interface Physics2DConfig extends PhysicsConfigBase<"2d"> {
  /**
   * Collision event delivery mode.
   * - `pull`: first-class path via `getCollisionEventsBatch()`
   * - `hybrid`: pull + convenience hook dispatch in `onUpdate`
   * @default 'pull'
   */
  eventMode?: PhysicsEventMode;
  /**
   * Global CCD fallback for bodies without local override.
   * If omitted, the plugin derives a default from `qualityPreset`.
   */
  ccdEnabled?: boolean;

  /**
   * Build-time Vite plugin options for `gwen:physics2d`.
   * These only affect the Vite build pipeline, not the runtime simulation.
   */
  vite?: {
    /**
     * Log layer-inlining activity to the Vite console.
     * @default false
     */
    debug?: boolean;
  };
}
