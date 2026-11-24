import { stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import type { GwenPlugin } from "@gwenjs/schema";
import { ConformanceErrorCodes } from "../error-codes.js";
import { isRecord } from "../json.js";
import { resolveInstalledPackage } from "../installed-package.js";
import type { ConformanceFinding } from "../types.js";
import { isPlugin } from "./call-factory.js";
import { locateBuiltFile, readGwenExtends, readRuntimeManifest } from "./package-manifest.js";
import type { PluginConformanceSpec, RuntimeCheckContext } from "./types.js";

type LoadedBase = RuntimeCheckContext["bases"][number];

type BaseEntry = NonNullable<PluginConformanceSpec["bases"]>[number];

export type BasesLoad =
  | { readonly ok: true; readonly bases: readonly LoadedBase[] }
  | { readonly ok: false; readonly findings: readonly ConformanceFinding[] };

function invalid(message: string, hint: string): ConformanceFinding {
  return { code: ConformanceErrorCodes.INVALID_SPEC, message, hint };
}

function outsideExtends(packageName: string): ConformanceFinding {
  return invalid(
    `spec.bases package ${JSON.stringify(packageName)} is not in gwen.extends`,
    "List that package in gwen.extends, or in the gwen.extends of an installed base this package lists.",
  );
}

function extendsWithoutBase(packageName: string): ConformanceFinding {
  return invalid(
    `gwen.extends lists ${JSON.stringify(packageName)} but spec.bases has no entry for it`,
    "Pass a spec.bases entry for every package named in gwen.extends.",
  );
}

function baseNotInstalled(packageName: string, root: string): ConformanceFinding {
  return invalid(
    `spec.bases package ${JSON.stringify(packageName)} is not installed under ${root}`,
    "Install that package in node_modules of the package root or of an ancestor.",
  );
}

function exportNotFunction(exportName: string): ConformanceFinding {
  return invalid(
    `spec.bases export ${JSON.stringify(exportName)} is not a function`,
    "Point export at a function of the base package root entry.",
  );
}

function baseLoadFailed(packageName: string, detail: string): ConformanceFinding {
  return invalid(
    `spec.bases package ${JSON.stringify(packageName)} ${detail}`,
    'Point the base package exports["."].import at a built ECMAScript module.',
  );
}

async function isFile(file: string): Promise<boolean> {
  try {
    const info = await stat(file);
    return info.isFile();
  } catch {
    return false;
  }
}

/** Dynamic-import `file`. A failure is `undefined`, not a throw. */
async function importBuilt(file: string): Promise<Record<string, unknown> | undefined> {
  try {
    const href = pathToFileURL(file).href;
    const loaded: unknown = await import(href);
    if (!isRecord(loaded)) return undefined;
    const view: Record<string, unknown> = {};
    for (const key of Object.keys(loaded)) view[key] = loaded[key];
    return view;
  } catch {
    return undefined;
  }
}

/**
 * Names in `listed`, plus `gwen.extends` of each installed package reached from them.
 * A listed name stays in the set when that package is not installed.
 */
async function extendsClosure(root: string, listed: readonly string[]): Promise<Set<string>> {
  const accepted = new Set<string>();
  const queue = [...listed];
  let index = 0;
  while (index < queue.length) {
    const name = queue[index];
    index += 1;
    if (name === undefined || accepted.has(name)) continue;
    accepted.add(name);
    const installed = await resolveInstalledPackage(root, name);
    if (installed.kind !== "found") continue;
    for (const child of readGwenExtends(installed.manifest)) {
      if (!accepted.has(child)) queue.push(child);
    }
  }
  return accepted;
}

function rejected(findings: readonly ConformanceFinding[]): BasesLoad {
  return { ok: false, findings };
}

async function loadOne(root: string, entry: BaseEntry): Promise<BasesLoad | LoadedBase> {
  const installed = await resolveInstalledPackage(root, entry.packageName);
  if (installed.kind !== "found") {
    return rejected([baseNotInstalled(entry.packageName, root)]);
  }
  const read = await readRuntimeManifest(installed.directory);
  if (!read.ok) return rejected([baseLoadFailed(entry.packageName, read.message)]);
  const located = locateBuiltFile(installed.directory, ".", read.manifest.rootTarget);
  if (!located.ok) return rejected([baseLoadFailed(entry.packageName, located.message)]);
  if (!(await isFile(located.file))) {
    return rejected([baseLoadFailed(entry.packageName, `${located.file} is not a file`)]);
  }
  const namespace = await importBuilt(located.file);
  if (namespace === undefined) {
    return rejected([baseLoadFailed(entry.packageName, "could not be loaded")]);
  }
  const exported: unknown = namespace[entry.export];
  if (typeof exported !== "function") {
    return rejected([exportNotFunction(entry.export)]);
  }
  const factory = exported;
  const options = entry.options;
  return {
    packageName: entry.packageName,
    exportName: entry.export,
    options,
    create(): unknown {
      return factory(options);
    },
  };
}

function isLoadedBase(value: BasesLoad | LoadedBase): value is LoadedBase {
  return !("ok" in value);
}

/**
 * Resolve `spec.bases` from `root` and apply the `gwen.extends` rules.
 * A base is accepted when its package is in `gwenExtends` or in the
 * `gwen.extends` of an installed package reached from that list.
 * Every name in `gwenExtends` needs a `spec.bases` entry.
 * Does not import a package name: resolution starts at `root`.
 */
export async function loadSpecBases(
  root: string,
  spec: PluginConformanceSpec,
  gwenExtends: readonly string[],
): Promise<BasesLoad> {
  const requested = spec.bases ?? [];
  const accepted = await extendsClosure(root, gwenExtends);
  const outside: ConformanceFinding[] = [];
  for (const base of requested) {
    if (!accepted.has(base.packageName)) outside.push(outsideExtends(base.packageName));
  }
  if (outside.length > 0) return rejected(outside);
  const covered = new Set<string>();
  for (const base of requested) covered.add(base.packageName);
  const missing: ConformanceFinding[] = [];
  for (const name of gwenExtends) {
    if (!covered.has(name)) missing.push(extendsWithoutBase(name));
  }
  if (missing.length > 0) return rejected(missing);
  const bases: LoadedBase[] = [];
  for (const entry of requested) {
    const loaded = await loadOne(root, entry);
    if (!isLoadedBase(loaded)) return loaded;
    bases.push(loaded);
  }
  return { ok: true, bases };
}

/** A new plugin per call, in `spec.bases` order. A return that is not a plugin is skipped. */
export function buildBases(context: RuntimeCheckContext): GwenPlugin[] {
  const plugins: GwenPlugin[] = [];
  for (const base of context.bases) {
    const created = base.create();
    if (!isPlugin(created)) continue;
    plugins.push(created);
  }
  return plugins;
}
