/**
 * Configuration normalization for the Physics3D plugin.
 */

import type { Vec3 } from "@gwenjs/math";
import { GwenConfigError } from "@gwenjs/core";
import { LAYER_ERROR_CODES, LayerRegistry, type LayerSelector } from "@gwenjs/physics-core";
import { GwenError } from "@gwenjs/schema";
import { Physics3DErrorCodes } from "./errors/codes";
import type { Physics3DConfig, QualityPreset, ResolvedPhysics3DConfig } from "./types";

export { QUALITY_PRESET_CODE } from "./types";

/** Full default gravity. A caller-supplied object is stored as given. */
const DEFAULT_GRAVITY = { x: 0, y: -9.81, z: 0 };

/** A missing component uses DEFAULT_GRAVITY (`packages/physics3d/src/config.ts:21`). */
export function readGravityAxis(gravity: Partial<Vec3>, key: "x" | "y" | "z"): number {
  const value = gravity[key];
  if (value !== undefined) return value;
  return DEFAULT_GRAVITY[key];
}

/** Fully-resolved default configuration values. */
export const DEFAULT_PHYSICS3D_CONFIG: ResolvedPhysics3DConfig = {
  gravity: DEFAULT_GRAVITY,
  maxEntities: 10_000,
  qualityPreset: "medium",
  debug: false,
  coalesceEvents: true,
  maxLinearVelocity: 400,
  layers: {},
};

/**
 * Normalize a partial `Physics3DConfig` into a fully-resolved config.
 *
 * Missing fields are filled with {@link DEFAULT_PHYSICS3D_CONFIG} values.
 * The stored gravity object is kept as given. Its components are not filled in.
 *
 * @param config - Partial configuration from the plugin constructor.
 * @returns A fully-resolved configuration object.
 * @throws {GwenConfigError} If `maxLinearVelocity` is not finite or not positive.
 */
export function normalizePhysics3DConfig(config: Physics3DConfig = {}): ResolvedPhysics3DConfig {
  const qualityPreset: QualityPreset =
    config.qualityPreset ?? DEFAULT_PHYSICS3D_CONFIG.qualityPreset;

  if (
    config.maxLinearVelocity !== undefined &&
    (!Number.isFinite(config.maxLinearVelocity) || config.maxLinearVelocity <= 0)
  ) {
    throw new GwenConfigError("maxLinearVelocity", config.maxLinearVelocity, {
      hint: "Must be finite and greater than 0. The default is 400.",
    });
  }

  return {
    gravity: config.gravity ?? DEFAULT_PHYSICS3D_CONFIG.gravity,
    maxEntities: config.maxEntities ?? DEFAULT_PHYSICS3D_CONFIG.maxEntities,
    qualityPreset,
    debug: config.debug ?? DEFAULT_PHYSICS3D_CONFIG.debug,
    coalesceEvents: config.coalesceEvents ?? DEFAULT_PHYSICS3D_CONFIG.coalesceEvents,
    maxLinearVelocity: config.maxLinearVelocity ?? DEFAULT_PHYSICS3D_CONFIG.maxLinearVelocity,
    layers: config.layers ?? DEFAULT_PHYSICS3D_CONFIG.layers,
  };
}

/**
 * Map a physics-core layer code onto a Physics3D error.
 * `what` is the registry message, unchanged.
 */
function layerError(code: string, what: string): never {
  throw new GwenError(
    code === LAYER_ERROR_CODES.LAYER_UNKNOWN
      ? Physics3DErrorCodes.UNKNOWN_LAYER
      : Physics3DErrorCodes.INVALID_LAYERS,
    what,
    {
      composable: "Physics3DPlugin",
      ...(code === LAYER_ERROR_CODES.LAYER_UNKNOWN
        ? {
            hint: __GWEN_DEV__ ? "Add it to Physics3DConfig.layers or fix the typo." : undefined,
          }
        : {}),
    },
  );
}

/**
 * Build the shared layer registry from explicit bit indexes.
 * Constructed once per engine. Own keys are copied onto a null-prototype object (`packages/physics-core/src/layer-registry.ts:49`).
 *
 * @param layers - Layer name to bit index.
 * @returns The shared registry.
 * @throws {GwenError} `PHYSICS3D:INVALID_LAYERS` when the record is not a valid registry.
 */
export function buildLayerRegistry(layers: Record<string, number>): LayerRegistry {
  const own: Record<string, number> = Object.create(null);
  for (const [name, bit] of Object.entries(layers)) own[name] = bit;
  return new LayerRegistry(own, layerError);
}

/**
 * Resolve a layer selector to a combined bitmask.
 *
 * Returns `0xFFFFFFFF` when `selector` is `undefined` or an empty array, before
 * the registry is asked. An empty list would otherwise resolve to 0. A scalar
 * string has a `.length`, so the empty check uses `Array.isArray`.
 *
 * @param selector - Name, raw bitmask, or a list of either.
 * @param registry - Layer registry built by {@link buildLayerRegistry}.
 * @param role     - Option name used in the unknown-layer message. @default "layer"
 * @returns Combined bitmask.
 * @throws {GwenError} `PHYSICS3D:UNKNOWN_LAYER` when a name is not declared.
 */
export function resolveLayerBits(
  selector: LayerSelector | undefined,
  registry: LayerRegistry,
  role = "layer",
): number {
  if (selector === undefined) return 0xffffffff;
  if (Array.isArray(selector) && selector.length === 0) return 0xffffffff;
  return registry.resolve(selector, role);
}
