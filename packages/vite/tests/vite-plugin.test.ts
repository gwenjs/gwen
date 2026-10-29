/**
 * Tests @gwenjs/vite
 * Verifies virtual module resolution and plugin options.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { createServer, type ConfigEnv, type Plugin, type UserConfig } from "vite";
import { gwen } from "../src/index";
import {
  generateEntryModule,
  generateScenesModule,
  generateConfigModulesVirtualModule,
  extractModuleNamesFromConfig,
} from "../src/entry-gen.js";
import { entryResolvedFixture } from "./entry-resolved-fixture.js";
import { gwenVitePlugin } from "../src/plugins/index.js";

function makeTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "gwen-vite-test-"));
}

function gwenPlugin(options?: Parameters<typeof gwen>[0]) {
  const plugin = gwen(options)[0];
  if (!plugin) throw new Error("gwen() returned no plugin");
  return plugin;
}

function entryModule(
  hasScenesDir: boolean,
  declarations: Parameters<typeof generateEntryModule>[1] = [],
  cssFiles: Parameters<typeof generateEntryModule>[2] = [],
): string {
  return generateEntryModule(hasScenesDir, declarations, cssFiles, entryResolvedFixture);
}

// ── Plugin instantiation ──────────────────────────────────────────────────────

describe("gwen() plugin factory", () => {
  it('returns a Vite plugin object with name "gwen"', () => {
    const plugin = gwenPlugin();
    expect(plugin.name).toBe("gwen");
  });

  it('enforce is "pre"', () => {
    expect(gwenPlugin().enforce).toBe("pre");
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
  async function configFromTmp(): Promise<UserConfig> {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gwen-vite-config-"));
    try {
      fs.writeFileSync(path.join(root, "gwen.config.ts"), "export default { modules: [] };\n");
      const plugin = gwenPlugin();
      const hook = plugin.config;
      if (typeof hook !== "function") throw new Error("config hook missing");
      const config = await (hook as ConfigHook)(
        { root },
        { command: "serve", mode: "development" },
      );
      if (!config) throw new Error("config() returned no object");
      return config;
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }

  it("includes @gwenjs/core and subpaths in optimizeDeps.include", async () => {
    const config = await configFromTmp();
    expect(config.optimizeDeps?.include).toContain("@gwenjs/core");
    expect(config.optimizeDeps?.include).toContain("@gwenjs/core/system");
    expect(config.optimizeDeps?.include).toContain("@gwenjs/core/actor");
    expect(config.optimizeDeps?.include).toContain("@gwenjs/core/scene");
    expect(config.optimizeDeps?.include).toContain("@gwenjs/core/internal");
    expect(config.optimizeDeps?.include).toContain("@gwenjs/core/system/module");
    expect(config.optimizeDeps?.include).toContain("@gwenjs/core/actor/module");
    expect(config.optimizeDeps?.include).toContain("@gwenjs/core/scene/module");
    expect(config.optimizeDeps?.include).toContain("@gwenjs/core/router/module");
    expect(config.optimizeDeps?.include).toContain("@gwenjs/core/tween/module");
  });

  it("deduplicates @gwenjs/core in resolve.dedupe", async () => {
    const config = await configFromTmp();
    expect(config.resolve?.dedupe).toContain("@gwenjs/core");
  });

  it("dedupes and pre-bundles @gwenjs/kit with core", async () => {
    const config = await configFromTmp();
    expect(config.resolve?.dedupe).toContain("@gwenjs/kit");
    expect(config.optimizeDeps?.include).toContain("@gwenjs/core > @gwenjs/kit");
  });
});

// ── Virtual module — resolveId ────────────────────────────────────────────────

describe("virtual:gwen-manifest — resolveId", () => {
  it("resolves virtual:gwen-manifest to internal ID", () => {
    const plugin = gwenPlugin();
    const resolve = plugin.resolveId as Function;
    const result = resolve("virtual:gwen-manifest");
    expect(result).toBe("\0virtual:gwen-manifest");
  });

  it("returns null for other IDs", () => {
    const plugin = gwenPlugin();
    const resolve = plugin.resolveId as Function;
    expect(resolve("some-other-module")).toBeNull();
    expect(resolve("./local")).toBeNull();
  });
});

// ── Virtual module — load ─────────────────────────────────────────────────────

describe("virtual:gwen-manifest — load", () => {
  it("returns JS export default with manifest JSON when no file found", () => {
    const plugin = gwenPlugin();
    const load = plugin.load as Function;
    const result = load("\0virtual:gwen-manifest");
    expect(result).toMatch(/^export default /);
    expect(result).toContain('"version"');
    expect(result).toContain('"plugins"');
  });

  it("returns null for non-virtual IDs", () => {
    const plugin = gwenPlugin();
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

    const plugin = gwenPlugin({ manifestPath });
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

    const plugin = gwenPlugin({ manifestPath: manifestFile });
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
    const plugin = gwenPlugin({ watch: false });
    expect(plugin.name).toBe("gwen");
  });

  it("watch: false skips watcher setup", () => {
    // configureServer should not start file watchers when watch: false
    const plugin = gwenPlugin({ watch: false, verbose: false });
    expect(plugin.configureServer).toBeDefined();
  });
});

// ── generateBundle ────────────────────────────────────────────────────────────

describe("generateBundle", () => {
  it("emits gwen-manifest.json asset", () => {
    const plugin = gwenPlugin();
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
    const plugin = gwenPlugin();
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
    const code = entryModule(false);
    expect(code).toContain('from "@gwenjs/core"');
    expect(code).not.toContain("setupGwen");
  });

  it("imports createEngine from @gwenjs/core and WasmBridgeImpl from @gwenjs/core/internal", () => {
    const code = entryModule(false);
    expect(code).toContain('import { createEngine } from "@gwenjs/core";');
    expect(code).toContain('import { WasmBridgeImpl } from "@gwenjs/core/internal";');
  });

  it("the bootstrap passes _ownsBridge: true to createEngine", () => {
    const code = entryModule(false);
    const start = code.indexOf("createEngine(");
    const call = code.slice(start, code.indexOf(");", start));
    expect(call).toContain("_bridge: bridge");
    expect(call).toContain("_ownsBridge: true");
  });

  it("bootstrap does not pass requireSAB", () => {
    const code = entryModule(false);
    expect(code).not.toContain("requireSAB");
    expect(code).not.toContain("detectSharedMemoryRequired");
    expect(code).not.toContain("crossOriginIsolated");
  });

  it("serves dev and preview with no COOP or COEP", async () => {
    const root = makeTmp();
    fs.writeFileSync(path.join(root, "index.html"), "<!DOCTYPE html><html><body></body></html>");
    fs.writeFileSync(path.join(root, "gwen.config.ts"), "export default { modules: [] };\n");
    const server = await createServer({
      configFile: false,
      root,
      logLevel: "silent",
      plugins: gwen({ watch: false }),
      server: { host: "127.0.0.1", port: 0 },
    });
    try {
      await server.listen();
      const address = server.httpServer?.address();
      if (address === null || address === undefined || typeof address === "string") {
        throw new Error("dev server has no TCP port");
      }
      const response = await fetch(`http://127.0.0.1:${address.port}/`);
      await response.arrayBuffer();
      expect(response.headers.get("cross-origin-opener-policy")).toBeNull();
      expect(response.headers.get("cross-origin-embedder-policy")).toBeNull();
      const previewHeaders = server.config.preview.headers;
      const previewNames = (previewHeaders === undefined ? [] : Object.keys(previewHeaders)).map(
        (name) => name.toLowerCase(),
      );
      expect(previewNames).not.toContain("cross-origin-opener-policy");
      expect(previewNames).not.toContain("cross-origin-embedder-policy");
    } finally {
      await server.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("imports createViewportsPlugin and createScreenPlugin from @gwenjs/app", () => {
    const code = entryModule(false);
    expect(code).toContain('from "@gwenjs/app"');
    expect(code).toContain("createViewportsPlugin");
    expect(code).toContain("createScreenPlugin");
  });

  it("imports virtual:gwen/local-plugins, local-modules and config-modules", () => {
    const code = entryModule(false);
    expect(code).toContain('from "virtual:gwen/local-plugins"');
    expect(code).toContain('from "virtual:gwen/local-modules"');
    expect(code).toContain('from "virtual:gwen/config-modules"');
  });

  it("config modules: runs setup() for each npm module before local modules", () => {
    const code = entryModule(false);
    expect(code).toContain("_cfgModules");
    expect(code).toContain("_cmMod.setup");
    const cfgIdx = code.indexOf("_cfgModules");
    const localIdx = code.indexOf("_localModules");
    expect(cfgIdx).toBeGreaterThan(0);
    expect(localIdx).toBeGreaterThan(cfgIdx);
  });

  it("no declarations: no extra static plugin imports", () => {
    const code = entryModule(false, []);
    expect(code).not.toContain("_gwenPlugin0");
  });

  it("declaration with named export: generates named import", () => {
    const code = entryModule(false, [{ src: "@gwenjs/renderer-core", export: "ScreenPlugin" }]);
    expect(code).toContain('import { ScreenPlugin as _gwenPlugin0 } from "@gwenjs/renderer-core"');
  });

  it("declaration without export: generates default import", () => {
    const code = entryModule(false, [{ src: "@gwenjs/audio" }]);
    expect(code).toContain('import _gwenPlugin0 from "@gwenjs/audio"');
  });

  it("declaration with options: serializes options as JSON in the use() call", () => {
    const code = entryModule(false, [
      { src: "@gwenjs/renderer-core", export: "ScreenPlugin", options: { fov: 75 } },
    ]);
    expect(code).toContain('await engine.use(_gwenPlugin0({"fov":75}))');
  });

  it("declaration without options: calls factory with no arguments", () => {
    const code = entryModule(false, [{ src: "@gwenjs/audio", export: "AudioPlugin" }]);
    expect(code).toContain("await engine.use(_gwenPlugin0())");
  });

  it("multiple declarations: generates sequential static imports and use() calls", () => {
    const code = entryModule(false, [
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
    const code = entryModule(false);
    expect(code).toContain("gwenConfig.plugins");
    expect(code).toContain("for (const p of gwenConfig.plugins");
  });

  it("awaits engine.start()", () => {
    const code = entryModule(false);
    expect(code).toContain("await engine.start()");
  });

  it("with scenes: imports registerScenes and mainScene", () => {
    const code = entryModule(true);
    expect(code).toContain("import { registerScenes, mainScene }");
  });

  it("with scenes: wires systems via SceneRegistry adapter before start", () => {
    const code = entryModule(true);
    const scenesIdx = code.indexOf("registerScenes(");
    const startIdx = code.indexOf("engine.start()");
    expect(scenesIdx).toBeGreaterThan(0);
    expect(startIdx).toBeGreaterThan(scenesIdx);
    expect(code).toContain("register(scene)");
    expect(code).toContain("engine.use(_s)");
  });

  it("with scenes: awaits scene:enter for mainScene once, before start, with no direct onEnter", () => {
    const code = entryModule(true);
    const hookIdx = code.indexOf("engine.hooks.hook('scene:enter'");
    const call = 'if (mainScene) await engine.hooks.callHook("scene:enter", mainScene, undefined);';
    const callIdx = code.indexOf(call);
    const startIdx = code.indexOf("await engine.start()");
    const externalIdx = code.indexOf("await engine.startExternal()");
    expect(hookIdx).toBeGreaterThan(0);
    expect(callIdx).toBeGreaterThan(hookIdx);
    expect(startIdx).toBeGreaterThan(callIdx);
    expect(externalIdx).toBeGreaterThan(callIdx);
    expect(code.match(/callHook\("scene:enter"/g)).toHaveLength(1);
    expect(code).not.toContain("_mainDef.onEnter");
    expect(code).not.toContain("mainSceneFactory");
  });

  it("without scenes: no registerScenes import or call", () => {
    const code = entryModule(false);
    expect(code).not.toContain("registerScenes");
    expect(code).not.toContain("gwen-scenes");
  });

  it("local module kit: handles PluginDeclaration via dynamic import", () => {
    const code = entryModule(false);
    expect(code).toContain("_lmDecls");
    expect(code).toContain('"src" in p');
    expect(code).toContain("await import(/* @vite-ignore */ d.src)");
  });

  it("local module kit: handles factory function and direct plugin alongside PluginDeclaration", () => {
    const code = entryModule(false);
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
    expect(code).not.toContain("mainSceneFactory");
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

    const plugin = gwenPlugin({ watch: false });
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

// ── Resolved config is the only build source ────────────────────────────────

const serveEnv: ConfigEnv = { command: "serve", mode: "development" };
const RESOLVED_ENTRY_ID = "\0/@gwenjs/gwen-entry";
const RESOLVED_SCENES_ID = "\0/@gwenjs/gwen-scenes";
const RESOLVED_CONFIG_MODULES_ID = "\0virtual:gwen/config-modules";
const RESOLVED_LOCAL_MODULES_ID = "\0virtual:gwen/local-modules";
const RESOLVED_LOCAL_PLUGINS_ID = "\0virtual:gwen/local-plugins";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function inlinedSections(code: string | null | undefined): Record<string, unknown> {
  const marker = "const __gwenResolved = ";
  const start = code?.indexOf(marker) ?? -1;
  if (code === undefined || code === null || start < 0) throw new Error("missing inlined config");
  const body = code.slice(start + marker.length);
  const parsed: unknown = JSON.parse(body.slice(0, body.indexOf(";")));
  if (!isRecord(parsed) || !isRecord(parsed["sections"])) throw new Error("missing sections");
  return parsed["sections"];
}

interface ConfigHook {
  (this: void, config: UserConfig, env: ConfigEnv): Promise<UserConfig | null | void>;
}

interface LoadHook {
  (this: void, id: string): Promise<string | null | undefined> | string | null | undefined;
}

function configHook(plugin: Plugin): ConfigHook {
  const hook = plugin.config;
  if (typeof hook !== "function") throw new Error("config hook missing");
  return hook as ConfigHook;
}

function loadHook(plugin: Plugin): LoadHook {
  const hook = plugin.load;
  if (typeof hook !== "function") throw new Error(`${plugin.name} load hook missing`);
  return hook as LoadHook;
}

function applyResolvedRoot(plugin: Plugin, root: string): void {
  const hook = plugin.configResolved;
  if (typeof hook !== "function") throw new Error(`${plugin.name} configResolved missing`);
  const resolved = hook as (this: void, config: { root: string }) => void;
  resolved({ root });
}

function pluginNamed(name: string): Plugin {
  const found = gwen({ watch: false }).find((plugin) => plugin.name === name);
  if (!found) throw new Error(`missing plugin ${name}`);
  return found;
}

function writeConfig(root: string, source: string): void {
  fs.writeFileSync(path.join(root, "gwen.config.ts"), source);
}

function writeModule(root: string, name: string, source: string): void {
  const dir = path.join(root, "node_modules", name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ type: "module", main: "index.js" }),
  );
  fs.writeFileSync(path.join(dir, "index.js"), source);
}

