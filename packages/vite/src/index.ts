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

import fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, spawn, type ChildProcess } from 'node:child_process';
import type { Plugin, ViteDevServer } from 'vite';
import { walk } from 'oxc-walker';
import type {
  ExportDefaultDeclaration,
  ExportNamedDeclaration,
  VariableDeclaration,
  VariableDeclarator,
  CallExpression,
  PropertyDefinition,
  StringLiteral,
  ObjectExpression,
  ObjectProperty,
  ArrayExpression,
  Class as OxcClass,
} from 'oxc-parser';
import {
  parseSource,
  isCallTo,
  getCallArgs,
  getObjectProperties,
  getPropertyKeyName,
} from './oxc/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Types ─────────────────────────────────────────────────────────────────────

export type CoreVariant = 'light' | 'physics2d' | 'physics3d';

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
  wasmMode?: 'release' | 'debug';
  /**
   * Path to the gwen-manifest.json manifest.
   * If provided, its contents are injected as `__GWEN_MANIFEST__`.
   */
  manifestPath?: string;
  /** Enables verbose logging. */
  verbose?: boolean;
}

// ── Virtual module IDs ────────────────────────────────────────────────────────

const VIRTUAL_MANIFEST_ID = 'virtual:gwen-manifest';
const RESOLVED_VIRTUAL_MANIFEST = '\0' + VIRTUAL_MANIFEST_ID;

// /@gwenjs/gwen- prefix — resolved as real HTTP path by browser,
// intercepted by resolveId before Vite looks on disk.
// Pattern identical to /@vite/ and /@fs/ used by Vite itself.
const GWEN_ENTRY_ID = '/@gwenjs/gwen-entry';
const GWEN_SCENES_ID = '/@gwenjs/gwen-scenes';
const RESOLVED_ENTRY = '\0/@gwenjs/gwen-entry';
const RESOLVED_SCENES = '\0/@gwenjs/gwen-scenes';

// ── Scan src/scenes/ ──────────────────────────────────────────────────────────

interface SceneInfo {
  file: string;
  className: string;
  sceneName: string;
  isDefault: boolean;
  isFactory: boolean; // defineScene form 2 — callable factory
  isConst: boolean; // defineScene form 1 — direct object (export const)
  relPath: string;
}

/**
 * Scan a single scene source file and extract class name, scene name, and export type.
 *
 * Handles 4 patterns:
 * 1. `export default class FooScene { ... }` — isDefault=true
 * 2. `export class FooScene { ... }` — named class export
 * 3. `export const Foo = defineScene('name', ...)` — factory pattern
 * 4. `readonly name = 'foo'` property inside a class — extracts scene name
 *
 * @param source       - TypeScript source code of the scene file.
 * @param filename     - Absolute path (used for the parser).
 * @param fallbackName - Used as class/scene name when AST extraction fails.
 * @returns Extracted scene metadata.
 */
