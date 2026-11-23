/**
 * Tests for Physics3D plugin configuration normalization.
 */
import { describe, it, expect } from "vitest";
import { GwenConfigError } from "@gwenjs/core";
import { GwenError } from "@gwenjs/schema";
import { Physics3DErrorCodes } from "../src/errors/codes";
import {
  DEFAULT_PHYSICS3D_CONFIG,
  normalizePhysics3DConfig,
  buildLayerRegistry,
  resolveLayerBits,
} from "../src/config";
import { QUALITY_PRESETS } from "../src/types";

describe("normalizePhysics3DConfig", () => {
  it("applies full defaults on empty input", () => {
    const cfg = normalizePhysics3DConfig();
    expect(cfg).toEqual(DEFAULT_PHYSICS3D_CONFIG);
  });

  it("stores a full gravity object whole", () => {
    const gravity = { x: 1, y: -3, z: 2 };
    const cfg = normalizePhysics3DConfig({ gravity });
    expect(cfg.gravity).toBe(gravity);
  });

  it("overrides maxEntities", () => {
    const cfg = normalizePhysics3DConfig({ maxEntities: 2048 });
    expect(cfg.maxEntities).toBe(2048);
    expect(cfg.gravity).toEqual(DEFAULT_PHYSICS3D_CONFIG.gravity);
  });

  it("defaults qualityPreset to medium", () => {
    const cfg = normalizePhysics3DConfig();
    expect(cfg.qualityPreset).toBe("medium");
  });

  it("accepts all quality preset values", () => {
    for (const preset of ["low", "medium", "high", "esport"] as const) {
      const cfg = normalizePhysics3DConfig({ qualityPreset: preset });
      expect(cfg.qualityPreset).toBe(preset);
    }
  });

  it("defaults debug to false", () => {
    const cfg = normalizePhysics3DConfig();
    expect(cfg.debug).toBe(false);
  });

  it("enables debug mode", () => {
    const cfg = normalizePhysics3DConfig({ debug: true });
    expect(cfg.debug).toBe(true);
  });

  it("defaults coalesceEvents to true", () => {
    const cfg = normalizePhysics3DConfig();
    expect(cfg.coalesceEvents).toBe(true);
  });

  it("allows disabling coalesceEvents", () => {
    const cfg = normalizePhysics3DConfig({ coalesceEvents: false });
    expect(cfg.coalesceEvents).toBe(false);
  });

  it("defaults layers to empty array", () => {
    const cfg = normalizePhysics3DConfig();
    expect(cfg.layers).toEqual([]);
  });

  it("defaults layers to an empty record", () => {
    const cfg = normalizePhysics3DConfig();
    expect(cfg.layers).toEqual({});
    expect(DEFAULT_PHYSICS3D_CONFIG.layers).toEqual({});
  });

  it("stores provided layer names", () => {
    const cfg = normalizePhysics3DConfig({ layers: ["default", "player", "enemy"] });
    expect(cfg.layers).toEqual(["default", "player", "enemy"]);
  });

  it("rejects a cap that is not finite or not positive", () => {
    for (const value of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      let caught: unknown;
      try {
        normalizePhysics3DConfig({ maxLinearVelocity: value });
      } catch (err: unknown) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(GwenConfigError);
      if (!(caught instanceof GwenConfigError)) {
        throw new Error("expected GwenConfigError");
      }
      expect(caught.code).toBe("CORE:INVALID_CONFIG");
      expect(caught.field).toBe("maxLinearVelocity");
      expect(caught.hint).toBe(
        __GWEN_DEV__ ? "Must be finite and greater than 0. The default is 400." : undefined,
      );
    }
    expect(normalizePhysics3DConfig({}).maxLinearVelocity).toBe(400);
    expect(normalizePhysics3DConfig({ maxLinearVelocity: 50 }).maxLinearVelocity).toBe(50);
  });
});

describe("layer record", () => {
  it("layers as a record with explicit bits; 33 layers throw", () => {
    const many: Record<string, number> = {};
    for (let i = 0; i < 33; i += 1) many[`layer${i}`] = 0;
    requireGwenError(
      caughtError(() => {
        buildLayerRegistry(many);
      }),
      Physics3DErrorCodes.INVALID_LAYERS,
      "at most 32 layers, received 33",
    );

    requireGwenError(
      caughtError(() => {
        buildLayerRegistry({ tooHigh: 32 });
      }),
      Physics3DErrorCodes.INVALID_LAYERS,
      'Layer "tooHigh" bit 32 is outside 0..31.',
    );
    requireGwenError(
      caughtError(() => {
        buildLayerRegistry({ negative: -1 });
      }),
      Physics3DErrorCodes.INVALID_LAYERS,
      'Layer "negative" bit -1 is outside 0..31.',
    );
    requireGwenError(
      caughtError(() => {
        buildLayerRegistry({ fraction: 1.5 });
      }),
      Physics3DErrorCodes.INVALID_LAYERS,
      'Layer "fraction" bit 1.5 is outside 0..31.',
    );

    const cfg = normalizePhysics3DConfig({ layers: { ground: 3 } });
    const registry = buildLayerRegistry(cfg.layers);
    expect(resolveLayerBits(["ground"], registry)).toBe(8);
    requireGwenError(
      caughtError(() => {
        resolveLayerBits(["missing"], registry);
      }),
      Physics3DErrorCodes.UNKNOWN_LAYER,
      'Unknown layer "missing"',
    );
    expect(resolveLayerBits(undefined, registry)).toBe(0xffffffff);
    expect(resolveLayerBits([], registry)).toBe(0xffffffff);
  });
});

