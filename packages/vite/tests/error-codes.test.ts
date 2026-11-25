/**
 * Vite plugin throws use ViteErrorCodes and the GWEN grammar.
 * packages/vite/src is Node-side, so the hint follows NODE_ENV.
 */
import { describe, expect, it } from "vitest";

describe("ViteErrorCodes", () => {
  it("holds exactly the codes @gwenjs/vite throws", async () => {
    const entry: Record<string, unknown> = await import("@gwenjs/vite");
    expect(entry["ViteErrorCodes"]).toEqual({
      SCENE_NAME_UNRESOLVED: "VITE:SCENE_NAME_UNRESOLVED",
      SCENE_NAME_DUPLICATE: "VITE:SCENE_NAME_DUPLICATE",
      MAIN_SCENE_UNKNOWN: "VITE:MAIN_SCENE_UNKNOWN",
      TRANSFORM_PARSE_FAILED: "VITE:TRANSFORM_PARSE_FAILED",
      TRANSFORM_EDIT_CONFLICT: "VITE:TRANSFORM_EDIT_CONFLICT",
      TRANSFORM_UNSUPPORTED: "VITE:TRANSFORM_UNSUPPORTED",
      TRANSFORM_UNIT_FAILED: "VITE:TRANSFORM_UNIT_FAILED",
      BVH_PREBAKE_FAILED: "VITE:BVH_PREBAKE_FAILED",
      VARIANT_REQUIRED: "VITE:VARIANT_REQUIRED",
      WASM_MODULE_DUPLICATE: "VITE:WASM_MODULE_DUPLICATE",
    });
  });
});
