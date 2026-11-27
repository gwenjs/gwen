/**
 * @file Swap control behind hot-replacing an actor. Dev only: `defineActor` builds the control
 * under `__GWEN_DEV__`, so a production build allocates none and stores no props.
 *
 * @module
 */

import type { GwenErrorTarget } from "@gwenjs/schema";
import { createDisposable } from "../disposable.js";
import type { ActorDefinition, PrefabDefinition } from "../actor/runtime/types.js";
import type { EntityId } from "../engine/engine-api";
import type { GwenEngine } from "../engine/engine-types.js";
import type { ComponentDef } from "../system/runtime/define-system";

/** Key of the {@link HotActorControl} on a definition `defineActor` returned. */
export const HOT_ACTOR: unique symbol = Symbol("gwen.hot.actor");

/** What the installed plugin runs for a new instance and for a swapped one. */
export interface ActorBody<Props, PublicAPI> {
  readonly factory: ((props: Props) => PublicAPI) | (() => PublicAPI);
  readonly prefab: PrefabDefinition<readonly ComponentDef[]>;
}

/** Outcome of respawning one instance. A throw is returned, not thrown. */
export type RespawnResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: unknown; readonly target: GwenErrorTarget };

/** What a `defineActor` closure lets a swap do. It acts on state nobody else sees. */
export interface HotActorControl<Props, PublicAPI> {
  readonly definition: ActorDefinition<Props, PublicAPI>;
  /** Control of the first definition, the one whose plugin the engines hold. Unset on that one. */
  root: HotActorControl<Props, PublicAPI> | undefined;
  /** Engines the plugin is installed on. */
  engines(): readonly GwenEngine[];
  /** Entity ids of the live instances of one engine, in spawn order. */
  ids(engine: GwenEngine): readonly EntityId[];
  /** The body this closure was defined with. */
  body(): ActorBody<Props, PublicAPI>;
  /** Run `body` from now on, for new instances. */
  retarget(body: ActorBody<Props, PublicAPI>): void;
  /** Run the current body again on one live instance, keeping its entity. */
  respawn(engine: GwenEngine, id: EntityId): RespawnResult;
  /** Call `drop` after each swap of this definition. Returns the unsubscribe function. */
  listen(drop: () => void): () => void;
  /** Call every listener. */
  notify(): void;
  /** Move listeners onto `target`. A later unsubscribe still removes them. */
  rehome(target: HotActorControl<Props, PublicAPI>): void;
  /** Take the listeners of `cell` into this control. */
  absorb(cell: { set: Set<() => void> }): void;
}

/** A definition in a dev build. */
export interface HotActorDefinition<Props, PublicAPI> extends ActorDefinition<Props, PublicAPI> {
  readonly [HOT_ACTOR]: HotActorControl<Props, PublicAPI>;
}

function isHotActor<Props, PublicAPI>(
  definition: ActorDefinition<Props, PublicAPI>,
): definition is HotActorDefinition<Props, PublicAPI> {
  return HOT_ACTOR in definition;
}

/** Swap control of a definition. Undefined for one `defineActor` did not make, or in a prod build. */
export function actorControlOf<Props, PublicAPI>(
  definition: ActorDefinition<Props, PublicAPI>,
): HotActorControl<Props, PublicAPI> | undefined {
  return isHotActor(definition) ? definition[HOT_ACTOR] : undefined;
}

/**
 * Make a `useActor` handle forget the public API methods it cached when `definition` is swapped.
 * The engine drops the listener when it stops.
 */
export function trackActorHandle<Props, PublicAPI>(
  definition: ActorDefinition<Props, PublicAPI>,
  engine: GwenEngine,
  drop: () => void,
): void {
  const control = actorControlOf(definition);
  if (control === undefined || engine.disposables.closed) return;
  engine.disposables.add("hot-actor-handle", createDisposable(control.listen(drop)));
}
