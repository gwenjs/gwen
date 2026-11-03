/**
 * @file Context matrix on a real engine (#75, P-75-3b).
 *
 * Four columns run the same composables: a system factory, an actor factory,
 * a scene factory and a plugin setup. A global pool survives a scene change
 * driven by the real router; an unscoped pool does not.
 */

import { describe, expect, it } from "vitest";
import { GwenContextErrorCodes } from "@gwenjs/kit";

import {
  defineActor,
  defineActorPool,
  definePrefab,
  onDestroy,
  onStart,
  useActor,
  useActorPool,
  useChildren,
  useEntityId,
} from "../../src/actor/index.js";
import { defineComponent, GwenContextError, Types } from "../../src/index.js";
import { defineSceneRouter, useSceneRouter } from "../../src/router/index.js";
import {
  defineScene,
  onEnter,
  onExit,
  onTransitionEnter,
  onTransitionExit,
  useSystem,
} from "../../src/scene/index.js";
import {
  defineSystem,
  onAfterUpdate,
  onBeforeUpdate,
  onRender,
  onUpdate,
} from "../../src/system/index.js";
import { createRealEngine } from "./harness.js";

const Marker = defineComponent({
  name: "ComposableContextMarker",
  schema: { v: Types.u32 },
});
const Prefab = definePrefab([{ def: Marker, defaults: { v: 1 } }]);

type Column = "system" | "actor" | "scene" | "plugin";
const COLUMNS: readonly Column[] = ["system", "actor", "scene", "plugin"];

/** Result of one call: `ok`, or the code of the context error it threw. */
type Outcome = string;

const OK = "ok";
const ACTOR = GwenContextErrorCodes.OUTSIDE_ACTOR_CONTEXT;
const SCENE = GwenContextErrorCodes.OUTSIDE_SCENE_CONTEXT;
const SYSTEM = GwenContextErrorCodes.OUTSIDE_SYSTEM_CONTEXT;

function outcomeOf(fn: () => unknown): Outcome {
  try {
    fn();
  } catch (caught) {
    if (caught instanceof GwenContextError) return caught.code;
    return `threw ${String(caught)}`;
  }
  return OK;
}

