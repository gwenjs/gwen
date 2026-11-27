/**
 * @file Read-only introspection contract.
 *
 * Types, plus four frozen constants. The core engine provides the service
 * under the key {@link GWEN_INTROSPECTION_SERVICE}; a tool such as the
 * inspector reads it through `requires.services`. This module has no
 * `@gwenjs/*` dependency.
 *
 * @module
 */

import type { EntityId } from "./entity.js";
import type { GwenEngineState } from "./engine-state.js";

/** Service key of the introspection service. Engine-owned: a plugin never provides it. */
export const GWEN_INTROSPECTION_SERVICE = "introspection" as const;

/**
 * Version of this contract. A change to a shape below is a version bump.
 * A consumer compares it with {@link GwenIntrospection.version} before it reads.
 */
export const GWEN_INTROSPECTION_VERSION = 1 as const;

/** Default `limits.maxPageSize`: the most entities one `entities` page may list. */
export const GWEN_INTROSPECTION_DEFAULT_MAX_PAGE = 1000 as const;

const IntrospectionErrorCodes = {
  PAGE_INVALID: "CORE:INTROSPECTION_PAGE_INVALID",
} as const;

/** Error codes of the introspection service. Frozen. */
export const GWEN_INTROSPECTION_ERROR_CODES = Object.freeze(IntrospectionErrorCodes);

/** Limits of the `entities` read. Fixed when the engine is built. */
export interface GwenIntrospectionLimits {
  /** Largest `limit` an `entities` page accepts. A larger one is an error, never clamped. */
  readonly maxPageSize: number;
}

/** Window of an `entities` read. */
export interface GwenIntrospectionPageRequest {
  /** Index of the first entity to list. A safe integer, 0 or more. */
  readonly offset: number;
  /** Number of entities to list. A safe integer from 1 to `limits.maxPageSize`. */
  readonly limit: number;
}

/**
 * Payload of the error {@link GWEN_INTROSPECTION_ERROR_CODES}.PAGE_INVALID:
 * which part of the request was refused.
 */
export interface GwenIntrospectionPageInvalid {
  /** `"page"` when the request is not an object, else the offending field. */
  readonly field: "page" | "offset" | "limit";
  /** The value received, as given. */
  readonly value: unknown;
  /** The `limits.maxPageSize` in force. */
  readonly maxPageSize: number;
}

/**
 * Change counters a consumer polls. Each only grows. A section changed
 * since the last read if and only if its counter moved.
 */
export interface GwenIntrospectionRevisions {
  /** Frames run. */
  readonly frame: number;
  /** Scene stack pushed or popped. */
  readonly scenes: number;
  /** Systems added, removed, paused or resumed. */
  readonly systems: number;
  /** Plugins installed or removed. */
  readonly plugins: number;
  /** Services provided or removed. */
  readonly services: number;
  /** Components registered. */
  readonly components: number;
  /** Hook listeners added or removed. */
  readonly hooks: number;
}

/** A registered component type. */
export interface GwenIntrospectionComponent {
  /** Component name. */
  readonly name: string;
  /** Numeric type id in the WASM component store. */
  readonly typeId: number;
  /** Field names, in schema order. */
  readonly fields: readonly string[];
}

/** A system registered with the engine. */
export interface GwenIntrospectionSystem {
  /** Stable id. The `phases` lists hold this id. */
  readonly id: string;
  /** Display name. */
  readonly name: string;
  /** True while the system is paused. */
  readonly paused: boolean;
  /** True when an error isolated the system. */
  readonly isolated: boolean;
  /**
   * Milliseconds of the synchronous part of the handlers, per phase, in frame
   * `lastRunFrame`. Present only when `timing` is true and the system ran at least
   * once while timed.
   */
  readonly frameMs?: {
    /** Time in `onBeforeUpdate`. */
    readonly beforeUpdate: number;
    /** Time in `onUpdate`. */
    readonly update: number;
    /** Time in `onAfterUpdate`. */
    readonly afterUpdate: number;
    /** Time in `onRender`. */
    readonly render: number;
    /** Sum of the four phases. */
    readonly total: number;
  };
  /** The frame `frameMs` describes. Present if and only if `frameMs` is present. */
  readonly lastRunFrame?: number;
}

/** A plugin installed in the engine. */
export interface GwenIntrospectionPlugin {
  /** Plugin name. */
  readonly name: string;
  /** Service keys the plugin provides. */
  readonly provides: readonly string[];
  /** What the plugin declared in `requires`. */
  readonly requires: {
    /** Required plugins, by name or with an extension api range. */
    readonly plugins: readonly (
      | string
      | { readonly name: string; readonly extensionApi: unknown }
    )[];
    /** Required service keys. */
    readonly services: readonly string[];
    /** Optional service keys. */
    readonly optional: readonly string[];
  };
  /** Extension api version the plugin exposes, or `null` when it exposes none. */
  readonly extensionApi: { readonly major: number; readonly minor: number } | null;
  /** True when an error isolated the plugin. */
  readonly isolated: boolean;
}

