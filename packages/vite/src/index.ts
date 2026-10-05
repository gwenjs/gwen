/**
 * @gwenjs/vite — Vite plugin for GWEN projects
 *
 * Features:
 *  1. **WASM hot-reload**: watches `.rs` files in the Rust crate,
 *     re-runs `wasm-pack build` in the background and triggers a full HMR
 *     when the `.wasm` changes.
 *  2. **WASM injection via middleware**: serves WASM files directly
 *     from sources (without copying to public/) in dev mode.
 *     In production build, emits them as Rollup assets in dist/wasm/.
 *  3. **Manifest injection**: injects `gwen-manifest.json` as
 *     the virtual variable `__GWEN_MANIFEST__` accessible in code.
 *
 * Usage in vite.config.ts:
 * ```typescript
 * import { gwen } from '@gwenjs/vite';
 *
 * export default defineConfig({
 *   plugins: [
 *     gwen({
 *       cratePath: '../crates/gwen-core',
 *       watch: true,
 *     })
 *   ]
 * });
 * ```
 */

import fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync, spawn, type ChildProcess } from "node:child_process";
import type { Plugin, ViteDevServer } from "vite";
import { resolveGwenConfig, GwenApp } from "@gwenjs/app/resolve";
import type { PluginDeclaration, GwenModule } from "@gwenjs/schema";
import type { AutoImport, GwenTypeTemplate } from "@gwenjs/kit";
import {
  gwenLocalPluginsPlugin,
  gwenLocalModulesPlugin,
  gwenAutoImportsPlugin,
  gwenTypesPlugin,
} from "./plugins/index.js";
import {
  extractGlobalCssFromConfig,
  extractModuleNamesFromConfig,
  generateConfigModulesVirtualModule,
  generateEntryModule,
  generateScenesModule,
  resolveMainScene,
  scanScenes,
  toRootRelative,
} from "./entry-gen.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Types ─────────────────────────────────────────────────────────────────────

export type CoreVariant = "light" | "physics2d" | "physics3d";

export interface GwenPluginOptions {
  /**
   * Core WASM variant to use.
   * If not provided, it will be auto-detected from gwen.config.ts.
   */
  variant?: CoreVariant;
  /**
   * Path to the Rust crate to compile (folder containing Cargo.toml).
   * If omitted, the plugin searches for Cargo.toml in parent directories.
   */
  cratePath?: string;
  /**
   * URL prefix under which WASM files are served.
   * Default: '/wasm'
   */
  wasmPublicPath?: string;
  /**
   * Enables watching .rs files for WASM hot-reload.
   * Default: true in dev mode, false in build mode.
   */
  watch?: boolean;
  /**
   * wasm-pack compilation mode ('release' | 'debug').
   * Default: 'debug' in dev mode for faster rebuilds.
   */
  wasmMode?: "release" | "debug";
  /**
   * Path to the gwen-manifest.json manifest.
   * If provided, its contents are injected as `__GWEN_MANIFEST__`.
   */
  manifestPath?: string;
  /** Enables verbose logging. */
  verbose?: boolean;
}

// ── Virtual module IDs ────────────────────────────────────────────────────────

const VIRTUAL_MANIFEST_ID = "virtual:gwen-manifest";
const RESOLVED_VIRTUAL_MANIFEST = "\0" + VIRTUAL_MANIFEST_ID;

// /@gwenjs/gwen- prefix — resolved as real HTTP path by browser,
// intercepted by resolveId before Vite looks on disk.
// Pattern identical to /@vite/ and /@fs/ used by Vite itself.
const GWEN_ENTRY_ID = "/@gwenjs/gwen-entry";
const GWEN_SCENES_ID = "/@gwenjs/gwen-scenes";
const RESOLVED_ENTRY = "\0/@gwenjs/gwen-entry";
const RESOLVED_SCENES = "\0/@gwenjs/gwen-scenes";
const CONFIG_MODULES_VIRTUAL = "virtual:gwen/config-modules";
const RESOLVED_CONFIG_MODULES = "\0virtual:gwen/config-modules";

// ── Plugin principal ──────────────────────────────────────────────────────────

const WASM_SERVABLE_EXTENSIONS = new Set([".wasm", ".js"]);

/**
 * Resolve a request file name inside `dir`, rejecting anything that escapes it
 * (`..`, absolute paths, encoded separators) or has a non-WASM extension.
 * Returns the resolved path if it exists, null otherwise.
 */
