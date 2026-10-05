/**
 * Tests @gwenjs/vite
 * Verifies virtual module resolution and plugin options.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { gwen } from "../src/index";
import {
  generateEntryModule,
  generateScenesModule,
  generateConfigModulesVirtualModule,
  extractModuleNamesFromConfig,
} from "../src/entry-gen.js";
import { gwenVitePlugin } from "../src/plugins/index.js";

function makeTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "gwen-vite-test-"));
}

// ── Plugin instantiation ──────────────────────────────────────────────────────

describe("gwen() plugin factory", () => {
  it('returns a Vite plugin object with name "gwen"', () => {
    const [plugin] = gwen();
    expect(plugin.name).toBe("gwen");
  });

  it('enforce is "pre"', () => {
    expect(gwen()[0].enforce).toBe("pre");
  });

  it("accepts all options without throwing", () => {
    expect(() =>
      gwen({
        cratePath: "/tmp/crate",
        watch: false,
        wasmMode: "release",
        verbose: false,
      }),
    ).not.toThrow();
  });
});

describe("gwen() config hook — optimizeDeps", () => {
  it("includes @gwenjs/core and subpaths in optimizeDeps.include", async () => {
    const [plugin] = gwen();
    const config = await (plugin.config as Function)({}, { command: "serve" });
    expect(config.optimizeDeps.include).toContain("@gwenjs/core");
    expect(config.optimizeDeps.include).toContain("@gwenjs/core/system");
    expect(config.optimizeDeps.include).toContain("@gwenjs/core/actor");
    expect(config.optimizeDeps.include).toContain("@gwenjs/core/scene");
    expect(config.optimizeDeps.include).toContain("@gwenjs/core/internal");
    expect(config.optimizeDeps.include).toContain("@gwenjs/core/system/module");
    expect(config.optimizeDeps.include).toContain("@gwenjs/core/actor/module");
    expect(config.optimizeDeps.include).toContain("@gwenjs/core/scene/module");
    expect(config.optimizeDeps.include).toContain("@gwenjs/core/router/module");
    expect(config.optimizeDeps.include).toContain("@gwenjs/core/tween/module");
  });

  it("deduplicates @gwenjs/core in resolve.dedupe", async () => {
    const [plugin] = gwen();
    const config = await (plugin.config as Function)({}, { command: "serve" });
    expect(config.resolve.dedupe).toContain("@gwenjs/core");
  });
});

// ── Virtual module — resolveId ────────────────────────────────────────────────

describe("virtual:gwen-manifest — resolveId", () => {
  it("resolves virtual:gwen-manifest to internal ID", () => {
    const [plugin] = gwen();
    const resolve = plugin.resolveId as Function;
    const result = resolve("virtual:gwen-manifest");
    expect(result).toBe("\0virtual:gwen-manifest");
  });

  it("returns null for other IDs", () => {
    const [plugin] = gwen();
    const resolve = plugin.resolveId as Function;
    expect(resolve("some-other-module")).toBeNull();
    expect(resolve("./local")).toBeNull();
  });
});

// ── Virtual module — load ─────────────────────────────────────────────────────

describe("virtual:gwen-manifest — load", () => {
  it("returns JS export default with manifest JSON when no file found", () => {
    const [plugin] = gwen();
    const load = plugin.load as Function;
    const result = load("\0virtual:gwen-manifest");
    expect(result).toMatch(/^export default /);
    expect(result).toContain('"version"');
    expect(result).toContain('"plugins"');
  });

  it("returns null for non-virtual IDs", () => {
    const [plugin] = gwen();
    const load = plugin.load as Function;
    expect(load("/some/file.ts")).toBeNull();
  });

  it("injects manifest from file when manifestPath provided", () => {
    const tmp = makeTmp();
    const manifestPath = path.join(tmp, "manifest.json");
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({
        version: "1.0.0",
        plugins: [{ name: "gwen_core", type: "wasm" }],
        engine: { maxEntities: 5000 },
      }),
    );

    const [plugin] = gwen({ manifestPath });
    const load = plugin.load as Function;
    const result: string = load("\0virtual:gwen-manifest");

    expect(result).toContain("gwen_core");
    expect(result).toContain("5000");

    fs.rmSync(tmp, { recursive: true });
  });

  it("loads manifest from manifestPath when dist/gwen-manifest.json provided", () => {
    const tmp = makeTmp();
    const distDir = path.join(tmp, "dist");
    fs.mkdirSync(distDir);
    const manifestFile = path.join(distDir, "gwen-manifest.json");
    fs.writeFileSync(
      manifestFile,
      JSON.stringify({
        version: "0.2.0",
        plugins: [],
        engine: { targetFPS: 30 },
      }),
    );

    const [plugin] = gwen({ manifestPath: manifestFile });
    const load = plugin.load as Function;
    const result: string = load("\0virtual:gwen-manifest");

    fs.rmSync(tmp, { recursive: true });

    expect(result).toContain("0.2.0");
  });
});

// ── Default options ───────────────────────────────────────────────────────────

describe("plugin options defaults", () => {
  it("wasmMode defaults to debug", () => {
    // We can't easily test this directly, but we can verify the plugin
    // doesn't throw and has correct structure
    const [plugin] = gwen({ watch: false });
    expect(plugin.name).toBe("gwen");
  });

  it("watch: false skips watcher setup", () => {
    // configureServer should not start file watchers when watch: false
    const [plugin] = gwen({ watch: false, verbose: false });
    expect(plugin.configureServer).toBeDefined();
  });
});

// ── generateBundle ────────────────────────────────────────────────────────────

describe("generateBundle", () => {
  it("emits gwen-manifest.json asset", () => {
    const [plugin] = gwen();
    const emitted: any[] = [];
    const ctx = {
      emitFile: (f: any) => emitted.push(f),
    };
    (plugin.generateBundle as Function).call(ctx);

    const manifestAsset = emitted.find((asset) => asset.fileName === "gwen-manifest.json");
    expect(manifestAsset).toBeDefined();
    expect(manifestAsset.type).toBe("asset");
  });

  it("emitted manifest is valid JSON", () => {
    const [plugin] = gwen();
    const emitted: any[] = [];
    const ctx = { emitFile: (f: any) => emitted.push(f) };
    (plugin.generateBundle as Function).call(ctx);

    const manifestAsset = emitted.find((asset) => asset.fileName === "gwen-manifest.json");
    expect(manifestAsset).toBeDefined();
    expect(() => JSON.parse(manifestAsset.source)).not.toThrow();
  });
});

// ── generateEntryModule ───────────────────────────────────────────────────────

describe("generateEntryModule — bootstrap correctness", () => {
  it("imports @gwenjs/core directly — no setupGwen", () => {
    const code = generateEntryModule(false);
    expect(code).toContain('from "@gwenjs/core"');
    expect(code).not.toContain("setupGwen");
  });

  it("imports createEngine from @gwenjs/core and WasmBridgeImpl from @gwenjs/core/internal", () => {
    const code = generateEntryModule(false);
    expect(code).toContain(
      'import { createEngine, GwenLogger, consoleLogProvider } from "@gwenjs/core";',
    );
    expect(code).toContain(
      'import { engineContext, WasmBridgeImpl, detectCoreVariant, detectSharedMemoryRequired } from "@gwenjs/core/internal";',
    );
  });

  it("imports createViewportsPlugin and createScreenPlugin from @gwenjs/app", () => {
    const code = generateEntryModule(false);
    expect(code).toContain('from "@gwenjs/app"');
    expect(code).toContain("createViewportsPlugin");
    expect(code).toContain("createScreenPlugin");
  });

  it("imports virtual:gwen/local-plugins, local-modules and config-modules", () => {
    const code = generateEntryModule(false);
    expect(code).toContain('from "virtual:gwen/local-plugins"');
    expect(code).toContain('from "virtual:gwen/local-modules"');
    expect(code).toContain('from "virtual:gwen/config-modules"');
  });

  it("config modules: runs setup() for each npm module before local modules", () => {
    const code = generateEntryModule(false);
    expect(code).toContain("_cfgModules");
    expect(code).toContain("_cmMod.setup");
    const cfgIdx = code.indexOf("_cfgModules");
    const localIdx = code.indexOf("_localModules");
    expect(cfgIdx).toBeGreaterThan(0);
    expect(localIdx).toBeGreaterThan(cfgIdx);
  });

  it("no declarations: no extra static plugin imports", () => {
    const code = generateEntryModule(false, []);
    expect(code).not.toContain("_gwenPlugin0");
  });

  it("declaration with named export: generates named import", () => {
    const code = generateEntryModule(false, [
      { src: "@gwenjs/renderer-core", export: "ScreenPlugin" },
    ]);
    expect(code).toContain('import { ScreenPlugin as _gwenPlugin0 } from "@gwenjs/renderer-core"');
  });

  it("declaration without export: generates default import", () => {
    const code = generateEntryModule(false, [{ src: "@gwenjs/audio" }]);
    expect(code).toContain('import _gwenPlugin0 from "@gwenjs/audio"');
  });

  it("declaration with options: serializes options as JSON in the use() call", () => {
    const code = generateEntryModule(false, [
      { src: "@gwenjs/renderer-core", export: "ScreenPlugin", options: { fov: 75 } },
    ]);
    expect(code).toContain('await engine.use(_gwenPlugin0({"fov":75}))');
  });

  it("declaration without options: calls factory with no arguments", () => {
    const code = generateEntryModule(false, [{ src: "@gwenjs/audio", export: "AudioPlugin" }]);
    expect(code).toContain("await engine.use(_gwenPlugin0())");
  });

  it("multiple declarations: generates sequential static imports and use() calls", () => {
    const code = generateEntryModule(false, [
      { src: "@gwenjs/input", export: "InputPlugin" },
      { src: "@gwenjs/audio" },
    ]);
    expect(code).toContain("_gwenPlugin0");
    expect(code).toContain("_gwenPlugin1");
    const use0Idx = code.indexOf("engine.use(_gwenPlugin0");
    const use1Idx = code.indexOf("engine.use(_gwenPlugin1");
    expect(use0Idx).toBeGreaterThan(0);
    expect(use1Idx).toBeGreaterThan(use0Idx);
  });

  it("registers user config plugins via gwenConfig.plugins loop", () => {
    const code = generateEntryModule(false);
    expect(code).toContain("gwenConfig.plugins");
    expect(code).toContain("for (const p of gwenConfig.plugins");
  });

  it("awaits engine.start()", () => {
    const code = generateEntryModule(false);
    expect(code).toContain("await engine.start()");
  });

  it("with scenes: imports registerScenes and mainSceneFactory", () => {
    const code = generateEntryModule(true);
    expect(code).toContain("import { registerScenes, mainSceneFactory, mainScene }");
  });

  it("with scenes: wires systems via SceneRegistry adapter before start", () => {
    const code = generateEntryModule(true);
    const scenesIdx = code.indexOf("registerScenes(");
    const startIdx = code.indexOf("engine.start()");
    expect(scenesIdx).toBeGreaterThan(0);
    expect(startIdx).toBeGreaterThan(scenesIdx);
    expect(code).toContain("register(scene)");
    expect(code).toContain("engine.use(_s)");
  });

  it("without scenes: no registerScenes import or call", () => {
    const code = generateEntryModule(false);
    expect(code).not.toContain("registerScenes");
    expect(code).not.toContain("gwen-scenes");
  });

  it("local module kit: handles PluginDeclaration via dynamic import", () => {
    const code = generateEntryModule(false);
    expect(code).toContain("_lmDecls");
    expect(code).toContain('"src" in p');
    expect(code).toContain("await import(/* @vite-ignore */ d.src)");
  });

  it("local module kit: handles factory function and direct plugin alongside PluginDeclaration", () => {
    const code = generateEntryModule(false);
    expect(code).toContain('typeof p === "function"');
    expect(code).toContain("_lmPlugins.push(p())");
    expect(code).toContain("_lmPlugins.push(p)");
    expect(code).toContain("_lmDecls.push(p)");
  });
});

