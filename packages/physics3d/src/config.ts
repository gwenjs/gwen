/**
 * Configuration normalization for the Physics3D plugin.
 */

import type { Physics3DConfig, ResolvedPhysics3DConfig, Physics3DQualityPreset } from './types';

export { QUALITY_PRESETS } from './types';

/** Fully-resolved default configuration values. */
export const DEFAULT_PHYSICS3D_CONFIG: ResolvedPhysics3DConfig = {
  gravity: { x: 0, y: -9.81, z: 0 },
  maxEntities: 10_000,
  qualityPreset: 'medium',
  debug: false,
  coalesceEvents: true,
  layers: [],
};

/**
 * Normalize a partial `Physics3DConfig` into a fully-resolved config.
 *
 * Missing fields are filled with {@link DEFAULT_PHYSICS3D_CONFIG} values.
 * Gravity components are applied independently so callers can override
 * only the axes they care about.
 *
 * @param config - Partial configuration from the plugin constructor.
 * @returns A fully-resolved configuration object.
 */
export function normalizePhysics3DConfig(config: Physics3DConfig = {}): ResolvedPhysics3DConfig {
  const qualityPreset: Physics3DQualityPreset =
    (config.qualityPreset as Physics3DQualityPreset | undefined) ??
    DEFAULT_PHYSICS3D_CONFIG.qualityPreset;

  return {
    gravity: {
      x: config.gravity?.x ?? DEFAULT_PHYSICS3D_CONFIG.gravity.x,
      y: config.gravity?.y ?? DEFAULT_PHYSICS3D_CONFIG.gravity.y,
      z: config.gravity?.z ?? DEFAULT_PHYSICS3D_CONFIG.gravity.z,
    },
    maxEntities: config.maxEntities ?? DEFAULT_PHYSICS3D_CONFIG.maxEntities,
    qualityPreset,
    debug: config.debug ?? DEFAULT_PHYSICS3D_CONFIG.debug,
    coalesceEvents: config.coalesceEvents ?? DEFAULT_PHYSICS3D_CONFIG.coalesceEvents,
    layers: config.layers ?? DEFAULT_PHYSICS3D_CONFIG.layers,
  };
}

/**
 * Build a layer name-to-bitmask registry from a list of layer names.
 *
 * Each entry in `layers` maps to bit position `index`. The first entry
 * occupies bit 0 (value 1), the second bit 1 (value 2), and so on.
 * Maximum 32 layers.
 *
 * @param layers - Ordered array of unique layer names.
 * @returns A `Map<layerName, bitMask>`.
 */
export function buildLayerRegistry(layers: string[]): Map<string, number> {
  const registry = new Map<string, number>();
  for (let i = 0; i < Math.min(layers.length, 32); i++) {
    const name = layers[i];
    if (name !== undefined) registry.set(name, 1 << i);
  }
  return registry;
}

/**
 * Resolve an array of layer names to a combined bitmask.
 *
 * Returns `0xFFFFFFFF` (all bits set) when `names` is empty or `undefined`.
 * Throws if any name is not found in the registry — this prevents silent
 * layer-typo bugs where a collider silently uses the wrong filter.
 *
 * @param names    - Layer names to resolve.
 * @param registry - Layer registry built by {@link buildLayerRegistry}.
 * @returns Combined bitmask.
 * @throws Error if a layer name is not declared in the registry.
 */
export function resolveLayerBits(
  names: (string | number)[] | undefined,
  registry: Map<string, number>,
): number {
  if (!names || names.length === 0) return 0xffffffff;
  const declared = [...registry.keys()];
  let mask = 0;
  for (const name of names) {
    if (typeof name === 'number') {
      mask |= name;
    } else {
      const bit = registry.get(name);
      if (bit === undefined) {
        throw new Error(
          `[GWEN:Physics3D] Unknown layer "${name}". Declared layers: [${declared.join(', ')}]`,
        );
      }
      mask |= bit;
    }
  }
  return mask >>> 0; // ensure unsigned 32-bit
}
