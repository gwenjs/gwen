/**
 * Codegen helpers for the GWEN Vite plugin.
 * The package entry `@gwenjs/vite/internal` re-exports only the five public-internal names.
 */
import fs from "node:fs";
import * as path from "node:path";
import { walk } from "oxc-walker";
import type {
  ArrayExpression,
  CallExpression,
  ExportDefaultDeclaration,
  ExportNamedDeclaration,
  ObjectExpression,
  ObjectProperty,
  PropertyDefinition,
  StringLiteral,
  VariableDeclaration,
  VariableDeclarator,
  Class as OxcClass,
} from "oxc-parser";
import {
  getCallArgs,
  getObjectProperties,
  getPropertyKeyName,
  isCallTo,
  parseSource,
} from "./oxc/index.js";
import type { PluginDeclaration } from "@gwenjs/schema";

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
      sceneName: fallbackName.replace(/Scene$/, ""),
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
      if (node.type === "ExportDefaultDeclaration") {
        const { declaration } = node as ExportDefaultDeclaration;
        if (declaration.type === "ClassDeclaration" || declaration.type === "ClassExpression") {
          const cls = declaration as OxcClass;
          if (cls.id?.type === "Identifier") {
            className = (cls.id as { name: string }).name;
            isDefault = true;
          }
        }
        return;
      }

      // Case 2 & 3: export class / export const = defineScene(...)
      if (node.type === "ExportNamedDeclaration") {
        const { declaration } = node as ExportNamedDeclaration;
        if (!declaration) return;

        if (declaration.type === "ClassDeclaration" || declaration.type === "ClassExpression") {
          const cls = declaration as OxcClass;
          if (cls.id?.type === "Identifier") className = (cls.id as { name: string }).name;
          return;
        }

        if (declaration.type === "VariableDeclaration") {
          for (const declarator of (declaration as VariableDeclaration).declarations) {
            const { id, init } = declarator as VariableDeclarator;
            if (id.type !== "Identifier") continue;
            if (!init || !isCallTo(init, "defineScene")) continue;
            className = (id as { name: string }).name;
            isConst = true;
            const args = getCallArgs(init as CallExpression);
            if (args.length >= 1 && args[0]!.type === "Literal") {
              const val = (args[0] as StringLiteral).value;
              if (typeof val === "string") {
                sceneName = val;
                isFactory = true;
              }
            }
          }
          return;
        }
      }

      // Case 3b: defineScene('name', ...) outside export
      if (node.type === "CallExpression" && isCallTo(node as CallExpression, "defineScene")) {
        if (!sceneName) {
          const args = getCallArgs(node as CallExpression);
          if (args.length >= 1 && args[0]!.type === "Literal") {
            const val = (args[0] as StringLiteral).value;
            if (typeof val === "string") sceneName = val;
          }
        }
        return;
      }

      // Case 4: readonly name = 'Foo' inside a class
      if (node.type === "PropertyDefinition") {
        const propDef = node as PropertyDefinition;
        if (
          propDef.key.type === "Identifier" &&
          (propDef.key as { name: string }).name === "name"
        ) {
          if (propDef.value && propDef.value.type === "Literal" && !sceneName) {
            const val = (propDef.value as StringLiteral).value;
            if (typeof val === "string") sceneName = val;
          }
        }
      }
    },
  });

  return {
    className,
    sceneName: sceneName ?? className.replace(/Scene$/, ""),
    isDefault,
    isConst,
    isFactory,
  };
}