describe("QUALITY_PRESETS", () => {
  it("maps preset names to numeric codes", () => {
    expect(QUALITY_PRESETS.low).toBe(0);
    expect(QUALITY_PRESETS.medium).toBe(1);
    expect(QUALITY_PRESETS.high).toBe(2);
    expect(QUALITY_PRESETS.esport).toBe(3);
  });
});

describe("buildLayerRegistry", () => {
  it("maps each layer name to its bit position", () => {
    const reg = buildLayerRegistry(["default", "player", "enemy"]);
    expect(reg.get("default")).toBe(1);
    expect(reg.get("player")).toBe(2);
    expect(reg.get("enemy")).toBe(4);
  });

  it("caps at 32 layers", () => {
    const names = Array.from({ length: 40 }, (_, i) => `layer${i}`);
    const reg = buildLayerRegistry(names);
    expect(reg.size).toBe(32);
  });

  it("returns empty map for empty input", () => {
    expect(buildLayerRegistry([])).toEqual(new Map());
  });
});

describe("resolveLayerBits", () => {
  const registry = buildLayerRegistry(["default", "player", "enemy", "ground"]);

  it("returns 0xFFFFFFFF for undefined names", () => {
    expect(resolveLayerBits(undefined, registry)).toBe(0xffffffff);
  });

  it("returns 0xFFFFFFFF for empty array", () => {
    expect(resolveLayerBits([], registry)).toBe(0xffffffff);
  });

  it("resolves a single layer name", () => {
    expect(resolveLayerBits(["player"], registry)).toBe(2);
  });

  it("combines multiple layer names into a bitmask", () => {
    expect(resolveLayerBits(["default", "enemy"], registry)).toBe(1 | 4);
  });

  it("throws on unknown layer names with a helpful message", () => {
    expect(() => resolveLayerBits(["unknown"], registry)).toThrow(
      '[GWEN] Unknown layer "unknown". Declared layers: [default, player, enemy, ground].',
    );
  });

  it("throws on first unknown in a mixed valid/invalid list", () => {
    expect(() => resolveLayerBits(["player", "typo"], registry)).toThrow(
      '[GWEN] Unknown layer "typo".',
    );
  });

  it("produces unsigned 32-bit value", () => {
    const big = buildLayerRegistry(Array.from({ length: 32 }, (_, i) => `l${i}`));
    const result = resolveLayerBits(
      Array.from({ length: 32 }, (_, i) => `l${i}`),
      big,
    );
    expect(result >>> 0).toBe(result);
  });
});

function caughtError(run: () => void): unknown {
  try {
    run();
  } catch (error: unknown) {
    return error;
  }
  return undefined;
}

function requireGwenError(error: unknown, code: string, message: string): void {
  expect(error).toBeInstanceOf(GwenError);
  if (!(error instanceof GwenError)) {
    throw new Error("expected GwenError");
  }
  expect(error.code).toBe(code);
  expect(error.message).toContain(message);
}

function isBitRecord(value: unknown): value is Record<string, number> {
  return typeof value === "object" && value !== null;
}

function bitsOrMinus(names: string[], reg: ReturnType<typeof buildLayerRegistry>): number {
  try {
    return resolveLayerBits(names, reg);
  } catch {
    return -1;
  }
}

describe("layer own keys", () => {
  it("rejects inherited names, bad bits, and a source record changed after build", () => {
    const layers: Record<string, number> = { ground: 3 };
    const reg = buildLayerRegistry(layers);
    expect(bitsOrMinus(["ground"], reg)).toBe(8);
    for (const name of ["toString", "constructor", "__proto__"] as const) {
      requireGwenError(
        caughtError(() => resolveLayerBits([name], reg)),
        Physics3DErrorCodes.UNKNOWN_LAYER,
        name,
      );
    }
    layers.late = 40;
    layers.ground = 0;
    expect(bitsOrMinus(["ground"], reg)).toBe(8);
    requireGwenError(
      caughtError(() => resolveLayerBits(["late"], reg)),
      Physics3DErrorCodes.UNKNOWN_LAYER,
      "late",
    );
    for (const bit of [Number.NaN, Number.POSITIVE_INFINITY]) {
      requireGwenError(
        caughtError(() => buildLayerRegistry({ n: bit })),
        "PHYSICS3D:INVALID_LAYERS",
        String(bit),
      );
    }
    const error = caughtError(() => resolveLayerBits(["missing"], reg));
    requireGwenError(error, Physics3DErrorCodes.UNKNOWN_LAYER, "missing");
    if (!(error instanceof GwenError)) throw new Error("expected GwenError");
    expect(error.message).toContain("Declared layers: [ground]");
    expect(error.hint).toBe(
      __GWEN_DEV__ ? "Add it to Physics3DConfig.layers or fix the typo." : undefined,
    );
    const parsed: unknown = JSON.parse('{"__proto__": 1}');
    if (!isBitRecord(parsed)) throw new Error("expected a layer record");
    const before = Object.getOwnPropertyDescriptor(Object.prototype, "__proto__")?.get;
    const protoReg = buildLayerRegistry(parsed);
    parsed.late = 4;
    expect(Object.getOwnPropertyDescriptor(Object.prototype, "__proto__")?.get).toBe(before);
    expect(bitsOrMinus(["__proto__"], protoReg)).toBe(2);
    requireGwenError(
      caughtError(() => resolveLayerBits(["late"], protoReg)),
      Physics3DErrorCodes.UNKNOWN_LAYER,
      "late",
    );
  });

  it("resolves all 32 named bits to 0xffffffff", () => {
    const layers: Record<string, number> = {};
    const names: string[] = [];
    for (let i = 0; i < 32; i += 1) {
      const name = `l${i}`;
      layers[name] = i;
      names.push(name);
    }
    expect(bitsOrMinus(names, buildLayerRegistry(layers))).toBe(0xffffffff);
  });
});
