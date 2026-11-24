import path from "node:path";
import { declaredTypes, readBuilt } from "./built-exports.js";
import { ConformanceErrorCodes } from "./error-codes.js";
import { readExtensionManifest } from "./extension-manifest.js";
import { FRAMEWORK_ENTRIES, FRAMEWORK_TEST_ONLY_ENTRIES } from "./framework-entries.generated.js";
import { FRAMEWORK_PACKAGES } from "./framework-packages.js";
import { resolveInstalledPackage } from "./installed-package.js";
import { scanImports } from "./import-sources.js";
import type { ImportSite } from "./import-sources.js";
import { isRecord } from "./json.js";
import type { PackageContext } from "./package-context.js";
import {
  listDistFiles,
  listRuntimeFiles,
  listTestFiles,
  parseSource,
  readSourceText,
  readTextIfPresent,
} from "./source-files.js";
import type { SourceFile } from "./source-files.js";
import type { ConformanceFinding } from "./types.js";

/** Framework packages a plugin may never import, whatever the entry (physics are coupled to Rust). */
const FORBIDDEN_PACKAGES: ReadonlySet<string> = new Set([
  "@gwenjs/app",
  "@gwenjs/vite",
  "@gwenjs/physics2d",
  "@gwenjs/physics3d",
  "@gwenjs/physics3d-fracture",
]);

const TEST_ONLY: ReadonlySet<string> = new Set(FRAMEWORK_TEST_ONLY_ENTRIES);
const EXTENSION_SEGMENT = "extension";
const CONFORMANCE_PACKAGE = "@gwenjs/plugin-conformance";
/** Entries of the conformance package that a test file may import, whatever its snapshot lists. */
const CONFORMANCE_TEST_ENTRIES: ReadonlySet<string> = new Set([
  CONFORMANCE_PACKAGE,
  `${CONFORMANCE_PACKAGE}/runtime`,
  `${CONFORMANCE_PACKAGE}/vitest`,
]);
const FILE_URL = /^file:/i;
/** A `node:` builtin or any other URL scheme (`https:`, `data:`): not a package. */
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** Where a file is read: the runtime files of `src`, the test files, or the build output. */
type ScanKind = "src" | "test" | "dist";

interface ImportManifest {
  readonly name: string;
  readonly extendsBases: ReadonlySet<string>;
  readonly peers: ReadonlySet<string>;
  readonly devs: ReadonlySet<string>;
}

function stringKeys(value: unknown): ReadonlySet<string> {
  return new Set(isRecord(value) ? Object.keys(value) : []);
}

/** Validated package names of `gwen.extends`. A subpath entry is not a base. */
function readImportManifest(context: PackageContext): ImportManifest {
  const listing = readExtensionManifest(context);
  const record = isRecord(context.manifest) ? context.manifest : {};
  return {
    name: listing.name,
    extendsBases: new Set(listing.bases.map((base) => base.name)),
    peers: stringKeys(record.peerDependencies),
    devs: stringKeys(record.devDependencies),
  };
}

interface SplitSpecifier {
  readonly pkg: string;
  /** Segments after the package name. */
  readonly rest: readonly string[];
}

function splitSpecifier(specifier: string): SplitSpecifier {
  const parts = specifier.split("/");
  const size = specifier.startsWith("@") ? 2 : 1;
  return { pkg: parts.slice(0, size).join("/"), rest: parts.slice(size) };
}

function isRelative(specifier: string): boolean {
  return (
    specifier === "." ||
    specifier === ".." ||
    specifier.startsWith("./") ||
    specifier.startsWith("../")
  );
}

function isInternalSegment(segment: string): boolean {
  return segment === "internal" || segment === "wasm";
}

/** True when a plugin manifest says so: it peers on or depends on `@gwenjs/core`, or `gwen.type`. */
function isPluginManifest(manifest: unknown): boolean {
  if (!isRecord(manifest)) return false;
  const gwen = isRecord(manifest.gwen) ? manifest.gwen : {};
  return (
    gwen.type === "plugin" ||
    stringKeys(manifest.peerDependencies).has("@gwenjs/core") ||
    stringKeys(manifest.dependencies).has("@gwenjs/core")
  );
}

