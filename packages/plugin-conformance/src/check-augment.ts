import path from "node:path";
import ts from "typescript";
import { declaredTypes } from "./built-exports.js";
import { ConformanceErrorCodes } from "./error-codes.js";
import { readExtensionManifest } from "./extension-manifest.js";
import { FRAMEWORK_PROVIDES_KEYS } from "./framework-entries.generated.js";
import { resolveInstalledPackage } from "./installed-package.js";
import { isRecord } from "./json.js";
import type { PackageContext } from "./package-context.js";
import {
  isStringLiteralLike,
  lineOf,
  listDeclarationFiles,
  listRuntimeFiles,
  listTestFiles,
  parseSource,
  readSourceText,
  readTextIfPresent,
} from "./source-files.js";
import type { SourceFile } from "./source-files.js";
import type { ConformanceFinding } from "./types.js";

const SCHEMA = "@gwenjs/schema";
const SERVICE_HINT = 'Pick a service key of your own, for example "<plugin>:<service>".';
const HOOK_HINT = 'Pick a hook key of your own, for example "<plugin>:<event>".';
const REGISTRY_HINT = "Pick a registry key of your own.";

/** Key to the base package that already declares it, for one schema interface. */
interface BaseKeys {
  readonly provides: ReadonlyMap<string, string>;
  readonly hooks: ReadonlyMap<string, string>;
  readonly registry: ReadonlyMap<string, string>;
}

interface MutableBaseKeys {
  readonly provides: Map<string, string>;
  readonly hooks: Map<string, string>;
  readonly registry: Map<string, string>;
}

function packageName(manifest: unknown): string {
  return isRecord(manifest) && typeof manifest.name === "string" ? manifest.name : "";
}

function memberName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  if (ts.isComputedPropertyName(name) && isStringLiteralLike(name.expression)) {
    return name.expression.text;
  }
  return undefined;
}

function isOwnModule(target: string, own: string): boolean {
  return own !== "" && (target === own || target.startsWith(`${own}/`));
}

function extensionTarget(manifest: unknown): unknown {
  if (!isRecord(manifest)) return undefined;
  const exportsField = manifest.exports;
  if (!isRecord(exportsField)) return undefined;
  return exportsField["./extension"];
}

/** First base wins when two installed bases declare the same key. */
function remember(keys: Map<string, string>, key: string, baseName: string): void {
  if (!keys.has(key)) keys.set(key, baseName);
}

