import { readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { ConformanceErrorCodes } from "./error-codes.js";
import { isRecord } from "./json.js";
import { packageReadFinding } from "./manifest-finding.js";
import type { PackageContext } from "./package-context.js";
import { readPackageJson } from "./read-package.js";
import { compareFindings } from "./sort-findings.js";
import type { ConformanceFinding, ConformanceReport } from "./types.js";

/** Name of the snapshot file at the package root. */
const SNAPSHOT_FILE = "public-api.snap.json";

interface SnapEntry {
  readonly values: readonly string[];
  readonly types: readonly string[];
}

type Snapshot = Record<string, SnapEntry>;

type SnapshotRead =
  | { readonly ok: true; readonly snapshot: Snapshot }
  | {
      readonly ok: false;
      readonly problem: string;
      readonly hint: string;
      /** True when the read failed for a reason other than a missing file: a write must not replace it. */
      readonly unreadable?: true;
    };

/** One subpath read from its built types file. */
interface BuiltEntry extends SnapEntry {
  readonly file: string;
}

/** The snapshot findings, split by the check that reports them. */
export interface SnapshotFindings {
  readonly values: readonly ConformanceFinding[];
  readonly types: readonly ConformanceFinding[];
}

/**
 * The module-entry file each subpath declares, split into those on disk and those missing, plus
 * the subpaths whose target names no file.
 */
interface DeclaredFiles {
  readonly files: ReadonlyMap<string, string>;
  readonly missing: ReadonlyMap<string, string>;
  readonly undeclared: readonly string[];
}

function quote(text: string): string {
  return JSON.stringify(text);
}

const UPDATE_HINT = `Run gwen-conformance check --write to update ${SNAPSHOT_FILE}, or change the export.`;

function mismatch(message: string, hint = UPDATE_HINT): ConformanceFinding {
  return { code: ConformanceErrorCodes.SNAPSHOT_MISMATCH, message, hint, file: SNAPSHOT_FILE };
}

function isNameList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

const CREATE_HINT = `Create ${SNAPSHOT_FILE} with a "values" and a "types" list for each subpath.`;

function errorCode(error: unknown): string {
  return isRecord(error) && typeof error.code === "string" ? error.code : "unknown error";
}

function unreadable(error: unknown): SnapshotRead {
  const code = errorCode(error);
  if (code === "ENOENT") return { ok: false, problem: "is missing", hint: CREATE_HINT };
  return {
    ok: false,
    problem: `cannot be read (${code})`,
    hint: `Make ${SNAPSHOT_FILE} a readable JSON file.`,
    unreadable: true,
  };
}

/** Read and parse the snapshot file at `root`. */
export async function readSnapshot(root: string): Promise<SnapshotRead> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path.join(root, SNAPSHOT_FILE), "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) {
      return { ok: false, problem: "is not valid JSON", hint: CREATE_HINT };
    }
    return unreadable(error);
  }
  const invalid: SnapshotRead = { ok: false, problem: "has an invalid shape", hint: CREATE_HINT };
  if (!isRecord(parsed)) return invalid;
  const snapshot: Snapshot = {};
  for (const [subpath, entry] of Object.entries(parsed)) {
    if (!isRecord(entry) || !isNameList(entry.values) || !isNameList(entry.types)) return invalid;
    snapshot[subpath] = { values: entry.values, types: entry.types };
  }
  return { ok: true, snapshot };
}

/** Subpaths of `exports`, with the sugar form (conditions at the root) read as ".". */
function exportsOf(manifest: unknown): Record<string, unknown> {
  const value = isRecord(manifest) ? manifest.exports : undefined;
  if (typeof value === "string") return { ".": value };
  if (!isRecord(value)) return {};
  return Object.keys(value).some((key) => key.startsWith(".")) ? value : { ".": value };
}

/** The types file a target declares: `types`, `types.import`, then `import`. */
function declaredTypes(target: unknown): string | undefined {
  if (typeof target === "string") return target;
  if (!isRecord(target)) return undefined;
  if (typeof target.types === "string") return target.types;
  if (isRecord(target.types) && typeof target.types.import === "string") return target.types.import;
  return typeof target.import === "string" ? target.import : undefined;
}

/** True for .d.ts, .d.mts, .ts, .tsx, .js and .mjs. */
function isModuleEntry(file: string): boolean {
  return [".d.mts", ".ts", ".tsx", ".js", ".mjs"].some((extension) => file.endsWith(extension));
}

