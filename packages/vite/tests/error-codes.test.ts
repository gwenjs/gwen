/**
 * Vite plugin throws use ViteErrorCodes and the GWEN grammar.
 * packages/vite/src is Node-side, so the hint follows NODE_ENV.
 */
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { GwenError } from "@gwenjs/schema";
import { CodeGenerator } from "../src/optimizer/code-generator.js";
import { ComponentManifest } from "../src/optimizer/component-manifest.js";
import { gwenWasmPlugin } from "../src/plugins/wasm.js";

const RESOLVED_ID = "\0virtual:gwen/wasm";
const WASM_SEE =
  "See https://gwenjs.github.io/gwen/api/errors#vite-wasm-not-found (VITE:WASM_NOT_FOUND)";
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

function loadMissingWasm(wasmPath: string): unknown {
  const plugin = gwenWasmPlugin({ wasm: { wasmPath } });
  if (typeof plugin.configResolved !== "function") {
    throw new Error("configResolved hook missing");
  }
  plugin.configResolved.call({} as never, { command: "serve" } as never);
  const load = plugin.load;
  if (typeof load !== "function") throw new Error("load hook missing");
  try {
    load.call({} as never, RESOLVED_ID);
    return undefined;
  } catch (err) {
    return err;
  }
}

function asGwenError(value: unknown): GwenError {
  expect(value).toBeInstanceOf(GwenError);
  if (!(value instanceof GwenError)) throw new Error("expected GwenError");
  return value;
}

describe("ViteErrorCodes", () => {
  it("a missing wasm throws VITE:WASM_NOT_FOUND without a tag", async () => {
    const wasmPath = resolve(join(tmpdir(), `gwen-missing-p648-${process.pid}.wasm`));
    const hint = "Run 'cargo build --target wasm32-unknown-unknown' first.";
    const what = `WASM binary not found at ${wasmPath}.`;

    const dev = asGwenError(withNodeEnv("development", () => loadMissingWasm(wasmPath)));
    expect(dev.message.split("\n")[0]).toBe(`[GWEN] ${what}`);
    expect(dev.message).toBe(grammar(what, hint, WASM_SEE, true));
    expect(dev.code).toBe("VITE:WASM_NOT_FOUND");
    expect(dev.message.includes("[gwen:wasm]")).toBe(false);

    const prod = asGwenError(withNodeEnv("production", () => loadMissingWasm(wasmPath)));
    expect(prod.message).toBe(grammar(what, hint, WASM_SEE, false));
    expect(prod.message.includes("Fix:")).toBe(false);
    expect(prod.code).toBe("VITE:WASM_NOT_FOUND");

    const entry: Record<string, unknown> = await import("@gwenjs/vite");
    expect(entry["ViteErrorCodes"]).toEqual({
      WASM_NOT_FOUND: "VITE:WASM_NOT_FOUND",
      OPTIMIZER_UNKNOWN_COMPONENT: "VITE:OPTIMIZER_UNKNOWN_COMPONENT",
      OPTIMIZER_UNKNOWN_FIELD: "VITE:OPTIMIZER_UNKNOWN_FIELD",
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
