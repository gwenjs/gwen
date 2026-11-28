/**
 * @file Swap a scene in place on every engine that installed it.
 *
 * Dev only. A production build applies with count 0 because no scene records a install.
 * A scene that declares systems or actors is single-engine: the factory runs once, on the
 * first engine, and the scope and plugin objects belong to that run.
 *
 * @module
 */

import type { ActorDefinition } from "../actor/runtime/types.js";
import { CoreErrorCodes, GwenPluginDependencyError } from "../engine/engine-errors.js";
import type { GwenEngine, GwenPlugin } from "../engine/engine-types.js";
import { hotReplaceActor } from "./hot-replace-actor.js";
import { isLive, settle } from "./frame.js";
import { hotReplaceSystem } from "./hot-replace-system.js";
import { registerSceneHandles } from "./scene-handles.js";
import {
  actorOwnerOf,
  factoryOf,
  sceneRecordOf,
  type SceneSystemFactory,
} from "./scene-installs.js";
import { sceneIsEntered } from "../scene/engine-plugin.js";
import type {
  SceneDefinition,
  SceneFactory,
  SceneRegistry,
} from "../scene/runtime/define-scene.js";
import type { SystemHandle } from "../scene/runtime/system-handle.js";
import type { GwenHotReport } from "./types.js";

const emptyRegistry: SceneRegistry = {
  register() {},
};

interface SystemSlot {
  readonly plugin: GwenPlugin;
  readonly factory: SceneSystemFactory;
  readonly handle: SystemHandle;
}

interface ActorSlot {
  readonly plugin: GwenPlugin;
  readonly definition: ActorDefinition<unknown, unknown>;
}

function applied(name: string, count: number): GwenHotReport {
  return { status: "applied", kind: "scene", name, count };
}

function reload(
  name: string,
  reason: "engine-not-running" | "scene-set-changed" | "plugin-in-use",
  detail?: string,
): GwenHotReport {
  if (detail === undefined) return { status: "reload", kind: "scene", name, reason };
  return { status: "reload", kind: "scene", name, reason, detail };
}

function isPluginInUse(error: unknown): error is GwenPluginDependencyError {
  return error instanceof GwenPluginDependencyError && error.code === CoreErrorCodes.PLUGIN_IN_USE;
}

function systemSlots(def: SceneDefinition): SystemSlot[] {
  const slots: SystemSlot[] = [];
  let handleAt = 0;
  for (const plugin of def.systems) {
    const factory = factoryOf(plugin);
    if (factory === undefined) continue;
    const handle = def.handles[handleAt];
    handleAt += 1;
    if (handle === undefined) continue;
    slots.push({ plugin, factory, handle });
  }
  return slots;
}

function actorSlots(def: SceneDefinition): ActorSlot[] {
  const slots: ActorSlot[] = [];
  for (const plugin of def.systems) {
    const definition = actorOwnerOf(plugin);
    if (definition === undefined) continue;
    slots.push({ plugin, definition });
  }
  return slots;
}

/** Drop the scope a throwing factory left on `next`, never the one `prev` still uses. */
function dropPartialScope(next: SceneFactory, prev: SceneFactory): void {
  const partial = sceneRecordOf(next)?.scope;
  const kept = sceneRecordOf(prev)?.scope;
  if (partial === undefined || partial === kept) return;
  partial.dispose();
  const record = sceneRecordOf(next);
  if (record !== undefined && record.scope === partial) delete record.scope;
}

/** Dispose the scope `prev` held, once. The scope `next` just opened stays. */
function retireScope(prev: SceneFactory, next: SceneFactory): void {
  const from = sceneRecordOf(prev);
  if (from === undefined) return;
  const oldScope = from.scope;
  if (oldScope === undefined || oldScope === sceneRecordOf(next)?.scope) return;
  oldScope.dispose();
  delete from.scope;
}

function moveEngine(prev: SceneFactory, next: SceneFactory, engine: GwenEngine): void {
  sceneRecordOf(prev)?.engines.delete(engine);
  const to = sceneRecordOf(next);
  if (to === undefined || to.engines.has(engine)) return;
  to.engines.add(engine);
}

function emitSetupFailure(engine: GwenEngine, name: string, error: unknown): void {
  const detail = error instanceof Error ? error.message : String(error);
  engine.errors.emit({
    level: "error",
    code: CoreErrorCodes.PLUGIN_RUNTIME_ERROR,
    message: `[${name}] setup threw: ${detail}`,
    source: name,
    error,
    context: { phase: "setup" },
  });
}

/**
 * The collect pass already subscribed `plugin`. Tear that copy down when the installed
 * plugin is the one that stays.
 */
function dropUnused(plugin: GwenPlugin): void {
  plugin.teardown?.();
}

/**
 * Diff systems and actors of one engine.
 * @returns the handles to bind, or a reload report when `unuse` is rejected.
 */
