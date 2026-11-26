/**
 * @file Engine side of the paged entity reads.
 *
 * Dev only. Binds the reader of `entities.ts` to one engine: its chunk
 * queries, its component snapshots, its actor table and its dormancy flags.
 * Not exported from the package root or from `./internal`.
 */

import type { EntityId } from "@gwenjs/schema";
import { actorIdentityFor } from "../actor/runtime/define-actor.js";
import { createChunkQuery } from "../engine/chunk-query.js";
import { componentSources } from "../engine/engine-component-registry.js";
import type { EngineEntities } from "../engine/engine-entities.js";
import type { GwenEngine } from "../engine/engine-types.js";
import type { WasmBridgeImpl } from "../engine/wasm-bridge.js";
import { entityGeneration, entityIndex } from "../types/entity.js";
import type { EntityReaderDeps } from "./entities.js";

/**
 * A chunk loop that queues nothing.
 * `ChunkIter.reset` calls `enter` (`chunk-query.ts`). The engine's own hooks
 * raise the loop depth and defer structural changes. These two do neither.
 */
const NO_LOOP = {
  enter(): void {},
  leave(): void {},
};

/** The engine-bound half of {@link EntityReaderDeps}. */
export function entityRows(
  engine: GwenEngine,
  bridge: WasmBridgeImpl,
  entities: EngineEntities,
): Omit<EntityReaderDeps, "maxPageSize" | "state" | "total"> {
  return {
    sources: () => componentSources(engine),
    query: (def) =>
      createChunkQuery(
        engine,
        bridge,
        [def] as const,
        () => entities.createLiveQuery([def]),
        NO_LOOP,
      ),
    read: (id: EntityId, def) => entities.getComponent(id, def),
    actor: (id: EntityId) => actorIdentityFor(engine, id),
    dormant: (id: EntityId) => bridge.isEntityDormant(entityIndex(id), entityGeneration(id)),
  };
}
