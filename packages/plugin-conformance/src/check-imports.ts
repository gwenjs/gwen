import path from "node:path";
import { ConformanceErrorCodes } from "./error-codes.js";
import { FRAMEWORK_ENTRIES, FRAMEWORK_TEST_ONLY_ENTRIES } from "./framework-entries.generated.js";
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

/** `@gwenjs/<name>` of a framework entry specifier. */
function packageOfEntry(entry: string): string {
  return entry.split("/").slice(0, 2).join("/");
}

const FRAMEWORK_PACKAGES: ReadonlySet<string> = new Set(
  Object.keys(FRAMEWORK_ENTRIES).map(packageOfEntry),
);
const TEST_ONLY: ReadonlySet<string> = new Set(FRAMEWORK_TEST_ONLY_ENTRIES);
const EXTENSION_SUFFIX = "/extension";

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

function readImportManifest(manifest: unknown): ImportManifest {
  const record = isRecord(manifest) ? manifest : {};
  const gwen = isRecord(record.gwen) ? record.gwen : {};
  const bases = Array.isArray(gwen.extends)
    ? gwen.extends.filter((base): base is string => typeof base === "string")
    : [];
  return {
    name: typeof record.name === "string" ? record.name : "",
    extendsBases: new Set(bases),
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

/** Rule 7: `<base>/extension` of a package listed in `gwen.extends`, for a community plugin only. */
function isListedExtension(manifest: ImportManifest, specifier: string): boolean {
  return (
    isCommunity(manifest) &&
    specifier.endsWith(EXTENSION_SUFFIX) &&
    manifest.extendsBases.has(specifier.slice(0, -EXTENSION_SUFFIX.length))
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

function checkFrameworkEntry(
  run: ImportRun,
  file: SourceFile,
  kind: ScanKind,
  site: ImportSite,
  pkg: string,
): readonly ConformanceFinding[] {
  const { specifier } = site;
  const names = FRAMEWORK_ENTRIES[specifier];
  if (names === undefined) {
    return [
      finding(
        ConformanceErrorCodes.IMPORT_DEEP,
        `"${specifier}" is not an entry of ${pkg}`,
        `Import one of the public entries of ${pkg}.`,
        file.relative,
        site.line,
      ),
    ];
  }
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
  const findings: ConformanceFinding[] = [];
  const declared = run.manifest.peers.has(pkg) || (kind === "test" && run.manifest.devs.has(pkg));
  if (!declared) {
    const where = kind === "test" ? "peerDependencies or devDependencies" : "peerDependencies";
    findings.push(
      finding(
        ConformanceErrorCodes.IMPORT_UNDECLARED,
        `${pkg} is imported but not declared in ${where}`,
        `Add "${pkg}" to peerDependencies in package.json.`,
        file.relative,
        site.line,
      ),
    );
  }
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
  if (isRelative(specifier)) {
    if (dist || !escapesRoot(run, file, specifier)) return [];
    return [
      finding(
        ConformanceErrorCodes.IMPORT_DEEP,
        `"${specifier}" leaves the package root`,
        "Keep relative imports inside the package.",
        file.relative,
        site.line,
      ),
    ];
  }
  if (isListedExtension(run.manifest, specifier)) return [];

  const { pkg, rest } = splitSpecifier(specifier);
  if (!pkg.startsWith("@gwenjs/")) return dist ? [] : checkThirdParty(run, file, site, pkg);
  if (rest.some(isInternalSegment)) {
    return [
      finding(
        ConformanceErrorCodes.IMPORT_INTERNAL,
        `"${specifier}" is an internal entry of ${pkg}`,
        `Import a public entry of ${pkg}: internal entries are not part of its API.`,
        file.relative,
        site.line,
      ),
    ];
  }
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
 * of `dist`. A finding per offending line. Self imports are always accepted. A file or a
 * directory that cannot be read (any error but a missing one) rejects.
 */
export async function checkImports(
  context: PackageContext,
): Promise<readonly ConformanceFinding[]> {
  const run: ImportRun = {
    root: context.root,
    manifest: readImportManifest(context.manifest),
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
