import type { Physics2DConfig, PhysicsQualityPreset } from './types';

/** Pixel to meter ratio used for internal conversions. */
export const PIXELS_PER_METER = 50;
/** Maximum number of collision layers (limited by u32 bitmask). */
export const MAX_LAYERS = 32;
/** Default layer mask (all bits set). */
export const LAYER_ALL = 0xffffffff;

/**
 * Normalized internal configuration for the Physics2D plugin.
 */
export type NormalizedPhysics2DConfig = {
  gravity: number;
  gravityX: number;
  maxEntities: number;
  qualityPreset: PhysicsQualityPreset;
  eventMode: 'pull' | 'hybrid';
  debug: boolean;
  coalesceEvents: boolean;
  ccdEnabled?: boolean;
  layers: Record<string, number>;
};

/**
 * Validates and normalizes user-provided configuration.
 * @throws {Error} If layer configuration is invalid.
 */
export function normalizeConfig(config: Physics2DConfig): NormalizedPhysics2DConfig {
  const layers: Record<string, number> = {};
  if (config.layers) {
    for (const [name, bit] of Object.entries(config.layers)) {
      if (bit < 0 || bit >= MAX_LAYERS || !Number.isInteger(bit)) {
        throw new Error(
          `[Physics2D] Layer "${name}" has invalid bit index ${bit}. Must be an integer in [0, ${MAX_LAYERS - 1}].`,
        );
      }
      layers[name] = bit;
    }
  }
  return {
    gravity: config.gravity ?? -9.81,
    gravityX: config.gravityX ?? 0,
    maxEntities: config.maxEntities ?? 10_000,
    qualityPreset: config.qualityPreset ?? 'medium',
    eventMode: config.eventMode ?? 'pull',
    debug: config.debug ?? false,
    coalesceEvents: config.coalesceEvents ?? true,
    ...(config.ccdEnabled !== undefined ? { ccdEnabled: config.ccdEnabled } : {}),
    layers,
  };
}

/**
 * Resolves whether CCD should be enabled globally based on quality preset if not explicitly set.
 */
export function resolveGlobalCcdEnabled(cfg: NormalizedPhysics2DConfig): boolean {
  if (cfg.ccdEnabled !== undefined) return cfg.ccdEnabled;
  return cfg.qualityPreset === 'high' || cfg.qualityPreset === 'esport';
}

/**
 * Resolves named layers to a u32 bitmask.
 * Created once per plugin instance at init time.
 */
export class LayerRegistry {
  private readonly bits: Record<string, number>;

  constructor(layers: Record<string, number>) {
    if (Object.keys(layers).length > MAX_LAYERS) {
      throw new Error(
        `[Physics2D] Too many layers declared: ${Object.keys(layers).length}. Maximum is ${MAX_LAYERS}.`,
      );
    }
    this.bits = layers;
  }

  /**
   * Resolve a `membershipLayers` or `filterLayers` value to a raw u32 bitmask.
   * - `undefined` → all layers (0xFFFFFFFF)
   * - `number` → used as-is (raw bitmask)
   * - `string[]` → each name resolved; throws on unknown name
   */
  resolve(value: string[] | number | undefined, role: 'membership' | 'filter'): number {
    if (value === undefined) return LAYER_ALL;
    if (typeof value === 'number') return value >>> 0;

    let mask = 0;
    for (const name of value) {
      const bit = this.bits[name];
      if (bit === undefined) {
        const known = Object.keys(this.bits).join(', ');
        throw new Error(
          `[Physics2D] Unknown layer "${name}" in ${role}. Declared layers: [${known}]. ` +
            `Add it to Physics2DConfig.layers or fix the typo.`,
        );
      }
      mask |= 1 << bit;
    }
    return mask >>> 0;
  }
}