export function scanScenes(projectRoot: string): SceneInfo[] {
  const scenesDir = path.join(projectRoot, "src", "scenes");
  if (!fs.existsSync(scenesDir)) return [];

  return fs
    .readdirSync(scenesDir)
    .filter((f) => f.endsWith(".ts") && !f.startsWith("_") && !f.startsWith("."))
    .sort()
    .map((file) => {
      const base = file.replace(/\.ts$/, "");
      const fullPath = path.join(scenesDir, file);
      const source = fs.readFileSync(fullPath, "utf-8");

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

export function resolveMainScene(scenes: SceneInfo[], fromConfig?: string): string | undefined {
  if (fromConfig) return fromConfig;
  const candidates = ["Main", "MainMenu", "Boot"];
  return candidates.find((c) => scenes.some((s) => s.sceneName === c)) ?? scenes[0]?.sceneName;
}

// ── Virtual module generation ─────────────────────────────────────────────────

export function generateScenesModule(scenes: SceneInfo[], mainScene: string | undefined): string {
  if (scenes.length === 0) {
    return [
      "export function registerScenes(_scenes) {}",
      "export const mainScene = undefined;",
    ].join("\n");
  }

  const imports = scenes
    .map((s) =>
      s.isDefault
        ? `import ${s.className} from ${JSON.stringify(s.relPath)};`
        : `import { ${s.className} } from ${JSON.stringify(s.relPath)};`,
    )
    .join("\n");

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
    .join("\n");

  const mainSceneValue = mainScene ? JSON.stringify(mainScene) : "undefined";

  return [
    imports,
    "",
    "export function registerScenes(scenes) {",
    registrations,
    "}",
    "",
    `export const mainScene = ${mainSceneValue};`,
  ].join("\n");
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
export function extractModuleNamesFromConfig(configPath: string): string[] {
  if (!fs.existsSync(configPath)) return [];
  const src = fs.readFileSync(configPath, "utf-8");

  const parsed = parseSource(configPath, src);
  if (!parsed) return [];

  const names: string[] = [];

  walk(parsed.program, {
    enter(node) {
      if (node.type !== "ObjectExpression") return;

      for (const prop of getObjectProperties(node as ObjectExpression)) {
        if (getPropertyKeyName(prop) !== "modules") continue;

        const { value } = prop as ObjectProperty;
        if (value.type !== "ArrayExpression") continue;

        for (const el of (value as ArrayExpression).elements) {
          if (!el || el.type === "SpreadElement") continue;

          // Form 1: '@scope/pkg' string literal
          if (el.type === "Literal" && typeof (el as StringLiteral).value === "string") {
            const s = (el as StringLiteral).value;
            if (s.includes("/") || s.startsWith("@")) names.push(s);
            continue;
          }

          // Form 2: ['@scope/pkg', opts] tuple
          if (el.type === "ArrayExpression") {
            const first = (el as ArrayExpression).elements[0];
            if (
              first &&
              first.type === "Literal" &&
              typeof (first as StringLiteral).value === "string"
            ) {
              const s = (first as StringLiteral).value;
              if (s.includes("/") || s.startsWith("@")) names.push(s);
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

/**
 * Extract `globalCss` file paths from a `gwen.config.ts` file.
 *
 * @param configPath - Absolute path to `gwen.config.ts`.
 * @returns Array of CSS file path strings.
 */
export function extractGlobalCssFromConfig(configPath: string): string[] {
  if (!fs.existsSync(configPath)) return [];
  const src = fs.readFileSync(configPath, "utf-8");

  const parsed = parseSource(configPath, src);
  if (!parsed) return [];

  const files: string[] = [];

  walk(parsed.program, {
    enter(node) {
      if (node.type !== "ObjectExpression") return;

      for (const prop of getObjectProperties(node as ObjectExpression)) {
        if (getPropertyKeyName(prop) !== "globalCss") continue;

        const { value } = prop as ObjectProperty;
        if (value.type !== "ArrayExpression") continue;

        for (const el of (value as ArrayExpression).elements) {
          if (!el || el.type === "SpreadElement") continue;
          if (el.type === "Literal" && typeof (el as StringLiteral).value === "string") {
            files.push((el as StringLiteral).value);
          }
        }

        this.skip();
        return;
      }
    },
  });

  return files;
}

/**
 * Convert a user-supplied CSS path (relative to project root, or absolute) to a
 * root-relative import path that Vite can resolve from a virtual module.
 *
 * Virtual modules have no real directory, so relative imports like `"./src/..."` are
 * resolved from the project root when they start with `"/"`. Files outside the project
 * root are served via Vite's `/@fs/` prefix.
 */
export function toRootRelative(filePath: string, projectRoot: string): string {
  if (filePath.startsWith("/")) return filePath; // already root-relative or absolute URL
  const abs = path.resolve(projectRoot, filePath);
  if (abs.startsWith(projectRoot)) {
    return "/" + path.relative(projectRoot, abs).replace(/\\/g, "/");
  }
  // File is outside project root (e.g. a monorepo sibling) — use /@fs/ prefix
  return "/@fs" + abs;
}

/**
 * Generates the `virtual:gwen/config-modules` virtual module source.
 *
 * Statically imports each npm module declared in `gwen.config.ts` via its
 * `/module` subpath, so the browser bootstrap can call `setup()` at runtime.
 *
 * @param moduleNames - Package names from `gwen.config.ts → modules`.
 * @returns ESM source string.
 */
export function generateConfigModulesVirtualModule(moduleNames: string[]): string {
  if (moduleNames.length === 0) return "export const configModules = [];\n";
  const imports = moduleNames
    .map((n, i) => `import _cm${i} from ${JSON.stringify(n + "/module")};`)
    .join("\n");
  const entries = moduleNames.map((_, i) => `  _cm${i}.default ?? _cm${i}`).join(",\n");
  return `${imports}\nexport const configModules = [\n${entries},\n];\n`;
}

/**
 * Generates the `/@gwenjs/gwen-entry` virtual module source.
 *
 * Imports `@gwenjs/core` directly to prevent
 * esbuild from pre-bundling `@gwenjs/app` and creating duplicate `engineContext` singletons.
 *
 * @param hasScenesDir - Whether `src/scenes/` exists in the project.
 * @param declarations - Path-based plugin declarations collected from module setup().
 * @param cssFiles     - Root-relative CSS paths to inject as top-level imports.
 */
export function generateEntryModule(
  hasScenesDir: boolean,
  declarations: PluginDeclaration[] = [],
  cssFiles: string[] = [],
): string {
  const lines: string[] = [];

  for (const css of cssFiles) {
    lines.push(`import ${JSON.stringify(css)};`);
  }

  lines.push(
    'import { createEngine, GwenLogger, consoleLogProvider } from "@gwenjs/core";',
    'import { WasmBridgeImpl, detectCoreVariant } from "@gwenjs/core/internal";',
    'import { createViewportsPlugin, createScreenPlugin } from "@gwenjs/app";',
    'import gwenConfig from "/gwen.config.ts";',
    'import { configModules as _cfgModules } from "virtual:gwen/config-modules";',
    'import { plugins as _localPlugins } from "virtual:gwen/local-plugins";',
    'import { modules as _localModules } from "virtual:gwen/local-modules";',
  );

  if (hasScenesDir) {
    lines.push('import { registerScenes, mainScene } from "/@gwenjs/gwen-scenes";');
  }

  for (let i = 0; i < declarations.length; i++) {
    const d = declarations[i]!;
    if (d.export) {
      lines.push(`import { ${d.export} as _gwenPlugin${i} } from ${JSON.stringify(d.src)};`);
    } else {
      lines.push(`import _gwenPlugin${i} from ${JSON.stringify(d.src)};`);
    }
  }

  const bootstrapLines: string[] = [
    "",
    "async function bootstrap() {",
    "  const variant = detectCoreVariant(gwenConfig);",
    "  const bridge = new WasmBridgeImpl();",
    "  await bridge.init(variant);",
    "  const engine = await createEngine({ ...gwenConfig.engine, variant, _bridge: bridge });",
    "  const _logCfg = gwenConfig.logger ?? {};",
    '  engine.logger = new GwenLogger(_logCfg.providers ?? [consoleLogProvider()], _logCfg.minLevel ?? "warn");',
    "",
    "  await engine.use(createViewportsPlugin(gwenConfig.viewports));",
    "  await engine.use(createScreenPlugin(gwenConfig.screen));",
    "",
    "  for (const p of gwenConfig.plugins ?? []) await engine.use(p);",
    "",
  ];

  for (let i = 0; i < declarations.length; i++) {
    const d = declarations[i]!;
    const opts = d.options !== undefined ? JSON.stringify(d.options) : undefined;
    bootstrapLines.push(
      opts !== undefined
        ? `  await engine.use(_gwenPlugin${i}(${opts}));`
        : `  await engine.use(_gwenPlugin${i}());`,
    );
  }

  bootstrapLines.push(
    "",
    "  for (const _cmMod of _cfgModules) {",
    "    const _cmPlugins = [];",
    "    const _cmDecls = [];",
    '    const _cmKit = { addPlugin(p) { if (typeof p === "function") { _cmPlugins.push(p()); } else if (p && "src" in p) { _cmDecls.push(p); } else { _cmPlugins.push(p); } }, addAutoImports() {}, addVitePlugin() {}, extendViteConfig() {}, addTypeTemplate() {}, addModuleAugment() {}, hook() {}, options: gwenConfig };',
    "    const _cmKey = _cmMod.meta?.configKey;",
    "    const _cmOpts = Object.assign({}, _cmMod.defaults ?? {}, _cmKey ? (gwenConfig[_cmKey] ?? {}) : {});",
    "    await _cmMod.setup(_cmOpts, _cmKit);",
    "    for (const p of _cmPlugins) await engine.use(p);",
    "    for (const d of _cmDecls) { const _m = await import(/* @vite-ignore */ d.src); const _f = d.export ? _m[d.export] : _m.default; await engine.use(d.options !== undefined ? _f(d.options) : _f()); }",
    "  }",
    "",
    "  for (const mod of _localModules) {",
    "    const _lmPlugins = [];",
    "    const _lmDecls = [];",
    '    const _lmKit = { addPlugin(p) { if (typeof p === "function") { _lmPlugins.push(p()); } else if (p && "src" in p) { _lmDecls.push(p); } else { _lmPlugins.push(p); } }, addAutoImports() {}, addVitePlugin() {}, extendViteConfig() {}, addTypeTemplate() {}, addModuleAugment() {}, hook() {}, options: gwenConfig };',
    "    const _lmKey = mod.meta?.configKey;",
    "    const _lmOpts = Object.assign({}, mod.defaults ?? {}, _lmKey ? (gwenConfig[_lmKey] ?? {}) : {});",
    "    await mod.setup(_lmOpts, _lmKit);",
    "    for (const p of _lmPlugins) await engine.use(p);",
    "    for (const d of _lmDecls) { const _m = await import(/* @vite-ignore */ d.src); const _f = d.export ? _m[d.export] : _m.default; await engine.use(d.options !== undefined ? _f(d.options) : _f()); }",
    "  }",
    "  for (const factory of _localPlugins) await engine.use(factory());",
  );

  if (hasScenesDir) {
    bootstrapLines.push(
      "",
      "  const _sceneUsages = [];",
      "  const _sceneHandleMap = new Map();",
      "  engine.run(() => registerScenes({ register(scene) { _sceneHandleMap.set(scene.name, scene.handles ?? []); for (const _s of scene.systems ?? []) _sceneUsages.push(engine.use(_s)); } }));",
      "  await Promise.all(_sceneUsages);",
      "",
      "  // Pause systems of every scene except the initial one.",
      "  // scene:enter / scene:beforeLeave resume and pause them during transitions.",
      "  for (const [_sName, _sHandles] of _sceneHandleMap.entries()) {",
      "    if (_sName !== mainScene) for (const _h of _sHandles) _h._scenePause();",
      "  }",
      "  engine.hooks.hook('scene:enter', (_name) => { for (const _h of _sceneHandleMap.get(_name) ?? []) _h._sceneResume(); });",
      "  engine.hooks.hook('scene:beforeLeave', (_name) => { for (const _h of _sceneHandleMap.get(_name) ?? []) _h._scenePause(); });",
      "",
      '  if (mainScene) await engine.hooks.callHook("scene:enter", mainScene, undefined);',
    );
  }

  bootstrapLines.push(
    "",
    '  if (gwenConfig.engine?.loop === "external") {',
    "    await engine.startExternal();",
    "  } else {",
    "    await engine.start();",
    "  }",
    "}",
    "",
    "bootstrap().catch(err => {",
    '  console.error("[GWEN] Fatal:", err);',
    '  const pre = document.createElement("pre");',
    '  pre.style.cssText = "color:red;padding:2rem";',
    "  pre.textContent = `[GWEN] Fatal:\\n${err}`;",
    '  document.body.textContent = "";',
    "  document.body.appendChild(pre);",
    "});",
  );

  lines.push(...bootstrapLines);
  return lines.join("\n");
}
