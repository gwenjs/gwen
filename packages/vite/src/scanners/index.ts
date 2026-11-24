/**
 * Scene discovery for `@gwenjs/vite/scanners`.
 * No Vite import: `GwenApp` and the CLI can call this without a Vite peer.
 */
import fs from "node:fs";
import * as path from "node:path";
import { walk } from "oxc-walker";
import type { Expression, ModuleExportName, Program } from "oxc-parser";
import { GwenError } from "@gwenjs/schema";
import type { AutoImport } from "@gwenjs/kit";
import { getCallArgs, getObjectProperties, getPropertyKeyName } from "../oxc/index.js";
import { ViteErrorCodes } from "../error-codes.js";
import type { ModuleResolver } from "../pipeline/resolve-callee.js";
import type { GwenCallee } from "../pipeline/types.js";
import { includeBase, readScanned, sourceFilesUnder } from "./read.js";

/** One file under `src/scenes/` that exports a scene. */
export interface SceneInfo {
  file: string;
  className: string;
  sceneName: string;
  isDefault: boolean;
  isFactory: boolean;
  isConst: boolean;
  relPath: string;
}

/** One exported `defineHooks` binding and the file that declares it. */
export interface HookExport {
  file: string;
  name: string;
}

/** One `defineLayout` binding and the file that declares it. */
export interface LayoutName {
  file: string;
  name: string;
}

/**
 * Shared scanner options.
 * `autoImports` supplies bare callees such as `defineScene("menu", …)` with no import.
 * Without it only explicit imports of the framework are found.
 */
export interface ScanOptions {
  autoImports?: readonly AutoImport[];
}

/**
 * Read one scene file.
 * `sceneName` is null when the file has no string literal name.
 * `className` is the export binding, or `fallbackName` when the file declares none.
 */
function scanSceneFile(
  file: string,
  fallbackName: string,
  autoImports: readonly AutoImport[],
): {
  className: string;
  sceneName: string | null;
  isDefault: boolean;
  isFactory: boolean;
  isConst: boolean;
} {
  const { program, resolver } = readScanned(file, "scanScenes", autoImports);

  let className = fallbackName;
  let isDefault = false;
  let isConst = false;
  let isFactory = false;
  let sceneName: string | null = null;

  walk(program, {
    enter(node) {
      if (node.type === "ExportDefaultDeclaration") {
        const { declaration } = node;
        if (declaration.type === "ClassDeclaration" || declaration.type === "ClassExpression") {
          if (declaration.id?.type === "Identifier") {
            className = declaration.id.name;
            isDefault = true;
          }
        }
        return;
      }

      if (node.type === "ExportNamedDeclaration") {
        const { declaration } = node;
        if (!declaration) return;

        if (declaration.type === "ClassDeclaration" || declaration.type === "ClassExpression") {
          if (declaration.id?.type === "Identifier") className = declaration.id.name;
          return;
        }

        if (declaration.type === "VariableDeclaration") {
          for (const { id, init } of declaration.declarations) {
            if (id.type !== "Identifier") continue;
            if (!init || init.type !== "CallExpression") continue;
            if (resolver.resolveCallee(init) !== "defineScene") continue;
            className = id.name;
            isConst = true;
            const first = getCallArgs(init)[0];
            if (first && first.type === "Literal" && typeof first.value === "string") {
              sceneName = first.value;
              isFactory = true;
            }
          }
          return;
        }
      }

      if (node.type === "CallExpression" && resolver.resolveCallee(node) === "defineScene") {
        if (!sceneName) {
          const first = getCallArgs(node)[0];
          if (first && first.type === "Literal" && typeof first.value === "string") {
            sceneName = first.value;
          }
        }
        return;
      }

      if (node.type === "PropertyDefinition") {
        if (node.key.type === "Identifier" && node.key.name === "name") {
          if (node.value && node.value.type === "Literal" && !sceneName) {
            if (typeof node.value.value === "string") sceneName = node.value.value;
          }
        }
      }
    },
  });

  return { className, sceneName, isDefault, isConst, isFactory };
}

/**
 * Scan `src/scenes/*.ts`. Files whose names start with `_` or `.` are skipped.
 * A file that cannot be read or parsed throws `VITE:TRANSFORM_PARSE_FAILED`.
 */