/**
 * Whether `pkg`, as Node resolves it from `root` (its `node_modules` and its ancestors'), is a plugin.
 * An unparsed `package.json` is not a plugin.
 */
async function isInstalledPlugin(root: string, pkg: string): Promise<boolean> {
  const installed = await resolveInstalledPackage(root, pkg);
  return installed.kind === "found" && isPluginManifest(installed.manifest);
}

function finding(
  code: ConformanceFinding["code"],
  message: string,
  hint: string,
  file: string,
  line: number,
): ConformanceFinding {
  return { code, message, hint, file, line };
}

/** Public names of one installed base `./extension`, or why that list cannot be read. */
type ExtensionSurface =
  | { readonly kind: "skip" }
  | { readonly kind: "not-built"; readonly declared: string }
  | { readonly kind: "no-types" }
  | { readonly kind: "names"; readonly names: ReadonlySet<string> };

interface ImportRun {
  readonly root: string;
  readonly manifest: ImportManifest;
  /** Whether an installed package is a plugin, by package name. */
  readonly plugins: Map<string, boolean>;
  /** Built `./extension` names of a listed base, filled on the first import of that base. */
  readonly surfaces: Map<string, ExtensionSurface>;
}

const SHARE_HINT =
  "Do not import another plugin. Share state through a service, or through a framework package.";

function isCommunity(manifest: ImportManifest): boolean {
  return !manifest.name.startsWith("@gwenjs/");
}

/**
 * A community package and a base listed verbatim in `gwen.extends`.
 * A framework package and a forbidden package keep their own rules.
 * An official package keeps IMPORT_FOREIGN_PLUGIN.
 */
function isListedBase(manifest: ImportManifest, pkg: string): boolean {
  return (
    isCommunity(manifest) &&
    manifest.extendsBases.has(pkg) &&
    !FRAMEWORK_PACKAGES.has(pkg) &&
    !FORBIDDEN_PACKAGES.has(pkg)
  );
}

function isExtensionSubpath(rest: readonly string[]): boolean {
  return rest.length === 1 && rest[0] === EXTENSION_SEGMENT;
}

/** The package root and `<base>/testing`, accepted from a test file only. */
function isTestBaseEntry(rest: readonly string[]): boolean {
  return rest.length === 0 || (rest.length === 1 && rest[0] === "testing");
}

function internalEntry(file: SourceFile, site: ImportSite, pkg: string): ConformanceFinding {
  return finding(
    ConformanceErrorCodes.IMPORT_INTERNAL,
    `"${site.specifier}" is an internal entry of ${pkg}`,
    `Import a public entry of ${pkg}: internal entries are not part of its API.`,
    file.relative,
    site.line,
  );
}

function listedDeepFinding(
  file: SourceFile,
  site: ImportSite,
  pkg: string,
  rest: readonly string[],
): ConformanceFinding {
  const built = rest.some((segment) => segment === "dist");
  const where = built ? "build output" : "source";
  const hint = built
    ? `Import a public entry of ${pkg}, not a file of its dist.`
    : `Import "${pkg}/extension", not a file of its source.`;
  return finding(
    ConformanceErrorCodes.IMPORT_DEEP,
    `"${site.specifier}" reaches into the ${where} of ${pkg}`,
    hint,
    file.relative,
    site.line,
  );
}

function extensionEntryFinding(
  file: SourceFile,
  site: ImportSite,
  pkg: string,
): ConformanceFinding {
  return finding(
    ConformanceErrorCodes.EXTENSION_ENTRY,
    `"${site.specifier}" is not the extension entry of ${pkg}, which is listed in gwen.extends`,
    `Import only "${pkg}/extension" from a base.`,
    file.relative,
    site.line,
  );
}

/** `exports["./extension"]` of an installed manifest, when `exports` is an object. */
function extensionTarget(manifest: unknown): unknown {
  if (!isRecord(manifest)) return undefined;
  const exportsField = manifest.exports;
  if (!isRecord(exportsField)) return undefined;
  return exportsField["./extension"];
}

/**
 * Names exported by the installed base `./extension`.
 * An absent or unparsed package is skipped: `BASE_NOT_EXTENSIBLE` already reports it.
 * A target with no types or import file, and a types file that is not on disk, are reported
 * once, on the specifier line. A pattern target names no single file and is skipped.
 */
