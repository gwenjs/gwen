import { createEngineLocal, popEngine, pushEngine } from "../engine/engine-local.js";
import type { GwenEngine } from "../engine/engine-types.js";
import type { SystemHandle } from "../scene/runtime/system-handle.js";
import { devNoteScenePresence } from "../scene/engine-plugin.js";

/** Scene name to the handles of its systems, one map per engine. */
export const sceneHandles = createEngineLocal<Map<string, SystemHandle[]>>(() => new Map());

/**
 * Record the handles of a scene and bind its pause/resume pair.
 *
 * The scene factory must have run first, so the registry already has a bucket for
 * `name`. The pair is registered after that scene's own hooks: resume runs after
 * `onEnter`, pause after `onExit`. `unhookScene` removes both.
 */
export function registerSceneHandles(
  engine: GwenEngine,
  name: string,
  handles: SystemHandle[],
): void {
  sceneHandles.get(engine).set(name, handles);
  const registry = engine.tryInject("scene:hook-registry");
  if (registry === undefined) return;

  const resume = async (sceneName: string): Promise<void> => {
    if (sceneName !== name) return;
    if (__GWEN_DEV__) devNoteScenePresence(registry, name, true);
    const previous = pushEngine(engine);
    try {
      const list = sceneHandles.get(engine).get(name);
      if (list === undefined) return;
      for (const handle of list) handle._sceneResume();
    } finally {
      popEngine(engine, previous);
    }
  };
  const pause = async (sceneName: string): Promise<void> => {
    if (sceneName !== name) return;
    if (__GWEN_DEV__) devNoteScenePresence(registry, name, false);
    const previous = pushEngine(engine);
    try {
      const list = sceneHandles.get(engine).get(name);
      if (list === undefined) return;
      for (const handle of list) handle._scenePause();
    } finally {
      popEngine(engine, previous);
    }
  };

  engine.hooks.hook("scene:enter", resume);
  engine.hooks.hook("scene:beforeLeave", pause);
  registry.addSceneCleanup(name, () => {
    engine.hooks.removeHook("scene:enter", resume);
  });
  registry.addSceneCleanup(name, () => {
    engine.hooks.removeHook("scene:beforeLeave", pause);
  });
}