export function scanScenes(projectRoot: string, options?: ScanOptions): SceneInfo[] {
  const scenesDir = path.join(projectRoot, "src", "scenes");
  if (!fs.existsSync(scenesDir)) return [];

  const scenes: SceneInfo[] = [];
  const seen = new Map<string, string>();
  const files = fs
    .readdirSync(scenesDir)
    .filter((file) => file.endsWith(".ts") && !file.startsWith("_") && !file.startsWith("."))
    .sort();

  for (const file of files) {
    const rel = `src/scenes/${file}`;
    const base = file.slice(0, -".ts".length);
    const fullPath = path.join(scenesDir, file);
    const extracted = scanSceneFile(fullPath, base, options?.autoImports ?? []);
    if (extracted.sceneName === null) {
      throw new GwenError(
        ViteErrorCodes.SCENE_NAME_UNRESOLVED,
        `Scene file "${rel}" has no literal scene name.`,
        {
          composable: "scanScenes",
          hint:
            process.env["NODE_ENV"] !== "production"
              ? "Use defineScene('<name>', …) with a string literal, or prefix helper files with \"_\"."
              : undefined,
        },
      );
    }
    const sceneName = extracted.sceneName;
    const previous = seen.get(sceneName);
    if (previous !== undefined) {
      throw new GwenError(
        ViteErrorCodes.SCENE_NAME_DUPLICATE,
        `Scene name "${sceneName}" is declared in "${previous}" and "${rel}".`,
        {
          composable: "scanScenes",
          hint:
            process.env["NODE_ENV"] !== "production"
              ? "Give each scene file its own string literal name."
              : undefined,
        },
      );
    }
    seen.set(sceneName, rel);
    scenes.push({
      file,
      className: extracted.className,
      sceneName,
      isDefault: extracted.isDefault,
      isFactory: extracted.isFactory,
      isConst: extracted.isConst,
      relPath: `/src/scenes/${base}.ts`,
    });
  }

  return scenes;
}

/**
 * Pick the initial scene.
 * A `fromConfig` that is not one of the discovered names throws.
 * With no `fromConfig`, the first discovered scene is used.
 */
export function resolveMainScene(
  scenes: readonly SceneInfo[],
  fromConfig?: string,
): string | undefined {
  if (fromConfig) {
    if (!scenes.some((scene) => scene.sceneName === fromConfig)) {
      const discovered = scenes.map((scene) => scene.sceneName).join(", ");
      throw new GwenError(
        ViteErrorCodes.MAIN_SCENE_UNKNOWN,
        `Main scene "${fromConfig}" is not a discovered scene (${discovered}).`,
        {
          composable: "resolveMainScene",
          hint:
            process.env["NODE_ENV"] !== "production"
              ? "Set mainScene to a name discovered under src/scenes/."
              : undefined,
        },
      );
    }
    return fromConfig;
  }
  return scenes[0]?.sceneName;
}

function moduleExportName(name: ModuleExportName): string {
  return name.type === "Identifier" ? name.name : name.value;
}

/** True when `init` is a call that resolves, by import binding or auto-import, to `callee`. */
function isCalleeCall(
  resolver: ModuleResolver,
  init: Expression | null,
  callee: GwenCallee,
): boolean {
  if (!init || init.type !== "CallExpression") return false;
  return resolver.resolveCallee(init) === callee;
}

/** Exported `defineHooks` bindings of one parsed file, in source order. */
function hooksOfProgram(file: string, program: Program, resolver: ModuleResolver): HookExport[] {
  const locals = new Set<string>();
  for (const statement of program.body) {
    if (statement.type !== "VariableDeclaration") continue;
    for (const { id, init } of statement.declarations) {
      if (id.type === "Identifier" && isCalleeCall(resolver, init, "defineHooks")) {
        locals.add(id.name);
      }
    }
  }

  const found: HookExport[] = [];
  for (const statement of program.body) {
    if (statement.type !== "ExportNamedDeclaration") continue;
    const { declaration } = statement;
    if (declaration && declaration.type === "VariableDeclaration") {
      for (const { id, init } of declaration.declarations) {
        if (id.type === "Identifier" && isCalleeCall(resolver, init, "defineHooks")) {
          found.push({ file, name: id.name });
        }
      }
      continue;
    }
    if (declaration || statement.source) continue;
    for (const specifier of statement.specifiers) {
      if (!locals.has(moduleExportName(specifier.local))) continue;
      // `default` and a string export name (`as "x-y"`) cannot be written in `import type { … }`.
      if (specifier.exported.type !== "Identifier" || specifier.exported.name === "default") {
        continue;
      }
      found.push({ file, name: specifier.exported.name });
    }
  }
  return found;
}

