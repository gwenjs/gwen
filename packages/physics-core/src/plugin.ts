/**
 * Shared physics plugin. A dimension package supplies the adapter.
 */

import type { GwenEngine } from "@gwenjs/core";
import { engineContext, reportRejectedHook } from "@gwenjs/core/internal";
import { definePlugin } from "@gwenjs/kit/plugin";
import type { GwenConfigIssue, GwenPluginServiceKey, GwenProvides } from "@gwenjs/schema";
import type { PhysicsAdapter } from "./adapter.js";
import { readCollisionEvents } from "./events.js";
import type { InternalCollisionEvent } from "./events.js";
import { clearEngineContacts, createContactRegistry, createSensorRegistry } from "./registries.js";
import { createSensorTracker } from "./sensor-tracker.js";
import type { PhysicsSensorTracker } from "./sensor-tracker.js";
import type { CollisionContact, Dim } from "./types.js";

/**
 * Builds a plugin that steps one {@link PhysicsAdapter} on the engine that installs it.
 *
 * `setup` calls `makeAdapter`, stores `api` under `serviceKey`, and registers
 * `prefab:instantiate`, `entity:destroy`, `engine:before-update` and `engine:update`
 * on that same engine. `beginFrame`, when the adapter has one, runs on every
 * `engine:before-update`. `step` runs only when `dt > 0`.
 * `engine:update` reads `eventView`. No view, or a count of 0, emits nothing.
 * Otherwise sensor transitions run first. Inside one transition the registry
 * callbacks (`onSensorEnter` / `onSensorExit`) run, then `physics:sensor:changed`.
 * When the resolved contact list is empty, the plugin calls neither
 * `physics:collision`, nor `onContact`, nor `onContacts`. Sensor transitions of
 * that frame still run. Otherwise the order continues with `physics:collision`,
 * `onContact`, then `onContacts`.
 * A rejected `physics:collision` or `physics:sensor:changed` handler is reported.
 * `entity:destroy` forgets that entity's sensor counts, drops sensor callbacks
 * stored for that owner (`SensorRegistry.removeOwned`), and does not fire an exit.
 * `teardown` clears that engine's contact and sensor callbacks, then calls `dispose`.
 * One plugin object installed on two engines keeps one adapter per engine.
 * Stopping one engine disposes only that engine's adapter.
 * A second call, or a call with no current engine, does not clear callbacks registered
 * after the first, and does not call `dispose` again.
 * A throw from `makeAdapter` is the error `engine.use` rejects with.
 *
 * @typeParam D - Physics dimension.
 * @typeParam K - Service key the plugin provides.
 * @typeParam Api - Value stored under `K`.
 * @typeParam O - Resolved options passed to `makeAdapter`.
 * @param name - Plugin name. `engine.unuse` takes this string.
 * @param serviceKey - Key of `engine.provide` and of `provides`.
 * @param makeAdapter - Builds the adapter for one engine and one resolved config.
 *   The third argument is that plugin instance's sensor tracker.
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
  makeAdapter: (
    engine: GwenEngine,
    config: Readonly<O>,
    ctx: { readonly sensors: PhysicsSensorTracker },
  ) => PhysicsAdapter<D, Api>,
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
    const adapters = new WeakMap<GwenEngine, PhysicsAdapter<D, Api>>();
    const releases = new WeakMap<GwenEngine, () => void>();
    return {
      name,
      setup(engine: GwenEngine) {
        const host = engineContext.tryUse() ?? engine;
        const release = (): void => {
          clearEngineContacts(host);
        };
        releases.set(host, release);
        const tracker = createSensorTracker();
        const created = makeAdapter(engine, config, { sensors: tracker.sensors });
        const pool: InternalCollisionEvent[] = [];
        engine.provide(serviceKey, created.api);
        engine.hooks.hook("prefab:instantiate", (entityId, extensions) => {
          created.onPrefab?.(entityId, extensions);
        });
        engine.hooks.hook("entity:destroy", (entityId) => {
          tracker.forget(entityId);
          createSensorRegistry().peek(engine)?.removeOwned(entityId);
          created.onEntityDestroy(entityId);
        });
        engine.hooks.hook("engine:before-update", (dt) => {
          created.beginFrame?.(dt);
          if (!(dt > 0)) return;
          created.step(dt);
        });
        engine.hooks.hook("engine:update", () => {
          const packed = created.eventView();
          if (packed === undefined) return;
          while (pool.length < packed.count) {
            pool.push({ slotA: 0, slotB: 0, started: false });
          }
          const written = readCollisionEvents(packed.view, packed.count, pool, created.eventLayout);
          for (let index = 0; index < written; index += 1) {
            const event = pool[index];
            if (event === undefined) continue;
            noteSide(event.slotA, event.aColliderId, event.started);
            noteSide(event.slotB, event.bColliderId, event.started);
          }
          const contacts: CollisionContact[] = [];
          for (let index = 0; index < written; index += 1) {
            const event = pool[index];
            if (event === undefined) continue;
            const entityA = created.resolveEntity(event.slotA);
            const entityB = created.resolveEntity(event.slotB);
            if (entityA === undefined || entityB === undefined) continue;
            const contact: CollisionContact = {
              entityA,
              entityB,
              started: event.started,
            };
            if (event.aColliderId !== undefined) contact.aColliderId = event.aColliderId;
            if (event.bColliderId !== undefined) contact.bColliderId = event.bColliderId;
            contacts.push(contact);
          }
          if (contacts.length === 0) return;
          reportRejectedHook(
            engine,
            name,
            "physics:collision",
            engine.hooks.callHook("physics:collision", contacts),
          );
          const contactRegistry = createContactRegistry().peek(engine);
          if (contactRegistry !== undefined) {
            for (const contact of contacts) contactRegistry.emit(contact);
          }
          created.onContacts?.(contacts);
        });
        adapters.set(host, created);

        function noteSide(slot: number, reportedId: number | undefined, started: boolean): void {
          const sensorId = created.resolveSensorId(slot, reportedId);
          if (sensorId === undefined) return;
          const entityId = created.resolveEntity(slot);
          if (entityId === undefined) return;
          const applied = tracker.apply(entityId, sensorId, started);
          if (!applied.changed) return;
          const sensorRegistry = createSensorRegistry().peek(engine);
          if (applied.state.isActive) sensorRegistry?.emit(sensorId, entityId, "enter");
          else sensorRegistry?.emit(sensorId, entityId, "exit");
          reportRejectedHook(
            engine,
            name,
            "physics:sensor:changed",
            engine.hooks.callHook("physics:sensor:changed", entityId, sensorId, applied.state),
          );
        }
      },
      teardown() {
        const host = engineContext.tryUse();
        if (host === undefined) return;
        const release = releases.get(host);
        const current = adapters.get(host);
        releases.delete(host);
        adapters.delete(host);
        release?.();
        current?.dispose();
      },
    };
  });
}