function resolveWasmFileWithin(dir: string, fileName: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(fileName);
  } catch {
    return null;
  }
  if (!decoded || decoded.includes("\0")) return null;
  if (!WASM_SERVABLE_EXTENSIONS.has(path.extname(decoded))) return null;

  const base = path.resolve(dir);
  const resolved = path.resolve(base, decoded);
  if (!resolved.startsWith(base + path.sep)) return null;
  return fs.existsSync(resolved) ? resolved : null;
}

/**
 * Scan node_modules/@gwenjs/gwen-plugin-* for WASM artifacts.
 * Returns the full path to the file if found, null otherwise.
 */
function findWasmPluginFile(root: string, fileName: string): string | null {
  const nmDir = path.resolve(root, "node_modules/@gwenjs");
  if (!fs.existsSync(nmDir)) return null;

  for (const entry of fs.readdirSync(nmDir)) {
    if (!entry.startsWith("gwen-plugin-")) continue;
    const pkgPath = path.join(nmDir, entry);
    const realPkgPath = fs.existsSync(pkgPath) ? fs.realpathSync(pkgPath) : pkgPath;
    const candidate = resolveWasmFileWithin(path.join(realPkgPath, "wasm"), fileName);
    if (candidate) return candidate;
  }
  return null;
}

/**
 * Collect all WASM plugin artifact directories from node_modules.
 * Used in production build to emit all plugin .wasm files into dist/wasm/.
 */
function collectWasmPluginDirs(root: string): string[] {
  const dirs: string[] = [];
  const nmDir = path.resolve(root, "node_modules/@gwenjs");
  if (!fs.existsSync(nmDir)) return [];

  for (const entry of fs.readdirSync(nmDir)) {
    if (!entry.startsWith("gwen-plugin-")) continue;
    // Resolve symlink (pnpm workspace uses symlinks to source packages)
    const pkgPath = path.join(nmDir, entry);
    const realPkgPath = fs.existsSync(pkgPath) ? fs.realpathSync(pkgPath) : pkgPath;
    const wasmDir = path.join(realPkgPath, "wasm");
    if (fs.existsSync(wasmDir)) dirs.push(wasmDir);
  }
  return dirs;
}

