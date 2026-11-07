import type { Physics2DConfig, QualityPreset } from "./types";
import { GwenConfigError } from "@gwenjs/core";
import { formatReceived, type GwenConfigIssue } from "@gwenjs/schema";
import { LAYER_ALL, MAX_LAYERS } from "@gwenjs/physics-core";

export { LAYER_ALL, MAX_LAYERS };

/** Pixel to meter ratio used for internal conversions. */
export const PIXELS_PER_METER = 50;

/**
 * Defaults shared by `normalizeConfig` and the physics2d module.
 * `maxLinearVelocity` and `coalesceEvents` stay plugin-only.
 */
export const PHYSICS2D_DEFAULTS = Object.freeze({
  gravity: Object.freeze({ x: 0, y: -9.81 }),
  maxEntities: 10_000,
  qualityPreset: "medium",
  eventMode: "pull",
  debug: false,
} as const);

type InvalidLayerBit = {
  name: string;
  bit: unknown;
};

function invalidLayerBits(config: Readonly<Physics2DConfig>): InvalidLayerBit[] {
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

function layerBitIssues(config: Readonly<Physics2DConfig>): GwenConfigIssue[] {
  return invalidLayerBits(config).map((layer) => ({
    path: `layers.${layer.name}`,
    expected: `an integer in [0, ${MAX_LAYERS - 1}]`,
    received: formatReceived(layer.bit),
    owner: "@gwenjs/physics2d",
  }));
}

function componentIssue(
  path: "gravity.x" | "gravity.y",
  value: number | undefined,
): GwenConfigIssue[] {
  if (value === undefined || Number.isFinite(value)) return [];
  return [
    {
      path,
      expected: "a finite number",
      received: formatReceived(value),
      owner: "@gwenjs/physics2d",
    },
  ];
}

function gravityIssues(config: Readonly<Physics2DConfig>): GwenConfigIssue[] {
  return [
    ...componentIssue("gravity.y", config.gravity?.y),
    ...componentIssue("gravity.x", config.gravity?.x),
  ];
}

/**
 * Layer rules. A bad bit uses path `layers.<name>`.
 * More than {@link MAX_LAYERS} layers uses path `layers`.
 * A non-finite `gravity.x` or `gravity.y` uses that path.
 */
export function checkPhysics2DConfig(config: Readonly<Physics2DConfig>): GwenConfigIssue[] {
  const issues = [...gravityIssues(config), ...layerBitIssues(config)];
  const layers = config.layers;
  if (layers !== undefined && layers !== null && Object.keys(layers).length > MAX_LAYERS) {
    issues.push({
      path: "layers",
      expected: `at most ${MAX_LAYERS} layers`,
      received: formatReceived(Object.keys(layers).length),
      owner: "@gwenjs/physics2d",
    });
  }
  return issues;
}

/**
 * Normalized internal configuration for the Physics2D plugin.
 */
export type NormalizedPhysics2DConfig = {
  gravity: { x: number; y: number };
  maxLinearVelocity: number;
  maxEntities: number;
  qualityPreset: QualityPreset;
  eventMode: "pull" | "hybrid";
  debug: boolean;
  coalesceEvents: boolean;
  ccdEnabled?: boolean;
  layers: Record<string, number>;
};

/**
 * Normalizes user-provided configuration.
 * Layer bits are copied as given. {@link checkPhysics2DConfig} reports bad bits and counts.
 * @throws {GwenConfigError} If `maxLinearVelocity` is not finite or not positive.
 */
export function normalizeConfig(config: Physics2DConfig): NormalizedPhysics2DConfig {
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
  const gravity = {
    x: config.gravity?.x ?? PHYSICS2D_DEFAULTS.gravity.x,
    y: config.gravity?.y ?? PHYSICS2D_DEFAULTS.gravity.y,
  };
  return {
    gravity,
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
