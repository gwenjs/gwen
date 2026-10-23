import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import * as kit from "@gwenjs/kit";
import * as kitPlugin from "@gwenjs/kit/plugin";
import * as schema from "@gwenjs/schema";

const require = createRequire(import.meta.url);
const tscBin = path.join(path.dirname(require.resolve("typescript/package.json")), "bin", "tsc");
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const pluginIndex = path.resolve(here, "../src/plugin/index.ts");

const REMOVED_NAMES = [
  "EngineErrorBus",
  "GwenEngine",
  "GwenEngineOptions",
  "GwenHookable",
  "MemoryRegion",
  "WasmBridge",
  "WasmModuleHandle",
  "WasmModuleOptions",
  "createChildScope",
  "createErrorBus",
] as const;

const CONTROL_SOURCE = `import { useCurrentScope } from "@gwenjs/kit";
import { createEntityId, definePlugin, unpackEntityId } from "@gwenjs/kit/plugin";
import type {
  ComponentType,
  EntityId,
  GwenPlugin,
  GwenProvides,
  GwenRuntimeHooks,
  PluginErrorContext,
} from "@gwenjs/kit/plugin";

export function kept(
  plugin: GwenPlugin,
  provides: GwenProvides,
  hooks: GwenRuntimeHooks,
  id: EntityId,
  component: ComponentType,
  context: PluginErrorContext,
): string {
  return [
    typeof useCurrentScope,
    typeof definePlugin,
    typeof createEntityId,
    typeof unpackEntityId,
    typeof plugin,
    typeof provides,
    typeof hooks,
    typeof id,
    typeof component,
    typeof context,
  ].join(",");
}
`;

const REMOVED_SOURCE = `import { createChildScope, createErrorBus } from "@gwenjs/kit";
import type {
  EngineErrorBus,
  GwenEngine,
  GwenEngineOptions,
  GwenHookable,
  MemoryRegion,
  WasmBridge,
  WasmModuleHandle,
  WasmModuleOptions,
} from "@gwenjs/kit/plugin";

export function removed(
  engine: GwenEngine,
  options: GwenEngineOptions,
  bridge: WasmBridge,
  region: MemoryRegion,
  moduleOptions: WasmModuleOptions,
  handle: WasmModuleHandle,
  hookable: GwenHookable,
  bus: EngineErrorBus,
): string {
  return [
    typeof createErrorBus,
    typeof createChildScope,
    typeof engine,
    typeof options,
    typeof bridge,
    typeof region,
    typeof moduleOptions,
    typeof handle,
    typeof hookable,
    typeof bus,
  ].join(",");
}
`;

function isExecFailure(
  value: unknown,
): value is { status: number; stdout: string; stderr: string } {
  if (typeof value !== "object" || value === null || !("status" in value)) return false;
  return typeof value.status === "number";
}

function moduleSpecifiers(file: string): string[] {
  if (!existsSync(file)) {
    throw new Error(`kit surface harness: missing file ${file}`);
  }
  const info = ts.preProcessFile(readFileSync(file, "utf8"), true, true);
  return info.importedFiles.map((ref) => ref.fileName);
}

function ts2305Names(output: string): string[] {
  const names = new Set<string>();
  for (const match of output.matchAll(/error TS2305: .* has no exported member '([^'\n]+)'/g)) {
    const name = match[1];
    if (name !== undefined) names.add(name);
  }
  return [...names].sort();
}

/**
 * Dev and prod vitest projects run this file at the same time. Each run writes
 * its own sibling directory so one `finally` cannot delete the other's files.
 */
function writeProject(
  dir: string,
  fileName: string,
  source: string,
): { project: string; source: string } {
  mkdirSync(dir, { recursive: true });
  const sourcePath = path.join(dir, fileName);
  writeFileSync(sourcePath, source);
  const project = path.join(dir, "tsconfig.json");
  const extendsPath = path
    .relative(dir, path.join(repoRoot, "tsconfig.base.json"))
    .split(path.sep)
    .join("/");
  // packages/app/package.json:48 has @types/node; packages/kit/package.json:47-52 does not. typeRoots points at the app install.
  const nodeTypes = path.resolve(repoRoot, "packages/app/node_modules/@types");
  if (!existsSync(path.join(nodeTypes, "node"))) {
    throw new Error(`kit surface harness: missing file ${path.join(nodeTypes, "node")}`);
  }
  const typeRoots = path.relative(dir, nodeTypes).split(path.sep).join("/");
  writeFileSync(
    project,
    `${JSON.stringify(
      {
        extends: extendsPath,
        compilerOptions: { noEmit: true, types: ["node"], typeRoots: [typeRoots] },
        include: [fileName],
      },
      null,
      2,
    )}\n`,
  );
  if (!existsSync(sourcePath) || !existsSync(project)) {
    throw new Error(`kit surface harness: missing file ${sourcePath}`);
  }
  return { project, source: sourcePath };
}

function runTsc(projectFile: string, sourceFile: string): { status: number; stdout: string } {
  if (!existsSync(sourceFile)) {
    throw new Error(`kit surface harness: missing file ${sourceFile}`);
  }
  if (!existsSync(projectFile)) {
    throw new Error(`kit surface harness: missing file ${projectFile}`);
  }
  if (!existsSync(tscBin)) {
    throw new Error(`kit surface harness: tsc did not start, missing binary ${tscBin}`);
  }
  try {
    const stdout = execFileSync(
      process.execPath,
      [tscBin, "-p", projectFile, "--pretty", "false"],
      {
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
      },
    );
    return { status: 0, stdout };
  } catch (error) {
    if (!isExecFailure(error)) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`kit surface harness: tsc did not start: ${message}`);
    }
    const stdout = typeof error.stdout === "string" ? error.stdout : "";
    const stderr = typeof error.stderr === "string" ? error.stderr : "";
    return { status: error.status, stdout: `${stdout}${stderr}` };
  }
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
    const runDir = path.join(here, `run-${randomUUID()}`);
    try {
      const control = writeProject(path.join(runDir, "control"), "stay.ts", CONTROL_SOURCE);
      const removed = writeProject(path.join(runDir, "removed"), "gone.ts", REMOVED_SOURCE);
      const controlResult = runTsc(control.project, control.source);
      expect(controlResult.status, controlResult.stdout).toBe(0);
      const removedResult = runTsc(removed.project, removed.source);
      expect(removedResult.status, removedResult.stdout).not.toBe(0);
      expect(ts2305Names(removedResult.stdout)).toEqual([...REMOVED_NAMES]);
    } finally {
      rmSync(runDir, { recursive: true, force: true });
    }
  }, 120_000);
});
