/**
 * @file Context matrix of the composables of the five core entries (#75, P-75-3b).
 *
 * Each composable has one row. Outside any context every row throws the same
 * error class, `GwenContextError`, with the code of its column and its own name
 * in `composable`. Inside `engine.run()` an engine-bound row throws no context
 * error, and every other column keeps its own code.
 *
 * The set of rows is compared with the exports of the entries, not with a list
 * written in this file: a new composable without a row, or a row whose export is
 * gone, fails the test.
 */

import { afterEach, describe, expect, it } from "vitest";
import { GwenContextErrorCodes, type GwenContextErrorCode } from "@gwenjs/kit";
import * as root from "../src/index";
import * as system from "../src/system/index";
import * as actor from "../src/actor/index";
import * as scene from "../src/scene/index";
import * as tween from "../src/tween/index";
import { createEngine } from "../src/node";
import { createEntityId } from "../src/types/entity";
import { definePrefab } from "../src/actor/runtime/define-prefab";
import { defineActor } from "../src/actor/runtime/define-actor";
import { defineActorPool } from "../src/actor/runtime/pool/define-actor-pool";
import { defineLayout } from "../src/actor/runtime/define-layout";
import { defineScene } from "../src/scene/index";
import { defineSceneRouter } from "../src/router/defines/define-scene-router";
import { defineSystem } from "../src/system/runtime/define-system";
import { GwenContextError } from "../src/engine/context";
import { stubComponent } from "./helpers/stub-component";
import type { GwenEngine } from "../src/engine/engine-types";

declare module "@gwenjs/schema" {
  interface GwenRuntimeHooks {
    "composable-context:ping": () => void;
  }
  interface GwenProvides {
    "composable-context": { readonly n: number };
  }
}

declare module "../src/engine/engine-types.js" {
  interface GwenWasmModules {
    "composable-context": WebAssembly.Exports;
  }
}

type Kind = "engine" | "cleanup" | "frame" | "actor" | "scene" | "layout";

interface Cell {
  /** Which column of the matrix the call belongs to. */
  readonly kind: Kind;
  /** Calls the composable with arguments that are valid for it. */
  readonly call: () => unknown;
}

const Position = stubComponent("ComposableContextPosition");
const Prefab = definePrefab([{ def: Position, defaults: { x: 0, y: 0 } }]);
const Actor = defineActor(Prefab, () => ({ value: 1 }));
const PoolDef = defineActorPool(Actor, { size: 2 });
const Layout = defineLayout(() => ({}));
const Scene = defineScene("composable-context-scene", () => {});
const Router = defineSceneRouter({
  initial: "start",
  routes: { start: { scene: Scene, on: {} } },
});
const SomeSystem = defineSystem("ComposableContextSystem", () => {});
const SomeEntity = createEntityId(1, 1);

/** One entry per composable. A composable with two call forms has two cells. */
const ROWS: Readonly<Record<string, readonly Cell[]>> = {
  useEngine: [{ kind: "engine", call: () => root.useEngine() }],
  useHook: [{ kind: "engine", call: () => root.useHook("engine:start", () => {}) }],
  emit: [{ kind: "engine", call: () => root.emit("composable-context:ping") }],
  onCleanup: [{ kind: "cleanup", call: () => root.onCleanup(() => {}) }],

  onBeforeUpdate: [{ kind: "frame", call: () => system.onBeforeUpdate(() => {}) }],
  onUpdate: [{ kind: "frame", call: () => system.onUpdate(() => {}) }],
  onAfterUpdate: [{ kind: "frame", call: () => system.onAfterUpdate(() => {}) }],
  onRender: [{ kind: "frame", call: () => system.onRender(() => {}) }],
  useQuery: [{ kind: "engine", call: () => system.useQuery([Position]) }],
  useService: [{ kind: "engine", call: () => system.useService("composable-context") }],
  useWasmModule: [{ kind: "engine", call: () => system.useWasmModule("composable-context") }],
  useComponent: [
    { kind: "actor", call: () => system.useComponent(Position) },
    { kind: "engine", call: () => system.useComponent(SomeEntity, Position) },
  ],

  onStart: [{ kind: "actor", call: () => actor.onStart(() => {}) }],
  onDestroy: [{ kind: "actor", call: () => actor.onDestroy(() => {}) }],
  onRelease: [{ kind: "actor", call: () => actor.onRelease(() => {}) }],
  onReset: [{ kind: "actor", call: () => actor.onReset(() => {}) }],
  onEnable: [{ kind: "actor", call: () => actor.onEnable(() => {}) }],
  onDisable: [{ kind: "actor", call: () => actor.onDisable(() => {}) }],
  useEntityId: [{ kind: "actor", call: () => actor.useEntityId() }],
  useTransform: [{ kind: "actor", call: () => actor.useTransform() }],
  useChildren: [{ kind: "actor", call: () => actor.useChildren() }],
  useActor: [{ kind: "engine", call: () => actor.useActor(Actor) }],
  usePrefab: [{ kind: "engine", call: () => actor.usePrefab(Prefab) }],
  useLayout: [{ kind: "engine", call: () => actor.useLayout(Layout) }],
  useActorPool: [{ kind: "engine", call: () => actor.useActorPool(PoolDef) }],
  useActorQuery: [{ kind: "engine", call: () => actor.useActorQuery(Actor, []) }],
  placeActor: [{ kind: "layout", call: () => actor.placeActor(Actor) }],
  placeGroup: [{ kind: "layout", call: () => actor.placeGroup() }],
  placePrefab: [{ kind: "layout", call: () => actor.placePrefab(Prefab) }],

  useSceneRouter: [{ kind: "engine", call: () => scene.useSceneRouter(Router) }],
  useSystem: [{ kind: "scene", call: () => scene.useSystem(SomeSystem()) }],
  onEnter: [{ kind: "scene", call: () => scene.onEnter(() => {}) }],
  onExit: [{ kind: "scene", call: () => scene.onExit(() => {}) }],
  onTransitionExit: [{ kind: "scene", call: () => scene.onTransitionExit(() => {}) }],
  onTransitionEnter: [{ kind: "scene", call: () => scene.onTransitionEnter(() => {}) }],

  useTween: [
    {
      kind: "engine",
      call: () => tween.useTween({ duration: 1 }),
    },
  ],
  useSequence: [{ kind: "engine", call: () => tween.useSequence([]) }],
};

