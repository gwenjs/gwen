import { describe, expect, it } from "vitest";
import { GwenError } from "@gwenjs/schema";
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

  it("normalizeConfig throws INVALID_LAYERS from the same rule, and defaults come from the constant", () => {
    expect(config.PHYSICS2D_DEFAULTS).toBeDefined();
    const defaults = config.PHYSICS2D_DEFAULTS;
    let caught: unknown;
    try {
      config.normalizeConfig({ layers: { bad: 32 } });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(GwenError);
    if (!(caught instanceof GwenError)) return;
    expect(caught.code).toBe("PHYSICS2D:INVALID_LAYERS");
    expect(caught.message).toContain('Layer "bad" has invalid bit index 32.');

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
  });

  it("normalizeConfig rejects NaN and Infinity layer bits", () => {
    const cases = [
      ["nan", Number.NaN, "NaN"],
      ["inf", Number.POSITIVE_INFINITY, "Infinity"],
    ] as const;
    for (const [name, bit, received] of cases) {
      const issues = config.checkPhysics2DConfig({ layers: { [name]: bit } });
      expect(issues).toHaveLength(1);
      expect(issues[0]?.received).toBe(received);
      let caught: unknown;
      try {
        config.normalizeConfig({ layers: { [name]: bit } });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(GwenError);
      if (!(caught instanceof GwenError)) return;
      expect(caught.code).toBe("PHYSICS2D:INVALID_LAYERS");
      expect(caught.message).toContain(`Layer "${name}" has invalid bit index ${received}.`);
    }
  });
});
