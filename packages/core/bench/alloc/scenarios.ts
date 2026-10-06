import { defineActor, useEntityId } from "../../src/actor/runtime/define-actor";
import { definePrefab } from "../../src/actor/runtime/define-prefab";
import { defineActorPool } from "../../src/actor/runtime/pool/define-actor-pool";
import { useEngine } from "../../src/engine/context";
import type { EntityId } from "../../src/engine/engine-api";
import { createEntityId, entityIndex } from "../../src/types/entity";
import { defineComponent, Types } from "../../src/schema";
import { defineSystem, onUpdate, useQuery } from "../../src/system/runtime/define-system";
import { TweenPlugin } from "../../src/tween/engine-plugin";
import { useTween } from "../../src/tween/runtime/use-tween";
import type { RealEngineHandle } from "../../tests/integration-wasm/harness";
import type { AllocPathName } from "./evaluate-alloc-gate";
import type { AllocScenario } from "./measure";

const Position = defineComponent({
  name: "AllocPosition",
  schema: { x: Types.f32, y: Types.f32 },
});

const Velocity = defineComponent({
  name: "AllocVelocity",
  schema: { vx: Types.f32, vy: Types.f32 },
});

/** Read from the gate tests so per-frame stores stay observable. */
let sink = 0;

export function readAllocSink(): number {
  return sink;
}

export interface ScenarioOptions {
  /** One fresh object per entity per frame, stored so V8 cannot drop it. */
  extraObject?: boolean;
}

function spawnEngineEntities(
  handle: RealEngineHandle,
  entities: number,
  withMotion: boolean,
): void {
  const { engine } = handle;
  for (let i = 0; i < entities; i++) {
    const id = engine.createEntity();
    if (!withMotion) continue;
    engine.addComponent(id, Position, { x: i, y: 0 });
    engine.addComponent(id, Velocity, { vx: 1, vy: 0 });
  }
}

function spawnBridgeEntities(
  handle: RealEngineHandle,
  entities: number,
): {
  typeIds: number[];
  posType: number;
  ids: EntityId[];
} {
  const { bridge } = handle;
  const posType = bridge.registerComponentType();
  const velType = bridge.registerComponentType();
  const typeIds = [posType, velType];
  const bytes = new Uint8Array(8);
  const ids: EntityId[] = Array.from({ length: entities });
  for (let i = 0; i < entities; i++) {
    const created = bridge.createEntity();
    bridge.addComponent(created.index, created.generation, posType, bytes);
    bridge.addComponent(created.index, created.generation, velType, bytes);
    bridge.updateEntityArchetype(created.index, typeIds);
    ids[i] = createEntityId(created.index, created.generation);
  }
  return { typeIds, posType, ids };
}

function updateSystem(extraObject: boolean): AllocScenario {
  return {
    name: "update.system",
    async build(handle, entities) {
      spawnEngineEntities(handle, entities, true);
      const slots: Array<{ n: number } | null> | null = extraObject
        ? Array.from({ length: entities })
        : null;
      const system = defineSystem("alloc-update-system", () => {
        const query = useQuery([Position, Velocity]);
        onUpdate((dt) => {
          let index = 0;
          for (const entry of query) {
            const pos = entry.get(Position);
            const vel = entry.get(Velocity);
            if (pos && vel) pos.x += vel.vx * dt;
            if (slots) slots[index] = { n: index };
            index += 1;
          }
          sink = index;
        });
      });
      await handle.engine.use(system());
    },
  };
}

