import type { GwenEngine } from "@gwenjs/core";
import type { GwenPlugin, GwenPluginServiceKey } from "@gwenjs/schema";
import { buildBases } from "./base-packages.js";
import type { OpenedEngine } from "./open-engine.js";
import type { PluginConformanceSpec, RuntimeCheckContext } from "./types.js";

/** `hookListeners` and `plugins` from one `getStats()` call (`packages/core/src/engine/gwen-engine.ts:566`). */
export interface EngineBaseline {
  readonly hookListeners: number;
  readonly plugins: readonly string[];
}

/** Snapshot `hookListeners` and `plugins`. `plugins` is a new array on each call (`packages/core/src/engine/engine-types.ts:502`). */
export function baselineOf(engine: GwenEngine): EngineBaseline {
  const stats = engine.getStats();
  return { hookListeners: stats.hookListeners, plugins: stats.plugins };
}

/** Advance `spec.frames` frames (default 3) at `1/60`. */
export async function advanceFrames(
  open: OpenedEngine,
  spec: PluginConformanceSpec,
): Promise<void> {
  const frames = spec.frames ?? 3;
  await open.advance(frames, 1 / 60);
}

/** Install `frameworkProviders` in order. Each call builds a new plugin. */
export async function installProviders(
  engine: GwenEngine,
  spec: PluginConformanceSpec,
): Promise<void> {
  for (const provider of spec.frameworkProviders ?? []) {
    await engine.use(provider());
  }
}

/**
 * Providers, then one new instance of each base, in `spec.bases` order.
 * R2 stays on `installProviders` and does not install bases.
 */
export async function installPrerequisites(
  engine: GwenEngine,
  context: RuntimeCheckContext,
): Promise<void> {
  await installProviders(engine, context.spec);
  for (const plugin of buildBases(context)) {
    await engine.use(plugin);
  }
}

/** Declared `provides` keys. An absent list is no keys. */
export function provideKeys(plugin: GwenPlugin): readonly GwenPluginServiceKey[] {
  if (plugin.provides === undefined) return [];
  return plugin.provides;
}

/** Names in `after` that are not in `baseline`, in `after` order. */
export function extraNames(baseline: readonly string[], after: readonly string[]): string[] {
  const known = new Set(baseline);
  const extras: string[] = [];
  for (const name of after) {
    if (!known.has(name)) extras.push(name);
  }
  return extras;
}

/** Same names in the same order. */
export function sameNames(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

/**
 * `engine.use`. A rejection returns false so the caller can skip.
 * Requires owns that rejection (`packages/core/src/engine/plugin-registry.ts:346`).
 */
export async function usePlugin(engine: GwenEngine, plugin: GwenPlugin): Promise<boolean> {
  try {
    await engine.use(plugin);
    return true;
  } catch {
    return false;
  }
}

/** Text of a thrown value. A non-Error becomes its string form. */
export function thrownMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
