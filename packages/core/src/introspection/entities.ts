/**
 * @file Paged entity reads of the introspection service.
 *
 * Dev only, like the provider. The engine passes in what a read needs; this
 * module does not import the engine. It lists entities through one chunk query
 * per registered component type (never `each()`), merges the rows by entity,
 * and pages that list. Component snapshots are read for the page, or for the
 * single id passed to `entity`. Every chunk query it opens is released in
 * `finally`. A read does not add, remove, or write a component, and it does
 * not subscribe a hook. `register_query` and `release_query` do not bump
 * `storage_generation` (`chunk_store.rs`).
 *
 * Not exported from the package root or from `./internal`.
 */

import { GwenError } from "@gwenjs/schema";
import type {
  EntityId,
  GwenEngineState,
  GwenIntrospectionEntity,
  GwenIntrospectionEntityPage,
  GwenIntrospectionPageRequest,
} from "@gwenjs/schema";
import { defineComponent, type ComponentDefinition, type ComponentSchema } from "../schema.js";
import type { Query } from "../engine/chunk-query.js";
import { releaseChunkQuery } from "../engine/chunk-query.js";
import { CoreErrorCodes } from "../engine/engine-errors.js";
import type { ComponentLayoutSource } from "../engine/engine-component-registry.js";
import { createEntityId, entityIndex } from "../types/entity.js";

/** Definition of one registered component, as the chunk query and the reader need it. */
type Definition = ComponentDefinition<ComponentSchema>;

/** What the engine passes in. */
export interface EntityReaderDeps {
  /** Page cap already validated, or the default. */
  readonly maxPageSize: number;
  /** Lifecycle state at call time. */
  readonly state: () => GwenEngineState;
  /** Live entities, from the bridge. Not called when the engine is faulted or stopped. */
  readonly total: () => number;
  /** Registered components that have a definition, in registration order. */
  readonly sources: () => readonly {
    readonly name: string;
    readonly typeId: number;
    readonly source: ComponentLayoutSource;
  }[];
  /** Open a chunk query over `def`. The caller releases it. */
  readonly query: (def: Definition) => Query<readonly [Definition]>;
  /** Snapshot of one component row, or `undefined` when the entity is dead or lacks it. */
  readonly read: (id: EntityId, def: Definition) => Readonly<Record<string, unknown>> | undefined;
  /** Id and name of the live actor that owns `id`, if any. */
  readonly actor: (id: EntityId) => { readonly id: string; readonly name: string } | undefined;
  /** True when the entity is dormant. A dormant entity is never listed. */
  readonly dormant: (id: EntityId) => boolean;
}

/** Largest packed id: a 32-bit generation over a 32-bit index. */
const MAX_ENTITY_ID = (1n << 64n) - 1n;

interface Registered {
  readonly name: string;
  readonly typeId: number;
  readonly def: Definition;
}

/** The value as the error message prints it. */
function show(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return `${value}n`;
  if (typeof value === "object") return value === null ? "null" : "an object";
  return String(value);
}

function pageInvalid(
  field: "page" | "offset" | "limit",
  value: unknown,
  maxPageSize: number,
  expected: string,
): GwenError {
  return new GwenError(
    CoreErrorCodes.INTROSPECTION_PAGE_INVALID,
    `Page ${field} is ${show(value)}. ${expected} The maximum page size is ${maxPageSize}.`,
    {
      composable: "introspection.entities",
      hint: __GWEN_DEV__
        ? "Pass { offset, limit }. The request is never clamped. Raise the cap with the introspection.maxPageSize engine option."
        : undefined,
    },
  );
}

/**
 * Check a page request, in the order `page`, `offset`, `limit`.
 * Never clamps. Runs before any WASM call.
 * @throws {GwenError} code `CORE:INTROSPECTION_PAGE_INVALID`.
 */
