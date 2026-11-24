import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ConformanceCode, ConformanceFinding } from "@gwenjs/plugin-conformance";
import type {
  PluginConformanceSpec,
  PluginFactorySpec,
  RuntimeConformanceReport,
} from "@gwenjs/plugin-conformance/runtime";

const KNOWN_VARIANTS = ["light", "physics2d", "physics3d"] as const;

type RuntimeVariant = (typeof KNOWN_VARIANTS)[number];

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
  /** Passed through even when it is not one of the three variants. */
  readonly variant?: string;
  readonly frameworkProviders?: PluginConformanceSpec["frameworkProviders"];
  readonly fixture?: PluginConformanceSpec["fixture"];
}

function isKnownVariant(value: string): value is RuntimeVariant {
  return KNOWN_VARIANTS.some((variant) => variant === value);
}

function readVariant(value: string): RuntimeVariant {
  if (isKnownVariant(value)) return value;
  return value as RuntimeVariant;
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
  let result: PluginConformanceSpec = {
    packageName: overrides.packageName ?? "@fixture/plugin",
    factories: overrides.factories ?? [{ export: "Plugin" }],
  };
  if (overrides.root !== undefined) result = { ...result, root: overrides.root };
  if (overrides.official !== undefined) result = { ...result, official: overrides.official };
  if (overrides.frames !== undefined) result = { ...result, frames: overrides.frames };
  if (overrides.variant !== undefined) {
    result = { ...result, variant: readVariant(overrides.variant) };
  }
  if (overrides.frameworkProviders !== undefined) {
    result = { ...result, frameworkProviders: overrides.frameworkProviders };
  }
  if (overrides.fixture !== undefined) result = { ...result, fixture: overrides.fixture };
  return result;
}

/** Findings of `report` whose code is `code`. */
export function findingsWithCode(
  report: RuntimeConformanceReport,
  code: ConformanceCode,
): ConformanceFinding[] {
  return report.findings.filter((finding) => finding.code === code);
}