function scanSceneFile(
  source: string,
  filename: string,
  fallbackName: string,
): {
  className: string;
  sceneName: string;
  isDefault: boolean;
  isFactory: boolean;
  isConst: boolean;
} {
  const parsed = parseSource(filename, source);
  if (!parsed) {
    return {
      className: fallbackName,
      sceneName: fallbackName.replace(/Scene$/, ''),
      isDefault: false,
      isConst: false,
      isFactory: false,
    };
  }

  let className = fallbackName;
  let isDefault = false;
  let isConst = false;
  let isFactory = false;
  let sceneName: string | null = null;

  walk(parsed.program, {
    enter(node) {
      // Case 1: export default class FooScene
      if (node.type === 'ExportDefaultDeclaration') {
        const { declaration } = node as ExportDefaultDeclaration;
        if (declaration.type === 'ClassDeclaration' || declaration.type === 'ClassExpression') {
          const cls = declaration as OxcClass;
          if (cls.id?.type === 'Identifier') {
            className = (cls.id as { name: string }).name;
            isDefault = true;
          }
        }
        return;
      }

      // Case 2 & 3: export class / export const = defineScene(...)
      if (node.type === 'ExportNamedDeclaration') {
        const { declaration } = node as ExportNamedDeclaration;
        if (!declaration) return;

        if (declaration.type === 'ClassDeclaration' || declaration.type === 'ClassExpression') {
          const cls = declaration as OxcClass;
          if (cls.id?.type === 'Identifier') className = (cls.id as { name: string }).name;
          return;
        }

        if (declaration.type === 'VariableDeclaration') {
          for (const declarator of (declaration as VariableDeclaration).declarations) {
            const { id, init } = declarator as VariableDeclarator;
            if (id.type !== 'Identifier') continue;
            if (!init || !isCallTo(init, 'defineScene')) continue;
            className = (id as { name: string }).name;
            isConst = true;
            const args = getCallArgs(init as CallExpression);
            if (args.length >= 1 && args[0]!.type === 'Literal') {
              const val = (args[0] as StringLiteral).value;
              if (typeof val === 'string') {
                sceneName = val;
                isFactory = true;
              }
            }
          }
          return;
        }
      }

      // Case 3b: defineScene('name', ...) outside export
      if (node.type === 'CallExpression' && isCallTo(node as CallExpression, 'defineScene')) {
        if (!sceneName) {
          const args = getCallArgs(node as CallExpression);
          if (args.length >= 1 && args[0]!.type === 'Literal') {
            const val = (args[0] as StringLiteral).value;
            if (typeof val === 'string') sceneName = val;
          }
        }
        return;
      }

      // Case 4: readonly name = 'Foo' inside a class
      if (node.type === 'PropertyDefinition') {
        const propDef = node as PropertyDefinition;
        if (
          propDef.key.type === 'Identifier' &&
          (propDef.key as { name: string }).name === 'name'
        ) {
          if (propDef.value && propDef.value.type === 'Literal' && !sceneName) {
            const val = (propDef.value as StringLiteral).value;
            if (typeof val === 'string') sceneName = val;
          }
        }
      }
    },
  });

  return {
    className,
    sceneName: sceneName ?? className.replace(/Scene$/, ''),
    isDefault,
    isConst,
    isFactory,
  };
}

function scanScenes(projectRoot: string): SceneInfo[] {
  const scenesDir = path.join(projectRoot, 'src', 'scenes');
  if (!fs.existsSync(scenesDir)) return [];

  return fs
    .readdirSync(scenesDir)
    .filter((f) => f.endsWith('.ts') && !f.startsWith('_') && !f.startsWith('.'))
    .sort()
    .map((file) => {
      const base = file.replace(/\.ts$/, '');
      const fullPath = path.join(scenesDir, file);
      const source = fs.readFileSync(fullPath, 'utf-8');

      const { className, sceneName, isDefault, isFactory, isConst } = scanSceneFile(
        source,
        fullPath,
        base,
      );

      return {
        file,
        className,
        sceneName,
        isDefault,
        isFactory,
        isConst,
        relPath: `/src/scenes/${base}.ts`,
      };
    });
}

function resolveMainScene(scenes: SceneInfo[], fromConfig?: string): string | undefined {
  if (fromConfig) return fromConfig;
  const candidates = ['Main', 'MainMenu', 'Boot'];
  return candidates.find((c) => scenes.some((s) => s.sceneName === c)) ?? scenes[0]?.sceneName;
}

// ── Virtual module generation ─────────────────────────────────────────────────

function generateScenesModule(scenes: SceneInfo[], mainScene: string | undefined): string {
  if (scenes.length === 0) {
    return [
      'export function registerScenes(_scenes) {}',
      'export const mainScene = undefined;',
    ].join('\n');
  }

  const imports = scenes
    .map((s) =>
      s.isDefault
        ? `import ${s.className} from ${JSON.stringify(s.relPath)};`
        : `import { ${s.className} } from ${JSON.stringify(s.relPath)};`,
    )
    .join('\n');

  const registrations = scenes
    .map((s) => {
      if (s.isFactory) {
        // defineScene form 2 — callable factory with dependencies
        return `  scenes.register(${s.className}(scenes));`;
      }
      if (s.isConst) {
        // defineScene form 1 — direct object, registers as-is
        return `  scenes.register(${s.className});`;
      }
      // class (backward compat)
      return `  scenes.register(new ${s.className}(scenes));`;
    })
    .join('\n');

  const mainSceneValue = mainScene ? JSON.stringify(mainScene) : 'undefined';

  return [
    imports,
    '',
    'export function registerScenes(scenes) {',
    registrations,
    '}',
    '',
    `export const mainScene = ${mainSceneValue};`,
  ].join('\n');
}

