import { stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isRecord } from "../json.js";
import { locateBuiltFile, readRuntimeManifest } from "./package-manifest.js";
import { runtimeFinding } from "./spec.js";
import type { PluginConformanceSpec, PluginFactorySpec } from "./types.js";
import type { ConformanceFinding } from "../types.js";

/** Built package view. `rootEntry` is set only when every load rule passed. */
export interface LoadedPackage {
  readonly findings: readonly ConformanceFinding[];
  readonly rootEntry: Record<string, unknown> | undefined;
  readonly moduleFile: string | undefined;
}

function report(
  findings: readonly ConformanceFinding[],
  rootEntry: Record<string, unknown> | undefined = undefined,
  moduleFile: string | undefined = undefined,
): LoadedPackage {
  return { findings, rootEntry, moduleFile };
}

async function isFile(file: string): Promise<boolean> {
  try {
    const info = await stat(file);
    return info.isFile();
  } catch {
    return false;
  }
}

function namespaceView(loaded: unknown): Record<string, unknown> | undefined {
  if (!isRecord(loaded)) return undefined;
  const view: Record<string, unknown> = {};
  for (const key of Object.keys(loaded)) {
    view[key] = loaded[key];
  }
  return view;
}

/** Dynamic-import `file`. A failure is `undefined`, not a throw. */
async function importEntry(file: string): Promise<Record<string, unknown> | undefined> {
  try {
    const href = pathToFileURL(file).href;
    const loaded: unknown = await import(href);
    return namespaceView(loaded);
  } catch {
    return undefined;
  }
}

function factoriesNotExported(
  factories: readonly PluginFactorySpec[],
  entry: Record<string, unknown>,
): ConformanceFinding[] {
  const findings: ConformanceFinding[] = [];
  for (const factory of factories) {
    const exportName: unknown = factory.export;
    if (typeof exportName !== "string" || exportName.length === 0) continue;
    if (!Object.hasOwn(entry, exportName)) {
      findings.push(
        runtimeFinding(
          `built entry does not export ${JSON.stringify(exportName)}`,
          'Export that name from the file named by exports["."].import.',
        ),
      );
    }
  }
  return findings;
}

/**
 * Load the built root entry of `spec.root` (or the process working directory).
 * Never reads `<root>/src`. Any problem is an `INVALID_SPEC` finding.
 */
export async function loadRuntimePackage(spec: PluginConformanceSpec): Promise<LoadedPackage> {
  const root = path.resolve(spec.root ?? process.cwd());
  const loaded = await readRuntimeManifest(root);
  if (!loaded.ok) return report([runtimeFinding(loaded.message, loaded.hint)]);
  const manifest = loaded.manifest;
  if (manifest.name !== spec.packageName) {
    return report([
      runtimeFinding(
        `packageName ${JSON.stringify(spec.packageName)} does not equal package.json name ${JSON.stringify(manifest.name)}`,
        "Set packageName to the name field of package.json.",
      ),
    ]);
  }
  const packaged = locateBuiltFile(root, ".", manifest.rootTarget);
  if (!packaged.ok) return report([runtimeFinding(packaged.message, packaged.hint)]);
  const entryFile = packaged.file;
  if (!(await isFile(entryFile))) {
    return report([
      runtimeFinding(
        `exports["."].import ${JSON.stringify(manifest.rootTarget)} is not a file`,
        "Build the package so the import target exists, and do not point it at src.",
      ),
    ]);
  }
  const entry = await importEntry(entryFile);
  if (entry === undefined) {
    return report([
      runtimeFinding(
        `exports["."].import ${JSON.stringify(manifest.rootTarget)} could not be loaded`,
        "Build the package to an ECMAScript module and point import at that file.",
      ),
    ]);
  }
  const exportFindings = factoriesNotExported(spec.factories, entry);
  if (exportFindings.length > 0) return report(exportFindings);
  if (manifest.moduleTarget === undefined) return report([], entry, undefined);
  const moduleLocated = locateBuiltFile(root, "./module", manifest.moduleTarget);
  if (!moduleLocated.ok) return report([runtimeFinding(moduleLocated.message, moduleLocated.hint)]);
  if (!(await isFile(moduleLocated.file))) {
    return report([
      runtimeFinding(
        `exports["./module"].import ${JSON.stringify(manifest.moduleTarget)} is not a file`,
        'Build the module entry, or omit exports["./module"] until that file exists.',
      ),
    ]);
  }
  return report([], entry, moduleLocated.file);
}
