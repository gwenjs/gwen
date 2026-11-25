import { CoreErrorCodes } from "../engine/engine-errors.js";
import { readInFrame, whenFrameIdle } from "../engine/engine-internals.js";
import type { GwenEngine } from "../engine/engine-types.js";
import { isolateTarget } from "../engine/error-isolation.js";
import type { DiscoverablePlugin } from "../system/runtime/define-system";
import { controlOf, recordOf, type SystemInstall } from "./installs.js";
import type { GwenHotReport } from "./types.js";

function applied(name: string, count: number): GwenHotReport {
  return { status: "applied", kind: "system", name, count };
}

function isLive(engine: GwenEngine): boolean {
  return engine.state === "idle" || engine.state === "running";
}

/** Resolves when the frame in flight has ended, or when the engine changes state (a stop). */
function frameEnd(engine: GwenEngine): Promise<void> {
  return new Promise((resolve) => {
    const done = (): void => {
      off();
      resolve();
    };
    const off = engine.hooks.hook("engine:state-change", done);
    void whenFrameIdle(engine).then(done);
  });
}

/**
 * Run `next`'s body in place of the old body of one install.
 * @returns true when the new setup ran to the end.
 */
function swapInstall<Args extends unknown[]>(
  install: SystemInstall<Args>,
  next: (...args: Args) => DiscoverablePlugin,
  name: string,
): boolean {
  const replacement = next(...install.args);
  const control = controlOf(replacement);
  if (control === undefined) return false;
  const retired = install.control.retire();
  const { engine } = install;
  const result = engine.run(() => control.rebuild(retired, install.root));
  install.root.redirect(replacement);
  if (result.ok) return true;
  // The scope is already disposed: isolating now keeps the entry for `engine.isolated()`.
  isolateTarget(engine, result.target);
  const detail = result.error instanceof Error ? result.error.message : String(result.error);
  engine.errors.emit({
    level: "error",
    code: CoreErrorCodes.PLUGIN_RUNTIME_ERROR,
    message: `[${name}] setup threw: ${detail}`,
    source: name,
    error: result.error,
    target: result.target,
    context: { phase: "setup" },
  });
  return false;
}

/**
 * Replace the body of a system on every engine that installed it, in place.
 *
 * The new body takes the old install's place: its handlers keep their position inside every
 * phase the old body used, the pause flags carry over, and the old isolation entry is dropped.
 * A phase the old body did not use runs last. Closure state is not kept. Entities are untouched.
 * A swap asked during a frame applies after that frame.
 *
 * A body whose setup throws stays isolated, emits `CORE:PLUGIN_RUNTIME_ERROR` and is not counted.
 * Another definition name, a definition nothing installed and a production build apply with
 * count 0.
 *
 * @param prev - The factory `defineSystem` returned before the edit.
 * @param next - The factory `defineSystem` returned after the edit, with the same name.
 * @returns `applied` with the number of installs now running `next`, or `reload` when an engine
 *   is not `idle` or `running`.
 * @internal
 */
export async function hotReplaceSystem<Args extends unknown[]>(
  prev: (...args: Args) => DiscoverablePlugin,
  next: (...args: Args) => DiscoverablePlugin,
): Promise<GwenHotReport> {
  const name = prev.name;
  const record = recordOf(prev);
  if (record === undefined || record.installs.size === 0) return applied(name, 0);
  if (recordOf(next) === undefined || next.name !== name) return applied(name, 0);

  const engines: GwenEngine[] = [];
  for (const install of record.installs) {
    if (!engines.includes(install.engine)) engines.push(install.engine);
  }
  const reload = (): GwenHotReport => ({
    status: "reload",
    kind: "system",
    name,
    reason: "engine-not-running",
  });
  if (!engines.every(isLive)) return reload();

  let count = 0;
  for (const engine of engines) {
    // A display frame is every step and its render pass, so wait until none is in flight.
    while (readInFrame(engine) && isLive(engine)) await frameEnd(engine);
    // A stop can land while the frame ends.
    if (!isLive(engine)) return reload();
    for (const install of Array.from(record.installs)) {
      if (install.engine === engine && swapInstall(install, next, name)) count++;
    }
  }
  return applied(name, count);
}
