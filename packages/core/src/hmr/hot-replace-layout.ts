import { actorTablesFor } from "../actor/runtime/define-actor.js";
import type { LayoutDefinition, PlaceHandle } from "../actor/runtime/types.js";
import { isLive, settle } from "./frame.js";
import { HOT_LAYOUT, layoutRecordOf } from "./layout-installs.js";
import type { GwenHotReport } from "./types.js";

function applied(name: string, count: number): GwenHotReport {
  return { status: "applied", kind: "layout", name, count };
}

/**
 * Reload every loaded `useLayout` handle of a layout with its new factory.
 *
 * Each loaded handle destroys its entities, then loads again, so `refs` hold new entities with new
 * ids: layout entity ids are not kept. The actors the layout placed are despawned first, so no
 * instance or handler outlives its entity. A handle nobody loaded stays unloaded. A handle whose new
 * load throws stays inactive, emits `CORE:LAYOUT_LOAD_FAILED` and is not counted. After the swap
 * `prev` and `next` both reach the handles, and both read the factory the root holds. Another
 * layout name, a layout nothing loaded and a production build apply with count 0. A swap asked
 * during a frame applies after that frame.
 *
 * @param prev - The definition `defineLayout` returned before the edit.
 * @param next - The definition `defineLayout` returned after the edit, with the same name.
 * @returns `applied` with the number of handles reloaded, or `reload` when an engine is not `idle`
 *   or `running`.
 * @internal
 */
export async function hotReplaceLayout<Refs extends Record<string, PlaceHandle<unknown>>>(
  prev: LayoutDefinition<Refs>,
  next: LayoutDefinition<Refs>,
): Promise<GwenHotReport> {
  const name = prev.__layoutName__;
  const record = layoutRecordOf(prev);
  if (record === undefined || record.installs.size === 0 || next.__layoutName__ !== name) {
    return applied(name, 0);
  }
  const engines = Array.from(record.engines);
  const reload = (): GwenHotReport => ({
    status: "reload",
    kind: "layout",
    name,
    reason: "engine-not-running",
  });
  if (!engines.every(isLive)) return reload();

  let count = 0;
  for (const engine of engines) {
    if (!(await settle(engine))) return reload();
    const factory = next._factory;
    record.root._factory = factory;
    // `next` keeps reading the root. A getter on the root would call itself.
    if (next !== record.root) {
      Object.defineProperty(next, "_factory", {
        configurable: true,
        get: () => record.root._factory,
      });
    }
    Object.defineProperty(next, HOT_LAYOUT, { configurable: true, value: record });
    for (const install of Array.from(record.installs)) {
      if (install.engine !== engine) continue;
      // Disposing a layout destroys its entities but leaves their actor instances and handlers.
      engine.run(() => {
        const actors = actorTablesFor(engine).actors;
        for (const id of install.owned()) actors.get(id)?.despawn(id);
      });
      if (await install.reload()) count++;
    }
  }
  return applied(name, count);
}