async function readExtensionSurface(root: string, pkg: string): Promise<ExtensionSurface> {
  const installed = await resolveInstalledPackage(root, pkg);
  if (installed.kind !== "found") return { kind: "skip" };
  const declared = declaredTypes(extensionTarget(installed.manifest));
  if (declared === undefined) return { kind: "no-types" };
  if (declared.includes("*")) return { kind: "skip" };
  const file = path.resolve(installed.directory, declared);
  const present = await readTextIfPresent(file);
  if (present === undefined) return { kind: "not-built", declared };
  const built = readBuilt(installed.directory, new Map([["./extension", file]]));
  const entry = built.get("./extension");
  const values = entry === undefined ? [] : entry.values;
  const types = entry === undefined ? [] : entry.types;
  const names = new Set([...values, ...types]);
  return { kind: "names", names };
}

async function extensionSurfaceOf(run: ImportRun, pkg: string): Promise<ExtensionSurface> {
  const cached = run.surfaces.get(pkg);
  if (cached !== undefined) return cached;
  const surface = await readExtensionSurface(run.root, pkg);
  run.surfaces.set(pkg, surface);
  return surface;
}

function publicNameHint(specifier: string): string {
  return `Use a name listed in the public API of ${specifier}.`;
}

/**
 * `IMPORT_NOT_PUBLIC` for one `<base>/extension` import.
 * A value import and a type-only import share the same name list. `default` has its own message.
 * The line is the name, except the two file-level cases, which use the specifier line.
 */
async function extensionImportFindings(
  run: ImportRun,
  file: SourceFile,
  site: ImportSite,
  pkg: string,
): Promise<readonly ConformanceFinding[]> {
  const surface = await extensionSurfaceOf(run, pkg);
  const { specifier } = site;
  if (surface.kind === "skip") return [];
  if (surface.kind === "not-built") {
    return [
      finding(
        ConformanceErrorCodes.IMPORT_NOT_PUBLIC,
        `"${specifier}" declares "${surface.declared}", which is not built`,
        `Build the types file "${surface.declared}" of ${pkg}.`,
        file.relative,
        site.line,
      ),
    ];
  }
  if (surface.kind === "no-types") {
    return [
      finding(
        ConformanceErrorCodes.IMPORT_NOT_PUBLIC,
        `"${specifier}" declares no types or import file`,
        `Give "./extension" of ${pkg} a "types" or "import" file.`,
        file.relative,
        site.line,
      ),
    ];
  }
  const findings: ConformanceFinding[] = [];
  for (const imported of site.names) {
    if (surface.names.has(imported.name)) continue;
    findings.push(
      finding(
        ConformanceErrorCodes.IMPORT_NOT_PUBLIC,
        imported.name === "default"
          ? `"${specifier}" has no default export`
          : `"${imported.name}" is not exported by "${specifier}"`,
        publicNameHint(specifier),
        file.relative,
        imported.line,
      ),
    );
  }
  return findings;
}

/**
 * Listed-base specifiers. An `internal` or `wasm` segment is IMPORT_INTERNAL, including in `dist`.
 * A `dist` or `src` segment is IMPORT_DEEP. `<base>/extension` is the extension entry: in `src`
 * and in a test file, a name it does not export is IMPORT_NOT_PUBLIC. In a test file the root and
 * `<base>/testing` are accepted. Every other specifier is EXTENSION_ENTRY. A `dist` file reports
 * only the internal case.
 */
async function listedBaseFindings(
  run: ImportRun,
  file: SourceFile,
  kind: ScanKind,
  site: ImportSite,
  pkg: string,
  rest: readonly string[],
): Promise<readonly ConformanceFinding[]> {
  const listedInternal = rest.some(isInternalSegment);
  if (listedInternal) return [internalEntry(file, site, pkg)];
  if (kind === "dist") return [];
  const listedDeep = rest.some((segment) => segment === "dist" || segment === "src");
  if (listedDeep) return [listedDeepFinding(file, site, pkg, rest)];
  if (isExtensionSubpath(rest)) return extensionImportFindings(run, file, site, pkg);
  if (kind === "test" && isTestBaseEntry(rest)) return [];
  return [extensionEntryFinding(file, site, pkg)];
}

