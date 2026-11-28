import { createEngineLocal } from "../engine/engine-local.js";
import type { GwenEngine } from "../engine/engine-types.js";
import type { SystemHandle } from "../scene/runtime/system-handle.js";
import { devNoteScenePresence } from "../scene/engine-plugin.js";

/** Scene name to the handles of its systems, one map per engine. Dev swaps read it. */
export const sceneHandles = createEngineLocal<Map<string, SystemHandle[]>>(() => new Map());

/**
 * Record the handles of a scene and bind its pause/resume pair.
 *
 * The scene factory must have run first, so the registry already has a bucket for
 * `name`. The pair is registered after that scene's own hooks: resume runs after
 * `onEnter`, pause after `onExit`. `unhookScene` removes both.
 * In production the handlers close over `handles`. The map is filled only in dev.
 */
export function registerSceneHandles(
  engine: GwenEngine,
  name: string,
  handles: SystemHandle[],
): void {
  if (__GWEN_DEV__) sceneHandles.get(engine).set(name, handles);
  const registry = engine.tryInject("scene:hook-registry");
  if (registry === undefined) return;
  const current = (): SystemHandle[] =>
    __GWEN_DEV__ ? (sceneHandles.get(engine).get(name) ?? handles) : handles;
  const resume = (sceneName: string): void => {
    if (sceneName !== name) return;
    if (__GWEN_DEV__) devNoteScenePresence(registry, name, true);
    for (const handle of current()) handle._sceneResume();
  };
  const pause = (sceneName: string): void => {
    if (sceneName !== name) return;
    if (__GWEN_DEV__) devNoteScenePresence(registry, name, false);
    for (const handle of current()) handle._scenePause();
  };
  engine.hooks.hook("scene:enter", resume);
  engine.hooks.hook("scene:beforeLeave", pause);
  registry.addSceneCleanup(name, () => {
    engine.hooks.removeHook("scene:enter", resume);
    engine.hooks.removeHook("scene:beforeLeave", pause);
  });
}
