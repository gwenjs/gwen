/** Three-dimensional vector (x, y, z). */
export interface Physics3DVec3 {
  x: number;
  y: number;
  z: number;
}

/** Unit quaternion representing a 3D rotation. */
export interface Physics3DQuat {
  x: number;
  y: number;
  z: number;
  /** Scalar component. @default 1 */
  w: number;
}

/**
 * Physics quality preset controlling solver iterations and simulation accuracy.
 *
 * - `'low'`    — Minimum iterations. Best for low-end targets.
 * - `'medium'` — Balanced default.
 * - `'high'`   — More iterations, higher fidelity.
 * - `'esport'` — Maximum iterations for competitive accuracy.
 */
export type Physics3DQualityPreset = 'low' | 'medium' | 'high' | 'esport';

/**
 * Numeric bridge mapping for quality presets (TS -> WASM).
 * Matches the WASM-side enum: 0=low, 1=medium, 2=high, 3=esport.
 */
export const QUALITY_PRESETS: Record<Physics3DQualityPreset, number> = {
  low: 0,
  medium: 1,
  high: 2,
  esport: 3,
} as const;

/**
 * Configuration accepted by the Physics3D plugin constructor.
 */
export interface Physics3DConfig {
  /**
   * Gravity vector in m/s². Partial overrides are accepted.
   * @default { x: 0, y: -9.81, z: 0 }
   */
  gravity?: Partial<Physics3DVec3>;
  /**
   * Maximum number of entity slots. Should match the engine's `maxEntities`.
   * @default 10_000
   */
  maxEntities?: number;
  /**
   * Physics quality preset controlling solver fidelity.
   * @default 'medium'
   */
  qualityPreset?: Physics3DQualityPreset;
  /**
   * Enable Physics3D debug logging to the browser console.
   * @default false
   */
  debug?: boolean;
  /**
   * Enable same-frame collision event coalescing on the WASM side.
   * @default true
   */
  coalesceEvents?: boolean;
  /**
   * Named collision layer definitions. Each entry maps a layer name to a bit
   * position (0-based). Maximum 32 layers.
   *
   * @example
   * ```ts
   * layers: ['default', 'player', 'enemy', 'ground']
   * ```
   */
  layers?: string[];
}

/** Fully resolved Physics3D config (all fields guaranteed). */
export interface ResolvedPhysics3DConfig {
  gravity: Physics3DVec3;
  maxEntities: number;
  qualityPreset: Physics3DQualityPreset;
  debug: boolean;
  coalesceEvents: boolean;
  layers: string[];
}