function leavesRoot(file: SourceFile, site: ImportSite, hint: string): ConformanceFinding {
  return finding(
    ConformanceErrorCodes.IMPORT_DEEP,
    `"${site.specifier}" leaves the package root`,
    hint,
    file.relative,
    site.line,
  );
}

function notAnEntry(file: SourceFile, site: ImportSite, pkg: string): ConformanceFinding {
  return finding(
    ConformanceErrorCodes.IMPORT_DEEP,
    `"${site.specifier}" is not an entry of ${pkg}`,
    `Import one of the public entries of ${pkg}.`,
    file.relative,
    site.line,
  );
}

function escapesRoot(run: ImportRun, file: SourceFile, specifier: string): boolean {
  const resolved = path.resolve(run.root, path.dirname(file.relative), specifier);
  const relative = path.relative(run.root, resolved);
  return relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
}

async function checkThirdParty(
  run: ImportRun,
  file: SourceFile,
  site: ImportSite,
  pkg: string,
): Promise<readonly ConformanceFinding[]> {
  let plugin = run.plugins.get(pkg);
  if (plugin === undefined) {
    plugin = await isInstalledPlugin(run.root, pkg);
    run.plugins.set(pkg, plugin);
  }
  if (!plugin) return [];
  return [
    finding(
      ConformanceErrorCodes.IMPORT_FOREIGN_PLUGIN,
      `"${site.specifier}" is another plugin package: ${pkg} peers on or depends on @gwenjs/core`,
      SHARE_HINT,
      file.relative,
      site.line,
    ),
  ];
}

/** One IMPORT_UNDECLARED when `pkg` is in neither `peerDependencies` nor, in a test, `devDependencies`. */
function undeclaredFindings(
  run: ImportRun,
  file: SourceFile,
  kind: ScanKind,
  site: ImportSite,
  pkg: string,
): ConformanceFinding[] {
  if (run.manifest.peers.has(pkg) || (kind === "test" && run.manifest.devs.has(pkg))) return [];
  const where = kind === "test" ? "peerDependencies or devDependencies" : "peerDependencies";
  return [
    finding(
      ConformanceErrorCodes.IMPORT_UNDECLARED,
      `${pkg} is imported but not declared in ${where}`,
      `Add "${pkg}" to peerDependencies in package.json.`,
      file.relative,
      site.line,
    ),
  ];
}

function checkFrameworkEntry(
  run: ImportRun,
  file: SourceFile,
  kind: ScanKind,
  site: ImportSite,
  pkg: string,
): readonly ConformanceFinding[] {
  const { specifier } = site;
  const names = FRAMEWORK_ENTRIES[specifier];
  if (names === undefined) return [notAnEntry(file, site, pkg)];
  if (TEST_ONLY.has(specifier) && kind === "src") {
    return [
      finding(
        ConformanceErrorCodes.IMPORT_FORBIDDEN_ENTRY,
        `"${specifier}" is for tests only and cannot be imported from src`,
        "Import it from a test file, or use a runtime entry of the package.",
        file.relative,
        site.line,
      ),
    ];
  }
  const findings = undeclaredFindings(run, file, kind, site, pkg);
  const exported = new Set(names);
  for (const imported of site.names) {
    if (exported.has(imported.name)) continue;
    findings.push(
      finding(
        ConformanceErrorCodes.IMPORT_NOT_PUBLIC,
        imported.name === "default"
          ? `"${specifier}" has no default export`
          : `"${imported.name}" is not exported by "${specifier}"`,
        `Use a name listed in the public API of ${specifier}.`,
        file.relative,
        imported.line,
      ),
    );
  }
  return findings;
}

