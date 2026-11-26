/**
 * @file Read-only introspection service.
 *
 * Dev only: the engine builds one under `__GWEN_DEV__` and provides it as
 * `"introspection"`. The module is `packages/core/src/introspection/provider.ts`.
 * A production bundle drops this module.
 * Not exported from the package root or from `./internal`.
 *
 * `hooks` is still a placeholder. P-94-2b fills it.
 * `entities().available` is false only when the engine state is `"faulted"`.
 * A stopped engine returns an empty page with `available` true, and `entity`
 * returns `undefined`.
 *
 * `snapshot().phases` lists one system id per handler, in dispatch order.
 * `revisions()` compares a signature of each section on every call.
 * A change that appears and reverts between two polls does not move that
 * counter. `revisions().hooks` stays 0 until P-94-2b.
 *
 * `snapshot().entityCount` is 0 when `state` is `"faulted"` or `"stopped"`.
 * The schema text names only the faulted case. Stopped is zeroed here so a
 * disposed bridge is not read.
 * `snapshot().timing` equals `debug`: this provider is built only in a dev
 * build, which is the other half of "dev and debug".
 */

import {
  GWEN_INTROSPECTION_VERSION,
  type GwenEngineState,
  type GwenIntrospection,
  type GwenIntrospectionComponent,
  type GwenIntrospectionPlugin,
  type GwenIntrospectionRevisions,
  type GwenIntrospectionSnapshot,
  type GwenIntrospectionSystem,
  type GwenRuntimeHooks,
} from "@gwenjs/schema";
import type { ScopedHookable } from "../hooks/scoped-hookable.js";
import { isEngineOwnedService } from "../engine/service-container.js";
import { createEntityReader, type EntityReaderDeps } from "./entities.js";

/** Extension surface copied off a plugin. Major and minor only. */
interface ExtensionApi {
  readonly major: number;
  readonly minor: number;
}

/** One installed system, plus the scope that owns its handlers. */
export interface IntrospectionSystemSource {
  /** Scope id. Phase lists hold this id. */
  readonly id: string;
  /** Display name. */
  readonly name: string;
  /** Live scope, or null when the install has none. */
  readonly scope: ScopedHookable | null;
}

/** Plugin fields the snapshot copies. The objects themselves stay on the engine. */
export interface IntrospectionPluginSource {
  /** Plugin name. */
  readonly name: string;
  /** Service keys declared on the plugin. Absent means none. */
  readonly provides?: readonly string[];
  /** Requirement declaration. Absent members become empty lists. */
  readonly requires?: {
    readonly plugins?: readonly (
      | string
      | { readonly name: string; readonly extensionApi: ExtensionApi }
    )[];
    readonly services?: readonly string[];
    readonly optional?: readonly string[];
  };
  /** Extension surface the plugin exposes. Absent becomes null. */
  readonly extensionApi?: ExtensionApi;
}

/** What the engine passes in. The provider does not import the engine. */
export interface IntrospectionDeps {
  /** Subscribe on the engine bus. The unsubscribe drops that listener. */
  readonly subscribe: <K extends "scene:enter" | "scene:leave">(
    name: K,
    fn: GwenRuntimeHooks[K],
  ) => () => void;
  /** Engine `debug` option. */
  readonly debug: boolean;
  /** Page cap already validated, or the default. */
  readonly maxPageSize: number;
  /** Lifecycle state at call time. */
  readonly state: () => GwenEngineState;
  /** Completed frames. */
  readonly frameCount: () => number;
  /** Live entities. Not called when the engine is faulted or stopped. */
  readonly entityCount: () => number;
  /** Installed plugins, in install order. */
  readonly plugins: () => readonly IntrospectionPluginSource[];
  /** True when an error isolated this id (system scope id or plugin name). */
  readonly isolated: (id: string) => boolean;
  /** Service keys in registration order. */
  readonly serviceKeys: () => readonly string[];
  /** Plugin that provided `key`, or null when none did. */
  readonly serviceOwner: (key: string) => string | null;
  /** Registered components. */
  readonly components: () => readonly GwenIntrospectionComponent[];
  /** Installed systems. */
  readonly systems: () => readonly IntrospectionSystemSource[];
  /** Run `undo` from `stop()`, under `label`. */
  readonly onStop: (label: string, undo: () => void) => void;
  /** What the paged entity reads need. */
  readonly rows: Omit<EntityReaderDeps, "maxPageSize" | "state" | "total">;
}

/** A frozen copy of `items`. The input array is left alone. */
function frozenList<T>(items: readonly T[]): readonly T[] {
  return Object.freeze(items.slice());
}

/**
 * A fresh scene stack.
 * Each provider call owns its array, so two engines never share one.
 */
function emptyStack(): string[] {
  return [];
}

/** Copy of an extension surface, or null when the plugin exposes none. */
function copyApi(api: ExtensionApi | undefined): ExtensionApi | null {
  if (api === undefined) return null;
  return Object.freeze({ major: api.major, minor: api.minor });
}

/** Requirement lists with every missing member replaced by an empty list. */
function copyRequires(
  source: IntrospectionPluginSource["requires"],
): GwenIntrospectionPlugin["requires"] {
  const plugins: (string | { readonly name: string; readonly extensionApi: ExtensionApi })[] = [];
  for (const entry of source?.plugins ?? []) {
    if (typeof entry === "string") {
      plugins.push(entry);
      continue;
    }
    plugins.push(
      Object.freeze({
        name: entry.name,
        extensionApi: Object.freeze({
          major: entry.extensionApi.major,
          minor: entry.extensionApi.minor,
        }),
      }),
    );
  }
  return Object.freeze({
    plugins: Object.freeze(plugins),
    services: frozenList(source?.services ?? []),
    optional: frozenList(source?.optional ?? []),
  });
}

