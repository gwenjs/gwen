/**
 * @file Run one scene preload and publish its aggregate progress.
 */

import type { GwenSceneName, ScenePreloadEvent } from "@gwenjs/schema";
import type { GwenEngine } from "../engine/engine-types.js";
import { reportRejectedHook } from "../hooks/report-rejected-hook.js";
import { GwenScenePreloadError } from "./scene-preload-error.js";

/**
 * Run every `scene:preload` handler for `to` and publish aggregate progress.
 *
 * Handlers start together and are awaited together.
 * The published value is the aggregate whenever it rises and stays below `1`.
 * `1` is published once every handler has resolved (never on failure).
 * Each task's `loaded` is clamped into `[0, total]`.
 * A report with a non-finite `loaded` or `total`, or with `total <= 0`, is ignored.
 * Reports after the preload has settled are ignored.
 * `1` is published only on success.
 * The first rejection rejects with {@link GwenScenePreloadError} and publishes no `1`.
 * That error is not emitted on `engine.errors`.
 * A listener that throws on `scene:preload:progress` is reported and does not abort the preload.
 *
 * @param engine - Engine whose hooks receive the preload.
 * @param from - Scene being left, or `null` when the first scene is activated.
 * @param to - Scene being preloaded.
 */
export async function runScenePreload(
  engine: GwenEngine,
  from: GwenSceneName | null,
  to: GwenSceneName,
): Promise<void> {
  const tasks = new Map<string, { loaded: number; total: number }>();
  let settled = false;
  let last = 0;

  const publish = (progress: number): void => {
    reportRejectedHook(
      engine,
      `scene:${to}`,
      "scene:preload:progress",
      engine.hooks.callHook("scene:preload:progress", { from, to, progress }),
    );
  };

  const event: ScenePreloadEvent = {
    from,
    to,
    progress(task, loaded, total) {
      if (settled || !Number.isFinite(total) || total <= 0 || !Number.isFinite(loaded)) return;
      tasks.set(task, { loaded: Math.min(Math.max(loaded, 0), total), total });
      let loadedSum = 0;
      let totalSum = 0;
      for (const entry of tasks.values()) {
        loadedSum += entry.loaded;
        totalSum += entry.total;
      }
      const aggregate = loadedSum / totalSum;
      if (aggregate > last && aggregate < 1) {
        last = aggregate;
        publish(aggregate);
      }
    },
  };

  publish(0);
  try {
    await engine.hooks.callHookParallel("scene:preload", event);
  } catch (cause) {
    settled = true;
    throw new GwenScenePreloadError({ scene: to, from, cause });
  }
  settled = true;
  publish(1);
}