export function gwen(options: GwenPluginOptions = {}): Plugin[] {
  const { wasmPublicPath = "/wasm", wasmMode = "debug", verbose = false, manifestPath } = options;

  let projectRoot = process.cwd();
  let cratePath: string | null = options.cratePath ?? null;
  let watchProcess: ChildProcess | null = null;
  let server: ViteDevServer | null = null;

  /**
   * Source directory of WASM files to serve:
   * - Without Rust crate: @gwenjs/core/wasm/
   * - With Rust crate: wasm-pack output directory (in .gwen/wasm/)
   */
  let wasmSourceDir: string | null = null;
  let _declarations: PluginDeclaration[] = [];
  let _modulesLoaded = false;
  const _sharedAutoImports: AutoImport[] = [];
  const _sharedTypeTemplates: GwenTypeTemplate[] = [];

  function log(msg: string) {
    // eslint-disable-next-line no-console
    if (verbose) console.log(`[gwen-vite] ${msg}`);
  }

  function resolveCratePath(root: string): string | null {
    if (cratePath) return path.resolve(root, cratePath);
    // Walk up to find a Cargo.toml with a [package] section.
    // Stop as soon as we find ANY Cargo.toml — if it's workspace-only, we don't compile.
    let dir = root;
    for (let i = 0; i < 4; i++) {
      const cargo = path.join(dir, "Cargo.toml");
      if (fs.existsSync(cargo)) {
        const content = fs.readFileSync(cargo, "utf-8");
        if (content.includes("[package]")) return dir;
        // Found a workspace-only Cargo.toml → stop, no custom crate here
        return null;
      }
      dir = path.dirname(dir);
    }
    return null;
  }

  function findWasmPack(): string | null {
    const candidates = ["wasm-pack", `${process.env.HOME}/.cargo/bin/wasm-pack`];
    for (const c of candidates) {
      try {
        spawnSync(c, ["--version"], { stdio: "ignore" });
        return c;
      } catch {
        /* not found */
      }
    }
    return null;
  }

  /**
   * Finds the directory containing pre-compiled WASM artefacts in
   * @gwenjs/core/wasm/ robustly via module resolution.
   */
  function findPrecompiledWasmDir(root: string): string | null {
    try {
      // In Node.js ESM, we can resolve the package location.
      // We look for the package.json path to find the base directory of the engine-core package.
      const pkgUrl = import.meta.resolve("@gwenjs/core/package.json");
      const pkgPath = fileURLToPath(pkgUrl);
      const wasmDir = path.join(path.dirname(pkgPath), "wasm");

      if (fs.existsSync(wasmDir)) {
        log(`Resolved WASM dir via import.meta.resolve: ${wasmDir}`);
        return wasmDir;
      }
    } catch {
      // Fallback
    }

    const candidate = path.resolve(root, "node_modules/@gwenjs/core/wasm");
    if (fs.existsSync(candidate)) {
      log(`Found WASM dir via node_modules: ${candidate}`);
      return candidate;
    }

    return null;
  }

  /**
   * Returns WASM/JS files from wasmSourceDir recursively.
   */
  function listWasmFiles(dir: string, base: string = ""): string[] {
    if (!fs.existsSync(dir)) return [];
    const results: string[] = [];
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const fullPath = path.join(dir, file);
      const relPath = path.join(base, file);
      if (fs.statSync(fullPath).isDirectory()) {
        results.push(...listWasmFiles(fullPath, relPath));
      } else if (file.endsWith(".wasm") || file.endsWith(".js")) {
        results.push(relPath);
      }
    }
    return results;
  }

  /**
   * With a custom Rust crate: compiles with wasm-pack into .gwen/wasm/
   * (outside public/ to avoid polluting the repo).
   * Without a Rust crate: simply points to engine-core/wasm/.
   * In all cases, updates wasmSourceDir.
   */
  function buildWasm(root: string): boolean {
    const crate = resolveCratePath(root);

    if (!crate) {
      // No custom Rust crate — point to pre-compiled artifacts
      const precompiled = findPrecompiledWasmDir(root);
      if (!precompiled) {
        // eslint-disable-next-line no-console
        console.warn(
          "[gwen-vite] No pre-compiled WASM found in @gwenjs/core/wasm — WASM unavailable",
        );
        return false;
      }
      wasmSourceDir = precompiled;
      log(`WASM source: ${wasmSourceDir} (pre-compiled, no copy)`);
      return true;
    }

    const wasmPack = findWasmPack();
    if (!wasmPack) {
      // eslint-disable-next-line no-console
      console.warn(
        "[gwen-vite] wasm-pack not found — falling back to pre-compiled WASM from @gwenjs/core",
      );
      const precompiled = findPrecompiledWasmDir(root);
      if (precompiled) wasmSourceDir = precompiled;
      return !!precompiled;
    }

    // Compile to .gwen/wasm/ to avoid polluting public/
    const outDir = path.resolve(root, ".gwen", "wasm");
    fs.mkdirSync(outDir, { recursive: true });

    log(`Building WASM: ${crate} → ${outDir}`);
    const result = spawnSync(
      wasmPack,
      [
        "build",
        "--target",
        "web",
        "--out-dir",
        outDir,
        wasmMode === "release" ? "--release" : "--dev",
        crate,
      ],
      { stdio: verbose ? "inherit" : "pipe", encoding: "utf-8" },
    );

    if (result.status !== 0) {
      // eslint-disable-next-line no-console
      console.error("[gwen-vite] wasm-pack build failed:", result.stderr);
      return false;
    }

    wasmSourceDir = outDir;
    log("WASM build succeeded");
    return true;
  }

  function startWatcher(root: string, devServer: ViteDevServer): void {
    const crate = resolveCratePath(root);
    if (!crate) return;

    const wasmPack = findWasmPack();
    if (!wasmPack) return;

    const srcDir = path.join(crate, "src");
    if (!fs.existsSync(srcDir)) return;

    log(`Watching Rust sources in ${srcDir}`);

    // Register srcDir with Vite's Chokidar instance for reliable cross-platform watching
    devServer.watcher.add(srcDir);
    devServer.watcher.on("change", (filePath) => {
      if (!filePath.startsWith(srcDir + path.sep)) return;
      if (!filePath.endsWith(".rs")) return;
      log(`Rust file changed: ${filePath} — rebuilding WASM...`);

      // Debounce: ignore if already building
      if (watchProcess?.exitCode === null) return;

      // Compiler dans .gwen/wasm/ (pas dans public/)
      const outDir = path.resolve(root, ".gwen", "wasm");
      watchProcess = spawn(
        wasmPack,
        ["build", "--target", "web", "--out-dir", outDir, "--dev", crate],
        { stdio: "pipe" },
      );

      watchProcess!.on("close", (code: number | null) => {
        if (code === 0) {
          wasmSourceDir = outDir;
          log("WASM rebuilt — triggering HMR full reload");
          server?.ws.send({ type: "full-reload" });
        } else {
          // eslint-disable-next-line no-console
          console.error("[gwen-vite] WASM rebuild failed (exit " + code + ")");
        }
      });
    });
  }

  function loadManifest(): string {
    if (manifestPath && fs.existsSync(manifestPath)) {
      return fs.readFileSync(manifestPath, "utf-8");
    }
    // Try common locations
    for (const loc of ["dist/gwen-manifest.json", "gwen-manifest.json"]) {
      const p = path.resolve(projectRoot, loc);
      if (fs.existsSync(p)) return fs.readFileSync(p, "utf-8");
    }
    return JSON.stringify({ version: "0.1.0", plugins: [], engine: {} });
  }

  /**
   * Resolves a bare package name to its ESM entry point by reading the
   * project's local node_modules. Uses the package's `exports["."].import`
   * (or `.default`, then `main`) so ESM-only packages are handled correctly —
   * createRequire / require.resolve cannot resolve `"import"`-only exports.
   */
  function resolveProjectModuleEntry(root: string, name: string): string {
    const parts = name.startsWith("@") ? name.split("/").slice(0, 2) : [name];
    const pkgDir = path.join(root, "node_modules", ...parts);
    const pkgJson = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf-8")) as {
      exports?: unknown;
      main?: string;
    };

    let entry: string | undefined;
    const exp = pkgJson.exports;
    if (exp) {
      const main = typeof exp === "string" ? exp : (exp as Record<string, unknown>)["."];
      if (typeof main === "string") {
        entry = main;
      } else if (main && typeof main === "object") {
        const m = main as Record<string, unknown>;
        entry = (m["import"] ?? m["default"] ?? m["require"]) as string | undefined;
      }
    }
    if (!entry) entry = pkgJson.main ?? "index.js";
    return path.join(pkgDir, entry);
  }

  async function _loadModules(root: string): Promise<void> {
    if (_modulesLoaded) return;
    _modulesLoaded = true;
    try {
      const gwenConfig = await resolveGwenConfig(root);
      const app = new GwenApp();

      // @gwenjs/app lives in the pnpm store with only its own deps visible.
      // Resolve user modules (e.g. @gwenjs/physics2d) directly from the project's
      // node_modules, handling ESM-only "exports" maps that createRequire can't resolve.
      const moduleLoader = async (name: string): Promise<GwenModule> => {
        const entry = resolveProjectModuleEntry(root, name);
        const mod = (await import(pathToFileURL(entry).href)) as Record<string, unknown>;
        return (mod.default ?? mod) as GwenModule;
      };

      await app.setupModules(gwenConfig, moduleLoader);
      _declarations = app.pluginDeclarations;
      _sharedAutoImports.push(...app.autoImports);
      _sharedTypeTemplates.push(...app.typeTemplates);
      _moduleVitePlugins.push(...(app.vitePlugins as unknown as Plugin[]));
    } catch (err) {
      console.warn(`[gwen-vite] Failed to setup modules: ${err}`);
      _declarations = [];
    }
  }

  const _moduleVitePlugins: Plugin[] = [];

  const mainPlugin: Plugin = {
    name: "gwen",
    enforce: "pre",

    async config(userConfig) {
      const root = userConfig.root ?? process.cwd();
      await _loadModules(root);
      return {
        plugins: _moduleVitePlugins.length > 0 ? _moduleVitePlugins : undefined,
        optimizeDeps: {
          include: [
            "@gwenjs/core",
            "@gwenjs/core/system",
            "@gwenjs/core/actor",
            "@gwenjs/core/scene",
            "@gwenjs/core/internal",
            "@gwenjs/core/system/module",
            "@gwenjs/core/actor/module",
            "@gwenjs/core/scene/module",
            "@gwenjs/core/router/module",
            "@gwenjs/core/tween/module",
          ],
        },
        resolve: {
          dedupe: ["@gwenjs/core"],
        },
        preview: {
          headers: {
            "Cross-Origin-Opener-Policy": "same-origin",
            "Cross-Origin-Embedder-Policy": "require-corp",
          },
        },
      };
    },

    configResolved(config) {
      projectRoot = config.root;
    },

    async buildStart() {
      // Ensure modules are loaded (fallback if config hook didn't run)
      await _loadModules(projectRoot);
      // Ensure WASM source dir is resolved for builds without a dev server
      if (!wasmSourceDir) {
        buildWasm(projectRoot);
      }
    },

    // ── Virtual module resolution ──────────────────────────────────────
    resolveId(id) {
      if (id === VIRTUAL_MANIFEST_ID) return RESOLVED_VIRTUAL_MANIFEST;
      if (id === GWEN_ENTRY_ID) return RESOLVED_ENTRY;
      if (id === GWEN_SCENES_ID) return RESOLVED_SCENES;
      if (id === CONFIG_MODULES_VIRTUAL) return RESOLVED_CONFIG_MODULES;
      return null;
    },

    load(id) {
      if (id === RESOLVED_VIRTUAL_MANIFEST) {
        const manifest = loadManifest();
        return `export default ${manifest};`;
      }

      if (id === RESOLVED_ENTRY) {
        const hasScenesDir = fs.existsSync(path.join(projectRoot, "src", "scenes"));
        const configPath = path.join(projectRoot, "gwen.config.ts");
        const cssFiles = extractGlobalCssFromConfig(configPath).map((f) =>
          toRootRelative(f, projectRoot),
        );
        return generateEntryModule(hasScenesDir, _declarations, cssFiles);
      }

      if (id === RESOLVED_SCENES) {
        const scenes = scanScenes(projectRoot);
        const configPath = path.join(projectRoot, "gwen.config.ts");
        let mainSceneFromConfig: string | undefined;
        if (fs.existsSync(configPath)) {
          const src = fs.readFileSync(configPath, "utf-8");
          mainSceneFromConfig = src.match(/mainScene\s*:\s*['"]([^'"]+)['"]/)?.[1];
        }
        return generateScenesModule(scenes, resolveMainScene(scenes, mainSceneFromConfig));
      }

      if (id === RESOLVED_CONFIG_MODULES) {
        const configPath = path.join(projectRoot, "gwen.config.ts");
        const moduleNames = extractModuleNamesFromConfig(configPath);
        return generateConfigModulesVirtualModule(moduleNames);
      }

      return null;
    },

    // ── Inject entry script into served HTML ────────────────────────────
    transformIndexHtml(html) {
      // If script already present, don't duplicate
      if (html.includes("/@gwenjs/gwen-entry")) return html;
      return html.replace(
        "</body>",
        '  <script type="module" src="/@gwenjs/gwen-entry"></script>\n</body>',
      );
    },

    // ── HMR: invalidate modules when src/scenes/ changes ─────────────────
    configureServer(devServer) {
      server = devServer;
      projectRoot = devServer.config.root;
      cratePath = resolveCratePath(projectRoot);

      // Watcher on src/scenes/ to invalidate modules
      const scenesDir = path.join(projectRoot, "src", "scenes");
      if (fs.existsSync(scenesDir)) {
        // Register scenesDir with Vite's Chokidar instance for reliable cross-platform watching
        devServer.watcher.add(scenesDir);
        devServer.watcher.on("change", (filePath) => {
          if (!filePath.startsWith(scenesDir + path.sep)) return;
          const mod = devServer.moduleGraph.getModuleById(RESOLVED_SCENES);
          if (mod) devServer.moduleGraph.invalidateModule(mod);
          const entryMod = devServer.moduleGraph.getModuleById(RESOLVED_ENTRY);
          if (entryMod) devServer.moduleGraph.invalidateModule(entryMod);
          devServer.ws.send({ type: "full-reload" });
        });
      }

      if (options.watch !== false) {
        buildWasm(projectRoot);
        startWatcher(projectRoot, devServer);
      }

      // WASM middleware + COOP/COEP headers + generated HTML if index.html missing
      devServer.middlewares.use((req, res, next) => {
        // ── COOP/COEP headers — required for SharedArrayBuffer (WASM plugins) ──
        res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
        res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");

        // Serve WASM files directly from wasmSourceDir (no copy to public/)
        const wasmPrefix = wasmPublicPath.endsWith("/") ? wasmPublicPath : wasmPublicPath + "/";
        if (req.url?.startsWith(wasmPrefix)) {
          const fileName = req.url.slice(wasmPrefix.length).split("?")[0] ?? "";

          // 1. Try primary wasmSourceDir (gwen-core or custom crate)
          if (wasmSourceDir) {
            const filePath = resolveWasmFileWithin(wasmSourceDir, fileName);
            if (filePath) {
              const ext = path.extname(filePath);
              if (ext === ".wasm") res.setHeader("Content-Type", "application/wasm");
              if (ext === ".js") res.setHeader("Content-Type", "application/javascript");
              res.end(fs.readFileSync(filePath));
              return;
            }
          }

          // 2. Try WASM plugin packages: node_modules/@gwenjs/gwen-plugin-*/wasm/
          const pluginWasmFile = findWasmPluginFile(projectRoot, fileName);
          if (pluginWasmFile) {
            const ext = path.extname(pluginWasmFile);
            if (ext === ".wasm") res.setHeader("Content-Type", "application/wasm");
            if (ext === ".js") res.setHeader("Content-Type", "application/javascript");
            res.end(fs.readFileSync(pluginWasmFile));
            return;
          }
        }

        // Serve .gwen/index.html (file prepared by CLI)
        if (
          (req.url === "/" || req.url === "/index.html") &&
          !fs.existsSync(path.join(projectRoot, "index.html"))
        ) {
          const gwenHtmlPath = path.join(projectRoot, ".gwen", "index.html");

          // Fallback minimal in case `gwen prepare` hasn't finished yet
          let raw = `<!DOCTYPE html><html><body><script type="module" src="/@gwenjs/gwen-entry"></script></body></html>`;
          if (fs.existsSync(gwenHtmlPath)) {
            raw = fs.readFileSync(gwenHtmlPath, "utf-8");
          }

          // Go through Vite pipeline: inject HMR client + transformIndexHtml hooks
          devServer
            .transformIndexHtml(req.url!, raw, req.originalUrl)
            .then((html) => {
              res.setHeader("Content-Type", "text/html; charset=utf-8");
              res.end(html);
            })
            .catch(next);
          return;
        }

        next();
      });
    },

    // ── Production build: emit manifest + WASM assets ────────────────────
    generateBundle() {
      // Manifest
      const manifest = loadManifest();
      this.emitFile({
        type: "asset",
        fileName: "gwen-manifest.json",
        source: manifest,
      });

      // WASM artifacts — emitted as assets to dist/wasm/
      const srcDir = wasmSourceDir ?? findPrecompiledWasmDir(projectRoot);
      if (srcDir) {
        const files = listWasmFiles(srcDir);
        for (const file of files) {
          const buffer = fs.readFileSync(path.join(srcDir, file));
          this.emitFile({
            type: "asset",
            fileName: `wasm/${file}`,
            source: new Uint8Array(buffer),
          });
        }
        if (files.length > 0) log(`Emitted ${files.length} WASM assets to dist/wasm/`);
      } else {
        // eslint-disable-next-line no-console
        console.warn("[gwen-vite] No WASM source found for production build");
      }

      // Emit WASM plugin assets from node_modules/@gwenjs/gwen-plugin-*/wasm/
      const pluginDirs = collectWasmPluginDirs(projectRoot);
      for (const pluginDir of pluginDirs) {
        const files = listWasmFiles(pluginDir);
        for (const file of files) {
          const buffer = fs.readFileSync(path.join(pluginDir, file));
          this.emitFile({
            type: "asset",
            fileName: `wasm/${file}`,
            source: new Uint8Array(buffer),
          });
        }
        if (files.length > 0) log(`Emitted ${files.length} WASM plugin assets from ${pluginDir}`);
      }
    },

    // ── Vite serve preview: serve dist/wasm/ folder ─────────────────────
    // (handled automatically by Vite as dist/ is the build folder)
    // Nothing more to do here.
  };

  return [
    mainPlugin,
    gwenAutoImportsPlugin({ autoImports: _sharedAutoImports }),
    gwenTypesPlugin({ typeTemplates: _sharedTypeTemplates }),
    gwenLocalPluginsPlugin({}),
    gwenLocalModulesPlugin({}),
  ];
}

// Default export for CommonJS compatibility
export { gwenTransform } from "./transform";
export type { GwenTransformOptions } from "./transform";

export default gwen;

// RFC-006: New sub-plugin architecture
export { gwenVitePlugin } from "./plugins/index.js";
export type { GwenViteOptions, GwenWasmOptions, WasmVariant, ActorPluginOptions } from "./types.js";

// RFC-007: ECS optimizer plugin (opt-in)
export { gwenOptimizerPlugin } from "./plugins/optimizer.js";
export type { GwenOptimizerOptions } from "./plugins/optimizer.js";

// RFC-008: Physics3D query optimizer plugin (opt-in, Phase 1 — warn)
export { gwenPhysics3DOptimizerPlugin } from "./plugins/physics3d-optimizer.js";
export type { GwenPhysics3DOptimizerOptions } from "./plugins/physics3d-optimizer.js";