// ── generateConfigModulesVirtualModule ───────────────────────────────────────

describe("generateConfigModulesVirtualModule", () => {
  it("returns empty export for no modules", () => {
    const code = generateConfigModulesVirtualModule([]);
    expect(code).toBe("export const configModules = [];\n");
  });

  it("generates static import for each module via /module subpath", () => {
    const code = generateConfigModulesVirtualModule(["@gwenjs/input", "@gwenjs/physics2d"]);
    expect(code).toContain('import _cm0 from "@gwenjs/input/module"');
    expect(code).toContain('import _cm1 from "@gwenjs/physics2d/module"');
  });

  it("exports configModules array with .default fallback", () => {
    const code = generateConfigModulesVirtualModule(["@gwenjs/input"]);
    expect(code).toContain("export const configModules");
    expect(code).toContain("_cm0.default ?? _cm0");
  });
});

// ── extractModuleNamesFromConfig ──────────────────────────────────────────────

describe("extractModuleNamesFromConfig", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gwen-mod-test-"));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true });
  });

  function writeConfig(content: string): string {
    const p = path.join(tmp, "gwen.config.ts");
    fs.writeFileSync(p, content, "utf-8");
    return p;
  }

  it("returns empty array when file does not exist", () => {
    expect(extractModuleNamesFromConfig(path.join(tmp, "nonexistent.ts"))).toEqual([]);
  });

  it("returns empty array when no modules key", () => {
    const p = writeConfig("export default defineConfig({ engine: { targetFPS: 60 } })");
    expect(extractModuleNamesFromConfig(p)).toEqual([]);
  });

  it("extracts scoped package names from string entries", () => {
    const p = writeConfig(`export default defineConfig({
      modules: ['@gwenjs/input', '@gwenjs/ui'],
    })`);
    expect(extractModuleNamesFromConfig(p)).toEqual(["@gwenjs/input", "@gwenjs/ui"]);
  });

  it("extracts name from tuple [name, options] entries", () => {
    const p = writeConfig(`export default defineConfig({
      modules: ['@gwenjs/input', ['@gwenjs/physics2d', { gravity: 9.8 }]],
    })`);
    const names = extractModuleNamesFromConfig(p);
    expect(names).toContain("@gwenjs/input");
    expect(names).toContain("@gwenjs/physics2d");
  });

  it("does not extract non-package option strings", () => {
    const p = writeConfig(`export default defineConfig({
      modules: [['@gwenjs/input', { mode: 'gamepad' }]],
    })`);
    const names = extractModuleNamesFromConfig(p);
    expect(names).toEqual(["@gwenjs/input"]);
    expect(names).not.toContain("gamepad");
  });
});