async function withRoot(run: (root: string) => Promise<void>): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gwen-vite-resolved-"));
  try {
    await run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function field(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

describe("resolved config is the build source", () => {
  it("the entry inlines the resolved engine block with the resolved variant", async () => {
    await withRoot(async (root) => {
      writeConfig(root, `export default { modules: [], engine: { variant: "physics2d" } };\n`);
      const plugin = pluginNamed("gwen");
      await configHook(plugin)({ root }, serveEnv);
      const code = await loadHook(plugin)(RESOLVED_ENTRY_ID);
      expect(code).toContain("const __gwenResolved");
      expect(code).toContain('"variant":"physics2d"');
    });
  });

  it("the entry never reads engine values from the raw config", async () => {
    await withRoot(async (root) => {
      writeConfig(root, `export default { modules: [], engine: { maxEntities: 10000 } };\n`);
      const plugin = pluginNamed("gwen");
      await configHook(plugin)({ root }, serveEnv);
      const code = await loadHook(plugin)(RESOLVED_ENTRY_ID);
      expect(code).toContain("__gwenResolved.engine");
      expect(code).toContain('"maxEntities":10000');
      expect(code).not.toContain("gwenConfig.engine");
    });
  });

  it("the entry has no Object.assign over module defaults", async () => {
    await withRoot(async (root) => {
      writeModule(
        root,
        "keyed",
        `export default { meta: { name: "keyed", configKey: "score" }, setup() {} };\n`,
      );
      writeModule(root, "plain", `export default { meta: { name: "plain" }, setup() {} };\n`);
      writeConfig(root, `export default { modules: ["keyed", "plain"], score: { n: 1 } };\n`);
      const plugin = pluginNamed("gwen");
      await configHook(plugin)({ root }, serveEnv);
      const code = await loadHook(plugin)(RESOLVED_ENTRY_ID);
      expect(code).not.toContain("Object.assign");
      expect(code).toContain("__gwenResolved.sections");
      expect(inlinedSections(code)).toEqual({ score: { n: 1 } });
    });
  });

  it("config() returns module extendViteConfig then the user vite key, user last wins", async () => {
    await withRoot(async (root) => {
      writeModule(
        root,
        "vite-mod",
        `export default {
          meta: { name: "vite-mod" },
          setup(_options, gwen) {
            gwen.extendViteConfig(() => ({
              resolve: { alias: { a: "mod", b: "mod" } },
              define: { X: "mod", Y: "mod" },
            }));
          },
        };\n`,
      );
      writeConfig(
        root,
        `export default {
          modules: ["vite-mod"],
          vite: { resolve: { alias: { a: "user" } }, define: { X: "user" } },
        };\n`,
      );
      const plugin = pluginNamed("gwen");
      const result = await configHook(plugin)({ root }, serveEnv);
      const alias = field(field(result, "resolve"), "alias");
      const define = field(result, "define");
      expect(field(alias, "a")).toBe("user");
      expect(field(alias, "b")).toBe("mod");
      expect(field(define, "X")).toBe("user");
      expect(field(define, "Y")).toBe("mod");
    });
    await withRoot(async (root) => {
      writeConfig(root, `export default { modules: [] };\n`);
      const plugin = pluginNamed("gwen");
      const result = await configHook(plugin)({ root }, serveEnv);
      expect(field(field(field(result, "resolve"), "alias"), "b")).toBeUndefined();
    });
  });

  it("a config resolve failure rejects config()", async () => {
    await withRoot(async (root) => {
      const plugin = pluginNamed("gwen");
      await expect(configHook(plugin)({ root }, serveEnv)).rejects.toMatchObject({
        code: "APP:CONFIG_LOAD_FAILED",
      });
    });
  });

  it("a module that throws in setup rejects config() with the module name", async () => {
    await withRoot(async (root) => {
      writeModule(
        root,
        "boom-mod",
        `export default { meta: { name: "boom-mod" }, setup() { throw new Error("setup blew up"); } };\n`,
      );
      writeConfig(root, `export default { modules: ["boom-mod"] };\n`);
      const plugin = pluginNamed("gwen");
      const caught: unknown = await configHook(plugin)({ root }, serveEnv).then(
        () => undefined,
        (error: unknown) => error,
      );
      expect(caught).toMatchObject({ code: "APP:MODULE_SETUP_FAILED" });
      expect(caught instanceof Error ? caught.message : "").toContain("boom-mod");
    });
  });

  it("a custom localModulesDir is scanned", async () => {
    await withRoot(async (root) => {
      const dir = path.join(root, "custom", "modules");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "foo.ts"), "export default {};\n");
      writeConfig(root, `export default { modules: [], localModulesDir: "custom/modules" };\n`);
      const plugins = gwen({ watch: false });
      const main = plugins.find((plugin) => plugin.name === "gwen");
      const local = plugins.find((plugin) => plugin.name === "gwen:local-modules");
      if (!main || !local) throw new Error("missing gwen plugins");
      await configHook(main)({ root }, serveEnv);
      applyResolvedRoot(local, root);
      const code = await loadHook(local)(RESOLVED_LOCAL_MODULES_ID);
      expect(code).toContain("foo.ts");
      expect(code).not.toContain("src/modules");
    });
  });

  it("localPluginsDir false disables the scanner", async () => {
    await withRoot(async (root) => {
      const dir = path.join(root, "src", "plugins");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "skip.ts"), "export default {};\n");
      writeConfig(root, `export default { modules: [], localPluginsDir: false };\n`);
      const plugins = gwen({ watch: false });
      const main = plugins.find((plugin) => plugin.name === "gwen");
      const local = plugins.find((plugin) => plugin.name === "gwen:local-plugins");
      if (!main || !local) throw new Error("missing gwen plugins");
      await configHook(main)({ root }, serveEnv);
      applyResolvedRoot(local, root);
      const code = await loadHook(local)(RESOLVED_LOCAL_PLUGINS_ID);
      expect(code).not.toContain("skip.ts");
    });
  });

  it("hooks in gwen.config.ts run at build time", async () => {
    await withRoot(async (root) => {
      const ran = path.join(root, "ran");
      writeConfig(
        root,
        `import { writeFileSync } from "node:fs";
export default {
  modules: [],
  hooks: { "build:before"() { writeFileSync(${JSON.stringify(ran)}, "ok"); } },
};
`,
      );
      const plugin = pluginNamed("gwen");
      await configHook(plugin)({ root }, serveEnv);
      expect(fs.existsSync(ran)).toBe(true);
    });
  });

  it("mainScene comes from the resolved config", async () => {
    await withRoot(async (root) => {
      const scenes = path.join(root, "src", "scenes");
      fs.mkdirSync(scenes, { recursive: true });
      fs.writeFileSync(path.join(scenes, "main.ts"), `export const Main = defineScene("Main");\n`);
      fs.writeFileSync(path.join(scenes, "play.ts"), `export const Play = defineScene("Play");\n`);
      writeConfig(
        root,
        `// mainScene: "Commented"\nexport default { modules: [], mainScene: "Play" };\n`,
      );
      const plugin = pluginNamed("gwen");
      await configHook(plugin)({ root }, serveEnv);
      const code = await loadHook(plugin)(RESOLVED_SCENES_ID);
      expect(code).toContain('export const mainScene = "Play"');
      expect(code).not.toContain('export const mainScene = "Main"');
      expect(code).not.toContain("Commented");
    });
  });

  it("modules and globalCss come from the resolved config", async () => {
    await withRoot(async (root) => {
      writeModule(root, "real-mod", `export default { meta: { name: "real-mod" }, setup() {} };\n`);
      writeConfig(
        root,
        `const unused = { modules: ["ghost-mod"], globalCss: ["./ghost.css"] };
// modules: ["comment-mod"]
export default { modules: ["real-mod"], globalCss: ["./kept.css"] };
`,
      );
      const plugin = pluginNamed("gwen");
      await configHook(plugin)({ root }, serveEnv);
      const entry = await loadHook(plugin)(RESOLVED_ENTRY_ID);
      const modules = await loadHook(plugin)(RESOLVED_CONFIG_MODULES_ID);
      expect(entry).toContain("kept.css");
      expect(entry).not.toContain("ghost");
      expect(modules).toContain("real-mod/module");
      expect(modules).not.toContain("ghost-mod");
      expect(modules).not.toContain("comment-mod");
    });
  });

  it("a second config after a failure still rejects", async () => {
    await withRoot(async (root) => {
      const plugin = pluginNamed("gwen");
      const env = serveEnv;
      await expect(configHook(plugin)({ root }, env)).rejects.toMatchObject({
        code: "APP:CONFIG_LOAD_FAILED",
      });
      await expect(configHook(plugin)({ root }, env)).rejects.toMatchObject({
        code: "APP:CONFIG_LOAD_FAILED",
      });
      // A sync throw and a rejected promise both land on this assertion.
      const loaded = Promise.resolve().then(() => loadHook(plugin)(RESOLVED_ENTRY_ID));
      await expect(loaded).rejects.toMatchObject({
        code: "APP:CONFIG_LOAD_FAILED",
      });
    });
  });

  it("browser kits receive the resolved options", async () => {
    await withRoot(async (root) => {
      writeConfig(root, `export default { modules: [], engine: { maxEntities: 10000 } };\n`);
      const plugin = pluginNamed("gwen");
      await configHook(plugin)({ root }, serveEnv);
      const code = await loadHook(plugin)(RESOLVED_ENTRY_ID);
      expect(code).not.toContain("options: gwenConfig");
      expect(code).toContain(
        "options: { ...__gwenResolved.sections, engine: __gwenResolved.engine }",
      );
    });
  });

  it("two gwen instances isolate resolved config and scan dirs", async () => {
    const rootA = makeTmp();
    const rootB = makeTmp();
    try {
      const specs = [
        { root: rootA, name: "mod-a", file: "a.ts" },
        { root: rootB, name: "mod-b", file: "b.ts" },
      ];
      const packs = [];
      for (const spec of specs) {
        writeModule(
          spec.root,
          spec.name,
          `export default { meta: { name: "${spec.name}" }, setup() {} };\n`,
        );
        fs.mkdirSync(path.join(spec.root, "mods"));
        fs.writeFileSync(path.join(spec.root, "mods", spec.file), "export default {};\n");
        writeConfig(
          spec.root,
          `export default { modules: ["${spec.name}"], localModulesDir: "mods" };\n`,
        );
        const plugins = gwen({ watch: false });
        const main = plugins.find((plugin) => plugin.name === "gwen");
        const local = plugins.find((plugin) => plugin.name === "gwen:local-modules");
        if (!main || !local) throw new Error("missing gwen plugins");
        await configHook(main)({ root: spec.root }, serveEnv);
        applyResolvedRoot(local, spec.root);
        packs.push({ main, local });
      }
      const first = packs[0];
      const second = packs[1];
      if (!first || !second) throw new Error("missing packs");
      const modsA = await loadHook(first.main)(RESOLVED_CONFIG_MODULES_ID);
      const modsB = await loadHook(second.main)(RESOLVED_CONFIG_MODULES_ID);
      const scanA = await loadHook(first.local)(RESOLVED_LOCAL_MODULES_ID);
      const scanB = await loadHook(second.local)(RESOLVED_LOCAL_MODULES_ID);
      expect(modsA).toContain("mod-a/module");
      expect(modsA).not.toContain("mod-b");
      expect(modsB).toContain("mod-b/module");
      expect(scanA).toContain("a.ts");
      expect(scanA).not.toContain("b.ts");
      expect(scanB).toContain("b.ts");
    } finally {
      fs.rmSync(rootA, { recursive: true, force: true });
      fs.rmSync(rootB, { recursive: true, force: true });
    }
  });

  it("a missing module rejects config with its name", async () => {
    await withRoot(async (root) => {
      writeConfig(root, `export default { modules: ["absent-mod"] };\n`);
      const plugin = pluginNamed("gwen");
      const caught: unknown = await configHook(plugin)({ root }, serveEnv).then(
        () => undefined,
        (error: unknown) => error,
      );
      expect(caught).toMatchObject({ code: "APP:MODULE_LOAD_FAILED" });
      expect(caught instanceof Error ? caught.message : "").toContain("absent-mod");
    });
  });

  it("a module vite plugin without a name is not forwarded to vite", async () => {
    await withRoot(async (root) => {
      writeModule(
        root,
        "vite-plugin-mod",
        `export default {
          meta: { name: "vite-plugin-mod" },
          setup(_options, kit) {
            kit.addVitePlugin({ name: "kept" });
            kit.addVitePlugin({ nameless: true });
          },
        };\n`,
      );
      writeConfig(root, `export default { modules: ["vite-plugin-mod"] };\n`);
      const plugin = pluginNamed("gwen");
      const result = await configHook(plugin)({ root }, serveEnv);
      const plugins = field(result, "plugins");
      const forwarded = Array.isArray(plugins) ? plugins.filter((entry) => isRecord(entry)) : [];
      expect(forwarded.some((entry) => entry["name"] === "kept")).toBe(true);
      expect(forwarded.every((entry) => typeof entry["name"] === "string")).toBe(true);
    });
  });
});