/**
 * Frozen copy of one plugin.
 * The source object, its `requires`, and its `extensionApi` are not returned.
 */
function listPlugin(source: IntrospectionPluginSource, isolated: boolean): GwenIntrospectionPlugin {
  return Object.freeze({
    name: source.name,
    provides: frozenList(source.provides ?? []),
    requires: copyRequires(source.requires),
    extensionApi: copyApi(source.extensionApi),
    isolated,
  });
}

/**
 * Build the introspection service for one engine.
 * Call it only from an `if (__GWEN_DEV__)` branch.
 * @internal
 */
export function createIntrospection(deps: IntrospectionDeps): GwenIntrospection {
  const scenes = emptyStack();
  let scenesRevision = 0;
  const offEnter = deps.subscribe("scene:enter", (name) => {
    scenes.push(name);
    scenesRevision += 1;
  });
  const offLeave = deps.subscribe("scene:leave", (name) => {
    const at = scenes.lastIndexOf(name);
    if (at === -1) return;
    scenes.splice(at, 1);
    scenesRevision += 1;
  });
  deps.onStop("introspection:scene-recorder", () => {
    offEnter();
    offLeave();
  });

  const limits = Object.freeze({ maxPageSize: deps.maxPageSize });
  const signatures = new Map<string, string>();
  const counters = new Map<string, number>();

  /**
   * Counter for one section. Moves by one when `signature` differs from the
   * signature stored on the previous call, and stays put when it matches.
   */
  function revision(section: string, signature: string): number {
    const bumped = (counters.get(section) ?? 0) + (signatures.get(section) === signature ? 0 : 1);
    signatures.set(section, signature);
    counters.set(section, bumped);
    return bumped;
  }

  /** One id per handler of `hook`, sorted by registration order on the bus. */
  function phase(hook: string): readonly string[] {
    const placed: { readonly at: number; readonly id: string }[] = [];
    for (const source of deps.systems()) {
      for (const at of source.scope?.positionsOf(hook) ?? []) {
        placed.push({ at, id: source.id });
      }
    }
    placed.sort((left, right) => left.at - right.at);
    return frozenList(placed.map((entry) => entry.id));
  }

  function systemRows(): readonly GwenIntrospectionSystem[] {
    const rows: GwenIntrospectionSystem[] = [];
    for (const source of deps.systems()) {
      rows.push(
        Object.freeze({
          id: source.id,
          name: source.name,
          paused: source.scope?.paused === true,
          isolated: deps.isolated(source.id),
        }),
      );
    }
    return frozenList(rows);
  }

  function pluginRows(): readonly GwenIntrospectionPlugin[] {
    return frozenList(
      deps.plugins().map((source) => listPlugin(source, deps.isolated(source.name))),
    );
  }

  function serviceRows(): GwenIntrospectionSnapshot["services"] {
    const rows: GwenIntrospectionSnapshot["services"][number][] = [];
    for (const key of deps.serviceKeys()) {
      const owner = isEngineOwnedService(key) ? "<engine>" : (deps.serviceOwner(key) ?? null);
      rows.push(Object.freeze({ key, owner }));
    }
    return frozenList(rows);
  }

  function componentRows(): readonly GwenIntrospectionComponent[] {
    return frozenList(deps.components());
  }

  /** Whole engine except entity rows. Safe after `stop()`. */
  function snapshot(): GwenIntrospectionSnapshot {
    const state = deps.state();
    const entityCount = state === "faulted" || state === "stopped" ? 0 : deps.entityCount();
    const systems = systemRows();
    return Object.freeze({
      state,
      frameCount: deps.frameCount(),
      entityCount,
      debug: deps.debug,
      timing: deps.debug,
      scenes: frozenList(scenes),
      components: componentRows(),
      systems,
      phases: Object.freeze({
        beforeUpdate: phase("engine:before-update"),
        update: phase("engine:update"),
        afterUpdate: phase("engine:after-update"),
        render: phase("engine:render"),
      }),
      plugins: pluginRows(),
      services: serviceRows(),
    });
  }

  /** Change counters. `frame` is the frame count. `scenes` counts enter and leave. */
  function revisions(): GwenIntrospectionRevisions {
    const systems = systemRows();
    const plugins = pluginRows();
    const services = serviceRows();
    const components = componentRows();
    return Object.freeze({
      frame: deps.frameCount(),
      scenes: scenesRevision,
      systems: revision(
        "systems",
        systems
          .map((row) => `${row.id}\0${row.paused ? "1" : "0"}\0${row.isolated ? "1" : "0"}`)
          .join("\0"),
      ),
      plugins: revision("plugins", plugins.map((row) => row.name).join("\0")),
      services: revision("services", services.map((row) => row.key).join("\0")),
      components: revision(
        "components",
        components.map((row) => `${row.name}:${row.typeId}`).join("\0"),
      ),
      hooks: 0,
    });
  }

  const reader = createEntityReader({
    maxPageSize: deps.maxPageSize,
    state: deps.state,
    total: deps.entityCount,
    ...deps.rows,
  });

  return Object.freeze({
    version: GWEN_INTROSPECTION_VERSION,
    limits,
    revisions,
    snapshot,
    entities: reader.entities,
    entity: reader.entity,
    /** Placeholder. P-94-2b returns the listener counts. */
    hooks: () => frozenList([]),
  });
}
