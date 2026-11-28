/**
 * Tests @gwenjs/vite
 * Verifies virtual module resolution and plugin options.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { createServer, type ConfigEnv, type Plugin, type UserConfig } from "vite";
import { gwen, type GwenPluginOptions } from "../src/index";
import { generateEntryModule, generateScenesModule } from "../src/entry-gen.js";
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
        manifestPath: "/tmp/gwen-manifest.json",
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

  it("gwen() config excludes the six core factory subpaths from optimizeDeps and keeps them out of include", async () => {
    const config = await configFromTmp();
    const factories = [
      "@gwenjs/core/wasm/light/factory",
      "@gwenjs/core/wasm/physics2d/factory",
      "@gwenjs/core/wasm/physics3d/factory",
      "@gwenjs/core/wasm/light-dev/factory",
      "@gwenjs/core/wasm/physics2d-dev/factory",
      "@gwenjs/core/wasm/physics3d-dev/factory",
    ];
    expect(config.optimizeDeps?.exclude).toEqual(factories);
    const include = config.optimizeDeps?.include ?? [];
    for (const factory of factories) {
      expect(include).not.toContain(factory);
    }
    expect(include).toContain("@gwenjs/core");
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

// ── generateBundle ────────────────────────────────────────────────────────────

type BundleEmitHook = (this: { emitFile(file: unknown): void }) => void;

function isBundleEmitHook(hook: Plugin["generateBundle"]): hook is BundleEmitHook {
  return typeof hook === "function";
}

function emittedFileName(value: unknown): string {
  if (typeof value !== "object" || value === null || !("fileName" in value)) {
    throw new Error("emitFile argument has no fileName string");
  }
  const fileName = value.fileName;
  if (typeof fileName !== "string") throw new Error("emitFile argument has no fileName string");
  return fileName;
}

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

  it("generateBundle emits only gwen-manifest.json when a plugin package ships wasm files", () => {
    const root = makeTmp();
    try {
      const pluginA = path.join(root, "node_modules/@gwenjs/gwen-plugin-a/wasm");
      const pluginB = path.join(root, "node_modules/@gwenjs/gwen-plugin-b/wasm");
      fs.mkdirSync(pluginA, { recursive: true });
      fs.mkdirSync(pluginB, { recursive: true });
      fs.writeFileSync(path.join(pluginA, "a.wasm"), "A");
      fs.writeFileSync(path.join(pluginB, "b.js"), "B");

      const plugin = gwenPlugin();
      applyResolvedRoot(plugin, root);

      const emitted: { fileName: string }[] = [];
      const hook = plugin.generateBundle;
      if (!isBundleEmitHook(hook)) throw new Error("generateBundle is not a function");
      hook.call({
        emitFile(file: unknown) {
          emitted.push({ fileName: emittedFileName(file) });
        },
      });

      expect(emitted.map((file) => file.fileName)).toEqual(["gwen-manifest.json"]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("gwen() dev server — routes", () => {
  it("does not serve a plugin .wasm file under /wasm/ and still serves .gwen/index.html", async () => {
    const root = makeTmp();
    const wasmDir = path.join(root, "node_modules/@gwenjs/gwen-plugin-demo/wasm");
    fs.mkdirSync(wasmDir, { recursive: true });
    fs.writeFileSync(path.join(wasmDir, "demo.wasm"), "WASM");
    fs.mkdirSync(path.join(root, ".gwen"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".gwen", "index.html"),
      "<!DOCTYPE html><html><body>GWEN_HTML_MARKER</body></html>",
    );
    fs.writeFileSync(path.join(root, "gwen.config.ts"), "export default { modules: [] };\n");

    let server: Awaited<ReturnType<typeof createServer>> | undefined;
    try {
      server = await createServer({
        configFile: false,
        root,
        logLevel: "silent",
        plugins: gwen(),
        server: { host: "127.0.0.1", port: 0 },
      });
      await server.listen();
      const address = server.httpServer?.address();
      if (address === null || address === undefined || typeof address === "string") {
        throw new Error("dev server has no TCP port");
      }
      const wasmResponse = await fetch(`http://127.0.0.1:${address.port}/wasm/demo.wasm`);
      const wasmBody = await wasmResponse.text();
      expect(wasmResponse.headers.get("content-type")).not.toBe("application/wasm");
      expect(wasmBody).not.toBe("WASM");
      const page = await fetch(`http://127.0.0.1:${address.port}/`);
      const pageBody = await page.text();
      expect(pageBody).toContain("GWEN_HTML_MARKER");
    } finally {
      await server?.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("gwen() options — no crate build path", () => {
  it("ignores a Cargo.toml in the project: no Rust source watcher is registered", async () => {
    const root = makeTmp();
    fs.writeFileSync(path.join(root, "gwen.config.ts"), "export default { modules: [] };\n");
    fs.writeFileSync(path.join(root, "Cargo.toml"), "[package]\n");
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    fs.writeFileSync(path.join(root, "src", "lib.rs"), "\n");

    const recorded: string[] = [];
    const spy: Plugin = {
      name: "record-watcher-add",
      enforce: "pre",
      configureServer(devServer) {
        const watcher = devServer.watcher;
        const originalAdd = watcher.add.bind(watcher);
        watcher.add = (paths) => {
          if (typeof paths === "string") recorded.push(paths);
          else for (const entry of paths) recorded.push(entry);
          return originalAdd(paths);
        };
      },
    };

    let server: Awaited<ReturnType<typeof createServer>> | undefined;
    try {
      server = await createServer({
        configFile: false,
        root,
        logLevel: "silent",
        plugins: [spy, ...gwen()],
        server: { host: "127.0.0.1", port: 0 },
      });
      const optionsAreManifestAndReservedOptimizerOnly: Exclude<
        keyof GwenPluginOptions,
        "manifestPath" | "optimizer"
      > extends never
        ? true
        : false = true;
      expect(recorded.filter((entry) => entry === path.join(root, "src"))).toEqual([]);
      expect(fs.existsSync(path.join(root, ".gwen", "wasm"))).toBe(false);
      expect(optionsAreManifestAndReservedOptimizerOnly).toBe(true);
    } finally {
      await server?.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
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
      plugins: gwen(),
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

  it("imports RenderHostPlugin and ScreenPlugin from @gwenjs/app", () => {
    const code = entryModule(false);
    expect(code).toContain('from "@gwenjs/app"');
    expect(code).toContain("RenderHostPlugin");
    expect(code).toContain("ScreenPlugin");
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
    const hookIdx = code.indexOf("registerSceneHandles(engine, scene.name,");
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

  it("the entry registers scene handles through core and has no _sceneHandleMap local", () => {
    const code = entryModule(true);
    expect(code).toMatch(
      /import \{[^}]*\bregisterSceneHandles\b[^}]*\} from "@gwenjs\/core\/internal";/,
    );
    expect(code).toContain("registerSceneHandles(engine, scene.name,");
    expect(code).not.toContain("_sceneHandleMap");
    expect(code).not.toContain("engine.hooks.hook('scene:enter'");
    expect(code).not.toContain("engine.hooks.hook('scene:beforeLeave'");
  });

  it("the entry pauses the systems of every scene except the main one after installing them", () => {
    const code = entryModule(true);
    const install = code.indexOf("for (const _s of _sceneSystems) await engine.use(_s);");
    const pause = code.indexOf("for (const _h of _sceneInactive) _h._scenePause();");
    const collect = code.indexOf("if (scene.name !== mainScene) _sceneInactive.push(");
    expect(collect).toBeGreaterThan(0);
    expect(install).toBeGreaterThan(collect);
    expect(pause).toBeGreaterThan(install);
  });

  it("without scenes: no registerSceneHandles import or call", () => {
    const code = entryModule(false);
    expect(code).not.toContain("registerSceneHandles");
    expect(entryModule(true)).toContain("registerSceneHandles");
  });

  it("with scenes: imports runScenePreload from @gwenjs/core/internal and awaits it for mainScene before scene:enter and start()", () => {
    const code = entryModule(true);
    expect(code).toMatch(
      /import \{[^}]*\brunScenePreload\b[^}]*\} from "@gwenjs\/core\/internal";/,
    );
    const call = "if (mainScene) await runScenePreload(engine, null, mainScene);";
    expect(code.split(call)).toHaveLength(2);
    const importEnd = code.indexOf("engine.run(");
    const tryIdx = code.indexOf("try {");
    const registerIdx = code.indexOf("registerScenes(", importEnd);
    const resumeIdx = code.indexOf("registerSceneHandles(engine, scene.name,");
    const callIdx = code.indexOf(call);
    const enterIdx = code.indexOf('engine.hooks.callHook("scene:enter"');
    const startIdx = code.indexOf("await engine.start()");
    const externalIdx = code.indexOf("await engine.startExternal()");
    const catchIdx = code.indexOf("} catch (err) {");
    expect(tryIdx).toBeGreaterThanOrEqual(0);
    expect(tryIdx).toBeLessThan(registerIdx);
    expect(registerIdx).toBeLessThan(resumeIdx);
    expect(resumeIdx).toBeLessThan(callIdx);
    expect(callIdx).toBeLessThan(enterIdx);
    expect(enterIdx).toBeLessThan(startIdx);
    expect(callIdx).toBeLessThan(externalIdx);
    expect(callIdx).toBeLessThan(catchIdx);
  });

  it("the entry calls runScenePreload once and has no inline scene:preload:progress, aggregation code or errors emit", () => {
    const code = entryModule(true);
    const hits = code.match(/runScenePreload\(/g);
    expect(hits === null ? 0 : hits.length).toBe(1);
    expect(code).not.toContain("scene:preload");
    expect(code).not.toContain("Σ");
    expect(code).not.toContain("loaded");
    expect(code).not.toContain(".errors");
    expect(code).not.toContain("errors.emit");
    expect(code).not.toContain("Promise.all");
  });

  it("without scenes: no runScenePreload import or call, unlike the entry with scenes", () => {
    const without = entryModule(false);
    expect(without).not.toContain("runScenePreload");
    expect(without).toContain('import { WasmBridgeImpl } from "@gwenjs/core/internal";');
    expect(entryModule(true)).toContain("runScenePreload");
  });

  it("without scenes: no registerScenes import or call", () => {
    const code = entryModule(false);
    expect(code).not.toContain("registerScenes");
    expect(code).not.toContain("gwen-scenes");
  });

  it("the entry imports neither virtual:gwen/config-modules nor virtual:gwen/local-modules", () => {
    for (const code of [entryModule(false), entryModule(true)]) {
      expect(code).not.toContain("virtual:gwen/config-modules");
      expect(code).not.toContain("virtual:gwen/local-modules");
      expect(code).toContain("virtual:gwen/local-plugins");
    }
  });

  it("the entry contains no .setup( call", () => {
    expect(entryModule(false)).not.toMatch(/\.setup\(/);
    expect(entryModule(true)).not.toMatch(/\.setup\(/);
    expect(entryModule(false, [{ src: "@gwenjs/audio" }])).not.toMatch(/\.setup\(/);
  });

  it("the entry installs scene systems one at a time", () => {
    const code = entryModule(true);
    expect(code).toContain("for (const _s of _sceneSystems) await engine.use(_s);");
    expect(code).not.toContain("Promise.all");
    expect(code).not.toContain("_sceneUsages");
  });

  it("the entry collects scene systems in a Set so a shared system installs once", () => {
    const code = entryModule(true);
    expect(code).toContain("const _sceneSystems = new Set();");
    expect(code).toContain("_sceneSystems.add(_s)");
    const registerAt = code.indexOf("register(scene)");
    const callback = code.slice(registerAt, code.indexOf("} }));", registerAt));
    expect(callback).not.toContain("engine.use(_s)");
  });

  it("the entry stops the engine before rethrowing a bootstrap failure", () => {
    for (const code of [entryModule(false), entryModule(true)]) {
      const letIdx = code.indexOf("let engine;");
      const tryIdx = code.indexOf("try {");
      const createIdx = code.indexOf("engine = await createEngine(");
      const viewportsIdx = code.indexOf("engine.use(RenderHostPlugin");
      const startIdx = code.indexOf("await engine.start");
      const lastUseIdx = code.lastIndexOf("engine.use(");
      const stopIdx = code.indexOf("if (engine) await engine.stop().catch(() => {});");
      const throwIdx = code.indexOf("throw err;");
      const catchIdx = code.indexOf("} catch (err) {");
      const overlayIdx = code.indexOf("bootstrap().catch(");
      expect(code).toContain("if (engine) await engine.stop().catch(() => {});");
      expect(stopIdx).toBeGreaterThanOrEqual(0);
      expect(stopIdx).toBeLessThan(throwIdx);
      expect(letIdx).toBeGreaterThanOrEqual(0);
      expect(tryIdx).toBeGreaterThan(letIdx);
      expect(createIdx).toBeGreaterThan(tryIdx);
      expect(viewportsIdx).toBeGreaterThan(tryIdx);
      expect(startIdx).toBeGreaterThanOrEqual(0);
      expect(startIdx).toBeLessThan(catchIdx);
      expect(lastUseIdx).toBeGreaterThanOrEqual(0);
      expect(lastUseIdx).toBeLessThan(catchIdx);
      expect(catchIdx).toBeGreaterThanOrEqual(0);
      expect(overlayIdx).toBeGreaterThan(catchIdx);
    }
  });

  it("declarations are installed after gwenConfig.plugins and before local plugins", () => {
    const code = entryModule(true, [{ src: "@gwenjs/audio" }]);
    const viewports = code.indexOf("engine.use(RenderHostPlugin");
    const screen = code.indexOf("engine.use(ScreenPlugin");
    const configPlugins = code.indexOf("gwenConfig.plugins");
    const declared = code.indexOf("engine.use(_gwenPlugin0");
    const local = code.indexOf("for (const factory of _localPlugins) await engine.use(factory());");
    const scene = code.indexOf("for (const _s of _sceneSystems) await engine.use(_s);");
    expect(viewports).toBeGreaterThanOrEqual(0);
    expect(screen).toBeGreaterThan(viewports);
    expect(configPlugins).toBeGreaterThan(screen);
    expect(declared).toBeGreaterThan(configPlugins);
    expect(local).toBeGreaterThan(declared);
    expect(scene).toBeGreaterThan(local);
  });

  it("gwen() no longer resolves virtual:gwen/config-modules", async () => {
    const plugin = gwenPlugin();
    const resolve = plugin.resolveId as Function;
    const load = plugin.load as Function;
    expect(resolve("virtual:gwen/config-modules")).toBeNull();
    const loaded: unknown = await load("\0virtual:gwen/config-modules");
    expect(loaded ?? null).toBeNull();
  });

  it("gwen() does not register the gwen:local-modules plugin", () => {
    const names = gwen().map((plugin) => plugin.name);
    expect(names).not.toContain("gwen:local-modules");
    expect(names).toContain("gwen:local-plugins");
  });

  function entryForVariant(
    variant: "light" | "physics2d" | "physics3d",
    hasScenesDir: boolean,
    declarations: Parameters<typeof generateEntryModule>[1] = [],
  ): string {
    return generateEntryModule(hasScenesDir, declarations, [], {
      engine: { variant, loop: "internal" },
    });
  }

  it("the entry has exactly one @gwenjs/core/wasm/ specifier and it is the resolved variant's factory", () => {
    const declarationCases: Parameters<typeof generateEntryModule>[1][] = [
      [],
      [{ src: "@gwenjs/audio" }],
    ];
    for (const variant of ["light", "physics2d", "physics3d"] as const) {
      for (const hasScenesDir of [false, true]) {
        for (const declarations of declarationCases) {
          const code = entryForVariant(variant, hasScenesDir, declarations);
          const importLine = `import * as __gwenGlue from "@gwenjs/core/wasm/${variant}/factory";`;
          expect(code.split("@gwenjs/core/wasm/").length - 1).toBe(1);
          expect(code).toContain(importLine);
          for (const other of ["light", "physics2d", "physics3d"] as const) {
            if (other === variant) continue;
            expect(code).not.toContain(`@gwenjs/core/wasm/${other}`);
          }
          expect(code).not.toContain(`@gwenjs/core/wasm/${variant}"`);
          const importAt = code.indexOf(importLine);
          const bootstrapAt = code.indexOf("async function bootstrap");
          expect(importAt).toBeGreaterThanOrEqual(0);
          expect(bootstrapAt).toBeGreaterThan(importAt);
          expect(code).not.toContain("import(");
          expect(code).not.toContain("import.meta.glob");
          expect(code).not.toContain("@vite-ignore");
          expect(code).not.toContain("if (variant");
          expect(code).not.toContain("detectCoreVariant");
          expect(code).not.toContain("hot.dispose");
          expect(code).not.toContain("invalidateWasmModule");
        }
      }
    }
  });

  it("the entry imports <variant>-dev/factory for the dev profile and <variant>/factory for the release profile", () => {
    for (const variant of ["light", "physics2d", "physics3d"] as const) {
      const resolved = { engine: { variant, loop: "internal" } } as const;
      const initCall = `await bridge.init("${variant}", { glue: __gwenGlue,`;
      const dev = generateEntryModule(false, [], [], resolved, "dev");
      expect(dev.split("@gwenjs/core/wasm/").length - 1).toBe(1);
      expect(dev).toContain(
        `import * as __gwenGlue from "@gwenjs/core/wasm/${variant}-dev/factory";`,
      );
      expect(dev).toContain(initCall);
      const release = generateEntryModule(false, [], [], resolved, "release");
      const omitted = generateEntryModule(false, [], [], resolved);
      for (const code of [release, omitted]) {
        expect(code.split("@gwenjs/core/wasm/").length - 1).toBe(1);
        expect(code).toContain(
          `import * as __gwenGlue from "@gwenjs/core/wasm/${variant}/factory";`,
        );
        expect(code).toContain(initCall);
      }
    }
  });

  it("the entry passes the imported factory as glue to init with the same variant literal", () => {
    for (const variant of ["light", "physics2d", "physics3d"] as const) {
      const code = entryForVariant(variant, false);
      const initCall = `await bridge.init("${variant}", { glue: __gwenGlue, maxEntities: __gwenResolved.engine.maxEntities });`;
      expect(code).toContain(initCall);
      const specMarker = 'import * as __gwenGlue from "@gwenjs/core/wasm/';
      const specAt = code.indexOf(specMarker);
      const specFrom = specAt < 0 ? code.length : specAt;
      const specEnd = code.indexOf('/factory"', specFrom);
      const specVariant =
        specAt < 0 || specEnd < 0 ? "" : code.slice(specAt + specMarker.length, specEnd);
      const initMarker = 'await bridge.init("';
      const initAt = code.indexOf(initMarker);
      const initFrom = initAt < 0 ? -1 : initAt + initMarker.length;
      const initEnd = initFrom < 0 ? -1 : code.indexOf('"', initFrom);
      const initVariant = initFrom < 0 || initEnd < 0 ? "" : code.slice(initFrom, initEnd);
      expect(specVariant).toBe(variant);
      expect(initVariant).toBe(variant);
    }
  });

  it("the entry forwards maxEntities from the resolved block, not from the raw config", () => {
    for (const variant of ["light", "physics2d", "physics3d"] as const) {
      const code = entryForVariant(variant, false);
      const initAt = code.indexOf("await bridge.init(");
      const initEnd = code.indexOf(";", initAt < 0 ? 0 : initAt);
      const initCall = initAt < 0 || initEnd < 0 ? "" : code.slice(initAt, initEnd + 1);
      expect(initCall).toContain("maxEntities: __gwenResolved.engine.maxEntities");
      expect(code).not.toContain("gwenConfig.engine");
    }
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

// ── Resolved config is the only build source ────────────────────────────────

const serveEnv: ConfigEnv = { command: "serve", mode: "development" };
const RESOLVED_ENTRY_ID = "\0/@gwenjs/gwen-entry";
const RESOLVED_SCENES_ID = "\0/@gwenjs/gwen-scenes";
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
  const resolved = hook as (this: void, config: { root: string; build: { ssr: boolean } }) => void;
  resolved({ root, build: { ssr: false } });
}

function applyResolvedCommand(
  plugin: Plugin,
  root: string,
  env: { command: "build" | "serve"; mode: string },
): void {
  const hook = plugin.configResolved;
  if (typeof hook !== "function") throw new Error(`${plugin.name} configResolved missing`);
  const resolved = hook as (
    this: void,
    config: { root: string; build: { ssr: boolean }; command: string; mode: string },
  ) => void;
  resolved({ root, build: { ssr: false }, command: env.command, mode: env.mode });
}

function pluginNamed(name: string): Plugin {
  const found = gwen().find((plugin) => plugin.name === name);
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
    JSON.stringify({ type: "module", exports: { "./module": "./index.js" } }),
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

describe("the entry profile follows the Vite command", () => {
  const devImport = 'import * as __gwenGlue from "@gwenjs/core/wasm/light-dev/factory";';

  it("load of the entry imports light-dev/factory after configResolved sees command serve in mode development", async () => {
    await withRoot(async (root) => {
      writeConfig(root, "export default { modules: [] };\n");
      const plugin = pluginNamed("gwen");
      await configHook(plugin)({ root }, { command: "serve", mode: "development" });
      applyResolvedCommand(plugin, root, { command: "serve", mode: "development" });
      expect(await loadHook(plugin)(RESOLVED_ENTRY_ID)).toContain(devImport);
    });
  });

  it("load of the entry imports light-dev/factory after configResolved sees command serve in mode production", async () => {
    await withRoot(async (root) => {
      writeConfig(root, "export default { modules: [] };\n");
      const plugin = pluginNamed("gwen");
      await configHook(plugin)({ root }, { command: "serve", mode: "production" });
      applyResolvedCommand(plugin, root, { command: "serve", mode: "production" });
      expect(await loadHook(plugin)(RESOLVED_ENTRY_ID)).toContain(devImport);
    });
  });

  it("load of the entry imports light/factory after configResolved sees command build in mode development", async () => {
    await withRoot(async (root) => {
      writeConfig(root, "export default { modules: [] };\n");
      const plugin = pluginNamed("gwen");
      await configHook(plugin)({ root }, { command: "build", mode: "development" });
      applyResolvedCommand(plugin, root, { command: "build", mode: "development" });
      const code = await loadHook(plugin)(RESOLVED_ENTRY_ID);
      expect(code).toContain('import * as __gwenGlue from "@gwenjs/core/wasm/light/factory";');
      expect(code).not.toContain("-dev/");
    });
  });

  it("load of the entry imports the release factory when configResolved never ran", async () => {
    await withRoot(async (root) => {
      writeConfig(root, "export default { modules: [] };\n");
      const plugin = pluginNamed("gwen");
      await configHook(plugin)({ root }, { command: "serve", mode: "development" });
      const code = await loadHook(plugin)(RESOLVED_ENTRY_ID);
      expect(code).toContain('import * as __gwenGlue from "@gwenjs/core/wasm/light/factory";');
      expect(code).not.toContain("-dev/");
    });
  });
});

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
      expect(code).toContain('"sections":{"score":{"n":1}}');
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

  it("a module that adds a plugin instance makes config() reject with APP:PLUGIN_NOT_DECLARATIVE", async () => {
    await withRoot(async (root) => {
      writeModule(
        root,
        "instance-mod",
        `export default { meta: { name: "instance-mod" }, setup(_options, gwen) { gwen.addPlugin({ name: "x", setup() {} }); } };\n`,
      );
      writeConfig(root, `export default { modules: ["instance-mod"] };\n`);
      const plugin = pluginNamed("gwen");
      const caught: unknown = await configHook(plugin)({ root }, serveEnv).then(
        () => undefined,
        (error: unknown) => error,
      );
      expect(caught).toMatchObject({
        code: "APP:MODULE_SETUP_FAILED",
        cause: { code: "APP:PLUGIN_NOT_DECLARATIVE" },
      });
      expect(caught instanceof Error ? caught.message : "").toContain("instance-mod");
    });
  });

  it("the entry installs the inserted provider before its consumer", async () => {
    await withRoot(async (root) => {
      writeModule(
        root,
        "cam-mod",
        `export default { meta: { name: "cam-mod" }, setup(_options, gwen) { gwen.addPlugin({ src: "cam-pkg", export: "CamPlugin", requires: { plugins: ["camera-core"] } }); } };\n`,
      );
      writeConfig(root, `export default { modules: ["cam-mod"] };\n`);
      const plugin = pluginNamed("gwen");
      await configHook(plugin)({ root }, serveEnv);
      const code = await loadHook(plugin)(RESOLVED_ENTRY_ID);
      const provider = 'import { CameraCorePlugin as _gwenPlugin2 } from "@gwenjs/camera-core";';
      const consumer = 'import { CamPlugin as _gwenPlugin3 } from "cam-pkg";';
      expect(code).toContain(provider);
      expect(code?.indexOf(provider)).toBeLessThan(code?.indexOf(consumer) ?? -1);
      const installs = [...(code ?? "").matchAll(/await engine\.use\((_gwenPlugin\d+)\(/g)];
      expect(installs.map((match) => match[1])).toEqual([
        "_gwenPlugin0",
        "_gwenPlugin1",
        "_gwenPlugin2",
        "_gwenPlugin3",
      ]);
    });
  });

  it("config() rejects an extension module listed before its base and installs them in order otherwise", async () => {
    const writeFx = (root: string, modules: string): void => {
      writeModule(
        root,
        "base-mod",
        `export default { meta: { name: "base-mod" }, setup(_options, gwen) { gwen.addPlugin({ src: "base-pkg", export: "BasePlugin", name: "fx-base" }); } };\n`,
      );
      writeModule(
        root,
        "ext-mod",
        `export default { meta: { name: "ext-mod" }, setup(_options, gwen) { gwen.addPlugin({ src: "ext-pkg", export: "ExtPlugin", name: "fx-ext", requires: { plugins: [{ name: "fx-base", extensionApi: { major: 1, minor: 0 } }] } }); } };\n`,
      );
      writeConfig(root, `export default { modules: [${modules}] };\n`);
    };
    await withRoot(async (root) => {
      writeFx(root, `"ext-mod", "base-mod"`);
      const caught: unknown = await configHook(pluginNamed("gwen"))({ root }, serveEnv).then(
        () => undefined,
        (error: unknown) => error,
      );
      expect(caught).toMatchObject({ code: "APP:PLUGIN_REQUIREMENT_ORDER" });
      expect(caught instanceof Error ? caught.message : "").toContain(
        'Module "ext-mod" requires "fx-base", which module "base-mod" declares later.',
      );
    });
    await withRoot(async (root) => {
      writeFx(root, `"base-mod", "ext-mod"`);
      const plugin = pluginNamed("gwen");
      await configHook(plugin)({ root }, serveEnv);
      const code = await loadHook(plugin)(RESOLVED_ENTRY_ID);
      const installs = [...(code ?? "").matchAll(/await engine\.use\((_gwenPlugin\d+)\(/g)];
      expect(installs.map((match) => match[1])).toEqual([
        "_gwenPlugin0",
        "_gwenPlugin1",
        "_gwenPlugin2",
        "_gwenPlugin3",
      ]);
      expect(code).toContain('import { ExtPlugin as _gwenPlugin3 } from "ext-pkg";');
    });
  });

  it("config() rejects with the provider-absent code for a module whose requires.services is provided by nothing", async () => {
    await withRoot(async (root) => {
      writeModule(
        root,
        "needs-mod",
        `export default { meta: { name: "needs-mod" }, setup(_options, gwen) { gwen.addPlugin({ src: "needs-pkg", export: "NeedsPlugin", requires: { services: ["logger", "audio:mixer"] } }); } };\n`,
      );
      writeConfig(root, `export default { modules: ["needs-mod"] };\n`);
      const plugin = pluginNamed("gwen");
      const caught: unknown = await configHook(plugin)({ root }, serveEnv).then(
        () => undefined,
        (error: unknown) => error,
      );
      expect(caught).toMatchObject({ code: "APP:SERVICE_PROVIDER_MISSING" });
      expect(caught instanceof Error ? caught.message : "").toContain(
        'Module "needs-mod" requires service "audio:mixer"',
      );
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

  it("localPluginsDir false disables the scanner", async () => {
    await withRoot(async (root) => {
      const dir = path.join(root, "src", "plugins");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "skip.ts"), "export default {};\n");
      writeConfig(root, `export default { modules: [], localPluginsDir: false };\n`);
      const plugins = gwen();
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
      expect(entry).toContain("kept.css");
      expect(entry).not.toContain("ghost");
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

  it("two gwen instances isolate resolved config and scan dirs", async () => {
    const rootA = makeTmp();
    const rootB = makeTmp();
    try {
      const specs = [
        { root: rootA, name: "mod-a" },
        { root: rootB, name: "mod-b" },
      ];
      const packs = [];
      for (const spec of specs) {
        writeModule(
          spec.root,
          spec.name,
          `export default { meta: { name: "${spec.name}" }, setup() {} };\n`,
        );
        const entities = spec.name === "mod-a" ? 11 : 22;
        writeConfig(
          spec.root,
          `export default { modules: ["${spec.name}"], engine: { maxEntities: ${entities} } };\n`,
        );
        const plugins = gwen();
        const main = plugins.find((plugin) => plugin.name === "gwen");
        if (!main) throw new Error("missing gwen plugins");
        await configHook(main)({ root: spec.root }, serveEnv);
        packs.push({ main });
      }
      const first = packs[0];
      const second = packs[1];
      if (!first || !second) throw new Error("missing packs");
      const entryA = await loadHook(first.main)(RESOLVED_ENTRY_ID);
      const entryB = await loadHook(second.main)(RESOLVED_ENTRY_ID);
      expect(entryA).toContain('"maxEntities":11');
      expect(entryA).not.toContain('"maxEntities":22');
      expect(entryB).toContain('"maxEntities":22');
      expect(entryB).not.toContain('"maxEntities":11');
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

function registeredNames(entry: unknown): string[] {
  if (Array.isArray(entry)) return entry.flatMap((item) => registeredNames(item));
  if (isRecord(entry) && typeof entry["name"] === "string") return [entry["name"]];
  return [];
}

function isNamedPlugin(entry: unknown): entry is Plugin {
  return isRecord(entry) && typeof entry["name"] === "string";
}

function namedPlugins(entry: unknown): Plugin[] {
  if (Array.isArray(entry)) return entry.flatMap((item) => namedPlugins(item));
  return isNamedPlugin(entry) ? [entry] : [];
}

function runBuildStart(plugin: Plugin): void {
  const hook = plugin.buildStart;
  if (typeof hook !== "function") throw new Error(`${plugin.name} buildStart missing`);
  Reflect.apply(hook, plugin, []);
}

describe("gwen:wasm-modules-dts registration", () => {
  it("gwen() and gwenVitePlugin() register gwen:wasm-modules-dts once", () => {
    const wanted = (name: string): boolean => name === "gwen:wasm-modules-dts";
    expect(registeredNames(gwen()).filter(wanted)).toEqual(["gwen:wasm-modules-dts"]);
    expect(registeredNames(gwenVitePlugin()).filter(wanted)).toEqual(["gwen:wasm-modules-dts"]);
  });

  it("gwen() writes wasm-modules.d.ts from src and from the resolved localPluginsDir", async () => {
    await withRoot(async (root) => {
      writeConfig(root, `export default { modules: [], localPluginsDir: "custom/plugins" };\n`);
      const call = (name: string): string =>
        `import type { T } from "./t";\nengine.loadWasmModule<T>({ name: "${name}" });\n`;
      fs.mkdirSync(path.join(root, "src"), { recursive: true });
      fs.mkdirSync(path.join(root, "custom", "plugins"), { recursive: true });
      fs.writeFileSync(path.join(root, "src", "a.ts"), call("from-src"));
      fs.writeFileSync(path.join(root, "custom", "plugins", "b.ts"), call("from-custom"));
      const plugins = gwen();
      const main = plugins.find((plugin) => plugin.name === "gwen");
      const writer = plugins.find((plugin) => plugin.name === "gwen:wasm-modules-dts");
      expect(writer).toBeDefined();
      if (!main || !writer) throw new Error("missing gwen plugins");
      await configHook(main)({ root }, serveEnv);
      applyResolvedRoot(writer, root);
      runBuildStart(writer);
      const file = path.join(root, ".gwen", "types", "wasm-modules.d.ts");
      expect(fs.existsSync(file)).toBe(true);
      const text = fs.readFileSync(file, "utf8");
      expect(text).toContain('"from-src"');
      expect(text).toContain('"from-custom"');
    });
  });

  it("the plugin scans the resolved localModulesDir of gwen() and the local dirs of gwenVitePlugin", async () => {
    await withRoot(async (root) => {
      const call = (name: string): string =>
        `import type { T } from "./t";\nengine.loadWasmModule<T>({ name: "${name}" });\n`;
      const put = (rel: string, name: string): void => {
        fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
        fs.writeFileSync(path.join(root, rel), call(name));
      };
      const dtsFile = path.join(root, ".gwen", "types", "wasm-modules.d.ts");
      const dtsText = (): string =>
        fs.existsSync(dtsFile) ? fs.readFileSync(dtsFile, "utf8") : "";
      const writerOf = (entry: unknown): Plugin => {
        const found = namedPlugins(entry).find((plugin) => plugin.name === "gwen:wasm-modules-dts");
        if (!found) throw new Error("missing gwen:wasm-modules-dts");
        return found;
      };
      fs.mkdirSync(path.join(root, "custom", "modules"), { recursive: true });
      fs.writeFileSync(
        path.join(root, "custom", "modules", "m.ts"),
        [
          'import type { T } from "./t";',
          'export default { meta: { name: "m" }, setup() {} };',
          "export function load(engine: Engine): void {",
          '  engine.loadWasmModule<T>({ name: "from-modules-dir" });',
          "}",
          "",
        ].join("\n"),
      );
      writeConfig(root, `export default { modules: [], localModulesDir: "custom/modules" };\n`);
      const plugins = gwen();
      const main = plugins.find((plugin) => plugin.name === "gwen");
      if (!main) throw new Error("missing gwen plugin");
      await configHook(main)({ root }, serveEnv);
      applyResolvedRoot(writerOf(plugins), root);
      runBuildStart(writerOf(plugins));
      expect(dtsText()).toContain('"from-modules-dir"');
      fs.rmSync(path.join(root, ".gwen"), { recursive: true, force: true });

      put("extra/plugins/p.ts", "from-plugins-opt");
      put("extra/modules/m.ts", "from-modules-opt");
      const both = writerOf(
        gwenVitePlugin({
          localPlugins: { dir: "extra/plugins" },
          localModules: { dir: "extra/modules" },
        }),
      );
      applyResolvedRoot(both, root);
      runBuildStart(both);
      expect(dtsText()).toContain('"from-plugins-opt"');
      expect(dtsText()).toContain('"from-modules-opt"');
      fs.rmSync(path.join(root, ".gwen"), { recursive: true, force: true });

      const off = writerOf(
        gwenVitePlugin({ localPlugins: false, localModules: { dir: "extra/modules" } }),
      );
      applyResolvedRoot(off, root);
      runBuildStart(off);
      expect(dtsText()).toContain('"from-modules-opt"');
      expect(dtsText()).not.toContain('"from-plugins-opt"');
    });
  });
});
