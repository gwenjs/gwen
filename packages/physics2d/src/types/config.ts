// ─── Config ───────────────────────────────────────────────────────────────────

export type PhysicsQualityPreset = 'low' | 'medium' | 'high' | 'esport';
export type PhysicsEventMode = 'pull' | 'hybrid';

/** Numeric bridge mapping for solver quality presets (TS -> WASM). */
export const PHYSICS_QUALITY_PRESET_CODE: Record<PhysicsQualityPreset, number> = {
  low: 0,
  medium: 1,
  high: 2,
  esport: 3,
} as const;

export interface Physics2DConfig {
  /**
   * Gravity on the Y axis in m/s². Negative = downward.
   * @default -9.81
   */
  gravity?: number;
  /**
   * Gravity on the X axis in m/s².
   * @default 0
   */
  gravityX?: number;
  /**
   * Maximum number of entity slots. Must match the engine's `maxEntities`.
   * @default 10_000
   */
  maxEntities?: number;
  /**
   * Physics quality preset.
   * @default 'medium'
   */
  qualityPreset?: PhysicsQualityPreset;
  /**
   * Collision event delivery mode.
   * - `pull`: first-class path via `getCollisionEventsBatch()`
   * - `hybrid`: pull + convenience hook dispatch in `onUpdate`
   * @default 'pull'
   */
  eventMode?: PhysicsEventMode;
  /**
   * Enable Physics2D debug logs in the browser console.
   * When `false` (default), the plugin stays silent.
   * @default false
   */
  debug?: boolean;

  /**
   * Enable collision event coalescing on the Rust side.
   * Keeps the event stream quieter by deduplicating same-frame duplicates per pair.
   * @default true
   */
  coalesceEvents?: boolean;

  /**
   * Global CCD fallback for bodies without local override.
   * If omitted, the plugin derives a default from `qualityPreset`.
   */
  ccdEnabled?: boolean;

  /**
   * Named collision layer definitions.
   * Each key maps to a bit index (0-based). Maximum 32 layers.
   *
   * @example
   * ```ts
   * layers: { default: 0, player: 1, enemy: 2, ground: 3, trigger: 4 }
   * ```
   */
  layers?: Record<string, number>;
}