/**
 * Extract module package names from a `gwen.config.ts` file's `modules: [...]` array.
 *
 * Handles two element shapes:
 * - `'@scope/pkg'` — plain string literal
 * - `['@scope/pkg', options]` — tuple with package name as first element
 *
 * @param configPath - Absolute path to `gwen.config.ts`.
 * @returns Array of module package name strings.
 */
function extractModuleNamesFromConfig(configPath: string): string[] {
  if (!fs.existsSync(configPath)) return [];
  const src = fs.readFileSync(configPath, 'utf-8');

  const parsed = parseSource(configPath, src);
  if (!parsed) return [];

  const names: string[] = [];

  walk(parsed.program, {
    enter(node) {
      if (node.type !== 'ObjectExpression') return;

      for (const prop of getObjectProperties(node as ObjectExpression)) {
        if (getPropertyKeyName(prop) !== 'modules') continue;

        const { value } = prop as ObjectProperty;
        if (value.type !== 'ArrayExpression') continue;

        for (const el of (value as ArrayExpression).elements) {
          if (!el || el.type === 'SpreadElement') continue;

          // Form 1: '@scope/pkg' string literal
          if (el.type === 'Literal' && typeof (el as StringLiteral).value === 'string') {
            const s = (el as StringLiteral).value;
            if (s.includes('/') || s.startsWith('@')) names.push(s);
            continue;
          }

          // Form 2: ['@scope/pkg', opts] tuple
          if (el.type === 'ArrayExpression') {
            const first = (el as ArrayExpression).elements[0];
            if (
              first &&
              first.type === 'Literal' &&
              typeof (first as StringLiteral).value === 'string'
            ) {
              const s = (first as StringLiteral).value;
              if (s.includes('/') || s.startsWith('@')) names.push(s);
            }
          }
        }

        this.skip(); // Found modules array — stop descending
        return;
      }
    },
  });

  return names;
}

function generateEntryModule(hasScenesDir: boolean, moduleNames: string[] = []): string {
  const lines = [
    'import { initWasm, createEngine, detectCoreVariant, detectSharedMemoryRequired } from "@gwenjs/core";',
    'import gwenConfig from "/gwen.config.ts";',
  ];

  if (hasScenesDir) {
    lines.push('import { registerScenes } from "/@gwenjs/gwen-scenes";');
  }

  // Generate static imports for each module — Vite can pre-bundle these
  const localVars: string[] = moduleNames.map((name, i) => {
    const localVar = `_gwenMod${i}`;
    lines.push(`import ${localVar} from ${JSON.stringify(name + '/module')};`);
    return localVar;
  });

  // Build a static registry mapping name → imported module object
  const registryEntries = moduleNames
    .map((name, i) => `  ${JSON.stringify(name)}: ${localVars[i]}`)
    .join(',\n');
  const registryCode =
    moduleNames.length > 0
      ? `const _gwenModRegistry = {\n${registryEntries}\n};\n`
      : 'const _gwenModRegistry = {};\n';

  const bootstrapLines = [
    '',
    registryCode,
    'async function bootstrap() {',
    '  const variant = detectCoreVariant(gwenConfig);',
    '  const requireSAB = detectSharedMemoryRequired(gwenConfig);',
    '  await initWasm(variant, { requireSAB });',
    '  const engine = await createEngine(gwenConfig.engine ?? {});',
    '',
    '  // Load runtime plugins declared via modules: []',
    '  const modulePlugins = [];',
    '  const kit = {',
    '    addPlugin(p) { modulePlugins.push(typeof p === "function" ? p() : p); },',
    '    addAutoImports() {},',
    '    addVitePlugin() {},',
    '    extendViteConfig() {},',
    '    addTypeTemplate() {},',
    '    addModuleAugment() {},',
    '    hook() {},',
    '    options: gwenConfig,',
    '  };',
    '  for (const entry of (gwenConfig.modules ?? [])) {',
    '    const [name, opts] = Array.isArray(entry) ? entry : [entry, {}];',
    '    const mod = _gwenModRegistry[name];',
    '    if (mod) {',
    '      const def = mod.default ?? mod;',
    '      if (def && typeof def.setup === "function") await def.setup(opts ?? {}, kit);',
    '    }',
    '  }',
    '  for (const p of modulePlugins) await engine.use(p);',
    '',
    '  // Direct plugins from plugins: []',
    '  for (const plugin of (gwenConfig.plugins ?? [])) {',
    '    await engine.use(plugin);',
    '  }',
  ];

  if (hasScenesDir) {
    bootstrapLines.push(
      '',
      '  // Wire scenes: collect system plugins via SceneRegistry adapter',
      '  const usages = [];',
      '  registerScenes({ register(scene) { for (const s of scene.systems ?? []) usages.push(engine.use(s)); } });',
      '  await Promise.all(usages);',
    );
  }

  bootstrapLines.push(
    '  await engine.start();',
    '}',
    '',
    'bootstrap().catch(err => {',
    '  console.error("[GWEN] Fatal:", err);',
    '  document.body.innerHTML = `<pre style="color:red;padding:2rem">[GWEN] Fatal:\\n${err}</pre>`;',
    '});',
  );

  lines.push(...bootstrapLines);
  return lines.join('\n');
}

