/**
 * @gwenjs/vite — Vite plugin for GWEN projects.
 * Injects `gwen-manifest.json`, resolves the virtual entry, and scans `src/scenes`.
 */

import fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { mergeConfig, type Plugin } from "vite";
import { writeScenesDts } from "@gwenjs/app";
import {
  resolveGwenConfig,
  GwenApp,
  resolveModuleEntry,
  type ResolvedGwenConfig,
} from "@gwenjs/app/resolve";
import type { PluginDeclaration, GwenModule } from "@gwenjs/schema";
import type { AutoImport, ViteUserConfig } from "@gwenjs/kit";
import {
  gwenLocalPluginsPlugin,
  gwenAutoImportsPlugin,
  gwenDevStripPlugin,
  gwenWasmModulesDtsPlugin,
} from "./plugins/index.js";
import type { LocalPluginsDirOption } from "./plugins/local-plugins.js";
import type { GwenOptimizerUserOptions } from "./types.js";
import {
  generateEntryModule,
  generateScenesModule,
  toRootRelative,
  type EntryProfile,
} from "./entry-gen.js";
import { resolveMainScene, scanScenes } from "./scanners/index.js";
import { BUILT_IN_UNITS, OPTIMIZER_UNITS, optimizerEnabled } from "./pipeline/registry.js";
import { createTransformPipeline } from "./pipeline/transform-pipeline.js";
import { createVariantGuard } from "./transforms/variant-guard.js";
import { coversCore } from "./ssr-no-external.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export type CoreVariant = "light" | "physics2d" | "physics3d";

export interface GwenPluginOptions {
  /**
   * Path to the gwen-manifest.json manifest.
   * If provided, its contents are injected as `__GWEN_MANIFEST__`.
   */
  manifestPath?: string;