// ── generateScenesModule ──────────────────────────────────────────────────────

describe("generateScenesModule — registerScenes contract", () => {
  it("empty scenes → registerScenes is a no-op", () => {
    const code = generateScenesModule([], undefined);
    expect(code).toContain("export function registerScenes(_scenes)");
    expect(code).toContain("export const mainScene = undefined");
  });
});

describe("gwenVitePlugin — async-context plugin included", () => {
  it("includes gwen:async-context plugin", () => {
    const plugins = (gwenVitePlugin() as unknown[]).flat(Infinity);
    const names = plugins
      .filter(
        (p): p is { name: string } => !!p && typeof (p as { name?: string }).name === "string",
      )
      .map((p) => p.name);
    expect(names).toContain("gwen:async-context");
  });
});

describe("gwenVitePlugin — hooks plugin included", () => {
  it("includes gwen:hooks plugin in the composite", () => {
    const plugins = (gwenVitePlugin() as unknown[]).flat(Infinity);
    const names = plugins
      .filter(
        (p): p is { name: string } => !!p && typeof (p as { name?: string }).name === "string",
      )
      .map((p) => p.name);
    expect(names).toContain("gwen:hooks");
  });
});

// ── Dev-server WASM middleware — path containment ─────────────────────────────

describe("gwen() WASM middleware — path traversal containment", () => {
  let root: string;
  let outsideWasm: string;
  let outsideJs: string;
  let handler: (
    req: { url?: string },
    res: { setHeader(k: string, v: string): void; end(b?: unknown): void },
    next: () => void,
  ) => void;

  beforeEach(() => {
    root = makeTmp();
    const pluginWasm = path.join(root, "node_modules", "@gwenjs", "gwen-plugin-demo", "wasm");
    fs.mkdirSync(pluginWasm, { recursive: true });
    fs.writeFileSync(path.join(pluginWasm, "demo.wasm"), "WASM");
    fs.writeFileSync(path.join(pluginWasm, "notes.txt"), "not servable");
    // Servable extensions, so a missing containment check would serve these.
    outsideWasm = path.join(root, "secret.wasm");
    outsideJs = path.join(root, "secret.js");
    fs.writeFileSync(outsideWasm, "SECRET_WASM");
    fs.writeFileSync(outsideJs, "SECRET_JS");

    const [plugin] = gwen({ watch: false });
    const uses: Array<typeof handler> = [];
    const fakeServer = {
      config: { root },
      watcher: { add() {}, on() {} },
      moduleGraph: { getModuleById: () => null, invalidateModule() {} },
      ws: { send() {} },
      middlewares: { use: (fn: typeof handler) => uses.push(fn) },
    };
    (plugin.configureServer as (s: unknown) => void)(fakeServer);
    const registered = uses[0];
    if (!registered) throw new Error("configureServer did not register a middleware");
    handler = registered;
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function request(url: string): { body: unknown; nextCalled: boolean } {
    let body: unknown;
    let nextCalled = false;
    handler(
      { url },
      {
        setHeader() {},
        end(b) {
          body = b;
        },
      },
      () => {
        nextCalled = true;
      },
    );
    return { body, nextCalled };
  }

  it("serves a legitimate plugin .wasm file", () => {
    const { body, nextCalled } = request("/wasm/demo.wasm");
    expect(nextCalled).toBe(false);
    expect(String(body)).toBe("WASM");
  });

  it("rejects `..` traversal to a .wasm file outside the wasm directory", () => {
    const { body, nextCalled } = request("/wasm/../../../../secret.wasm");
    expect(body).toBeUndefined();
    expect(nextCalled).toBe(true);
  });

  it("rejects `..` traversal to a .js file outside the wasm directory", () => {
    const { body, nextCalled } = request("/wasm/../../../../secret.js");
    expect(body).toBeUndefined();
    expect(nextCalled).toBe(true);
  });

  it("rejects fully encoded %2e%2e%2f traversal to a .wasm file", () => {
    const encoded = "%2e%2e%2f".repeat(4) + "secret.wasm";
    const { body, nextCalled } = request(`/wasm/${encoded}`);
    expect(body).toBeUndefined();
    expect(nextCalled).toBe(true);
  });

  it("rejects fully encoded %2e%2e%2f traversal to a .js file", () => {
    const encoded = "%2e%2e%2f".repeat(4) + "secret.js";
    const { body, nextCalled } = request(`/wasm/${encoded}`);
    expect(body).toBeUndefined();
    expect(nextCalled).toBe(true);
  });

  it("rejects an absolute path to a .wasm file outside the wasm directory", () => {
    const { body, nextCalled } = request(`/wasm/${outsideWasm}`);
    expect(body).toBeUndefined();
    expect(nextCalled).toBe(true);
  });

  it("rejects an absolute path to a .js file outside the wasm directory", () => {
    const { body, nextCalled } = request(`/wasm/${outsideJs}`);
    expect(body).toBeUndefined();
    expect(nextCalled).toBe(true);
  });

  it("rejects files with non-WASM extensions even inside the directory", () => {
    const { body, nextCalled } = request("/wasm/notes.txt");
    expect(body).toBeUndefined();
    expect(nextCalled).toBe(true);
  });
});