/** Keys of the three schema interfaces in one `declare module "@gwenjs/schema"` tree. */
function absorbModule(
  text: string,
  fileName: string,
  baseName: string,
  keys: MutableBaseKeys,
): void {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const visit = (node: ts.Node): void => {
    if (
      ts.isModuleDeclaration(node) &&
      ts.isStringLiteral(node.name) &&
      node.name.text === SCHEMA &&
      node.body !== undefined &&
      ts.isModuleBlock(node.body)
    ) {
      for (const statement of node.body.statements) {
        if (!ts.isInterfaceDeclaration(statement)) continue;
        const interfaceName = statement.name.text;
        for (const member of statement.members) {
          if (!ts.isPropertySignature(member) && !ts.isMethodSignature(member)) continue;
          const key = memberName(member.name);
          if (key === undefined) continue;
          if (interfaceName === "GwenProvides") remember(keys.provides, key, baseName);
          else if (interfaceName === "GwenRuntimeHooks") remember(keys.hooks, key, baseName);
          else if (interfaceName === "GwenPluginRegistry") remember(keys.registry, key, baseName);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

/**
 * Resolution of `readBuilt`: `noLib`, no `paths`. `@gwenjs/schema` is not loaded.
 * Only a relative static import or `export … from` is followed, never `import()`.
 */
const BASE_RESOLVE_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  allowJs: true,
  skipLibCheck: true,
  noEmit: true,
  noLib: true,
  types: [],
  strict: false,
};

interface DeclarationText {
  readonly file: string;
  readonly text: string;
}

function specifierText(node: ts.Expression | undefined): string | undefined {
  if (node === undefined || !isStringLiteralLike(node)) return undefined;
  const text = node.text;
  if (text.startsWith("./") || text.startsWith("../")) return text;
  return undefined;
}

/** Relative static imports and `export … from` of one file. `import()` is left out. */
function relativeSpecifiers(source: ts.SourceFile): readonly string[] {
  const specs: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const text = specifierText(node.moduleSpecifier);
      if (text !== undefined) specs.push(text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return specs;
}

/** A file under `baseDirectory` that is not inside a nested `node_modules`. */
function isInsideBase(fileName: string, baseDirectory: string): boolean {
  const relative = path.relative(baseDirectory, fileName);
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    return false;
  }
  for (const segment of relative.split(path.sep)) {
    if (segment === "node_modules") return false;
  }
  return true;
}

function resolveInsideBase(
  specifier: string,
  fromFile: string,
  baseDirectory: string,
): string | undefined {
  try {
    const resolved = ts.resolveModuleName(
      specifier,
      fromFile,
      BASE_RESOLVE_OPTIONS,
      ts.sys,
    ).resolvedModule;
    if (resolved === undefined) return undefined;
    const fileName = path.resolve(resolved.resolvedFileName);
    if (!isInsideBase(fileName, baseDirectory)) return undefined;
    return fileName;
  } catch {
    return undefined;
  }
}

/** A referenced file that cannot be read is skipped. The entry file is read by the caller. */
async function readReferenced(fileName: string): Promise<string | undefined> {
  try {
    return await readTextIfPresent(fileName);
  } catch {
    return undefined;
  }
}

function enqueueReferenced(
  fileName: string,
  text: string,
  baseDirectory: string,
  seen: Set<string>,
  pending: string[],
): void {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  for (const specifier of relativeSpecifiers(source)) {
    const resolved = resolveInsideBase(specifier, fileName, baseDirectory);
    if (resolved === undefined || seen.has(resolved)) continue;
    seen.add(resolved);
    pending.push(resolved);
  }
}

/**
 * Declaration files reached from `entryFile` by a relative import or `export … from`,
 * staying inside `baseDirectory`. An import cycle is visited once. An absent file is skipped.
 */
async function followReferenced(
  baseDirectory: string,
  entryFile: string,
  entryText: string,
): Promise<readonly DeclarationText[]> {
  const root = path.resolve(baseDirectory);
  const seen = new Set<string>([path.resolve(entryFile)]);
  const pending: string[] = [];
  const found: DeclarationText[] = [];
  enqueueReferenced(entryFile, entryText, root, seen, pending);
  let index = 0;
  while (index < pending.length) {
    const fileName = pending[index];
    index += 1;
    if (fileName === undefined) continue;
    const text = await readReferenced(fileName);
    if (text === undefined) continue;
    found.push({ file: fileName, text });
    enqueueReferenced(fileName, text, root, seen, pending);
  }
  return found;
}

/**
 * Keys an installed base already declares on the three schema interfaces.
 * An official package (a name under `@gwenjs/`) is not compared with its bases.
 * An absent or unparsed base adds nothing: `BASE_NOT_EXTENSIBLE` already reports it.
 * The `./extension` declaration and the declaration files it references inside the base
 * directory are read as syntax, not type-checked.
 */
async function loadBaseKeys(context: PackageContext): Promise<BaseKeys> {
  const listing = readExtensionManifest(context);
  const keys: MutableBaseKeys = { provides: new Map(), hooks: new Map(), registry: new Map() };
  if (listing.name.startsWith("@gwenjs/")) return keys;
  for (const base of listing.bases) {
    const installed = await resolveInstalledPackage(context.root, base.name);
    if (installed.kind !== "found") continue;
    const declared = declaredTypes(extensionTarget(installed.manifest));
    if (declared === undefined || declared.includes("*")) continue;
    const file = path.resolve(installed.directory, declared);
    const text = await readTextIfPresent(file);
    if (text === undefined) continue;
    const followed = await followReferenced(installed.directory, file, text);
    const files = [{ file, text }, ...followed];
    for (const item of files) absorbModule(item.text, item.file, base.name, keys);
  }
  return keys;
}

function baseOwner(keys: BaseKeys, interfaceName: string, key: string): string | undefined {
  if (interfaceName === "GwenProvides") return keys.provides.get(key);
  if (interfaceName === "GwenRuntimeHooks") return keys.hooks.get(key);
  if (interfaceName === "GwenPluginRegistry") return keys.registry.get(key);
  return undefined;
}

function baseHint(interfaceName: string): string {
  if (interfaceName === "GwenRuntimeHooks") return HOOK_HINT;
  if (interfaceName === "GwenPluginRegistry") return REGISTRY_HINT;
  return SERVICE_HINT;
}

function scanFile(
  file: SourceFile,
  text: string,
  own: string,
  bases: BaseKeys,
): ConformanceFinding[] {
  const source = parseSource(file, text);
  const findings: ConformanceFinding[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isModuleDeclaration(node) && ts.isStringLiteral(node.name)) {
      const target = node.name.text;
      if (target === SCHEMA && node.body !== undefined && ts.isModuleBlock(node.body)) {
        for (const statement of node.body.statements) {
          if (!ts.isInterfaceDeclaration(statement)) continue;
          const interfaceName = statement.name.text;
          if (
            interfaceName !== "GwenProvides" &&
            interfaceName !== "GwenRuntimeHooks" &&
            interfaceName !== "GwenPluginRegistry"
          ) {
            continue;
          }
          for (const member of statement.members) {
            if (!ts.isPropertySignature(member) && !ts.isMethodSignature(member)) continue;
            const key = memberName(member.name);
            if (key === undefined) continue;
            if (interfaceName === "GwenProvides" && Object.hasOwn(FRAMEWORK_PROVIDES_KEYS, key)) {
              findings.push({
                code: ConformanceErrorCodes.AUGMENT_TARGET,
                message: `GwenProvides key "${key}" is already declared by ${FRAMEWORK_PROVIDES_KEYS[key]}`,
                hint: SERVICE_HINT,
                file: file.relative,
                line: lineOf(source, member.name),
              });
              continue;
            }
            const owner = baseOwner(bases, interfaceName, key);
            if (owner === undefined) continue;
            findings.push({
              code: ConformanceErrorCodes.AUGMENT_TARGET,
              message: `${interfaceName} key "${key}" is already declared by ${owner}`,
              hint: baseHint(interfaceName),
              file: file.relative,
              line: lineOf(source, member.name),
            });
          }
        }
      } else if (target.startsWith("@gwenjs/") && target !== SCHEMA && !isOwnModule(target, own)) {
        findings.push({
          code: ConformanceErrorCodes.AUGMENT_TARGET,
          message: `declare module "${target}" augments a framework package`,
          hint: "Augment @gwenjs/schema instead: add the service to GwenProvides or the hook to GwenRuntimeHooks.",
          file: file.relative,
          line: lineOf(source, node),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return findings;
}

/**
 * The script files of `src`, the test files and the declaration files of `src` and of the test
 * directories, once each: `src/__tests__/a.ts` is in both of the first two lists.
 */
async function listScanned(root: string): Promise<readonly SourceFile[]> {
  const files = new Map<string, SourceFile>();
  const listed = [
    ...(await listRuntimeFiles(root)),
    ...(await listTestFiles(root)),
    ...(await listDeclarationFiles(root)),
  ];
  for (const file of listed) {
    if (!files.has(file.relative)) files.set(file.relative, file);
  }
  return [...files.values()];
}

/**
 * Augmentation rules: a `declare module` of a framework package other than `@gwenjs/schema` (the
 * package's own name and its subpaths are not reported), and a `GwenProvides` key of
 * `@gwenjs/schema` that the framework already declares. A community package also reports a
 * `GwenProvides`, `GwenRuntimeHooks` or `GwenPluginRegistry` key that an installed base already
 * declares in its `./extension` declaration or in a declaration file that file references inside
 * the base directory. The framework message wins when both match.
 * Every script file and every declaration file (`.d.ts`, `.d.mts`, `.d.cts`) of `src`, and every
 * test file, is read; `dist` is not. A file that cannot be read (any error but an absent one)
 * rejects.
 */
export async function checkAugment(
  context: PackageContext,
): Promise<readonly ConformanceFinding[]> {
  const own = packageName(context.manifest);
  const bases = await loadBaseKeys(context);
  const findings: ConformanceFinding[] = [];
  // One read at a time: a wide `src` must not exhaust file descriptors.
  for (const file of await listScanned(context.root)) {
    const text = await readSourceText(file);
    if (text !== undefined) findings.push(...scanFile(file, text, own, bases));
  }
  return findings;
}