  /**
   * Same type as `GwenViteOptions.optimizer`. `true` or an options object registers
   * `gwen:hoist-chunk-columns` after the built-in units.
   *
   * @default false
   */
  optimizer?: boolean | GwenOptimizerUserOptions;
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

// ── Plugin principal ──────────────────────────────────────────────────────────

/** Logged when an SSR build's `ssr.noExternal` covers `@gwenjs/core`: the server then cannot find its `wasm/` directory. */
const SSR_NO_EXTERNAL_WARNING =
  "[gwen-vite] ssr.noExternal covers @gwenjs/core: the bundled server will not find the packaged wasm/ directory of @gwenjs/core (CORE:WASM_LOAD_ERROR). Keep @gwenjs/core external.";

/** Adapts Vite's `mergeConfig` to `ViteUserConfig`. */
const deepMergeVite = (config: ViteUserConfig, patch: Partial<ViteUserConfig>): ViteUserConfig =>
  mergeConfig(config, patch);

function wireConfigHooks(app: GwenApp, hooks: ResolvedGwenConfig["hooks"]): void {
  if (hooks === undefined) return;
  app.buildHooks.addHooks(hooks);
}

// boundary: app VitePlugin is not vite's Plugin #77
function isVitePlugin(candidate: unknown): candidate is Plugin {
  if (typeof candidate !== "object" || candidate === null) return false;
  return "name" in candidate && typeof candidate.name === "string";
}

export function gwen(options: GwenPluginOptions = {}): Plugin[] {
  const { manifestPath } = options;

  let projectRoot = process.cwd();
  let entryProfile: EntryProfile = "release";
  let _declarations: PluginDeclaration[] = [];
  let _resolved: ResolvedGwenConfig | undefined;
  let _app: GwenApp | undefined;
  let _loadPromise: Promise<void> | undefined;
  const localPluginsScan: LocalPluginsDirOption = { root: process.cwd() };
  const _sharedAutoImports: AutoImport[] = [];
  const pipeline = createTransformPipeline({
    units: optimizerEnabled(options.optimizer)
      ? [...BUILT_IN_UNITS, ...OPTIMIZER_UNITS]
      : BUILT_IN_UNITS,
    autoImports: _sharedAutoImports,
  });

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

  function _loadModules(root: string): Promise<void> {
    return (_loadPromise ??= loadResolved(root));
  }

  async function loadResolved(root: string): Promise<void> {
    const gwenConfig = await resolveGwenConfig(root);
    _resolved = gwenConfig;
    localPluginsScan.root = root;
    localPluginsScan.dir = gwenConfig.localPluginsDir ?? "src/plugins";
    const app = new GwenApp();
    wireConfigHooks(app, gwenConfig.hooks);

    // @gwenjs/app lives in the pnpm store with only its own deps visible.
    // Load each user module from its `./module` export in the project's node_modules.
    const moduleLoader = async (name: string): Promise<GwenModule> => {
      const entry = resolveModuleEntry(root, name);
      const mod = (await import(pathToFileURL(entry).href)) as Record<string, unknown>; // boundary: a dynamic import of a user path is typed any, read as a record of its exports
      return (mod.default ?? mod) as GwenModule; // boundary: the loader contract returns a GwenModule, but the default export (or the namespace) of a user module has no static type
    };

    await app.setupModules(gwenConfig, moduleLoader, { root });
    for (const transform of app.sourceTransforms) {
      pipeline.api.registerKit(transform);
    }
    pipeline.api.register(
      createVariantGuard({
        root,
        variant: gwenConfig.engine.variant,
        declaredModules: gwenConfig.modules,
      }),
    );
    _app = app;
    _declarations = app.pluginDeclarations;
    _sharedAutoImports.push(...app.autoImports);
    for (const plugin of app.vitePlugins) {
      const candidate: unknown = plugin;
      if (isVitePlugin(candidate)) _moduleVitePlugins.push(candidate);
    }
  }

  const _moduleVitePlugins: Plugin[] = [];

  const mainPlugin: Plugin = {
    name: "gwen",
    enforce: "pre",

    async config(userConfig) {
      const root = userConfig.root ?? process.cwd();
      projectRoot = root;
      await _loadModules(root);
      const base = {
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
            "@gwenjs/core > @gwenjs/kit",
          ],
          exclude: [
            "@gwenjs/core/wasm/light/factory",
            "@gwenjs/core/wasm/physics2d/factory",
            "@gwenjs/core/wasm/physics3d/factory",
            "@gwenjs/core/wasm/light-dev/factory",
            "@gwenjs/core/wasm/physics2d-dev/factory",
            "@gwenjs/core/wasm/physics3d-dev/factory",
          ],
        },
        resolve: {
          dedupe: ["@gwenjs/core", "@gwenjs/kit"],
        },
      };
      if (_app === undefined) return base;
      return _app.resolveViteConfig(base, deepMergeVite);
    },

    configResolved(config) {
      projectRoot = config.root;
      // The command picks the core build, not the mode: `vite build --mode development` stays release.
      entryProfile = config.command === "serve" ? "dev" : "release";
      if (config.build.ssr && coversCore(config.ssr.noExternal, config.ssr.external)) {
        config.logger.warn(SSR_NO_EXTERNAL_WARNING);
      }
    },

    async buildStart() {
      // Fallback when `config` did not run. `config` registers the kit transforms and the
      // variant guard: this `buildStart` runs after the pipeline froze, so for every
      // project, not only those with kit transforms, the registration throws.
      await _loadModules(projectRoot);
      const scenes = scanScenes(projectRoot, { autoImports: _sharedAutoImports });
      writeScenesDts(
        projectRoot,
        scenes.map((scene) => scene.sceneName),
      );
    },

    // ── Virtual module resolution ──────────────────────────────────────
    resolveId(id) {
      if (id === VIRTUAL_MANIFEST_ID) return RESOLVED_VIRTUAL_MANIFEST;
      if (id === GWEN_ENTRY_ID) return RESOLVED_ENTRY;
      if (id === GWEN_SCENES_ID) return RESOLVED_SCENES;
      return null;
    },