async function diffScene(
  engine: GwenEngine,
  prevDef: SceneDefinition,
  nextDef: SceneDefinition,
  active: boolean,
  name: string,
): Promise<
  | { readonly ok: true; readonly handles: readonly SystemHandle[] }
  | { readonly ok: false; readonly report: GwenHotReport }
> {
  const previous = new Map<string, SystemSlot>();
  for (const slot of systemSlots(prevDef)) previous.set(slot.plugin.name, slot);
  const nextSystems = systemSlots(nextDef);
  const nextNames = new Set(nextSystems.map((slot) => slot.plugin.name));
  const handles: SystemHandle[] = [];

  for (const slot of previous.values()) {
    if (nextNames.has(slot.plugin.name)) continue;
    slot.handle.destroy();
    handles.push(slot.handle);
    try {
      await engine.unuse(slot.plugin.name);
    } catch (error: unknown) {
      if (isPluginInUse(error))
        return { ok: false, report: reload(name, "plugin-in-use", slot.plugin.name) };
      throw error;
    }
  }

  for (const slot of nextSystems) {
    const prevSlot = previous.get(slot.plugin.name);
    if (prevSlot === undefined) {
      await engine.use(slot.plugin);
      if (!active) slot.handle._scenePause();
      handles.push(slot.handle);
      continue;
    }
    dropUnused(slot.plugin);
    if (prevSlot.factory === slot.factory) {
      handles.push(prevSlot.handle);
      continue;
    }
    await hotReplaceSystem(prevSlot.factory, slot.factory);
    handles.push(prevSlot.handle);
  }

  const previousActors = new Map<string, ActorDefinition<unknown, unknown>>();
  for (const slot of actorSlots(prevDef)) previousActors.set(slot.plugin.name, slot.definition);
  for (const slot of actorSlots(nextDef)) {
    const prevActor = previousActors.get(slot.plugin.name);
    if (prevActor === undefined) {
      await engine.use(slot.plugin);
      continue;
    }
    if (prevActor !== slot.definition) await hotReplaceActor(prevActor, slot.definition);
  }

  const linked = new Set<string>();
  for (const slot of nextSystems) linked.add(slot.plugin.name);
  for (const slot of actorSlots(nextDef)) linked.add(slot.plugin.name);
  const prevPluginNames = new Set(prevDef.systems.map((plugin) => plugin.name));
  for (const plugin of nextDef.systems) {
    if (linked.has(plugin.name) || prevPluginNames.has(plugin.name)) continue;
    await engine.use(plugin);
  }

  return { ok: true, handles };
}

/**
 * Replace `prev` with `next` on every engine that installed `prev`.
 *
 * The active scene is not re-entered. Its entities stay. Hooks and the scene scope are
 * replaced, systems are diffed by name, and an inline actor with an installed name is
 * swapped through `hotReplaceActor`. `count` is the number of engines swapped.
 *
 * A renamed scene reloads with `scene-set-changed`. A throwing `next` keeps `prev`
 * and emits `CORE:PLUGIN_RUNTIME_ERROR`. A scene nothing installed, and a production
 * build, apply with count 0.
 *
 * @param prev - The factory `defineScene` returned before the edit.
 * @param next - The factory `defineScene` returned after the edit.
 * @returns `applied` with the number of engines now running `next`, or `reload`.
 * @internal
 */
export async function hotReplaceScene(
  prev: SceneFactory,
  next: SceneFactory,
): Promise<GwenHotReport> {
  const name = prev.sceneName;
  if (next.sceneName !== name) return reload(name, "scene-set-changed", next.sceneName);
  const record = sceneRecordOf(prev);
  if (record === undefined || record.engines.size === 0) return applied(name, 0);
  const engines = Array.from(record.engines);
  if (!engines.every(isLive)) return reload(name, "engine-not-running");

  const prevDef = prev(emptyRegistry);
  let count = 0;
  let retiredScope = false;
  for (const engine of engines) {
    // A stop can land while the frame ends.
    if (!(await settle(engine))) return reload(name, "engine-not-running");
    let nextDef: SceneDefinition;
    try {
      nextDef = engine.run(() => next(emptyRegistry));
    } catch (error: unknown) {
      dropPartialScope(next, prev);
      emitSetupFailure(engine, name, error);
      continue;
    }
    const registry = engine.tryInject("scene:hook-registry");
    const active = registry !== undefined && sceneIsEntered(registry, name);
    if (registry !== undefined) registry.unhookScene(name);
    if (!retiredScope) {
      retireScope(prev, next);
      retiredScope = true;
    }
    if (registry !== undefined) registry.hookScene(engine, nextDef);
    const diff = await diffScene(engine, prevDef, nextDef, active, name);
    if (!diff.ok) return diff.report;
    registerSceneHandles(engine, name, [...diff.handles]);
    moveEngine(prev, next, engine);
    count += 1;
  }
  return applied(name, count);
}
