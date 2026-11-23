/**
 * 3D material table and the typed unknown-material error.
 */

import { describe, expect, it } from "vitest";
import { GwenError } from "@gwenjs/schema";
import * as core from "@gwenjs/physics-core";
import { resolveColliderMaterial } from "../src/plugin/physics3d-utils";
import { PHYSICS3D_MATERIAL_PRESETS } from "../src/types";

const ROWS = {
  default: { friction: 0.5, restitution: 0.0, density: 1.0 },
  ice: { friction: 0.02, restitution: 0.0, density: 0.9 },
  rubber: { friction: 1.2, restitution: 0.6, density: 1.2 },
};

describe("physics3d materials", () => {
  it("the 3D table has a row for every shared preset name", () => {
    const names = core.SHARED_MATERIAL_PRESETS;
    expect(names).toEqual(["default", "ice", "rubber"]);
    for (const name of names ?? []) {
      expect(PHYSICS3D_MATERIAL_PRESETS[name]).toEqual(ROWS[name]);
    }
  });

  it("resolveColliderMaterial throws PHYSICS3D:UNKNOWN_MATERIAL for a name outside the table", () => {
    expect(() => resolveColliderMaterial({ material: "wood" })).toThrow(GwenError);
    let caught: unknown;
    try {
      resolveColliderMaterial({ material: "wood" });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(GwenError);
    if (!(caught instanceof GwenError)) return;
    expect(caught.code).toBe("PHYSICS3D:UNKNOWN_MATERIAL");
    expect(caught.composable).toBe("Physics3DPlugin");
  });

  it("resolveColliderMaterial rejects an inherited name", () => {
    expect(() => resolveColliderMaterial({ material: "toString" })).toThrow(GwenError);
    expect(() => resolveColliderMaterial({ material: "constructor" })).toThrow(GwenError);
    expect(() => resolveColliderMaterial({ material: "__proto__" })).toThrow(GwenError);
  });
});