async function isFile(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

/**
 * A subpath whose target is not a module entry (a .wasm, a .css) is never required, nor is a
 * pattern (`./x/*`): it names no single file. A `null` target blocks the subpath and is skipped.
 * Any other target that names no `types`, `types.import` or `import` file is `undeclared`.
 */
async function declaredFiles(
  root: string,
  subpaths: Record<string, unknown>,
): Promise<DeclaredFiles> {
  const files = new Map<string, string>();
  const missing = new Map<string, string>();
  const undeclared: string[] = [];
  for (const [subpath, target] of Object.entries(subpaths)) {
    if (subpath === "./package.json" || target === null) continue;
    const declared = declaredTypes(target);
    if (declared === undefined) {
      undeclared.push(subpath);
      continue;
    }
    if (!isModuleEntry(declared) || declared.includes("*")) continue;
    const file = path.resolve(root, declared);
    if (await isFile(file)) files.set(subpath, file);
    else missing.set(subpath, declared);
  }
  return { files, missing, undeclared };
}

/** Names exported by `file`, split into values and types. `__`-prefixed names are skipped. */
function exportNames(program: ts.Program, file: string): SnapEntry {
  const source = program.getSourceFile(file);
  const checker = program.getTypeChecker();
  const moduleSymbol = source === undefined ? undefined : checker.getSymbolAtLocation(source);
  const values: string[] = [];
  const types: string[] = [];
  if (moduleSymbol === undefined) return { values, types };
  for (const symbol of checker.getExportsOfModule(moduleSymbol)) {
    const name = symbol.getName();
    if (name.startsWith("__")) continue;
    const alias = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
    const isValue = (alias.flags & ts.SymbolFlags.Value) !== 0;
    const declaration = symbol.declarations?.[0];
    const typeOnly =
      (declaration !== undefined &&
        ts.isExportSpecifier(declaration) &&
        (declaration.isTypeOnly || declaration.parent.parent.isTypeOnly)) ||
      (declaration !== undefined && ts.isExportDeclaration(declaration) && declaration.isTypeOnly);
    (typeOnly || !isValue ? types : values).push(name);
  }
  return { values: values.sort(), types: types.sort() };
}

/** Read the exports of every built subpath. */
function readBuilt(root: string, files: ReadonlyMap<string, string>): Map<string, BuiltEntry> {
  const program = ts.createProgram({
    rootNames: [...new Set(files.values())],
    options: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      allowJs: true,
      skipLibCheck: true,
      noEmit: true,
      noLib: true,
      types: [],
      strict: false,
    },
  });
  const built = new Map<string, BuiltEntry>();
  for (const [subpath, file] of files) {
    const relative = path.relative(root, file).split(path.sep).join("/");
    built.set(subpath, { ...exportNames(program, file), file: relative });
  }
  return built;
}

function sameSnapshot(left: Snapshot, right: Snapshot): boolean {
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => JSON.stringify(left[key]) === JSON.stringify(right[key]))
  );
}

/**
 * The snapshot the build implies. The subpaths of `previous` keep their order, those it lacks follow
 * in `exports` order, and those no longer in `exports` are dropped. A subpath not built keeps its
 * old entry.
 */
function snapshotOf(
  subpaths: Record<string, unknown>,
  built: ReadonlyMap<string, BuiltEntry>,
  previous: Snapshot,
): Snapshot {
  const wanted = Object.keys(subpaths);
  const known = Object.keys(previous);
  const order = [
    ...known.filter((subpath) => wanted.includes(subpath)),
    ...wanted.filter((subpath) => !known.includes(subpath)),
  ];
  const next: Snapshot = {};
  for (const subpath of order) {
    const entry = built.get(subpath) ?? previous[subpath];
    if (entry !== undefined) next[subpath] = { values: entry.values, types: entry.types };
  }
  return next;
}

