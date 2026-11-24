import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ConformanceCode, ConformanceFinding } from "@gwenjs/plugin-conformance";
import type {
  PluginConformanceSpec,
  PluginFactorySpec,
  RuntimeCheckId,
  RuntimeConformanceReport,
} from "@gwenjs/plugin-conformance/runtime";

export interface WritePluginPackageOptions {
  readonly name: string;
  readonly exports?: Readonly<
    Record<string, string | { readonly types?: string; readonly import?: string }>
  >;
  readonly files?: Readonly<Record<string, string>>;
}

export interface SpecOverrides {
  readonly packageName?: string;
  readonly factories?: readonly PluginFactorySpec[];
  readonly root?: string;
  readonly official?: boolean;
  readonly frames?: number;
  /** A string outside the three variants is kept so the runtime can reject it. */
  readonly variant?: PluginConformanceSpec["variant"] | string;
  readonly frameworkProviders?: PluginConformanceSpec["frameworkProviders"];
  readonly fixture?: PluginConformanceSpec["fixture"];
}

/** `packageName` and `factories` are present. `variant` is checked by the runtime. */
function isSpec(value: unknown): value is PluginConformanceSpec {
  if (typeof value !== "object" || value === null) return false;
  if (!("packageName" in value) || typeof value.packageName !== "string") return false;
  if (!("factories" in value) || !Array.isArray(value.factories)) return false;
  return true;
}

/** Plain factory module: one function export and no import. */
export function factorySource(exportName: string): string {
  return `export function ${exportName}() {\n  return { name: ${JSON.stringify(exportName)}, setup() {} };\n}\n`;
}

/**
 * Write a temp package at `dir` (`"type": "module"`).
 * `files` is a map of paths relative to `dir`. Returns `dir`.
 */
export async function writePluginPackage(
  dir: string,
  options: WritePluginPackageOptions,
): Promise<string> {
  const manifest = {
    name: options.name,
    type: "module",
    exports: options.exports ?? {
      ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
    },
  };
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  for (const [relative, text] of Object.entries(options.files ?? {})) {
    const full = path.join(dir, relative);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, text);
  }
  return dir;
}

/** A spec with defaults a caller can replace. An unknown `variant` is kept. */
export function spec(overrides: SpecOverrides = {}): PluginConformanceSpec {
  const result: {
    packageName: string;
    factories: readonly PluginFactorySpec[];
    root?: string;
    official?: boolean;
    frames?: number;
    variant?: string;
    frameworkProviders?: PluginConformanceSpec["frameworkProviders"];
    fixture?: PluginConformanceSpec["fixture"];
  } = {
    packageName: overrides.packageName ?? "@fixture/plugin",
    factories: overrides.factories ?? [{ export: "Plugin" }],
  };
  if (overrides.root !== undefined) result.root = overrides.root;
  if (overrides.official !== undefined) result.official = overrides.official;
  if (overrides.frames !== undefined) result.frames = overrides.frames;
  if (overrides.variant !== undefined) result.variant = overrides.variant;
  if (overrides.frameworkProviders !== undefined) {
    result.frameworkProviders = overrides.frameworkProviders;
  }
  if (overrides.fixture !== undefined) result.fixture = overrides.fixture;
  if (!isSpec(result)) throw new Error("spec helper requires packageName and factories");
  return result;
}

/**
 * Check order the runtime tests expect: shape, requires, provides, frames,
 * remove, reentry, two-engines, stop.
 * `options` follows `stop` when `options.options` is true.
 * `module` follows that when `options.module` is true.
 * `hooks` is always present, once per run.
 * `composable` is always last.
 */
export function ranChecks(options?: {
  readonly options?: boolean;
  readonly module?: boolean;
}): readonly RuntimeCheckId[] {
  const checks: RuntimeCheckId[] = [
    "shape",
    "requires",
    "provides",
    "frames",
    "remove",
    "reentry",
    "two-engines",
    "stop",
  ];
  if (options?.options === true) checks.push("options");
  if (options?.module === true) checks.push("module");
  checks.push("hooks");
  checks.push("composable");
  return checks;
}

/** Findings of `report` whose code is `code`. */
export function findingsWithCode(
  report: RuntimeConformanceReport,
  code: ConformanceCode,
): ConformanceFinding[] {
  return report.findings.filter((finding) => finding.code === code);
}