    load(id) {
      if (id === RESOLVED_VIRTUAL_MANIFEST) {
        const manifest = loadManifest();
        return `export default ${manifest};`;
      }

      const render = (): string | null => {
        if (_resolved === undefined) return null;

        if (id === RESOLVED_ENTRY) {
          const hasScenesDir = fs.existsSync(path.join(projectRoot, "src", "scenes"));
          const cssFiles = (_resolved.globalCss ?? []).map((file) =>
            toRootRelative(file, projectRoot),
          );
          return generateEntryModule(
            hasScenesDir,
            _declarations,
            cssFiles,
            _resolved,
            entryProfile,
          );
        }

        if (id === RESOLVED_SCENES) {
          const scenes = scanScenes(projectRoot, { autoImports: _sharedAutoImports });
          return generateScenesModule(scenes, resolveMainScene(scenes, _resolved.mainScene));
        }

        return null;
      };

      const gwenVirtual = id === RESOLVED_ENTRY || id === RESOLVED_SCENES;
      // Entry and scenes re-await the memoized load so a
      // failed config() rejects with the original error (D-V4a-3).
      if (gwenVirtual && _resolved === undefined) {
        return (async () => {
          await _loadModules(projectRoot);
          return render();
        })();
      }
      return render();
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
      projectRoot = devServer.config.root;

      // Watcher on src/scenes/ to invalidate modules
      const scenesDir = path.join(projectRoot, "src", "scenes");
      if (fs.existsSync(scenesDir)) {
        // Register scenesDir with Vite's Chokidar instance for reliable cross-platform watching
        devServer.watcher.add(scenesDir);
        devServer.watcher.on("change", (filePath) => {
          if (!filePath.startsWith(scenesDir + path.sep)) return;
          try {
            const scenes = scanScenes(projectRoot, { autoImports: _sharedAutoImports });
            writeScenesDts(
              projectRoot,
              scenes.map((scene) => scene.sceneName),
            );
            const mod = devServer.moduleGraph.getModuleById(RESOLVED_SCENES);
            if (mod) devServer.moduleGraph.invalidateModule(mod);
            const entryMod = devServer.moduleGraph.getModuleById(RESOLVED_ENTRY);
            if (entryMod) devServer.moduleGraph.invalidateModule(entryMod);
            devServer.ws.send({ type: "full-reload" });
          } catch (caught) {
            const message = caught instanceof Error ? caught.message : String(caught);
            devServer.config.logger.error(message);
          }
        });
      }

      // Generated HTML when the project has no index.html.
      // Isolation is optional. Users set Vite server.headers and preview.headers.
      devServer.middlewares.use((req, res, next) => {
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
            .transformIndexHtml(req.url, raw, req.originalUrl)
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

    // ── Production build: emit the manifest ──────────────────────────────
    generateBundle() {
      // Manifest
      const manifest = loadManifest();
      this.emitFile({
        type: "asset",
        fileName: "gwen-manifest.json",
        source: manifest,
      });
    },
  };

  return [
    mainPlugin,
    pipeline,
    gwenDevStripPlugin(),
    gwenAutoImportsPlugin({ autoImports: _sharedAutoImports }),
    gwenLocalPluginsPlugin(localPluginsScan),
    gwenWasmModulesDtsPlugin({
      dirs: () => [_resolved?.localPluginsDir, _resolved?.localModulesDir],
    }),
  ];
}

// Default export for CommonJS compatibility
export default gwen;

// RFC-006: New sub-plugin architecture
export { gwenVitePlugin, type GwenDevStripReport } from "./plugins/index.js";
export type { GwenViteOptions, ActorPluginOptions } from "./types.js";

// RFC-008: Physics3D query optimizer plugin (opt-in, Phase 1 — warn)
export { gwenPhysics3DOptimizerPlugin } from "./plugins/physics3d-optimizer.js";
export { ViteErrorCodes } from "./error-codes.js";
export type { GwenPhysics3DOptimizerOptions } from "./plugins/physics3d-optimizer.js";
