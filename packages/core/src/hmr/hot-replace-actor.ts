import type { ActorDefinition } from "../actor/runtime/types.js";
import { CoreErrorCodes } from "../engine/engine-errors.js";
import { isolateTarget } from "../engine/error-isolation.js";
import { isLive, settle } from "./frame.js";
import { actorControlOf, type HotActorControl } from "./actor-installs.js";
import type { GwenHotReport } from "./types.js";

function applied(name: string, count: number): GwenHotReport {
  return { status: "applied", kind: "actor", name, count };
}

/**
 * Make `next` share the plugin the engines hold: `next` and `prev` spawn, list and despawn
 * through it, and it runs `next`'s factory and prefab from now on.
 */
function adopt<Props, PublicAPI>(
  root: HotActorControl<Props, PublicAPI>,
  to: HotActorControl<Props, PublicAPI>,
): void {
  root.retarget(to.body());
  if (to === root) return;
  to.root = root;
  to.rehome(root);
  const installed = root.definition;
  for (const definition of [root.definition, to.definition]) {
    Object.defineProperty(definition, "_prefab", {
      configurable: true,
      get: () => root.body().prefab,
    });
  }
  Object.defineProperty(to.definition, "plugin", { configurable: true, value: installed.plugin });
  Object.defineProperty(to.definition, "_plugin", { configurable: true, value: installed._plugin });
  Object.defineProperty(to.definition, "_instances", {
    configurable: true,
    value: installed._instances,
  });
}

/**
 * Respawn every live instance of an actor with a new factory, in place.
 *
 * Each instance keeps its entity id and its component values. In spawn order it despawns the
 * children it owns, runs the old `onDestroy` callbacks, drops its scope, adds the prefab
 * components the entity lacks (never removes or overwrites one), runs `next`'s factory with the
 * props the instance was spawned or last acquired with, then the new `onStart` callbacks. A
 * dormant pooled instance is rebuilt paused: no `onStart`, no `onReset`, and its dormancy flag
 * stays as it was. Afterwards `prev` and `next` both use the plugin the engines hold, so `spawn`,
 * `useActor` and `spawnOnce` on either one build `next`'s actors. Closure state is not kept.
 * A swap asked during a frame applies after that frame.
 *
 * A factory or onStart that throws leaves that instance isolated and without handlers, emits
 * `CORE:PLUGIN_RUNTIME_ERROR` with its target and is not counted; the others continue. Another
 * actor name, an actor nothing installed and a production build apply with count 0.
 *
 * @param prev - The definition `defineActor` returned before the edit.
 * @param next - The definition `defineActor` returned after the edit, with the same name.
 * @returns `applied` with the number of instances now running `next`, or `reload` when an engine
 *   is not `idle` or `running`.
 * @internal
 */
export async function hotReplaceActor<Props, PublicAPI>(
  prev: ActorDefinition<Props, PublicAPI>,
  next: ActorDefinition<Props, PublicAPI>,
): Promise<GwenHotReport> {
  const name = prev.__actorName__;
  const from = actorControlOf(prev);
  const to = actorControlOf(next);
  if (from === undefined || to === undefined || next.__actorName__ !== name) {
    return applied(name, 0);
  }
  const root = from.root ?? from;
  const engines = root.engines();
  if (engines.length === 0) return applied(name, 0);
  const reload = (): GwenHotReport => ({
    status: "reload",
    kind: "actor",
    name,
    reason: "engine-not-running",
  });
  if (!engines.every(isLive)) return reload();

  let count = 0;
  for (const engine of engines) {
    // A stop can land while the frame ends.
    if (!(await settle(engine))) return reload();
    adopt(root, to);
    for (const id of root.ids(engine)) {
      const result = root.respawn(engine, id);
      if (result.ok) {
        count++;
        continue;
      }
      isolateTarget(engine, result.target);
      const detail = result.error instanceof Error ? result.error.message : String(result.error);
      engine.errors.emit({
        level: "error",
        code: CoreErrorCodes.PLUGIN_RUNTIME_ERROR,
        message: `[${name}] factory or onStart threw: ${detail}`,
        source: name,
        error: result.error,
        target: result.target,
        context: { phase: "setup" },
      });
    }
  }
  // A `useActor` handle cached the methods of the old public API: it reads the new one now.
  for (const control of new Set([from, to, root])) control.notify();
  return applied(name, count);
}
