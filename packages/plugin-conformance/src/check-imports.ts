import path from "node:path";
import { ConformanceErrorCodes } from "./error-codes.js";
import { readExtensionManifest } from "./extension-manifest.js";
import { FRAMEWORK_ENTRIES, FRAMEWORK_TEST_ONLY_ENTRIES } from "./framework-entries.generated.js";
import { FRAMEWORK_PACKAGES } from "./framework-packages.js";
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

type InstalledManifest =
  | { readonly kind: "found"; readonly manifest: unknown }
  | { readonly kind: "missing" };

async function readInstalled(directory: string, pkg: string): Promise<InstalledManifest> {
  const text = await readTextIfPresent(path.join(directory, "node_modules", pkg, "package.json"));
  if (text === undefined) return { kind: "missing" };
  try {
    const manifest: unknown = JSON.parse(text);
    return { kind: "found", manifest };
  } catch {
    // A package.json that cannot be parsed is ignored.
    return { kind: "found", manifest: undefined };
  }
}

/** Whether `pkg`, as Node resolves it from `root` (its `node_modules` and its ancestors'), is a plugin. */
async function isInstalledPlugin(root: string, pkg: string): Promise<boolean> {
  let directory = path.resolve(root);
  for (;;) {
    const installed = await readInstalled(directory, pkg);
    if (installed.kind === "found") return isPluginManifest(installed.manifest);
    const parent = path.dirname(directory);
    if (parent === directory) return false;
    directory = parent;
  }
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

interface ImportRun {
  readonly root: string;
  readonly manifest: ImportManifest;
  /** Whether an installed package is a plugin, by package name. */
  readonly plugins: Map<string, boolean>;
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

/**
 * Listed-base specifiers. An `internal` or `wasm` segment is IMPORT_INTERNAL, including in `dist`.
 * A `dist` or `src` segment is IMPORT_DEEP. `<base>/extension` is accepted. In a test file the
 * root and `<base>/testing` are accepted. Every other specifier is EXTENSION_ENTRY. A `dist` file
 * reports only the internal case.
 */
function listedBaseFindings(
  file: SourceFile,
  kind: ScanKind,
  site: ImportSite,
  pkg: string,
  rest: readonly string[],
): readonly ConformanceFinding[] {
  const listedInternal = rest.some(isInternalSegment);
  if (listedInternal) return [internalEntry(file, site, pkg)];
  if (kind === "dist") return [];
  const listedDeep = rest.some((segment) => segment === "dist" || segment === "src");
  if (listedDeep) return [listedDeepFinding(file, site, pkg, rest)];
  if (isExtensionSubpath(rest)) return [];
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
  if (isListedBase(run.manifest, pkg)) return listedBaseFindings(file, kind, site, pkg, rest);
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
 * `<base>/extension` is accepted, a test file may also import the root and `<base>/testing`, and
 * any other specifier is EXTENSION_ENTRY, IMPORT_INTERNAL or IMPORT_DEEP. A file or a directory
 * that cannot be read (any error but an absent one) rejects.
 */
export async function checkImports(
  context: PackageContext,
): Promise<readonly ConformanceFinding[]> {
  const run: ImportRun = {
    root: context.root,
    manifest: readImportManifest(context),
    plugins: new Map(),
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
