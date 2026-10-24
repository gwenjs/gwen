/**
 * Removed exports (#76).
 *
 * The legacy hook and engine contracts are gone from `@gwenjs/schema`, and `GwenHooks` is gone from
 * `@gwenjs/core`. This suite asks the TypeScript compiler for the real export list of each entry
 * module (`export type { ... }` and `export *` are both followed), so a re-export of a removed name
 * fails here with the name in the title.
 *
 * Each case first checks that the list is read and holds a name that stays, so an empty or
 * unresolved export list cannot pass. A missing module in the entry graph throws.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

interface EntryCase {
  pkg: string;
  dir: string;
  removed: readonly string[];
  kept: string;
}

const ENTRIES: readonly EntryCase[] = [
  {
    pkg: "@gwenjs/schema",
    dir: "packages/schema",
    removed: [
      "GwenHooks",
      "EngineLifecycleHooks",
      "PluginLifecycleHooks",
      "EntityLifecycleHooks",
      "ComponentLifecycleHooks",
      "SceneLifecycleHooks",
      "ExtensionLifecycleHooks",
      "EngineAPI",
    ],
    kept: "GwenRuntimeHooks",
  },
  {
    pkg: "@gwenjs/core",
    dir: "packages/core",
    removed: ["GwenHooks"],
    kept: "GwenHookable",
  },
];

const REMOVED_CASES = ENTRIES.flatMap((entry) =>
  entry.removed.map((name) => ({ pkg: entry.pkg, dir: entry.dir, name, kept: entry.kept })),
);

const exportNamesByDir = new Map<string, ReadonlySet<string>>();

/** Every name exported by `<dir>/src/index.ts`, read from the compiler with the package tsconfig. */
function readExportNames(dir: string): ReadonlySet<string> {
  const known = exportNamesByDir.get(dir);
  if (known !== undefined) {
    return known;
  }
  const configPath = path.join(repoRoot, dir, "tsconfig.json");
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error !== undefined) {
    throw new Error(`removed-exports: cannot read ${configPath}`);
  }
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath));
  const entry = path.join(repoRoot, dir, "src/index.ts");
  const program = ts.createProgram([entry], { ...parsed.options, noEmit: true, composite: false });
  const sourceFile = program.getSourceFile(entry);
  if (sourceFile === undefined) {
    throw new Error(`removed-exports: missing source file ${entry}`);
  }
  const unresolved = ts
    .getPreEmitDiagnostics(program, sourceFile)
    .find((diagnostic) => diagnostic.code === 2307);
  if (unresolved !== undefined) {
    const text = ts.flattenDiagnosticMessageText(unresolved.messageText, "\n");
    throw new Error(`removed-exports: ${entry} has an unresolved module: ${text}`);
  }
  const checker = program.getTypeChecker();
  const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
  if (moduleSymbol === undefined) {
    throw new Error(`removed-exports: ${entry} is not a module`);
  }
  const names = new Set(checker.getExportsOfModule(moduleSymbol).map((symbol) => symbol.name));
  exportNamesByDir.set(dir, names);
  return names;
}

describe("removed exports", () => {
  it.each(REMOVED_CASES)("$pkg does not export $name", ({ dir, name, kept }) => {
    const names = readExportNames(dir);
    expect(names.size).toBeGreaterThan(0);
    expect(names.has(kept)).toBe(true);
    expect(names.has(name)).toBe(false);
  });
});
