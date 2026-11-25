/**
 * Scene discovery for `@gwenjs/vite/scanners`.
 * No Vite import: `GwenApp` and the CLI can call this without a Vite peer.
 */
import fs from "node:fs";
import * as path from "node:path";
import { ScopeTracker, walk } from "oxc-walker";
import type { CallExpression, Expression, ModuleExportName, Program, TSType } from "oxc-parser";
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

/** One `loadWasmModule<T>({ name: "<name>" })` call whose name and type are both known. */
export interface WasmModuleHit {
  /** The string literal given as `name`. */
  name: string;
  /** Where `T` comes from: the import specifier as written and the original export name. */
  typeImport: { from: string; name: string };
  /** Absolute path of the file holding the call. */
  file: string;
  /** 1-based line of the call. */
  line: number;
}

/** One `loadWasmModule` call that cannot be typed, with the reason it was left out. */
export interface WasmModuleSkip {
  /** Absolute path of the file holding the call. */
  file: string;
  /** 1-based line of the call. */
  line: number;
  /** `non-literal name`, `no type argument` or `type not importable`. */
  reason: string;
}

/** What `scanWasmModuleNames` found: the typed calls and the calls it skipped. */
export interface WasmModuleScan {
  hits: WasmModuleHit[];
  skipped: WasmModuleSkip[];
}

/** Source suffixes read by `scanWasmModuleNames`. */
const WASM_SCAN_SUFFIXES = [".ts", ".tsx", ".js", ".jsx"];

/** A type reachable from an import: `local` name to the specifier and the original export name. */
type TypeImportTable = ReadonlyMap<string, { from: string; name: string }>;

function importedTypes(program: Program): TypeImportTable {
  const table = new Map<string, { from: string; name: string }>();
  for (const statement of program.body) {
    if (statement.type !== "ImportDeclaration") continue;
    const from = statement.source.value;
    for (const specifier of statement.specifiers) {
      if (specifier.type === "ImportSpecifier") {
        table.set(specifier.local.name, { from, name: moduleExportName(specifier.imported) });
      } else if (specifier.type === "ImportDefaultSpecifier") {
        table.set(specifier.local.name, { from, name: "default" });
      }
    }
  }
  return table;
}

/** True when `callee` is the `loadWasmModule` property of a non-computed member access. */
function isMethodCallee(callee: Expression): boolean {
  if (callee.type !== "MemberExpression" || callee.computed) return false;
  return callee.property.type === "Identifier" && callee.property.name === "loadWasmModule";
}

/** The string literal given as `name` in the options object, or `null`. */
function literalName(call: CallExpression): string | null {
  const [options] = getCallArgs(call);
  if (options === undefined || options.type !== "ObjectExpression") return null;
  for (const property of getObjectProperties(options)) {
    if (getPropertyKeyName(property) !== "name") continue;
    const { value } = property;
    return value.type === "Literal" && typeof value.value === "string" ? value.value : null;
  }
  return null;
}

/** The import behind the first type argument, `undefined` when it is a local, generic or inline type. */
function importedTypeOf(
  typeArgument: TSType,
  imports: TypeImportTable,
): { from: string; name: string } | undefined {
  if (typeArgument.type !== "TSTypeReference") return undefined;
  if (typeArgument.typeArguments !== null && typeArgument.typeArguments !== undefined) {
    return undefined;
  }
  if (typeArgument.typeName.type !== "Identifier") return undefined;
  return imports.get(typeArgument.typeName.name);
}

/** 1-based line of `offset`. A line break is `\n` only. */
function lineOf(code: string, offset: number): number {
  return code.slice(0, offset).split("\n").length;
}

function scanWasmModuleFile(file: string, found: WasmModuleScan): void {
  const { program, code } = readScanned(file, "scanWasmModuleNames", []);
  const imports = importedTypes(program);
  const tracker = new ScopeTracker({ preserveExitedScopes: true });
  /** Start offsets of the bindings that receive `loadWasmModule` from an object pattern. */
  const bindings = new Set<number>();

  function isBoundByPattern(name: string): boolean {
    const declaration = tracker.getDeclaration(name);
    return (
      declaration !== undefined && declaration !== null && bindings.has(declaration.node.start)
    );
  }

  function skip(call: CallExpression, reason: string): void {
    found.skipped.push({ file, line: lineOf(code, call.start), reason });
  }

  function record(call: CallExpression): void {
    const name = literalName(call);
    if (name === null) return skip(call, "non-literal name");
    const typeArgument = call.typeArguments?.params[0];
    if (typeArgument === undefined) return skip(call, "no type argument");
    const typeImport = importedTypeOf(typeArgument, imports);
    if (typeImport === undefined) return skip(call, "type not importable");
    found.hits.push({ name, typeImport, file, line: lineOf(code, call.start) });
  }

  // Pass 1 declares every scope and collects the pattern bindings: a call placed before its
  // declaration (a hoisted function, a `const` used inside a function) still resolves in pass 2.
  walk(program, {
    scopeTracker: tracker,
    enter(node) {
      if (node.type !== "ObjectPattern") return;
      for (const property of node.properties) {
        if (property.type !== "Property" || property.computed) continue;
        const { key } = property;
        if (key.type !== "Identifier" || key.name !== "loadWasmModule") continue;
        const target =
          property.value.type === "AssignmentPattern" ? property.value.left : property.value;
        if (target.type === "Identifier") bindings.add(target.start);
      }
    },
  });
  tracker.freeze();
  walk(program, {
    scopeTracker: tracker,
    enter(node) {
      if (node.type !== "CallExpression") return;
      const { callee } = node;
      if (callee.type === "Identifier" ? isBoundByPattern(callee.name) : isMethodCallee(callee)) {
        record(node);
      }
    },
  });
}

/**
 * Names given to `loadWasmModule` under `dirs`, each resolved against `root`.
 * A call matches by method name, not by import: `<any object>.loadWasmModule<T>(...)`, or a bare
 * callee bound by a destructuring pattern, even one declared after the call. A local function
 * named `loadWasmModule` (hoisted ones included), an aliased method, `.call`, `.apply`, `Reflect.apply` and a computed property are not seen.
 * A call whose `name` is not a string literal, that has no type argument, or whose type argument
 * is not a type imported by name (a local, generic, inline or namespaced type) is listed in
 * `skipped` with its reason and never dropped silently.
 * A `.d.ts`, `.test.` and `.spec.` file and a `node_modules` directory are skipped and never read.
 * A directory given twice, nested or missing reads each file once. A file that cannot be read or
 * parsed throws `VITE:TRANSFORM_PARSE_FAILED`.
 */
export function scanWasmModuleNames(root: string, dirs: readonly string[]): WasmModuleScan {
  const unique = new Set<string>();
  for (const dir of dirs) {
    for (const file of sourceFilesUnder(path.resolve(root, dir), WASM_SCAN_SUFFIXES, {
      skipSpec: true,
    })) {
      unique.add(file);
    }
  }
  const found: WasmModuleScan = { hits: [], skipped: [] };
  for (const file of [...unique].sort()) scanWasmModuleFile(file, found);
  return found;
}
