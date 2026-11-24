/**
 * Vite plugin throws use ViteErrorCodes and the GWEN grammar.
 * packages/vite/src is Node-side, so the hint follows NODE_ENV.
 */
import { describe, expect, it } from "vitest";
import { GwenError } from "@gwenjs/schema";
import { CodeGenerator } from "../src/optimizer/code-generator.js";
import { ComponentManifest } from "../src/optimizer/component-manifest.js";

const COMPONENT_SEE =
  "See https://gwenjs.github.io/gwen/api/errors#vite-optimizer-unknown-component (VITE:OPTIMIZER_UNKNOWN_COMPONENT)";
const FIELD_SEE =
  "See https://gwenjs.github.io/gwen/api/errors#vite-optimizer-unknown-field (VITE:OPTIMIZER_UNKNOWN_FIELD)";

function grammar(what: string, hint: string, see: string, dev: boolean): string {
  const fix = dev ? `\nFix: ${hint}` : "";
  return `[GWEN] ${what}${fix}\n${see}`;
}

function withNodeEnv<T>(nodeEnv: string, run: () => T): T {
  const previous = process.env["NODE_ENV"];
  process.env["NODE_ENV"] = nodeEnv;
  try {
    return run();
  } finally {
    if (previous === undefined) delete process.env["NODE_ENV"];
    else process.env["NODE_ENV"] = previous;
  }
}

function asGwenError(value: unknown): GwenError {
  expect(value).toBeInstanceOf(GwenError);
  if (!(value instanceof GwenError)) throw new Error("expected GwenError");
  return value;
}

describe("ViteErrorCodes", () => {
  it("holds exactly the codes @gwenjs/vite throws", async () => {
    const entry: Record<string, unknown> = await import("@gwenjs/vite");
    expect(entry["ViteErrorCodes"]).toEqual({
      OPTIMIZER_UNKNOWN_COMPONENT: "VITE:OPTIMIZER_UNKNOWN_COMPONENT",
      OPTIMIZER_UNKNOWN_FIELD: "VITE:OPTIMIZER_UNKNOWN_FIELD",
      SCENE_NAME_UNRESOLVED: "VITE:SCENE_NAME_UNRESOLVED",
      SCENE_NAME_DUPLICATE: "VITE:SCENE_NAME_DUPLICATE",
      MAIN_SCENE_UNKNOWN: "VITE:MAIN_SCENE_UNKNOWN",
      TRANSFORM_PARSE_FAILED: "VITE:TRANSFORM_PARSE_FAILED",
      TRANSFORM_EDIT_CONFLICT: "VITE:TRANSFORM_EDIT_CONFLICT",
      TRANSFORM_UNSUPPORTED: "VITE:TRANSFORM_UNSUPPORTED",
      BVH_PREBAKE_FAILED: "VITE:BVH_PREBAKE_FAILED",
    });
  });

  it("an unknown component or field in the code generator throws the VITE:OPTIMIZER_* code without a tag", () => {
    const componentHint = "Register the component before generating bulk code.";
    const fieldHint = "Use a field that the component manifest lists.";
    const empty = new CodeGenerator(new ComponentManifest(), "core");

    const read = asGwenError(
      withNodeEnv("development", () => {
        try {
          empty.generateBulkRead(["Pos"], "Pos");
          return undefined;
        } catch (err) {
          return err;
        }
      }),
    );
    expect(read.message.split("\n")[0]).toBe("[GWEN] Unknown component: Pos.");
    expect(read.message).toBe(
      grammar("Unknown component: Pos.", componentHint, COMPONENT_SEE, true),
    );
    expect(read.code).toBe("VITE:OPTIMIZER_UNKNOWN_COMPONENT");
    expect(read.message.includes("[gwen:optimizer]")).toBe(false);

    const write = asGwenError(
      withNodeEnv("production", () => {
        try {
          empty.generateBulkWrite("Pos", "_slots", "_gens", "_data");
          return undefined;
        } catch (err) {
          return err;
        }
      }),
    );
    expect(write.message).toBe(
      grammar("Unknown component: Pos.", componentHint, COMPONENT_SEE, false),
    );
    expect(write.code).toBe("VITE:OPTIMIZER_UNKNOWN_COMPONENT");
    expect(write.message.includes("Fix:")).toBe(false);

    const accessor = asGwenError(
      withNodeEnv("development", () => {
        try {
          empty.generateFieldAccessor("Pos", "x", "i", "_pos");
          return undefined;
        } catch (err) {
          return err;
        }
      }),
    );
    expect(accessor.message.split("\n")[0]).toBe("[GWEN] Unknown component: Pos.");
    expect(accessor.code).toBe("VITE:OPTIMIZER_UNKNOWN_COMPONENT");

    const manifest = new ComponentManifest();
    manifest.register({
      name: "Position",
      typeId: 1,
      byteSize: 8,
      f32Stride: 2,
      fields: [{ name: "x", type: "f32", byteOffset: 0 }],
      importPath: "./position.ts",
      exportName: "Position",
    });
    const known = new CodeGenerator(manifest, "core");
    const field = asGwenError(
      withNodeEnv("development", () => {
        try {
          known.generateFieldAccessor("Position", "y", "i", "_pos");
          return undefined;
        } catch (err) {
          return err;
        }
      }),
    );
    expect(field.message.split("\n")[0]).toBe("[GWEN] Unknown field: Position.y.");
    expect(field.message).toBe(grammar("Unknown field: Position.y.", fieldHint, FIELD_SEE, true));
    expect(field.code).toBe("VITE:OPTIMIZER_UNKNOWN_FIELD");
    expect(field.message.includes("[gwen:optimizer]")).toBe(false);
  });
});