const CODES: Readonly<
  Record<Kind, { outside: GwenContextErrorCode; run: GwenContextErrorCode | null }>
> = {
  engine: { outside: GwenContextErrorCodes.OUTSIDE_ENGINE_CONTEXT, run: null },
  cleanup: {
    outside: GwenContextErrorCodes.OUTSIDE_CLEANUP_CONTEXT,
    run: GwenContextErrorCodes.OUTSIDE_CLEANUP_CONTEXT,
  },
  frame: {
    outside: GwenContextErrorCodes.OUTSIDE_SYSTEM_CONTEXT,
    run: GwenContextErrorCodes.OUTSIDE_SYSTEM_CONTEXT,
  },
  actor: {
    outside: GwenContextErrorCodes.OUTSIDE_ACTOR_CONTEXT,
    run: GwenContextErrorCodes.OUTSIDE_ACTOR_CONTEXT,
  },
  scene: {
    outside: GwenContextErrorCodes.OUTSIDE_SCENE_CONTEXT,
    run: GwenContextErrorCodes.OUTSIDE_SCENE_CONTEXT,
  },
  layout: {
    outside: GwenContextErrorCodes.OUTSIDE_LAYOUT_CONTEXT,
    run: GwenContextErrorCodes.OUTSIDE_LAYOUT_CONTEXT,
  },
};

// A class is detected by its source text, which starts with `class`.
function isClass(value: unknown): boolean {
  return typeof value === "function" && /^class\b/.test(Function.prototype.toString.call(value));
}

/** Names of the composables exported by the five entries. */
function exportedComposables(): string[] {
  const names = new Set<string>();
  for (const entry of [root, system, actor, scene, tween]) {
    for (const [name, value] of Object.entries(entry)) {
      if (typeof value !== "function" || isClass(value)) continue;
      // `emit` is the one composable of the root that does not carry a prefix.
      if (/^(use|on|place)[A-Z]/.test(name) || name === "emit") names.add(name);
    }
  }
  return [...names].sort();
}

function thrownBy(fn: () => unknown): unknown {
  try {
    fn();
  } catch (caught) {
    return caught;
  }
  return undefined;
}

/** Describes how `error` differs from a context error with `code`, or `null`. */
function mismatch(name: string, error: unknown, code: GwenContextErrorCode): string | null {
  if (!(error instanceof GwenContextError)) {
    return `${name}: expected GwenContextError ${code}, got ${String(error)}`;
  }
  if (error.code !== code) return `${name}: expected code ${code}, got ${error.code}`;
  if (error.composable !== name) return `${name}: composable field is "${error.composable}"`;
  return null;
}

describe("composable context matrix", () => {
  const engines: GwenEngine[] = [];

  afterEach(async () => {
    for (const engine of engines.splice(0)) await engine.stop();
  });

  it("outside any context and inside engine.run, every use*/on*/place* export follows the context matrix", async () => {
    const divergences: string[] = [];

    // Completeness: the rows are checked against the exports, both ways.
    const exported = exportedComposables();
    for (const name of exported) {
      if (!(name in ROWS)) divergences.push(`no-row:${name}`);
    }
    for (const name of Object.keys(ROWS)) {
      if (!exported.includes(name)) divergences.push(`stale-row:${name}`);
    }

    for (const [name, cells] of Object.entries(ROWS)) {
      for (const cell of cells) {
        const problem = mismatch(name, thrownBy(cell.call), CODES[cell.kind].outside);
        if (problem !== null) divergences.push(`outside ${problem}`);
      }
    }

    const engine = await createEngine({ maxEntities: 16 });
    engines.push(engine);
    // Nothing a row does inside `engine.run` may go to the error bus: a context
    // failure is thrown, not reported.
    engine.errors.on((event) => divergences.push(`bus ${event.code}: ${event.message}`));
    for (const [name, cells] of Object.entries(ROWS)) {
      for (const cell of cells) {
        const error = engine.run(() => thrownBy(cell.call));
        const code = CODES[cell.kind].run;
        if (code === null) {
          // Engine-bound rows may still fail inside engine.run, for a reason
          // that is not a context failure (missing service, missing plugin).
          if (error instanceof GwenContextError) {
            divergences.push(`run ${name}: ${String(error.code)} inside engine.run`);
          }
          continue;
        }
        const problem = mismatch(name, error, code);
        if (problem !== null) divergences.push(`run ${problem}`);
      }
    }

    expect(divergences).toEqual([]);
  });
});