function checkPage(page: unknown, maxPageSize: number): GwenIntrospectionPageRequest {
  if (typeof page !== "object" || page === null) {
    throw pageInvalid("page", page, maxPageSize, "Expected an object.");
  }
  const offset: unknown = Reflect.get(page, "offset");
  if (typeof offset !== "number" || !Number.isSafeInteger(offset) || offset < 0) {
    throw pageInvalid("offset", offset, maxPageSize, "Expected a safe integer of 0 or more.");
  }
  const limit: unknown = Reflect.get(page, "limit");
  if (
    typeof limit !== "number" ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > maxPageSize
  ) {
    throw pageInvalid(
      "limit",
      limit,
      maxPageSize,
      `Expected a safe integer from 1 to ${maxPageSize}.`,
    );
  }
  return { offset, limit };
}

function emptyPage(available: boolean): GwenIntrospectionEntityPage {
  return Object.freeze({ available, total: 0, listed: 0, items: Object.freeze([]) });
}

/** Paged reads for one engine. */
export function createEntityReader(deps: EntityReaderDeps): {
  readonly entities: (page: GwenIntrospectionPageRequest) => GwenIntrospectionEntityPage;
  readonly entity: (id: bigint) => GwenIntrospectionEntity | undefined;
} {
  const definitions = new WeakMap<ComponentLayoutSource, Definition>();

  function registered(): readonly Registered[] {
    const rows: Registered[] = [];
    for (const { name, typeId, source } of deps.sources()) {
      let def = definitions.get(source);
      if (def === undefined) {
        def = defineComponent({ name: source.name, schema: source.schema });
        definitions.set(source, def);
        // Chunk query passes this rebuild to getOrRegister (`createChunkQuery` in engine/chunk-query.ts).
        definitions.set(def, def);
      }
      rows.push({ name, typeId, def });
    }
    return rows;
  }

  /** Every awake entity id that has `def`. One chunk query, released in `finally`. */
  function idsOf(def: Definition): EntityId[] {
    const ids: EntityId[] = [];
    const query = deps.query(def);
    try {
      for (const chunk of query) {
        for (let row = 0; row < chunk.count; row += 1) ids.push(chunk.entityId(row));
      }
    } finally {
      releaseChunkQuery(query);
    }
    return ids;
  }

  function build(id: EntityId, rows: readonly Registered[]): GwenIntrospectionEntity | undefined {
    const components: GwenIntrospectionEntity["components"][number][] = [];
    for (const { name, typeId, def } of rows) {
      const values = deps.read(id, def);
      if (values !== undefined) components.push(Object.freeze({ name, typeId, values }));
    }
    if (components.length === 0) return undefined;
    const actor = deps.actor(id);
    return Object.freeze({
      id,
      ...(actor === undefined ? {} : { actor: Object.freeze({ id: actor.id, name: actor.name }) }),
      components: Object.freeze(components),
    });
  }

  function entities(page: GwenIntrospectionPageRequest): GwenIntrospectionEntityPage {
    const { offset, limit } = checkPage(page, deps.maxPageSize);
    const state = deps.state();
    if (state === "faulted") return emptyPage(false);
    if (state === "stopped") return emptyPage(true);
    const rows = registered();
    const merged = new Set<EntityId>();
    for (const { def } of rows) {
      for (const id of idsOf(def)) merged.add(id);
    }
    const ordered = [...merged].sort((left, right) => entityIndex(left) - entityIndex(right));
    const items: GwenIntrospectionEntity[] = [];
    for (const id of ordered.slice(offset, offset + limit)) {
      const item = build(id, rows);
      if (item !== undefined) items.push(item);
    }
    return Object.freeze({
      available: true,
      total: deps.total(),
      listed: ordered.length,
      items: Object.freeze(items),
    });
  }

  function entity(id: bigint): GwenIntrospectionEntity | undefined {
    if (typeof id !== "bigint" || id < 0n || id > MAX_ENTITY_ID) return undefined;
    const state = deps.state();
    if (state === "faulted" || state === "stopped") return undefined;
    // Rebuilt from its two halves: the contract takes a plain bigint, the engine a branded id.
    const branded = createEntityId(Number(id & 0xffffffffn), Number(id >> 32n));
    if (deps.dormant(branded)) return undefined;
    return build(branded, registered());
  }

  return Object.freeze({ entities, entity });
}
