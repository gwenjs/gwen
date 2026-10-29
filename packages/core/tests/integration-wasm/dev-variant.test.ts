import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, it, type TestContext } from "vitest";
import { createEngine } from "../../src/engine/engine-factory.js";
import type { GwenEngine } from "../../src/engine/engine-types.js";
import { WasmBridgeImpl } from "../../src/engine/wasm-bridge.js";
import { checkGwenModule, GwenWasmMismatchError } from "../../src/engine/wasm-contract.js";
import { CONTRACT as cL, createGlue as gL } from "@gwenjs/core/wasm/light/factory";
import { CONTRACT as c2, createGlue as g2 } from "@gwenjs/core/wasm/physics2d/factory";
import { CONTRACT as c3, createGlue as g3 } from "@gwenjs/core/wasm/physics3d/factory";
const VARIANTS = ["light", "physics2d", "physics3d"] as const;
type Variant = (typeof VARIANTS)[number];
const coreRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const RELEASE = {
  light: { contract: cL, createGlue: gL },
  physics2d: { contract: c2, createGlue: g2 },
  physics3d: { contract: c3, createGlue: g3 },
} as const;
function devPath(variant: Variant, name: string): string {
  return path.join(coreRoot, "wasm", `${variant}-dev`, name);
}
function field(value: unknown, key: string): unknown {
  return value !== null && typeof value === "object" ? Reflect.get(value, key) : undefined;
}
function exportImport(key: string): string | undefined {
  const parsed: unknown = JSON.parse(readFileSync(path.join(coreRoot, "package.json"), "utf8"));
  const imported = field(field(field(parsed, "exports"), key), "import");
  return typeof imported === "string" ? imported : undefined;
}
function gate(variant: Variant, ctx: TestContext): boolean {
  const release = path.join(coreRoot, "wasm", variant, "gwen_core_bg.wasm");
  if (!existsSync(release)) {
    if (process.env.CI === "true") expect(existsSync(release), "run pnpm build:wasm").toBe(true);
    process.stdout.write("skip: release artefacts absent\n");
    ctx.skip();
    return false;
  }
  for (const key of [`./wasm/${variant}-dev`, `./wasm/${variant}-dev/factory`]) {
    const imported = exportImport(key);
    expect(imported, key).toBeDefined();
    if (imported === undefined) return false;
    expect(existsSync(path.join(coreRoot, imported)), "run pnpm build:wasm").toBe(true);
  }
  expect(existsSync(devPath(variant, "gwen_core_bg.wasm")), "run pnpm build:wasm").toBe(true);
  return true;
}
for (const variant of VARIANTS) {
  it(`${variant}-dev loads through the harness wasmUrl and one advance succeeds`, async (ctx) => {
    if (!gate(variant, ctx)) return;
    const bg = devPath(variant, "gwen_core_bg.wasm");
    const bridge = new WasmBridgeImpl();
    let engine: GwenEngine | undefined;
    try {
      const jsUrl = pathToFileURL(devPath(variant, "gwen_core_factory.js")).href;
      const wasmUrl = `data:application/wasm;base64,${readFileSync(bg).toString("base64")}`;
      await bridge.init(variant, { maxEntities: 32, jsUrl, wasmUrl });
      engine = await createEngine({ variant, maxEntities: 32, debug: false, _bridge: bridge });
      await engine.startExternal();
      const id = engine.createEntity();
      await engine.advance(1 / 60);
      expect(engine.isAlive(id)).toBe(true);
    } finally {
      try {
        if (engine !== undefined) await engine.stop();
      } finally {
        bridge.dispose();
      }
    }
  });
  it(`${variant}-dev exports the same glue names as the release glue`, async (ctx) => {
    if (!gate(variant, ctx)) return;
    const loaded: unknown = await import(`@gwenjs/core/wasm/${variant}-dev/factory`);
    const createGlue = field(loaded, "createGlue");
    if (typeof createGlue !== "function") throw new Error(variant);
    const glue: unknown = Reflect.apply(createGlue, undefined, []);
    if (glue === null || typeof glue !== "object") throw new Error(variant);
    expect(Object.keys(glue).sort()).toEqual(Object.keys(RELEASE[variant].createGlue()).sort());
  });
}
it("a dev binary with the release factory rejects CORE:WASM_GLUE_MISMATCH", async (ctx) => {
  for (const variant of VARIANTS) {
    if (!gate(variant, ctx)) return;
    const bytes = Uint8Array.from(readFileSync(devPath(variant, "gwen_core_bg.wasm")));
    const module = new WebAssembly.Module(bytes);
    const parts = WebAssembly.Module.customSections(module, "gwen.build");
    expect(parts).toHaveLength(1);
    const build = parts[0];
    if (build === undefined) throw new Error("missing gwen.build");
    let thrown: unknown;
    try {
      const buildId = new TextDecoder().decode(build);
      checkGwenModule(module, { ...RELEASE[variant].contract, buildId });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(GwenWasmMismatchError);
    if (!(thrown instanceof GwenWasmMismatchError)) return;
    expect(thrown.code).toBe("CORE:WASM_GLUE_MISMATCH");
    expect(thrown.reason).toBe("fingerprint");
    for (const text of ["profile=dev", "profile=release"]) expect(thrown.message).toContain(text);
  }
});
