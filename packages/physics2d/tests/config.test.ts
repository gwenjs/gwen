import { describe, expect, it } from "vitest";
import { Physics2DPlugin } from "../src/index";
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
    expect(normalized.gravity).toEqual({ x: 0, y: -9.81 });
    expect(normalized.gravity).toEqual(defaults.gravity);
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

  it("normalizeConfig gravity is a Vec2 and the horizontal key is absent", () => {
    expect(config.normalizeConfig({}).gravity).toEqual({ x: 0, y: -9.81 });
    expect(config.normalizeConfig({ gravity: { y: -1 } }).gravity).toEqual({ x: 0, y: -1 });
    expect("gravityX" in config.normalizeConfig({})).toBe(false);
    expect("gravityX" in config.PHYSICS2D_DEFAULTS).toBe(false);
  });

  it("reports a non-finite gravity.y", () => {
    const issues = Physics2DPlugin({ gravity: { y: Number.NaN } }).validateOptions();
    expect(issues[0]?.path).toBe("gravity.y");
  });

  it("reports Infinity gravity and a non-finite gravity.x", () => {
    expect(
      Physics2DPlugin({ gravity: { y: Number.POSITIVE_INFINITY } }).validateOptions()[0]?.path,
    ).toBe("gravity.y");
    expect(
      Physics2DPlugin({ gravity: { y: Number.NEGATIVE_INFINITY } }).validateOptions()[0]?.path,
    ).toBe("gravity.y");
    expect(Physics2DPlugin({ gravity: { y: 0 } }).validateOptions()).toEqual([]);
    expect(Physics2DPlugin({ gravity: { x: Number.NaN } }).validateOptions()[0]?.path).toBe(
      "gravity.x",
    );
    expect(
      Physics2DPlugin({ gravity: { x: Number.POSITIVE_INFINITY } }).validateOptions()[0]?.path,
    ).toBe("gravity.x");
    expect(
      Physics2DPlugin({ gravity: { x: Number.NEGATIVE_INFINITY } }).validateOptions()[0]?.path,
    ).toBe("gravity.x");
  });

  it("freezes the default gravity object", () => {
    expect(Object.isFrozen(config.PHYSICS2D_DEFAULTS)).toBe(true);
    expect(config.PHYSICS2D_DEFAULTS.gravity).toEqual({ x: 0, y: -9.81 });
    expect(Object.isFrozen(config.PHYSICS2D_DEFAULTS.gravity)).toBe(true);
  });
});
