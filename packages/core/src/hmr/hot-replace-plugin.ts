/**
 * @file Swap one local plugin in place on one engine. Dev only.
 *
 * Waits for the frame in flight. Saves `hot` state, retires the system and actor readers
 * of the plugin's services, tears the previous plugin down, then installs the next one.
 * Restores that state before those readers are built again. The report is named `prevName`.
 * `reload` with `plugin-in-use` removes nothing: another plugin still requires this one,
 * or a scene or another plugin read one of its services (`<type> <name> reads <key>`).
 * An applied swap sets `detail` to `hot state not restored` when save or restore threw.
 *
 * @module
 */

import { CoreErrorCodes, GwenPluginDependencyError } from "../engine/engine-errors.js";
import type { GwenEngine, GwenPlugin } from "../engine/engine-types.js";
import { isLive, settle } from "./frame.js";
import { pluginHostOf } from "./plugin-host.js";
import { markSwap } from "./plugin-swap.js";
import { retireReaders, unsupportedReaders } from "./readers.js";
import type { GwenHotReport } from "./types.js";

function applied(name: string, count: number, detail?: string): GwenHotReport {
  if (detail === undefined) return { status: "applied", kind: "plugin", name, count };
  return { status: "applied", kind: "plugin", name, count, detail };
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
 * Any other rejection of `use` publishes nothing: this emits one runtime error for it.
 */
function reportRejectedSetup(engine: GwenEngine, name: string, error: unknown): void {
  const detail = error instanceof Error ? error.message : String(error);
  engine.errors.emit({
    level: "error",
    code: CoreErrorCodes.PLUGIN_RUNTIME_ERROR,
    message: `[${name}] install rejected: ${detail}`,
    source: name,
    error,
    context: { phase: "setup" },
  });
}

/** A throwing `hot.save` or `hot.restore`: one runtime error naming the plugin, the swap goes on. */
function reportHotFailure(
  engine: GwenEngine,
  name: string,
  half: "save" | "restore",
  error: unknown,
): void {
  const detail = error instanceof Error ? error.message : String(error);
  engine.errors.emit({
    level: "error",
    code: CoreErrorCodes.PLUGIN_RUNTIME_ERROR,
    message: `[${name}] hot.${half} threw: ${detail}`,
    source: name,
    error,
    target: { kind: "plugin", id: name, name },
    context: { phase: half === "save" ? "teardown" : "setup" },
  });
}

/**
 * Tear `prevName` down, then install `next` last on `engine`.
 *
 * `hot.save` runs before the teardown. `hot.restore` runs after the new plugin is installed
 * and before its system and actor readers are built again. A throwing cleanup while retiring
 * a reader is reported on that reader; the swap still applies and the readers already retired
 * are built again. `count` is 1 when this call installs `next`, including when `prevName` was
 * absent. A failed `use(next)` reports `applied` with `count` 0. When `next.name` is already
 * installed after the teardown, that plugin is left as it is, nothing is emitted, and `count`
 * is 0. `prevName` is still removed when it was installed. `detail` on an applied report is
 * `hot state not restored` when save or restore threw.
 * @returns The swap report. `name` is `prevName`.
 */
export async function hotReplacePlugin(
  engine: GwenEngine,
  prevName: string,
  next: GwenPlugin,
): Promise<GwenHotReport> {
  if (!isLive(engine)) return reload(prevName, "engine-not-running");
  if (!(await settle(engine))) return reload(prevName, "engine-not-running");
  const host = pluginHostOf(engine);
  const prev = host?.named(prevName);
  const blockers = prev === undefined ? [] : (host?.dependents(prevName) ?? []);
  if (blockers.length > 0) return reload(prevName, "plugin-in-use", blockers.join(", "));
  const ownedKeys = host?.ownedKeys(prevName) ?? [];
  const stuck = unsupportedReaders(engine, ownedKeys, prevName);
  if (stuck.length > 0) return reload(prevName, "plugin-in-use", stuck.join(", "));
  const done = markSwap(engine, [prevName, next.name]);
  let setupReported = false;
  const stopWatch = engine.errors.on((event) => {
    if (event.code === CoreErrorCodes.PLUGIN_SETUP_ERROR) setupReported = true;
  });
  let hotLost = false;
  let saved: { readonly state: unknown } | undefined;
  let installedNext = false;
  let readers: ReturnType<typeof retireReaders> = { rebuild: () => 0 };
  // The plugin list decides `unuse`. The host is absent in a production build.
  const installed = engine.getStats().plugins.includes(prevName);
  try {
    if (prev?.hot !== undefined) {
      try {
        saved = { state: prev.hot.save() };
      } catch (error: unknown) {
        reportHotFailure(engine, prevName, "save", error);
        hotLost = true;
      }
    }
    readers = retireReaders(engine, ownedKeys);
    const outcome = await swap(engine, prevName, next, installed, () => setupReported);
    if (outcome.status === "reload") return outcome;
    installedNext = outcome.count === 1;
    // The state goes back before the readers are built again: they must see it.
    if (installedNext && saved !== undefined && next.hot !== undefined) {
      try {
        next.hot.restore(saved.state);
      } catch (error: unknown) {
        reportHotFailure(engine, next.name, "restore", error);
        hotLost = true;
      }
    }
  } finally {
    stopWatch();
    done();
    if (isLive(engine)) readers.rebuild();
  }
  return applied(prevName, installedNext ? 1 : 0, hotLost ? "hot state not restored" : undefined);
}

/** `unuse` then `use`, as the plugin swap before hot state. */
async function swap(
  engine: GwenEngine,
  prevName: string,
  next: GwenPlugin,
  installed: boolean,
  setupReported: () => boolean,
): Promise<GwenHotReport> {
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
  if (!isLive(engine)) return reload(prevName, "engine-not-running");
  if (engine.getStats().plugins.includes(next.name)) return applied(prevName, 0);
  try {
    await engine.use(next);
  } catch (error: unknown) {
    if (!setupReported()) reportRejectedSetup(engine, next.name, error);
    return applied(prevName, 0);
  }
  return applied(prevName, 1);
}