// ── Plugin principal ──────────────────────────────────────────────────────────

/**
 * Scan node_modules/@gwenjs/gwen-plugin-* for WASM artifacts.
 * Returns the full path to the file if found, null otherwise.
 */
function findWasmPluginFile(root: string, fileName: string): string | null {
  const nmDir = path.resolve(root, 'node_modules/@gwenjs');
  if (!fs.existsSync(nmDir)) return null;

  for (const entry of fs.readdirSync(nmDir)) {
    if (!entry.startsWith('gwen-plugin-')) continue;
    const pkgPath = path.join(nmDir, entry);
    const realPkgPath = fs.existsSync(pkgPath) ? fs.realpathSync(pkgPath) : pkgPath;
    const candidate = path.join(realPkgPath, 'wasm', fileName);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Collect all WASM plugin artifact directories from node_modules.
 * Used in production build to emit all plugin .wasm files into dist/wasm/.
 */
function collectWasmPluginDirs(root: string): string[] {
  const dirs: string[] = [];
  const nmDir = path.resolve(root, 'node_modules/@gwenjs');
  if (!fs.existsSync(nmDir)) return [];

  for (const entry of fs.readdirSync(nmDir)) {
    if (!entry.startsWith('gwen-plugin-')) continue;
    // Resolve symlink (pnpm workspace uses symlinks to source packages)
    const pkgPath = path.join(nmDir, entry);
    const realPkgPath = fs.existsSync(pkgPath) ? fs.realpathSync(pkgPath) : pkgPath;
    const wasmDir = path.join(realPkgPath, 'wasm');
    if (fs.existsSync(wasmDir)) dirs.push(wasmDir);
  }
  return dirs;
}

export function gwen(options: GwenPluginOptions = {}): Plugin {
  const { wasmPublicPath = '/wasm', wasmMode = 'debug', verbose = false, manifestPath } = options;

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

  function log(msg: string) {
    if (verbose) console.log(`[gwen-vite] ${msg}`);
  }

  function resolveCratePath(root: string): string | null {
    if (cratePath) return path.resolve(root, cratePath);
    // Walk up to find a Cargo.toml with a [package] section.
    // Stop as soon as we find ANY Cargo.toml — if it's workspace-only, we don't compile.
    let dir = root;
    for (let i = 0; i < 4; i++) {
      const cargo = path.join(dir, 'Cargo.toml');
      if (fs.existsSync(cargo)) {
        const content = fs.readFileSync(cargo, 'utf-8');
        if (content.includes('[package]')) return dir;
        // Found a workspace-only Cargo.toml → stop, no custom crate here
        return null;
      }
      dir = path.dirname(dir);
    }
    return null;
  }

  function findWasmPack(): string | null {
    const candidates = ['wasm-pack', `${process.env.HOME}/.cargo/bin/wasm-pack`];
    for (const c of candidates) {
      try {
        spawnSync(c, ['--version'], { stdio: 'ignore' });
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
      const pkgUrl = import.meta.resolve('@gwenjs/core/package.json');
      const pkgPath = fileURLToPath(pkgUrl);
      const wasmDir = path.join(path.dirname(pkgPath), 'wasm');

      if (fs.existsSync(wasmDir)) {
        log(`Resolved WASM dir via import.meta.resolve: ${wasmDir}`);
        return wasmDir;
      }
    } catch {
      // Fallback
    }

    const candidate = path.resolve(root, 'node_modules/@gwenjs/core/wasm');
    if (fs.existsSync(candidate)) {
      log(`Found WASM dir via node_modules: ${candidate}`);
      return candidate;
    }

    return null;
  }

  /**
   * Returns WASM/JS files from wasmSourceDir recursively.
   */
  function listWasmFiles(dir: string, base: string = ''): string[] {
    if (!fs.existsSync(dir)) return [];
    const results: string[] = [];
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const fullPath = path.join(dir, file);
      const relPath = path.join(base, file);
      if (fs.statSync(fullPath).isDirectory()) {
        results.push(...listWasmFiles(fullPath, relPath));
      } else if (file.endsWith('.wasm') || file.endsWith('.js')) {
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
        console.warn(
          '[gwen-vite] No pre-compiled WASM found in @gwenjs/core/wasm — WASM unavailable',
        );
        return false;
      }
      wasmSourceDir = precompiled;
      log(`WASM source: ${wasmSourceDir} (pre-compiled, no copy)`);
      return true;
    }

    const wasmPack = findWasmPack();
    if (!wasmPack) {
      console.warn(
        '[gwen-vite] wasm-pack not found — falling back to pre-compiled WASM from @gwenjs/core',
      );
      const precompiled = findPrecompiledWasmDir(root);
      if (precompiled) wasmSourceDir = precompiled;
      return !!precompiled;
    }

    // Compile to .gwen/wasm/ to avoid polluting public/
    const outDir = path.resolve(root, '.gwen', 'wasm');
    fs.mkdirSync(outDir, { recursive: true });

    log(`Building WASM: ${crate} → ${outDir}`);
    const result = spawnSync(
      wasmPack,
      [
        'build',
        '--target',
        'web',
        '--out-dir',
        outDir,
        wasmMode === 'release' ? '--release' : '--dev',
        crate,
      ],
      { stdio: verbose ? 'inherit' : 'pipe', encoding: 'utf-8' },
    );

    if (result.status !== 0) {
      console.error('[gwen-vite] wasm-pack build failed:', result.stderr);
      return false;
    }

    wasmSourceDir = outDir;
    log('WASM build succeeded');
    return true;
  }

  function startWatcher(root: string, devServer: ViteDevServer): void {
    const crate = resolveCratePath(root);
    if (!crate) return;

    const wasmPack = findWasmPack();
    if (!wasmPack) return;

    const srcDir = path.join(crate, 'src');
    if (!fs.existsSync(srcDir)) return;

    log(`Watching Rust sources in ${srcDir}`);

    // Register srcDir with Vite's Chokidar instance for reliable cross-platform watching
    devServer.watcher.add(srcDir);
    devServer.watcher.on('change', (filePath) => {
      if (!filePath.startsWith(srcDir + path.sep)) return;
      if (!filePath.endsWith('.rs')) return;
      log(`Rust file changed: ${filePath} — rebuilding WASM...`);

      // Debounce: ignore if already building
      if (watchProcess?.exitCode === null) return;

      // Compiler dans .gwen/wasm/ (pas dans public/)
      const outDir = path.resolve(root, '.gwen', 'wasm');
      watchProcess = spawn(
        wasmPack,
        ['build', '--target', 'web', '--out-dir', outDir, '--dev', crate],
        { stdio: 'pipe' },
      );

      watchProcess!.on('close', (code: number | null) => {
        if (code === 0) {
          wasmSourceDir = outDir;
          log('WASM rebuilt — triggering HMR full reload');
          server?.ws.send({ type: 'full-reload' });
        } else {
          console.error('[gwen-vite] WASM rebuild failed (exit ' + code + ')');
        }
      });
    });
  }

  function loadManifest(): string {
    if (manifestPath && fs.existsSync(manifestPath)) {
      return fs.readFileSync(manifestPath, 'utf-8');
    }
    // Try common locations
    for (const loc of ['dist/gwen-manifest.json', 'gwen-manifest.json']) {
      const p = path.resolve(projectRoot, loc);
      if (fs.existsSync(p)) return fs.readFileSync(p, 'utf-8');
    }
    return JSON.stringify({ version: '0.1.0', plugins: [], engine: {} });
  }

  return {
    name: 'gwen',
    enforce: 'pre',

    // ── COOP/COEP headers for Vite preview (production) ───────────────────
    config() {
      return {
        preview: {
          headers: {
            'Cross-Origin-Opener-Policy': 'same-origin',
            'Cross-Origin-Embedder-Policy': 'require-corp',
          },
        },
      };
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

      if (id === RESOLVED_ENTRY) {
        const hasScenesDir = fs.existsSync(path.join(projectRoot, 'src', 'scenes'));
        const configPath = path.join(projectRoot, 'gwen.config.ts');
        const moduleNames = extractModuleNamesFromConfig(configPath);
        return generateEntryModule(hasScenesDir, moduleNames);
      }

      if (id === RESOLVED_SCENES) {
        const scenes = scanScenes(projectRoot);
        const configPath = path.join(projectRoot, 'gwen.config.ts');
        let mainSceneFromConfig: string | undefined;
        if (fs.existsSync(configPath)) {
          const src = fs.readFileSync(configPath, 'utf-8');
          mainSceneFromConfig = src.match(/mainScene\s*:\s*['"]([^'"]+)['"]/)?.[1];
        }
        return generateScenesModule(scenes, resolveMainScene(scenes, mainSceneFromConfig));
      }

      return null;
    },

    // ── Inject entry script into served HTML ────────────────────────────
    transformIndexHtml(html) {
      // If script already present, don't duplicate
      if (html.includes('/@gwenjs/gwen-entry')) return html;
      return html.replace(
        '</body>',
        '  <script type="module" src="/@gwenjs/gwen-entry"></script>\n</body>',
      );
    },

    // ── HMR: invalidate modules when src/scenes/ changes ─────────────────
    configureServer(devServer) {
      server = devServer;
      projectRoot = devServer.config.root;
      cratePath = resolveCratePath(projectRoot);

      // Watcher on src/scenes/ to invalidate modules
      const scenesDir = path.join(projectRoot, 'src', 'scenes');
      if (fs.existsSync(scenesDir)) {
        // Register scenesDir with Vite's Chokidar instance for reliable cross-platform watching
        devServer.watcher.add(scenesDir);
        devServer.watcher.on('change', (filePath) => {
          if (!filePath.startsWith(scenesDir + path.sep)) return;
          const mod = devServer.moduleGraph.getModuleById(RESOLVED_SCENES);
          if (mod) devServer.moduleGraph.invalidateModule(mod);
          const entryMod = devServer.moduleGraph.getModuleById(RESOLVED_ENTRY);
          if (entryMod) devServer.moduleGraph.invalidateModule(entryMod);
          devServer.ws.send({ type: 'full-reload' });
        });
      }

      if (options.watch !== false) {
        buildWasm(projectRoot);
        startWatcher(projectRoot, devServer);
      }

      // WASM middleware + COOP/COEP headers + generated HTML if index.html missing
      devServer.middlewares.use((req, res, next) => {
        // ── COOP/COEP headers — required for SharedArrayBuffer (WASM plugins) ──
        res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
        res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');

        // Serve WASM files directly from wasmSourceDir (no copy to public/)
        const wasmPrefix = wasmPublicPath.endsWith('/') ? wasmPublicPath : wasmPublicPath + '/';
        if (req.url?.startsWith(wasmPrefix)) {
          const fileName = req.url.slice(wasmPrefix.length).split('?')[0];

          // 1. Try primary wasmSourceDir (gwen-core or custom crate)
          if (wasmSourceDir) {
            const filePath = path.join(wasmSourceDir, fileName);
            if (fs.existsSync(filePath)) {
              const ext = path.extname(filePath);
              if (ext === '.wasm') res.setHeader('Content-Type', 'application/wasm');
              if (ext === '.js') res.setHeader('Content-Type', 'application/javascript');
              res.end(fs.readFileSync(filePath));
              return;
            }
          }

          // 2. Try WASM plugin packages: node_modules/@gwenjs/gwen-plugin-*/wasm/
          const pluginWasmFile = findWasmPluginFile(projectRoot, fileName);
          if (pluginWasmFile) {
            const ext = path.extname(pluginWasmFile);
            if (ext === '.wasm') res.setHeader('Content-Type', 'application/wasm');
            if (ext === '.js') res.setHeader('Content-Type', 'application/javascript');
            res.end(fs.readFileSync(pluginWasmFile));
            return;
          }
        }

        // Serve .gwen/index.html (file prepared by CLI)
        if (
          (req.url === '/' || req.url === '/index.html') &&
          !fs.existsSync(path.join(projectRoot, 'index.html'))
        ) {
          const gwenHtmlPath = path.join(projectRoot, '.gwen', 'index.html');

          // Fallback minimal in case `gwen prepare` hasn't finished yet
          let raw = `<!DOCTYPE html><html><body><script type="module" src="/@gwenjs/gwen-entry"></script></body></html>`;
          if (fs.existsSync(gwenHtmlPath)) {
            raw = fs.readFileSync(gwenHtmlPath, 'utf-8');
          }

          // Go through Vite pipeline: inject HMR client + transformIndexHtml hooks
          devServer
            .transformIndexHtml(req.url!, raw, req.originalUrl)
            .then((html) => {
              res.setHeader('Content-Type', 'text/html; charset=utf-8');
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
        type: 'asset',
        fileName: 'gwen-manifest.json',
        source: manifest,
      });

      // WASM artifacts — emitted as assets to dist/wasm/
      const srcDir = wasmSourceDir ?? findPrecompiledWasmDir(projectRoot);
      if (srcDir) {
        const files = listWasmFiles(srcDir);
        for (const file of files) {
          const buffer = fs.readFileSync(path.join(srcDir, file));
          this.emitFile({
            type: 'asset',
            fileName: `wasm/${file}`,
            source: new Uint8Array(buffer),
          });
        }
        if (files.length > 0) log(`Emitted ${files.length} WASM assets to dist/wasm/`);
      } else {
        console.warn('[gwen-vite] No WASM source found for production build');
      }

      // Emit WASM plugin assets from node_modules/@gwenjs/gwen-plugin-*/wasm/
      const pluginDirs = collectWasmPluginDirs(projectRoot);
      for (const pluginDir of pluginDirs) {
        const files = listWasmFiles(pluginDir);
        for (const file of files) {
          const buffer = fs.readFileSync(path.join(pluginDir, file));
          this.emitFile({
            type: 'asset',
            fileName: `wasm/${file}`,
            source: new Uint8Array(buffer),
          });
        }
        if (files.length > 0) log(`Emitted ${files.length} WASM plugin assets from ${pluginDir}`);
      }
    },

    // ── Build SSR/preview: ensure wasmSourceDir is known ─────────────────
    buildStart() {
      if (!wasmSourceDir) {
        buildWasm(projectRoot);
      }
    },

    // ── Vite serve preview: serve dist/wasm/ folder ─────────────────────
    // (handled automatically by Vite as dist/ is the build folder)
    // Nothing more to do here.
  };
}

// Default export for CommonJS compatibility
export { gwenTransform } from './transform';
export type { GwenTransformOptions } from './transform';

/** @internal Exported for unit tests only */
export { generateEntryModule, generateScenesModule, extractModuleNamesFromConfig };

export default gwen;

// RFC-006: New sub-plugin architecture
export { gwenVitePlugin } from './plugins/index.js';
export type { GwenViteOptions, GwenWasmOptions, WasmVariant, ActorPluginOptions } from './types.js';

// RFC-007: ECS optimizer plugin (opt-in)
export { gwenOptimizerPlugin } from './plugins/optimizer.js';
export type { GwenOptimizerOptions } from './plugins/optimizer.js';

// RFC-008: Physics3D query optimizer plugin (opt-in, Phase 1 — warn)
export { gwenPhysics3DOptimizerPlugin } from './plugins/physics3d-optimizer.js';
export type { GwenPhysics3DOptimizerOptions } from './plugins/physics3d-optimizer.js';
