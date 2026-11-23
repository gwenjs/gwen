/**
 * Shared material lookup. A missing export fails on the returned value.
 */

import { describe, expect, it } from "vitest";
import * as api from "../src/index.js";

const DEFAULT = { friction: 0.5, restitution: 0, density: 1 };
const ICE = { friction: 0.02, restitution: 0, density: 0.9 };

const TABLE = {
  default: DEFAULT,
  ice: ICE,
};

describe("resolveMaterial", () => {
  it("resolves a preset name to its row of the table", () => {
    const row = api.resolveMaterial?.("ice", TABLE);
    expect(row).toEqual(ICE);
    expect(api.resolveMaterial?.("ice", TABLE)).toEqual(row);
    const other = {
      default: { friction: 1, restitution: 1, density: 1 },
      ice: { friction: 0.1, restitution: 0.2, density: 0.3 },
    };
    expect(api.resolveMaterial?.("ice", other)).toEqual(other.ice);
    expect(api.resolveMaterial?.("ice", TABLE)).toEqual(ICE);
  });

  it("an absent name resolves to the default row", () => {
    expect(api.resolveMaterial?.(undefined, TABLE)).toEqual(DEFAULT);
  });

  it("a name outside the table resolves to undefined", () => {
    expect(api.resolveMaterial?.("ice", TABLE)).toEqual(ICE);
    expect(api.resolveMaterial?.("wood", TABLE)).toBeUndefined();
    expect(api.resolveMaterial?.("", TABLE)).toBeUndefined();
  });

  it("an inherited name such as toString, constructor or __proto__ resolves to undefined", () => {
    const parent = {
      wood: { friction: 4, restitution: 4, density: 4 },
    };
    const table = Object.assign(Object.create(parent), { default: DEFAULT });
    expect(api.resolveMaterial?.("default", table)).toEqual(DEFAULT);
    expect(api.resolveMaterial?.("toString", table)).toBeUndefined();
    expect(api.resolveMaterial?.("constructor", table)).toBeUndefined();
    expect(api.resolveMaterial?.("__proto__", table)).toBeUndefined();
    expect(api.resolveMaterial?.("wood", table)).toBeUndefined();
  });

  it("the shared preset names are default, ice and rubber", () => {
    expect(api.SHARED_MATERIAL_PRESETS).toEqual(["default", "ice", "rubber"]);
  });
});
