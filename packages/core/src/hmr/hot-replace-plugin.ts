/**
 * @file Swap one local plugin in place on one engine. Dev only.
 *
 * Waits for the frame in flight, tears the previous plugin down, then installs
 * the next one last. The report is named `prevName`. A plugin that another
 * plugin still requires reports `reload` with `plugin-in-use` and removes nothing.
 *
 * @module
 */

import { CoreErrorCodes, GwenPluginDependencyError } from "../engine/engine-errors.js";
import type { GwenEngine, GwenPlugin } from "../engine/engine-types.js";
import { isLive, settle } from "./frame.js";
import { markSwap } from "./plugin-swap.js";
import type { GwenHotReport } from "./types.js";

function applied(name: string, count: number): GwenHotReport {
  return { status: "applied", kind: "plugin", name, count };
}

function reload(
  name: string,
  reason: "engine-not-running" | "plugin-in-use",
  detail?: string,
): GwenHotReport {
  if (detail === undefined) return { status: "reload", kind: "plugin", name, reason };
  return { status: "reload", kind: "plugin", name, reason, detail };
}

function isPluginInUse(error: unknown): error is GwenPluginDependencyError {
  return error instanceof GwenPluginDependencyError && error.code === CoreErrorCodes.PLUGIN_IN_USE;
}

/**
 * A throwing `setup` already published `CORE:PLUGIN_SETUP_ERROR` (`reportSetupError`).
 * A rejection before `setup` publishes nothing: this emits one runtime error for it.
 */
function reportRejectedSetup(engine: GwenEngine, name: string, error: unknown): void {
  const detail = error instanceof Error ? error.message : String(error);
  engine.errors.emit({
    level: "error",
    code: CoreErrorCodes.PLUGIN_RUNTIME_ERROR,
    message: `[${name}] rejected before setup: ${detail}`,
    source: name,
    error,
    context: { phase: "setup" },
  });
}

/**
 * Tear `prevName` down, then install `next` last on `engine`.
 *
 * `count` is 1 when `next` is installed, including when `prevName` was absent.
 * A failed `use(next)` after a successful `unuse` reports `applied` with `count` 0.
 * @returns The swap report. `name` is `prevName`.
 */
export async function hotReplacePlugin(
  engine: GwenEngine,
  prevName: string,
  next: GwenPlugin,
): Promise<GwenHotReport> {
  if (!isLive(engine)) return reload(prevName, "engine-not-running");
  const installed = engine.getStats().plugins.includes(prevName);
  if (!(await settle(engine))) return reload(prevName, "engine-not-running");
  const done = markSwap(engine, prevName);
  let setupReported = false;
  const stopWatch = engine.errors.on((event) => {
    if (event.code === CoreErrorCodes.PLUGIN_SETUP_ERROR) setupReported = true;
  });
  try {
    if (installed) {
      try {
        await engine.unuse(prevName);
      } catch (error: unknown) {
        if (isPluginInUse(error)) {
          return reload(prevName, "plugin-in-use", error.dependents.join(", "));
        }
        throw error;
      }
    }
    try {
      await engine.use(next);
    } catch (error: unknown) {
      if (!setupReported) reportRejectedSetup(engine, next.name, error);
      return applied(prevName, 0);
    }
  } finally {
    stopWatch();
    done();
  }
  return applied(prevName, 1);
}
