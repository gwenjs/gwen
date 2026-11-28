/**
 * @file Dev record of a scene factory and the back-links a scene swap needs.
 *
 * `defineScene` writes the record under `__GWEN_DEV__`. A production build never
 * calls these helpers, so it keeps neither the symbol nor the set.
 *
 * @module
 */

import { createDisposable } from "../disposable.js";
import type { ActorDefinition } from "../actor/runtime/types.js";
import { readMember } from "../scene/runtime/read-member.js";
import type { GwenScope } from "../context/scope.js";
import type { GwenEngine, GwenPlugin } from "../engine/engine-types.js";
import type { SceneFactory } from "../scene/runtime/define-scene.js";
import type { DiscoverablePlugin } from "../system/runtime/define-system.js";

/** Key of the {@link SceneRecord} on a `defineScene` factory. */
export const HOT_SCENE: unique symbol = Symbol("gwen.hot.scene");

/** Key of the `defineSystem` factory on the plugin it produced and on the scene wrapper. */
export const HOT_FACTORY: unique symbol = Symbol("gwen.hot.factory");

/** Key of the actor definition on the plugin `defineActor` produced. */
export const HOT_ACTOR_OWNER: unique symbol = Symbol("gwen.hot.actor-owner");

/** Engines that ran a scene factory, and the scope of that run. */
export interface SceneRecord {
  readonly engines: Set<GwenEngine>;
  scope?: GwenScope;
}

/** A `defineSystem` factory, as a scene diff stores it. */
export type SceneSystemFactory = (...args: unknown[]) => DiscoverablePlugin;

/** A scene factory in a dev build. */
export interface HotSceneFactory extends SceneFactory {
  readonly [HOT_SCENE]: SceneRecord;
}

function isSceneRecord(value: unknown): value is SceneRecord {
  if (typeof value !== "object" || value === null) return false;
  return Reflect.get(value, "engines") instanceof Set;
}

function isSceneSystemFactory(value: unknown): value is SceneSystemFactory {
  return typeof value === "function";
}

function isActorDefinition(value: unknown): value is ActorDefinition<unknown, unknown> {
  if (typeof value !== "object" || value === null) return false;
  if (!("__actorName__" in value) || !("plugin" in value)) return false;
  const name: unknown = Reflect.get(value, "__actorName__");
  return typeof name === "string";
}

/**
 * Installs of a scene factory. Undefined when `defineScene` did not write one.
 * `factory` is the function object. `sceneName` is attached after that function is created.
 */
export function sceneRecordOf(factory: object): SceneRecord | undefined {
  const value = readMember(factory, HOT_SCENE);
  return isSceneRecord(value) ? value : undefined;
}

/** Record of `factory`, creating it the first time. */
export function ensureSceneRecord(factory: object): SceneRecord {
  const existing = sceneRecordOf(factory);
  if (existing !== undefined) return existing;
  const record: SceneRecord = { engines: new Set() };
  Object.defineProperty(factory, HOT_SCENE, { value: record });
  return record;
}

/** Remember the scope `_withSceneContext` opened for `factory`. */
export function rememberSceneScope(factory: object, scope: GwenScope): void {
  ensureSceneRecord(factory).scope = scope;
}

/**
 * Remember that `engine` ran `factory`. One disposable drops the engine at `stop()`.
 * A second call for the same engine does not add another disposable.
 */
export function rememberSceneEngine(factory: object, engine: GwenEngine): void {
  const record = ensureSceneRecord(factory);
  if (record.engines.has(engine) || engine.disposables.closed) return;
  record.engines.add(engine);
  engine.disposables.add(
    "hot-scene",
    createDisposable(() => {
      record.engines.delete(engine);
    }),
  );
}

/** Factory a `defineSystem` plugin was built from. Undefined for any other plugin. */
export function factoryOf(plugin: GwenPlugin): SceneSystemFactory | undefined {
  const value = readMember(plugin, HOT_FACTORY);
  return isSceneSystemFactory(value) ? value : undefined;
}

/** Actor definition that owns `plugin`. Undefined for a system or a dependency. */
export function actorOwnerOf(plugin: GwenPlugin): ActorDefinition<unknown, unknown> | undefined {
  const value = readMember(plugin, HOT_ACTOR_OWNER);
  return isActorDefinition(value) ? value : undefined;
}