/**
 * Exported `defineHooks` bindings of `src/hooks.ts`, then of `src/hooks/*.ts` in name order.
 * `options.file` and `options.dir` replace those paths (relative to `root`).
 * A binding counts when it is `export const X = defineHooks(…)` or a top-level
 * `const X = defineHooks(…)` named in an `export { X }` list. A default export is not typed,
 * and neither is a binding exported under `default` or under a string name
 * (`export { X as "x-y" }`).
 * The result keeps source order inside a file.
 * A file that cannot be read or parsed throws `VITE:TRANSFORM_PARSE_FAILED`.
 */
export function scanDefineHooks(
  root: string,
  options?: ScanOptions & { file?: string; dir?: string },
): HookExport[] {
  const autoImports = options?.autoImports ?? [];
  const mainFile = path.resolve(root, options?.file ?? "src/hooks.ts");
  const hooksDir = path.resolve(root, options?.dir ?? "src/hooks");

  const files: string[] = [];
  if (fs.existsSync(mainFile)) files.push(mainFile);
  if (fs.existsSync(hooksDir)) {
    for (const name of fs.readdirSync(hooksDir).sort()) {
      const full = path.join(hooksDir, name);
      if (name.endsWith(".ts") && !files.includes(full)) files.push(full);
    }
  }

  const found: HookExport[] = [];
  for (const file of files) {
    const { program, resolver } = readScanned(file, "scanDefineHooks", autoImports);
    found.push(...hooksOfProgram(file, program, resolver));
  }
  return found;
}

/**
 * `defineLayout` bindings of the files the `include` globs select, sorted by file.
 * A glob names a directory only: the text before `**`. Every `.ts` and `.tsx` file under that
 * directory is scanned, whatever the rest of the glob says. A `.d.ts` file and a file whose name
 * contains `.test.` are skipped and never read; a `.spec.` file is scanned.
 * A file that cannot be read or parsed throws `VITE:TRANSFORM_PARSE_FAILED`.
 */
export function scanLayoutNames(
  root: string,
  include: readonly string[],
  options?: ScanOptions,
): LayoutName[] {
  const autoImports = options?.autoImports ?? [];
  const files = new Set<string>();
  for (const pattern of include) {
    const base = includeBase(pattern);
    if (base === "") continue;
    for (const file of sourceFilesUnder(path.resolve(root, base), [".ts", ".tsx"])) {
      files.add(file);
    }
  }

  const found: LayoutName[] = [];
  for (const file of [...files].sort()) {
    const { program, resolver } = readScanned(file, "scanLayoutNames", autoImports);
    walk(program, {
      enter(node) {
        if (node.type !== "VariableDeclarator" || node.id.type !== "Identifier") return;
        if (isCalleeCall(resolver, node.init, "defineLayout")) {
          found.push({ file, name: node.id.name });
        }
      },
    });
  }
  return found;
}

/**
 * Easing names written as `easing: "<name>"` in an object argument of a `useTween` call,
 * over `src/**`. Sorted and unique. Template literals and identifiers are not read.
 * A `.d.ts` file and a file whose name contains `.test.` or `.spec.` are skipped and never read.
 * A file that cannot be read or parsed throws `VITE:TRANSFORM_PARSE_FAILED`.
 */
export function scanEasingNames(root: string, options?: ScanOptions): string[] {
  const autoImports = options?.autoImports ?? [];
  const found = new Set<string>();
  for (const file of sourceFilesUnder(path.join(root, "src"), [".ts", ".tsx", ".js", ".jsx"], {
    skipSpec: true,
  })) {
    const { program, resolver } = readScanned(file, "scanEasingNames", autoImports);
    walk(program, {
      enter(node) {
        if (node.type !== "CallExpression") return;
        if (resolver.resolveCallee(node) !== "useTween") return;
        for (const argument of node.arguments) {
          if (argument.type !== "ObjectExpression") continue;
          for (const property of getObjectProperties(argument)) {
            if (getPropertyKeyName(property) !== "easing") continue;
            const { value } = property;
            if (value.type === "Literal" && typeof value.value === "string") {
              found.add(value.value);
            }
          }
        }
      },
    });
  }
  return [...found].sort();
}
