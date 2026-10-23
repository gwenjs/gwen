import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import * as kit from "@gwenjs/kit";
import * as kitPlugin from "@gwenjs/kit/plugin";
import * as schema from "@gwenjs/schema";

const here = path.dirname(fileURLToPath(import.meta.url));
const kitIndex = path.resolve(here, "../src/index.ts");
const pluginIndex = path.resolve(here, "../src/plugin/index.ts");

const KEPT_NAMES = {
  kit: ["useCurrentScope", "useLogger", "useErrorReporter", "usePerfMark"],
  plugin: [
    "definePlugin",
    "satisfiesPluginContract",
    "definePluginTypes",
    "GwenPluginFactory",
    "PluginTypesOptions",
    "GwenPlugin",
    "GwenProvides",
    "GwenRuntimeHooks",
    "EntityId",
    "ComponentType",
    "PluginErrorContext",
    "createEntityId",
    "unpackEntityId",
  ],
} as const;

const REMOVED_NAMES = {
  kit: ["createErrorBus", "createChildScope"],
  plugin: [
    "GwenEngine",
    "GwenEngineOptions",
    "WasmBridge",
    "MemoryRegion",
    "WasmModuleOptions",
    "WasmModuleHandle",
    "GwenHookable",
    "EngineErrorBus",
  ],
} as const;

function moduleSpecifiers(file: string): string[] {
  if (!existsSync(file)) {
    throw new Error(`kit surface harness: missing file ${file}`);
  }
  const info = ts.preProcessFile(readFileSync(file, "utf8"), true, true);
  return info.importedFiles.map((ref) => ref.fileName);
}

/**
 * Reads the exported names, types and values, of each kit entry.
 * The TypeScript API replaces two `tsc` runs that cost about 29 s per vitest project on CI.
 * Module resolution is off: an alias re-export keeps its name, a bare `export *` hides its names.
 */
function readEntries(files: readonly string[]): {
  exports: Map<string, Set<string>>;
  starExports: string[];
} {
  for (const file of files) {
    if (!existsSync(file)) {
      throw new Error(`kit surface harness: missing file ${file}`);
    }
  }
  const program = ts.createProgram([...files], {
    noResolve: true,
    noLib: true,
    types: [],
    skipLibCheck: true,
  });
  const checker = program.getTypeChecker();
  const exports = new Map<string, Set<string>>();
  const starExports: string[] = [];
  for (const file of files) {
    const sourceFile = program.getSourceFile(file);
    if (sourceFile === undefined) {
      throw new Error(`kit surface harness: missing source file ${file}`);
    }
    const symbol = checker.getSymbolAtLocation(sourceFile);
    const names = symbol === undefined ? [] : checker.getExportsOfModule(symbol);
    exports.set(file, new Set(names.map((name) => name.name)));
    for (const statement of sourceFile.statements) {
      if (ts.isExportDeclaration(statement) && statement.exportClause === undefined) {
        starExports.push(`${path.basename(path.dirname(file))}/${path.basename(file)}`);
      }
    }
  }
  return { exports, starExports };
}

describe("@gwenjs/kit surface", () => {
  it("kit no longer exports createErrorBus or createChildScope", () => {
    expect("createErrorBus" in kit).toBe(false);
    expect("createChildScope" in kit).toBe(false);
    expect(typeof kit.useCurrentScope).toBe("function");
  });

  it("kit/plugin re-exports the schema entity functions", () => {
    expect(kitPlugin.createEntityId).toBe(schema.createEntityId);
    expect(kitPlugin.unpackEntityId).toBe(schema.unpackEntityId);
    const specifiers = moduleSpecifiers(pluginIndex);
    // A runtime identity check cannot tell the two apart: core re-exports the schema function.
    expect(specifiers).toContain("@gwenjs/schema");
    expect(specifiers).not.toContain("@gwenjs/core");
  });

  it("kit and kit/plugin no longer export the removed core types and values", () => {
    const { exports, starExports } = readEntries([kitIndex, pluginIndex]);
    const kitNames = exports.get(kitIndex) ?? new Set<string>();
    const pluginNames = exports.get(pluginIndex) ?? new Set<string>();

    const missingKeptNames = [
      ...KEPT_NAMES.kit.filter((name) => !kitNames.has(name)),
      ...KEPT_NAMES.plugin.filter((name) => !pluginNames.has(name)),
    ];
    expect(missingKeptNames).toEqual([]);

    expect(starExports).toEqual([]);

    const presentRemovedNames = [
      ...REMOVED_NAMES.kit.filter((name) => kitNames.has(name)),
      ...REMOVED_NAMES.plugin.filter((name) => pluginNames.has(name)),
    ];
    expect(presentRemovedNames).toEqual([]);
  });
});