/** A service key in the engine registry. */
export interface GwenIntrospectionService {
  /** Service key. */
  readonly key: string;
  /** Name of the plugin whose `provides` holds the key, `"<engine>"` for an engine-owned key, or `null` when no plugin declares it. */
  readonly owner: string | null;
}

/** The whole engine, without entities. Read through {@link GwenIntrospection.snapshot}. */
export interface GwenIntrospectionSnapshot {
  /** Engine lifecycle state. */
  readonly state: GwenEngineState;
  /** Completed frames. */
  readonly frameCount: number;
  /** Live entities. `0` when `state` is `"faulted"`. */
  readonly entityCount: number;
  /** The engine `debug` option, as the user set it. */
  readonly debug: boolean;
  /** True if and only if the build is dev and `debug` is true. Says whether `systems[].frameMs` can exist. */
  readonly timing: boolean;
  /** Active scene stack, bottom to top. The last item is the active scene. Empty before the first enter. */
  readonly scenes: readonly string[];
  /** Registered component types. */
  readonly components: readonly GwenIntrospectionComponent[];
  /** Registered systems. */
  readonly systems: readonly GwenIntrospectionSystem[];
  /** System ids per phase, in dispatch order. An unsubscribed system is dropped. */
  readonly phases: {
    /** Ids run by `onBeforeUpdate`. */
    readonly beforeUpdate: readonly string[];
    /** Ids run by `onUpdate`. */
    readonly update: readonly string[];
    /** Ids run by `onAfterUpdate`. */
    readonly afterUpdate: readonly string[];
    /** Ids run by `onRender`. */
    readonly render: readonly string[];
  };
  /** Installed plugins, in install order. */
  readonly plugins: readonly GwenIntrospectionPlugin[];
  /** Registered services, in registration order. */
  readonly services: readonly GwenIntrospectionService[];
}

/** One entity with its component values. */
export interface GwenIntrospectionEntity {
  /** Entity id. */
  readonly id: EntityId;
  /** Present if and only if a live actor scope owns this entity id. */
  readonly actor?: { readonly id: string; readonly name: string };
  /** Components on the entity. `values` is a `getComponent` snapshot and may hold a `bigint`. */
  readonly components: readonly {
    readonly name: string;
    readonly typeId: number;
    readonly values: Readonly<Record<string, unknown>>;
  }[];
}

/** One page of entities. */
export interface GwenIntrospectionEntityPage {
  /** False if and only if the engine `state` is `"faulted"`: then `items` is empty and `total` is 0. */
  readonly available: boolean;
  /** Live entities in the engine. */
  readonly total: number;
  /**
   * Entities that have at least one component and are awake, over the whole engine,
   * not only this page. `total - listed` = live entities with no component, or dormant.
   */
  readonly listed: number;
  /** The page of the listed entities, ascending by entity index. */
  readonly items: readonly GwenIntrospectionEntity[];
}

/** Number of listeners on one hook. */
export interface GwenIntrospectionHookCount {
  /** Hook name. */
  readonly name: string;
  /** Listeners registered on it. */
  readonly count: number;
}

/**
 * Read-only view of a running engine. Every member is a `readonly` property:
 * nothing here changes the engine.
 */
export interface GwenIntrospection {
  /**
   * Contract version of the provider. Typed `number`, not `1`: a provider of
   * a later version must typecheck, so the consumer can reject it at runtime.
   */
  readonly version: number;
  /** Limits in force. */
  readonly limits: GwenIntrospectionLimits;
  /** Change counters. Cheap: poll this, then read what moved. */
  readonly revisions: () => GwenIntrospectionRevisions;
  /** The whole engine, without entities. */
  readonly snapshot: () => GwenIntrospectionSnapshot;
  /**
   * One page of entities. A request outside `limits` is an error with the
   * code {@link GWEN_INTROSPECTION_ERROR_CODES}.PAGE_INVALID.
   */
  readonly entities: (page: GwenIntrospectionPageRequest) => GwenIntrospectionEntityPage;
  /** One entity by id, or `undefined` when it is not alive or has no component. Never throws. An {@link EntityId} is accepted. */
  readonly entity: (id: bigint) => GwenIntrospectionEntity | undefined;
  /**
   * Subscription counts per hook that has a listener, sorted by name.
   * Engine-owned listeners are left out.
   */
  readonly hooks: () => readonly GwenIntrospectionHookCount[];
}