export function createScenario(path: AllocPathName, options?: ScenarioOptions): AllocScenario {
  switch (path) {
    case "frame.empty":
      return {
        name: path,
        async build(handle, entities) {
          spawnEngineEntities(handle, entities, false);
          sink = entities;
        },
      };
    case "update.system":
      return updateSystem(options?.extraObject === true);
    case "update.actor":
      return {
        name: path,
        async build(handle, entities) {
          const prefab = definePrefab([{ def: Position, defaults: { x: 0, y: 0 } }]);
          const actor = defineActor("alloc-update-actor", prefab, () => {
            const id = useEntityId();
            const pos = useEngine().getComponent(id, Position);
            onUpdate((dt) => {
              if (pos) pos.x += dt;
            });
          });
          await handle.engine.use(actor._plugin);
          for (let i = 0; i < entities; i++) actor._plugin.spawn();
          sink = entities;
        },
      };
    case "query.raw":
      return {
        name: path,
        async build(handle, entities) {
          const { typeIds } = spawnBridgeEntities(handle, entities);
          const found = handle.bridge.queryEntitiesRaw(typeIds);
          if (found !== entities) {
            throw new Error(
              `[ALLOC GATE] query.raw fixture matched ${found}, expected ${entities}`,
            );
          }
          handle.bridge.forEachQueryResultRaw(typeIds, () => {});
          const onEntity = (index: number) => {
            sink += index;
          };
          const system = defineSystem("alloc-query-raw", () => {
            onUpdate(() => {
              handle.bridge.forEachQueryResultRaw(typeIds, onEntity);
            });
          });
          await handle.engine.use(system());
        },
      };
    case "query.entities":
      return {
        name: path,
        async build(handle, entities) {
          const { typeIds } = spawnBridgeEntities(handle, entities);
          const system = defineSystem("alloc-query-entities", () => {
            onUpdate(() => {
              sink = handle.bridge.queryEntities(typeIds).length;
            });
          });
          await handle.engine.use(system());
        },
      };
    case "bulk.query":
      return {
        name: path,
        async build(handle, entities) {
          const { typeIds, posType } = spawnBridgeEntities(handle, entities);
          const system = defineSystem("alloc-bulk-query", () => {
            onUpdate(() => {
              const result = handle.bridge.queryReadBulk(typeIds, posType, 2);
              const data = result.data;
              if (result.entityCount > 0) data[0] = (data[0] ?? 0) + 1;
              handle.bridge.queryWriteBulk(result.slots, result.gens, posType, data);
              sink = result.entityCount;
            });
          });
          await handle.engine.use(system());
        },
      };
    case "bulk.components":
      return {
        name: path,
        async build(handle, entities) {
          const { posType, ids } = spawnBridgeEntities(handle, entities);
          const system = defineSystem("alloc-bulk-components", () => {
            onUpdate(() => {
              const data = handle.bridge.readComponentsBulk(ids, posType, 8);
              if (data.length > 0) data[0] = (data[0] ?? 0) + 1;
              handle.bridge.writeComponentsBulk(ids, posType, data);
              sink = data.length;
            });
          });
          await handle.engine.use(system());
        },
      };
    case "pool.cycle":
      return {
        name: path,
        async build(handle, entities) {
          const prefab = definePrefab([{ def: Position, defaults: { x: 0, y: 0 } }]);
          const actor = defineActor("alloc-pool-actor", prefab, () => {
            const id = useEntityId();
            const pos = useEngine().getComponent(id, Position);
            onUpdate(() => {
              if (pos) pos.x += 1;
            });
          });
          const pool = defineActorPool(actor, { size: entities });
          await handle.engine.use(actor._plugin);
          await handle.engine.use(pool.plugin);
          const system = defineSystem("alloc-pool-driver", () => {
            const held: EntityId[] = Array.from({ length: entities });
            let frame = 0;
            onUpdate(() => {
              if ((frame & 1) === 0) {
                for (let i = 0; i < entities; i++) held[i] = pool.acquire();
              } else {
                for (let i = 0; i < entities; i++) pool.release(held[i]!);
              }
              frame += 1;
              sink = frame;
            });
          });
          await handle.engine.use(system());
        },
      };
    case "tween.tick":
      return {
        name: path,
        async build(handle, entities) {
          await handle.engine.use(TweenPlugin({ poolSize: entities }));
          const system = defineSystem("alloc-tween-tick", () => {
            const handles: Array<{ readonly value: number }> = Array.from({ length: entities });
            for (let i = 0; i < entities; i++) {
              const tween = useTween<number>({ duration: 10_000, loop: true });
              if (tween === null) {
                throw new Error("[ALLOC GATE] tween.tick: tween pool dropped a slot");
              }
              tween.play({ from: 0, to: 1 });
              handles[i] = tween;
            }
            onUpdate(() => {
              let sum = 0;
              for (let i = 0; i < handles.length; i++) sum += handles[i]!.value;
              sink = sum;
            });
          });
          await handle.engine.use(system());
        },
      };
    case "entity.index":
      return {
        name: path,
        async build(handle, entities) {
          const system = defineSystem("alloc-entity-index", () => {
            const ids: EntityId[] = Array.from({ length: entities });
            for (let i = 0; i < entities; i++) ids[i] = handle.engine.createEntity();
            onUpdate(() => {
              let sum = 0;
              for (let i = 0; i < ids.length; i++) sum += entityIndex(ids[i]!);
              sink = sum;
            });
          });
          await handle.engine.use(system());
        },
      };
    default: {
      const neverPath: never = path;
      throw new Error(`[ALLOC GATE] ${String(neverPath)}: no recorded threshold`);
    }
  }
}
