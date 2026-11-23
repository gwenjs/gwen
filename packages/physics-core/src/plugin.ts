/**
 * Shared physics plugin. A dimension package supplies the adapter.
 */

import { useEngine } from "@gwenjs/core";
import type { GwenEngine } from "@gwenjs/core";
import { definePlugin } from "@gwenjs/kit/plugin";
import type { GwenConfigIssue, GwenPluginServiceKey, GwenProvides } from "@gwenjs/schema";
import type { PhysicsAdapter } from "./adapter.js";
import { clearEngineContacts } from "./registries.js";
import type { Dim } from "./types.js";

/**
 * Builds a plugin that steps one {@link PhysicsAdapter} on the engine that installs it.
 *
 * `setup` calls `makeAdapter`, stores `api` under `serviceKey`, and registers
 * `prefab:instantiate`, `entity:destroy`, `engine:before-update` and `engine:update`
 * on that same engine. `beginFrame`, when the adapter has one, runs on every
 * `engine:before-update`. `step` runs only when `dt > 0`.
 * `teardown` clears that engine's contact and sensor callbacks, then calls `dispose`.
 * A throw from `makeAdapter` is the error `engine.use` rejects with.
 *
 * @typeParam D - Physics dimension.
 * @typeParam K - Service key the plugin provides.
 * @typeParam Api - Value stored under `K`.
 * @typeParam O - Resolved options passed to `makeAdapter`.
 * @param name - Plugin name. `engine.unuse` takes this string.
 * @param serviceKey - Key of `engine.provide` and of `provides`.
 * @param makeAdapter - Builds the adapter for one engine and one resolved config.
 * @param declaration - Defaults, and an optional check of the resolved options.
 * @returns A factory. Each call returns a new plugin instance.
 */
export function createPhysicsPlugin<
  D extends Dim,
  const K extends GwenPluginServiceKey,
  Api extends GwenProvides[K],
  O extends object,
>(
  name: string,
  serviceKey: K,
  makeAdapter: (engine: GwenEngine, config: Readonly<O>) => PhysicsAdapter<D, Api>,
  declaration: {
    readonly defaults: O;
    readonly validate?: (resolved: Readonly<O>) => readonly GwenConfigIssue[];
  },
) {
  const validate = declaration.validate;
  const options: {
    defaults: O;
    validate?: (resolved: Readonly<O>) => readonly GwenConfigIssue[];
  } = { defaults: declaration.defaults };
  if (validate !== undefined) options.validate = validate;

  return definePlugin({ provides: [serviceKey], options }, (config) => {
    let adapter: PhysicsAdapter<D, Api> | undefined;
    return {
      name,
      setup(engine: GwenEngine) {
        const created = makeAdapter(engine, config);
        engine.provide(serviceKey, created.api);
        engine.hooks.hook("prefab:instantiate", (entityId, extensions) => {
          created.onPrefab?.(entityId, extensions);
        });
        engine.hooks.hook("entity:destroy", (entityId) => {
          created.onEntityDestroy(entityId);
        });
        engine.hooks.hook("engine:before-update", (dt) => {
          created.beginFrame?.(dt);
          if (!(dt > 0)) return;
          created.step(dt);
        });
        engine.hooks.hook("engine:update", () => {
          created.eventView();
        });
        adapter = created;
      },
      teardown() {
        clearEngineContacts(useEngine(name));
        adapter?.dispose();
      },
    };
  });
}