describe("real WASM composable context", () => {
  it("scene factory and plugin setup reject the frame-phase composables with CORE:OUTSIDE_SYSTEM_CONTEXT, every other column matches the matrix", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 64 });
    const divergences: string[] = [];
    try {
      const { engine } = handle;

      const PoolActor = defineActor("context-pool-probe", Prefab, () => {});
      const PoolDef = defineActorPool(PoolActor, { size: 2 });

      // One row per composable. `expected` is the outcome in each column.
      interface Probe {
        readonly name: string;
        readonly call: () => unknown;
        readonly expected: Readonly<Record<Column, Outcome>>;
      }
      const frame = (name: string, call: () => unknown): Probe => ({
        name,
        call,
        expected: { system: OK, actor: OK, scene: SYSTEM, plugin: SYSTEM },
      });
      const actorOnly = (name: string, call: () => unknown): Probe => ({
        name,
        call,
        expected: { system: ACTOR, actor: OK, scene: ACTOR, plugin: ACTOR },
      });
      const sceneOnly = (name: string, call: () => unknown): Probe => ({
        name,
        call,
        expected: { system: SCENE, actor: SCENE, scene: OK, plugin: SCENE },
      });
      const everywhere = (name: string, call: () => unknown): Probe => ({
        name,
        call,
        expected: { system: OK, actor: OK, scene: OK, plugin: OK },
      });
      const NoopSystem = defineSystem("context-noop-system", () => {});

      const probes: readonly Probe[] = [
        frame("onBeforeUpdate", () => onBeforeUpdate(() => {})),
        frame("onUpdate", () => onUpdate(() => {})),
        frame("onAfterUpdate", () => onAfterUpdate(() => {})),
        frame("onRender", () => onRender(() => {})),
        actorOnly("onStart", () => onStart(() => {})),
        actorOnly("onDestroy", () => onDestroy(() => {})),
        actorOnly("useEntityId", () => useEntityId()),
        actorOnly("useChildren", () => useChildren()),
        sceneOnly("onEnter", () => onEnter(() => {})),
        sceneOnly("onExit", () => onExit(() => {})),
        sceneOnly("onTransitionExit", () => onTransitionExit(() => {})),
        sceneOnly("onTransitionEnter", () => onTransitionEnter(() => {})),
        sceneOnly("useSystem", () => useSystem(NoopSystem())),
        everywhere("useActorPool", () => useActorPool(PoolDef)),
      ];

      const observed = new Map<Column, Map<string, Outcome>>(
        COLUMNS.map((column) => [column, new Map<string, Outcome>()]),
      );
      const record = (column: Column): void => {
        const cells = observed.get(column);
        if (cells === undefined) return;
        for (const probe of probes) cells.set(probe.name, outcomeOf(probe.call));
      };

      // The actor plugin must be installed before the pool probe reaches it.
      await engine.use(PoolActor.plugin);
      await engine.use(PoolDef.plugin);

      // Column: system factory.
      await engine.use(defineSystem("context-system-column", () => record("system"))());

      // Column: actor factory.
      const Probed = defineActor("context-actor-column", Prefab, () => record("actor"));
      await engine.use(Probed.plugin);
      engine.run(() => useActor(Probed)).spawn();

      // Column: scene factory.
      engine.run(() =>
        defineScene("context-scene-column", () => record("scene"))({ register: () => {} }),
      );

      // Column: plugin setup.
      await engine.use({ name: "context-plugin-column", setup: () => record("plugin") });

      for (const probe of probes) {
        for (const column of COLUMNS) {
          const actual = observed.get(column)?.get(probe.name);
          const want = probe.expected[column];
          if (actual !== want) {
            divergences.push(`${column} x ${probe.name}: expected ${want}, got ${String(actual)}`);
          }
        }
      }
    } finally {
      await handle.dispose();
    }
    expect(divergences).toEqual([]);
  });

  it("a global pool survives a scene change and an unscoped pool does not", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 64, scenes: true });
    let globalActive = -1;
    let scopedActive = -1;
    let customActive = -1;
    let mounts = 0;
    let unmounts = 0;
    let unmountsAfterSceneChange = -1;
    try {
      const { engine } = handle;

      const GlobalActor = defineActor("context-global-pool-actor", Prefab, () => {});
      const ScopedActor = defineActor("context-scoped-pool-actor", Prefab, () => {});
      const CustomActor = defineActor("context-custom-pool-actor", Prefab, () => {});
      const GlobalDef = defineActorPool(GlobalActor, { size: 4, scope: "global" });
      const ScopedDef = defineActorPool(ScopedActor, { size: 4 });
      const CustomDef = defineActorPool(CustomActor, {
        size: 4,
        scope: {
          onMount: () => {
            mounts++;
          },
          onUnmount: () => {
            unmounts++;
          },
        },
      });
      await engine.use(GlobalActor.plugin);
      await engine.use(ScopedActor.plugin);
      await engine.use(CustomActor.plugin);
      await engine.use(GlobalDef.plugin);
      await engine.use(ScopedDef.plugin);
      await engine.use(CustomDef.plugin);

      const globalPool = engine.run(() => useActorPool(GlobalDef));
      const scopedPool = engine.run(() => useActorPool(ScopedDef));
      const customPool = engine.run(() => useActorPool(CustomDef));
      globalPool.acquire();
      globalPool.acquire();
      scopedPool.acquire();
      scopedPool.acquire();
      customPool.acquire();
      customPool.acquire();
      expect(customPool.stats().active).toBe(2);
      expect(globalPool.stats().active).toBe(2);
      expect(scopedPool.stats().active).toBe(2);

      const SceneA = defineScene("context-pool-scene-a", () => {
        useActorPool(GlobalDef);
        useActorPool(ScopedDef);
        useActorPool(CustomDef);
      });
      const SceneB = defineScene("context-pool-scene-b", () => {});
      const Router = defineSceneRouter({
        initial: "a",
        routes: {
          a: { scene: SceneA, on: { GO: "b" } },
          b: { scene: SceneB, on: {} },
        },
      });

      await engine.run(async () => {
        await useSceneRouter(Router).send("GO");
      });

      globalActive = globalPool.stats().active;
      scopedActive = scopedPool.stats().active;
      customActive = customPool.stats().active;
      unmountsAfterSceneChange = unmounts;
    } finally {
      await handle.dispose();
    }
    expect({
      global: globalActive,
      custom: customActive,
      unscoped: scopedActive,
      mounts,
      unmountsAfterSceneChange,
    }).toEqual({ global: 2, custom: 2, unscoped: 0, mounts: 1, unmountsAfterSceneChange: 0 });
  });
});
