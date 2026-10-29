import type { Physics2DConfig, PhysicsQualityPreset } from "./types";
import { GwenConfigError } from "@gwenjs/core";
import { GwenError, formatReceived, type GwenConfigIssue } from "@gwenjs/schema";
import { Physics2DErrorCodes } from "./errors";

/** Pixel to meter ratio used for internal conversions. */
export const PIXELS_PER_METER = 50;
/** Maximum number of collision layers (limited by u32 bitmask). */
export const MAX_LAYERS = 32;
/** Default layer mask (all bits set). */
export const LAYER_ALL = 0xffffffff;

/**
 * Defaults shared by `normalizeConfig` and the physics2d module.
 * `maxLinearVelocity` and `coalesceEvents` stay plugin-only.
 */
export const PHYSICS2D_DEFAULTS = Object.freeze({
  gravity: -9.81,
  gravityX: 0,
  maxEntities: 10_000,
  qualityPreset: "medium",
  eventMode: "pull",
  debug: false,
} as const);

type InvalidLayerBit = {
  name: string;
  bit: unknown;
};

function invalidLayerBits(config: Physics2DConfig): InvalidLayerBit[] {
  const layers = config.layers;
  if (layers === undefined || layers === null) return [];
  const found: InvalidLayerBit[] = [];
  for (const [name, bit] of Object.entries(layers)) {
    if (typeof bit === "number" && bit >= 0 && bit < MAX_LAYERS && Number.isInteger(bit)) {
      continue;
    }
    found.push({ name, bit });
  }
  return found;
}

function layerBitIssues(config: Physics2DConfig): GwenConfigIssue[] {
  return invalidLayerBits(config).map((layer) => ({
    path: `layers.${layer.name}`,
    expected: `an integer in [0, ${MAX_LAYERS - 1}]`,
    received: formatReceived(layer.bit),
    owner: "@gwenjs/physics2d",
  }));
}

/** Layer-bit rule. Each path is `layers.<name>`. */
export function checkPhysics2DConfig(config: Physics2DConfig): GwenConfigIssue[] {
  return layerBitIssues(config);
}

/**
 * Normalized internal configuration for the Physics2D plugin.
 */
export type NormalizedPhysics2DConfig = {
  gravity: number;
  gravityX: number;
  maxLinearVelocity: number;
  maxEntities: number;
  qualityPreset: PhysicsQualityPreset;
  eventMode: "pull" | "hybrid";
  debug: boolean;
  coalesceEvents: boolean;
  ccdEnabled?: boolean;
  layers: Record<string, number>;
};

/**
 * Validates and normalizes user-provided configuration.
 * @throws {GwenError} If layer configuration is invalid.
 * @throws {GwenConfigError} If `maxLinearVelocity` is not finite or not positive.
 */
export function normalizeConfig(config: Physics2DConfig): NormalizedPhysics2DConfig {
  const invalid = invalidLayerBits(config)[0];
  if (invalid !== undefined) {
    throw new GwenError(
      Physics2DErrorCodes.INVALID_LAYERS,
      `Layer "${invalid.name}" has invalid bit index ${invalid.bit}.`,
      {
        hint: __GWEN_DEV__ ? `Use an integer in [0, ${MAX_LAYERS - 1}].` : undefined,
      },
    );
  }
  const layers: Record<string, number> = {};
  if (config.layers) {
    for (const [name, bit] of Object.entries(config.layers)) {
      layers[name] = bit;
    }
  }
  if (
    config.maxLinearVelocity !== undefined &&
    (!Number.isFinite(config.maxLinearVelocity) || config.maxLinearVelocity <= 0)
  ) {
    throw new GwenConfigError("maxLinearVelocity", config.maxLinearVelocity, {
      hint: "Must be finite and greater than 0. The default is 400.",
    });
  }
  return {
    gravity: config.gravity ?? PHYSICS2D_DEFAULTS.gravity,
    gravityX: config.gravityX ?? PHYSICS2D_DEFAULTS.gravityX,
    maxLinearVelocity: config.maxLinearVelocity ?? 400,
    maxEntities: config.maxEntities ?? PHYSICS2D_DEFAULTS.maxEntities,
    qualityPreset: config.qualityPreset ?? PHYSICS2D_DEFAULTS.qualityPreset,
    eventMode: config.eventMode ?? PHYSICS2D_DEFAULTS.eventMode,
    debug: config.debug ?? PHYSICS2D_DEFAULTS.debug,
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
  return cfg.qualityPreset === "high" || cfg.qualityPreset === "esport";
}

/**
 * Resolves named layers to a u32 bitmask.
 * Created once per plugin instance at init time.
 */
export class LayerRegistry {
  private readonly bits: Record<string, number>;

  constructor(layers: Record<string, number>) {
    const count = Object.keys(layers).length;
    if (count > MAX_LAYERS) {
      throw new GwenError(
        Physics2DErrorCodes.INVALID_LAYERS,
        `Too many layers declared: ${count}.`,
        { hint: __GWEN_DEV__ ? `Declare at most ${MAX_LAYERS} layers.` : undefined },
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
  resolve(value: string[] | number | undefined, role: "membership" | "filter"): number {
    if (value === undefined) return LAYER_ALL;
    if (typeof value === "number") return value >>> 0;

    let mask = 0;
    for (const name of value) {
      const bit = this.bits[name];
      if (bit === undefined) {
        const known = Object.keys(this.bits).join(", ");
        throw new GwenError(
          Physics2DErrorCodes.UNKNOWN_LAYER,
          `Unknown layer "${name}" in ${role}. Declared layers: [${known}].`,
          {
            hint: __GWEN_DEV__ ? "Add it to Physics2DConfig.layers or fix the typo." : undefined,
          },
        );
      }
      mask |= 1 << bit;
    }
    return mask >>> 0;
  }
}
