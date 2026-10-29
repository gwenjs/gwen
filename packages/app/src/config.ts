/**
 * @file RFC-004 — resolveGwenConfig (Node.js only)
 *
 * Browser-safe types and defineConfig live in ./types.ts.
 * This file imports c12 and must only be used in Node.js contexts.
 */

import { detectCoreVariant } from "@gwenjs/core/internal";
import { checkEngineConfig, ENGINE_DEFAULTS, formatReceived } from "@gwenjs/schema";
import type { GwenConfigIssue } from "@gwenjs/schema";
import { GwenAppConfigError } from "./config-error";
import { loadRawGwenConfig } from "./config-loader";
import { mergeLayers, recordOf } from "./merge";
import type { GwenUserConfig, ResolvedGwenConfig } from "./types";

export type {
  GwenModuleOptions,
  GwenModuleEntry,
  GwenUserConfig,
  ResolvedGwenConfig,
  GwenBuildHooks,
} from "./types";

const CONFIG_FILE: unique symbol = Symbol("@gwenjs/app/configFile");

const DEFAULT_LOGGER = {
  minLevel: "warn" as const,
};

export function readConfigFile(config: object): string {
  const value = (config as Record<symbol, unknown>)[CONFIG_FILE];
  return typeof value === "string" ? value : "";
}

function attachConfigFile<T extends object>(config: T, configFile: string): T {
  Object.defineProperty(config, CONFIG_FILE, { value: configFile, enumerable: false });
  return config;
}

function pushTupleIssues(modules: unknown, issues: GwenConfigIssue[]): void {
  if (modules === undefined) return;
  const entries = Array.isArray(modules) ? modules : [modules];
  for (let index = 0; index < entries.length; index += 1) {
    const entry: unknown = entries[index];
    if (Array.isArray(modules) && typeof entry === "string") continue;
    issues.push({
      path: Array.isArray(modules) ? `modules.${index}` : "modules",
      expected: "a module name string",
      received: formatReceived(Array.isArray(modules) ? entry : modules),
      owner: "@gwenjs/app",
    });
  }
}

function moduleNames(modules: unknown): string[] {
  if (!Array.isArray(modules)) return [];
  const names: string[] = [];
  for (const entry of modules) {
    const name = typeof entry === "string" ? entry : Array.isArray(entry) ? entry[0] : undefined;
    if (typeof name === "string") names.push(name);
  }
  return names;
}

export function resolveLoadedConfig(user: GwenUserConfig, configFile = ""): ResolvedGwenConfig {
  const issues: GwenConfigIssue[] = [];
  pushTupleIssues(user.modules, issues);

  const names = moduleNames(user.modules);
  const derived = detectCoreVariant({ modules: names });
  const explicit = user.engine?.variant;
  const physicsModule = ["@gwenjs/physics3d", "@gwenjs/physics2d"].find((name) =>
    names.includes(name),
  );
  if (explicit !== undefined && physicsModule !== undefined && explicit !== derived) {
    issues.push({
      path: "engine.variant",
      expected: `the variant derived from the declared modules ("${derived}")`,
      received: formatReceived(explicit),
      owner: "@gwenjs/app",
      conflictsWith: physicsModule,
    });
  }

  const base: ResolvedGwenConfig = {
    engine: { ...ENGINE_DEFAULTS, variant: derived },
    logger: { ...DEFAULT_LOGGER },
    modules: [],
  };
  const merged = mergeLayers<ResolvedGwenConfig>(base, user);
  const engine = recordOf(merged.engine);
  issues.push(...checkEngineConfig(engine, "@gwenjs/app", "engine."));
  if (issues.length > 0) throw new GwenAppConfigError(configFile, issues);
  return attachConfigFile(merged, configFile);
}

export async function resolveGwenConfig(rootDir?: string): Promise<ResolvedGwenConfig> {
  const { config, configFile } = await loadRawGwenConfig(rootDir ?? process.cwd());
  return resolveLoadedConfig(config, configFile);
}
