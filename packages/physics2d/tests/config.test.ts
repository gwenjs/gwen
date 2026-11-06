import { describe, expect, it } from "vitest";
import * as config from "../src/config";

describe("checkPhysics2DConfig", () => {
  it("checkPhysics2DConfig reports one issue per bad layer", () => {
    expect(typeof config.checkPhysics2DConfig).toBe("function");
    const check = config.checkPhysics2DConfig;
    expect(check({})).toEqual([]);
    expect(check({ layers: { floor: 0 } })).toEqual([]);
    expect(check({ layers: { top: 31 } })).toEqual([]);

    const cases = [
      ["over", 32, "32"],
      ["under", -1, "-1"],
      ["fraction", 1.5, "1.5"],
    ] as const;
    for (const [name, bit, received] of cases) {
      const issues = check({ layers: { [name]: bit } });
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({
        path: `layers.${name}`,
        expected: "an integer in [0, 31]",
        received,
      });
    }

    const both = check({ layers: { over: 32, under: -1 } });
    expect(both.map((issue) => issue.path)).toEqual(["layers.over", "layers.under"]);
  });

  it("normalizeConfig keeps invalid layers, and more than 32 layers is path layers", () => {
    expect(config.PHYSICS2D_DEFAULTS).toBeDefined();
    const defaults = config.PHYSICS2D_DEFAULTS;
    let layers: Record<string, number> | undefined;
    try {
      layers = config.normalizeConfig({ layers: { bad: 32 } }).layers;
    } catch {
      layers = undefined;
    }
    expect(layers).toEqual({ bad: 32 });

    const normalized = config.normalizeConfig({});
    expect(normalized.gravity).toBe(-9.81);
    expect(normalized.gravity).toBe(defaults.gravity);
    expect(normalized.gravityX).toBe(0);
    expect(normalized.gravityX).toBe(defaults.gravityX);
    expect(normalized.maxEntities).toBe(10_000);
    expect(normalized.maxEntities).toBe(defaults.maxEntities);
    expect(normalized.qualityPreset).toBe("medium");
    expect(normalized.qualityPreset).toBe(defaults.qualityPreset);
    expect(normalized.eventMode).toBe("pull");
    expect(normalized.eventMode).toBe(defaults.eventMode);
    expect(normalized.debug).toBe(false);
    expect(normalized.debug).toBe(defaults.debug);
    expect(config.normalizeConfig({ layers: { floor: 0, top: 31 } }).layers).toEqual({
      floor: 0,
      top: 31,
    });

    const tooMany: Record<string, number> = {};
    for (let i = 0; i < 33; i += 1) tooMany[`l${i}`] = i % 32;
    expect(config.checkPhysics2DConfig({ layers: tooMany })[0]?.path).toBe("layers");
  });

  it("normalizeConfig keeps NaN and Infinity layer bits", () => {
    const cases = [
      ["nan", Number.NaN, "NaN"],
      ["inf", Number.POSITIVE_INFINITY, "Infinity"],
    ] as const;
    for (const [name, bit, received] of cases) {
      const issues = config.checkPhysics2DConfig({ layers: { [name]: bit } });
      expect(issues).toHaveLength(1);
      expect(issues[0]?.received).toBe(received);
      let layers: Record<string, number> | undefined;
      try {
        layers = config.normalizeConfig({ layers: { [name]: bit } }).layers;
      } catch {
        layers = undefined;
      }
      expect(layers).toEqual({ [name]: bit });
    }
  });
});
