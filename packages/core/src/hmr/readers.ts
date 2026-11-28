/**
 * @file Retire the readers of a swapped plugin's services and set them up again. Dev only.
 *
 * @module
 */

import type { GwenErrorTarget } from "@gwenjs/schema";
import { actorTablesFor } from "../actor/runtime/define-actor.js";
import { CoreErrorCodes } from "../engine/engine-errors.js";
import type { GwenEngine } from "../engine/engine-types.js";
import { isolateTarget } from "../engine/error-isolation.js";
import { actorControlOf } from "./actor-installs.js";
import { reportRespawnFailure } from "./hot-replace-actor.js";
import { rebuildInstall } from "./hot-replace-system.js";
import { systemInstalls } from "./installs.js";
import { actorOwnerOf } from "./scene-installs.js";
import { readersOf, type ServiceReader } from "./service-readers.js";

/** Readers whose bodies are retired and wait for the new service. */
export interface RetiredReaders {
  /** Run every retired body again, by key, then in first-read order. Returns how many ran to the end. */
  rebuild(): number;
}

/** Retire the live actor with this entity id. The returned function builds it again. */
function retireActor(
  engine: GwenEngine,
  entityId: bigint | undefined,
): (() => boolean) | undefined {
  if (entityId === undefined) return undefined;
  const tables = actorTablesFor(engine);
  for (const [id, plugin] of tables.actors) {
    if (id !== entityId) continue;
    const definition = actorOwnerOf(plugin);
    const control = definition === undefined ? undefined : actorControlOf(definition);
    if (definition === undefined || control === undefined) return undefined;
    const again = (control.root ?? control).retire(engine, id);
    return () => {
      const result = again();
      if (!result.ok) reportRespawnFailure(engine, definition.__actorName__, result);
      return result.ok;
    };
  }
  return undefined;
}

/**
 * Readers of `keys` that cannot be set up again in place: a scene factory, or the setup of
 * another plugin. Each entry reads `<type> <name> reads <key>`. The plugin `self` is left out.
 */
export function unsupportedReaders(
  engine: GwenEngine,
  keys: readonly string[],
  self: string,
): string[] {
  const found: string[] = [];
  for (const key of keys) {
    for (const reader of readersOf(engine, [key])) {
      if (reader.type === "system" || reader.type === "actor") continue;
      if (reader.type === "plugin" && reader.id === self) continue;
      found.push(`${reader.type} ${reader.name} reads ${key}`);
    }
  }
  return found;
}

/** One reader's cleanup threw. Isolate that reader and keep retiring the others. */
function reportRetiredReader(engine: GwenEngine, reader: ServiceReader, error: unknown): void {
  if (reader.type !== "system" && reader.type !== "actor") return;
  const detail = error instanceof Error ? error.message : String(error);
  const target: GwenErrorTarget = { kind: reader.type, id: reader.id, name: reader.name };
  if (reader.entityId !== undefined) target.entityId = reader.entityId;
  isolateTarget(engine, target);
  engine.errors.emit({
    level: "error",
    code: CoreErrorCodes.PLUGIN_RUNTIME_ERROR,
    message: `[${reader.name}] cleanup threw: ${detail}`,
    source: reader.name,
    error,
    target,
    context: { phase: "teardown" },
  });
}

/**
 * Retire the system and actor readers of any of `keys`: their handlers leave the bus, in place.
 * A throwing cleanup is isolated and reported. The readers already retired are still rebuilt.
 * @param engine - The engine that swaps the provider.
 * @param keys - The service keys the old provider owned.
 */
export function retireReaders(engine: GwenEngine, keys: readonly string[]): RetiredReaders {
  const pending: Array<() => boolean> = [];
  for (const reader of readersOf(engine, keys)) {
    try {
      if (reader.type === "actor") {
        const again = retireActor(engine, reader.entityId);
        if (again !== undefined) pending.push(again);
        continue;
      }
      if (reader.type !== "system") continue;
      const info = systemInstalls.peek(engine)?.get(reader.id);
      const install = info?.install;
      if (info === undefined || install === undefined) continue;
      const listed = engine.getStats().plugins.includes(info.name);
      const retired = install.control.retire();
      const replacement = install.again();
      pending.push(() => {
        // Unused during the swap: building it again would put its hooks back on the bus.
        if (listed && !engine.getStats().plugins.includes(info.name)) return false;
        return rebuildInstall(install, retired, replacement, info.name);
      });
    } catch (error: unknown) {
      reportRetiredReader(engine, reader, error);
    }
  }
  return {
    rebuild() {
      let count = 0;
      for (const run of pending.splice(0)) if (run()) count++;
      return count;
    },
  };
}