/** Replace the snapshot file with `snapshot` through a temp file, so a failure leaves the old one. */
async function writeSnapshot(root: string, snapshot: Snapshot): Promise<void> {
  const target = path.join(root, SNAPSHOT_FILE);
  const temp = `${target}.tmp`;
  try {
    await writeFile(temp, `${JSON.stringify(snapshot, null, 2)}\n`);
    await rename(temp, target);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
}

function nameFindings(
  kind: "value" | "type",
  subpath: string,
  built: readonly string[],
  listed: readonly string[],
): ConformanceFinding[] {
  const added = built
    .filter((name) => !listed.includes(name))
    .map((name) =>
      mismatch(
        `subpath ${quote(subpath)} exports ${kind} ${quote(name)} that ${SNAPSHOT_FILE} does not list`,
      ),
    );
  const removed = listed
    .filter((name) => !built.includes(name))
    .map((name) =>
      mismatch(
        `${SNAPSHOT_FILE} lists ${kind} ${quote(name)} for subpath ${quote(subpath)} that the build does not export`,
      ),
    );
  return [...added, ...removed];
}

function notBuiltFindings(declared: DeclaredFiles): ConformanceFinding[] {
  const notBuilt = [...declared.missing].map(([subpath, file]) =>
    mismatch(
      `subpath ${quote(subpath)} declares ${quote(file)}, which is not built`,
      "Build the package, then run gwen-conformance check again.",
    ),
  );
  const noFile = declared.undeclared.map((subpath) =>
    mismatch(
      `subpath ${quote(subpath)} declares no types or import file`,
      'Give the subpath a "types" or "import" file, or set it to null.',
    ),
  );
  return [...notBuilt, ...noFile];
}

function privateFindings(built: ReadonlyMap<string, BuiltEntry>): ConformanceFinding[] {
  return [...built].flatMap(([subpath, entry]) =>
    entry.values
      .filter((name) => name.startsWith("_"))
      .map((name) => ({
        code: ConformanceErrorCodes.PRIVATE_EXPORT,
        message: `value ${quote(name)} of subpath ${quote(subpath)} starts with "_"`,
        hint: "Rename the value without the underscore, or stop exporting it.",
        file: entry.file,
      })),
  );
}

function compareSnapshot(
  subpaths: Record<string, unknown>,
  built: ReadonlyMap<string, BuiltEntry>,
  snapshot: Snapshot,
): SnapshotFindings {
  const values: ConformanceFinding[] = [];
  const types: ConformanceFinding[] = [];
  for (const subpath of Object.keys(snapshot)) {
    if (subpath in subpaths) continue;
    values.push(
      mismatch(`${SNAPSHOT_FILE} lists subpath ${quote(subpath)} that exports does not have`),
    );
  }
  for (const [subpath, entry] of built) {
    const listed = snapshot[subpath];
    if (listed === undefined) {
      values.push(mismatch(`subpath ${quote(subpath)} is in exports but not in ${SNAPSHOT_FILE}`));
      continue;
    }
    values.push(...nameFindings("value", subpath, entry.values, listed.values));
    types.push(...nameFindings("type", subpath, entry.types, listed.types));
  }
  return { values, types };
}

/**
 * Compare the snapshot with the build. With `write`, the snapshot is first rewritten from the
 * build in the gwen layout (2-space JSON, final newline), unless it already holds the same names;
 * the keys keep the order of the old file, new subpaths follow in `exports` order, and a subpath
 * whose target is not a module entry keeps its old entry. Nothing is written, and the findings are
 * those of a read, while a subpath is not built or declares no types or import file, while
 * `exports` names no subpath, or while the snapshot exists and cannot be read. A write that fails is
 * one finding. A missing, invalid or malformed snapshot file is one finding, reported with the
 * values. A subpath whose module entry is not built, or whose target names no file, is one finding
 * too.
 */
export async function snapshotFindings(
  context: Pick<PackageContext, "root" | "manifest">,
  write = false,
): Promise<SnapshotFindings> {
  const subpaths = exportsOf(context.manifest);
  const declared = await declaredFiles(context.root, subpaths);
  const built = readBuilt(context.root, declared.files);
  const notBuilt = notBuiltFindings(declared);
  const extra = [...notBuilt, ...privateFindings(built)];
  let current = await readSnapshot(context.root);
  let failure: ConformanceFinding | undefined;
  const writable =
    write &&
    notBuilt.length === 0 &&
    Object.keys(subpaths).length > 0 &&
    (current.ok || current.unreadable !== true);
  if (writable) {
    const next = snapshotOf(subpaths, built, current.ok ? current.snapshot : {});
    if (!current.ok || !sameSnapshot(current.snapshot, next)) {
      try {
        await writeSnapshot(context.root, next);
      } catch (error) {
        failure = mismatch(
          `${SNAPSHOT_FILE} cannot be written (${errorCode(error)})`,
          `Make the package directory writable, or fix ${SNAPSHOT_FILE} by hand.`,
        );
      }
    }
    if (failure === undefined) current = { ok: true, snapshot: next };
  }
  const reported = failure === undefined ? [] : [failure];
  if (!current.ok) {
    const problem = mismatch(`${SNAPSHOT_FILE} ${current.problem}`, current.hint);
    return { values: [problem, ...reported, ...extra], types: [] };
  }
  const compared = compareSnapshot(subpaths, built, current.snapshot);
  return { values: [...reported, ...compared.values, ...extra], types: compared.types };
}

/**
 * Compare `public-api.snap.json` with the built package at `pkgRoot`, as the checks
 * `snapshot-values` and `snapshot-types` do. `opts.write` rewrites the snapshot from the build
 * first, when it can (see {@link snapshotFindings}); the findings then describe what the new file
 * still disagrees with, such as the `_` names. Without it the package is only read.
 */
export async function checkSnapshot(
  pkgRoot: string,
  opts?: { write?: boolean },
): Promise<ConformanceReport> {
  const checks = ["snapshot-values", "snapshot-types"] as const;
  const loaded = await readPackageJson(pkgRoot);
  if (!loaded.ok) return { checks, findings: [packageReadFinding(loaded.reason)] };
  const found = await snapshotFindings(
    { root: pkgRoot, manifest: loaded.manifest },
    opts?.write === true,
  );
  return { checks, findings: [...found.values, ...found.types].sort(compareFindings) };
}
