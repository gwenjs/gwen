/**
 * Fill or check public-api.snap.json type names.
 *
 * Default: compare each package snap to the built dist/*.d.ts exports
 * that are not already runtime values.
 * `--write-source` fills types from the TypeScript source entries.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const writeSource = process.argv.includes("--write-source");

function sourceForDist(pkgDir, distFile) {
  const rel = distFile.replace(/^\.\/dist\//, "").replace(/\.(js|d\.ts|cjs)$/, "");
  const candidates = [
    path.join(pkgDir, "src", `${rel}.ts`),
    path.join(pkgDir, "src", rel, "index.ts"),
    path.join(pkgDir, "src", `${rel}.tsx`),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error(`No source for ${distFile} in ${pkgDir}`);
  return found;
}

function declaredTypes(target) {
  if (typeof target === "string") return target;
  if (typeof target.types === "string") return target.types;
  if (target.types && typeof target.types.import === "string") return target.types.import;
  if (typeof target.import === "string") return target.import;
  return null;
}

function entryFile(pkgDir, target) {
  const file = declaredTypes(target);
  if (!file) return null;
  if (file.startsWith("./dist/"))
    return writeSource ? sourceForDist(pkgDir, file) : path.join(pkgDir, file);
  return path.join(pkgDir, file);
}

function exportNames(program, file) {
  const source = program.getSourceFile(file);
  if (!source) throw new Error(`Missing source file ${file}`);
  const checker = program.getTypeChecker();
  const moduleSymbol = checker.getSymbolAtLocation(source);
  const values = [];
  const types = [];
  if (!moduleSymbol) return { values, types };
  for (const symbol of checker.getExportsOfModule(moduleSymbol)) {
    const name = symbol.getName();
    if (name.startsWith("__")) continue;
    const flags = symbol.flags;
    const alias = flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
    const isValue =
      (alias.flags & ts.SymbolFlags.Value) !== 0 || (alias.flags & ts.SymbolFlags.Enum) !== 0;
    const decl = symbol.declarations?.[0];
    const typeOnly =
      (decl && ts.isExportSpecifier(decl) && (decl.isTypeOnly || decl.parent.parent.isTypeOnly)) ||
      (decl && ts.isExportDeclaration(decl) && decl.isTypeOnly);
    if (typeOnly || !isValue) types.push(name);
    else values.push(name);
  }
  values.sort();
  types.sort();
  return { values, types };
}

const packages = readdirSync(path.join(root, "packages")).filter((dir) =>
  existsSync(path.join(root, "packages", dir, "package.json")),
);

let failed = false;
const files = [];
const jobs = [];

for (const dir of packages) {
  const pkgDir = path.join(root, "packages", dir);
  const manifest = JSON.parse(readFileSync(path.join(pkgDir, "package.json"), "utf8"));
  const snapPath = path.join(pkgDir, "public-api.snap.json");
  if (!manifest.exports || !existsSync(snapPath)) continue;
  const snap = JSON.parse(readFileSync(snapPath, "utf8"));
  for (const [subpath, target] of Object.entries(manifest.exports)) {
    if (subpath === "./package.json") continue;
    const file = entryFile(pkgDir, target);
    if (!file || !existsSync(file)) {
      if (!writeSource) {
        console.error(
          `missing built types for ${manifest.name}${subpath === "." ? "" : subpath.slice(1)}: ${file}`,
        );
        failed = true;
      }
      continue;
    }
    files.push(file);
    jobs.push({ snapPath, snap, subpath, file, name: manifest.name });
  }
}

const configFile = ts.readConfigFile(path.join(root, "tsconfig.base.json"), ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, root);

const program = ts.createProgram({
  rootNames: [...new Set(files)],
  options: {
    ...parsed.options,
    noEmit: true,
    strict: false,
    skipLibCheck: true,
    allowJs: true,
  },
});

const bySnap = new Map();
for (const job of jobs) {
  const exported = exportNames(program, path.resolve(job.file));
  const runtime = new Set(job.snap[job.subpath]?.values ?? []);
  const types = exported.types.filter((name) => !runtime.has(name));
  if (!bySnap.has(job.snapPath)) bySnap.set(job.snapPath, job.snap);
  const current = job.snap[job.subpath]?.types ?? [];
  if (writeSource) {
    const values = job.subpath.includes("wasm")
      ? exported.values
      : (job.snap[job.subpath]?.values ?? exported.values);
    job.snap[job.subpath] = { values, types };
  } else if (JSON.stringify(current) !== JSON.stringify(types)) {
    console.error(
      `${job.name} ${job.subpath} types differ\n  snap: ${current.join(", ")}\n  d.ts: ${types.join(", ")}`,
    );
    failed = true;
  }
}

if (writeSource) {
  for (const [snapPath, snap] of bySnap) {
    writeFileSync(snapPath, `${JSON.stringify(snap, null, 2)}\n`);
  }
}

if (failed) process.exit(1);