/** Findings of one import. A dist file only reports internal specifiers. */
async function checkSite(
  run: ImportRun,
  file: SourceFile,
  kind: ScanKind,
  site: ImportSite,
): Promise<readonly ConformanceFinding[]> {
  const { specifier } = site;
  const { name } = run.manifest;
  const dist = kind === "dist";
  if (name !== "" && (specifier === name || specifier.startsWith(`${name}/`))) return [];
  if (path.win32.isAbsolute(specifier) || FILE_URL.test(specifier)) {
    if (dist) return [];
    return [
      leavesRoot(
        file,
        site,
        "Import a package by name, or a file of this package by a relative path.",
      ),
    ];
  }
  if (specifier.startsWith("#") || URL_SCHEME.test(specifier)) return [];
  if (isRelative(specifier)) {
    if (dist || !escapesRoot(run, file, specifier)) return [];
    return [leavesRoot(file, site, "Keep relative imports inside the package.")];
  }

  const { pkg, rest } = splitSpecifier(specifier);
  if (isListedBase(run.manifest, pkg)) return listedBaseFindings(run, file, kind, site, pkg, rest);
  if (!pkg.startsWith("@gwenjs/")) return dist ? [] : checkThirdParty(run, file, site, pkg);
  if (rest.some(isInternalSegment)) return [internalEntry(file, site, pkg)];
  if (dist) return [];
  if (rest[0] === "dist") {
    return [
      finding(
        ConformanceErrorCodes.IMPORT_DEEP,
        `"${specifier}" reaches into the build output of ${pkg}`,
        `Import a public entry of ${pkg}, not a file of its dist.`,
        file.relative,
        site.line,
      ),
    ];
  }
  if (FORBIDDEN_PACKAGES.has(pkg)) {
    return [
      finding(
        ConformanceErrorCodes.IMPORT_FORBIDDEN_ENTRY,
        `${pkg} cannot be imported by a plugin ("${specifier}")`,
        "Depend on the framework entries a plugin may import: schema, kit, core, math, renderer-core and camera-core.",
        file.relative,
        site.line,
      ),
    ];
  }
  if (kind === "test" && pkg === CONFORMANCE_PACKAGE) {
    if (!CONFORMANCE_TEST_ENTRIES.has(specifier)) return [notAnEntry(file, site, pkg)];
    return undeclaredFindings(run, file, kind, site, pkg);
  }
  if (!FRAMEWORK_PACKAGES.has(pkg)) {
    return [
      finding(
        ConformanceErrorCodes.IMPORT_FOREIGN_PLUGIN,
        `"${specifier}" is another plugin package`,
        SHARE_HINT,
        file.relative,
        site.line,
      ),
    ];
  }
  return checkFrameworkEntry(run, file, kind, site, pkg);
}

interface Scan {
  readonly kind: ScanKind;
  readonly files: readonly SourceFile[];
}

/** The files of `src` that are not test files, the test files, and the files of `dist`. */
async function listScans(root: string): Promise<readonly Scan[]> {
  const tests = await listTestFiles(root);
  const testPaths = new Set(tests.map((file) => file.relative));
  const runtime = (await listRuntimeFiles(root)).filter((file) => !testPaths.has(file.relative));
  return [
    { kind: "src", files: runtime },
    { kind: "test", files: tests },
    { kind: "dist", files: await listDistFiles(root) },
  ];
}

/**
 * Import rules: every module specifier of `src`, of the test files, and (internal entries only)
 * of `dist`. A finding per offending import line, and one IMPORT_NOT_PUBLIC per name. Self imports
 * are always accepted. A community package reports a base listed verbatim in `gwen.extends`:
 * `<base>/extension` is the extension entry, and a name it does not export is IMPORT_NOT_PUBLIC
 * when the base is installed and its package.json parses. A test file may also import the root
 * and `<base>/testing`, and any other specifier is EXTENSION_ENTRY, IMPORT_INTERNAL or
 * IMPORT_DEEP. A file or a directory that cannot be read (any error but an absent one) rejects.
 */
export async function checkImports(
  context: PackageContext,
): Promise<readonly ConformanceFinding[]> {
  const run: ImportRun = {
    root: context.root,
    manifest: readImportManifest(context),
    plugins: new Map(),
    surfaces: new Map(),
  };
  const findings: ConformanceFinding[] = [];
  // One read at a time: a wide `src` must not exhaust file descriptors.
  for (const { kind, files } of await listScans(context.root)) {
    for (const file of files) {
      const text = await readSourceText(file);
      if (text === undefined) continue;
      for (const site of scanImports(parseSource(file, text))) {
        findings.push(...(await checkSite(run, file, kind, site)));
      }
    }
  }
  return findings;
}
