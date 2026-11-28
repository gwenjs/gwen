import { describe, expect, it } from "vitest";
import { definePlugin } from "@gwenjs/kit/plugin";
import { GwenError, type GwenEngineBase, type GwenPluginServiceKey } from "@gwenjs/schema";
import { defineActor, onStart } from "../../src/actor/runtime/define-actor.js";
import { defineLayout } from "../../src/actor/runtime/define-layout.js";
import { definePrefab } from "../../src/actor/runtime/define-prefab.js";
import { placeActor } from "../../src/actor/runtime/place.js";
import { useLayout } from "../../src/actor/runtime/use-layout.js";
import type { GwenEngine, GwenPlugin } from "../../src/engine/engine-types.js";
import { engineLocalCount } from "../../src/hmr/engine-local-count.js";
import {
  hotReplaceActor,
  hotReplaceLayout,
  hotReplacePlugin,
  hotReplaceScene,
  hotReplaceSystem,
  registerSceneHandles,
  type GwenHotReport,
} from "../../src/internal.js";
import { defineScene } from "../../src/scene/runtime/define-scene.js";
import { useSystem } from "../../src/scene/runtime/scene-context.js";
import { SceneEnginePlugin } from "../../src/scene/engine-plugin.js";
import { defineComponent, Types } from "../../src/schema.js";
import { defineSystem, onUpdate, useService } from "../../src/system/runtime/define-system.js";
import { createRealEngine } from "./harness.js";

const Marker = defineComponent({ name: "P783WasmMarker", schema: { v: Types.f32 } });
const Hp = defineComponent({ name: "P783WasmHp", schema: { hp: Types.f32 } });
const Prefab = definePrefab([{ def: Hp, defaults: { hp: 1 } }]);
const noServices: readonly GwenPluginServiceKey[] = [];

declare module "@gwenjs/schema" {
  interface GwenProvides {
    "p783:wasm-svc": { readonly n: number };
  }
}

interface Snapshot {
  readonly entities: number;
  readonly componentBytes: number | undefined;
  readonly componentTypes: number;
  readonly hookListeners: number;
  readonly engineLocals: number;
}

function snapshot(engine: GwenEngine, id: ReturnType<GwenEngine["createEntity"]>): Snapshot {
  return {
    entities: engine.getStats().entityCount,
    componentBytes: engine.getComponent(id, Marker)?.v,
    componentTypes: engine.registeredComponentTypes().size,
    hookListeners: engine.getStats().hookListeners,
    engineLocals: engineLocalCount(engine),
  };
}

function marker(engine: GwenEngine): ReturnType<GwenEngine["createEntity"]> {
  const id = engine.createEntity();
  engine.addComponent(id, Marker, { v: 7 });
  return id;
}

async function proveClean(
  engine: GwenEngine,
  id: ReturnType<GwenEngine["createEntity"]>,
  swap: (generation: number) => Promise<GwenHotReport>,
  lastGeneration: () => number | undefined,
): Promise<void> {
  await engine.advance(0.016);
  const cold = snapshot(engine, id);
  let swapped = 0;
  for (let n = 1; n <= 50; n++) {
    const report = await swap(n);
    if (report.status === "applied") swapped += report.count;
    await engine.advance(0.016);
  }
  expect(cold.engineLocals).toBeGreaterThan(0);
  expect(swapped).toBe(50);
  expect(lastGeneration()).toBe(50);
  expect(snapshot(engine, id)).toEqual(cold);
}

function caught(run: () => unknown): unknown {
  try {
    return run();
  } catch (error: unknown) {
    return error;
  }
}

describe.runIf(__GWEN_DEV__)("hot swaps start clean (real WASM)", () => {
  it("after 50 system swaps the entity count, component bytes, type count, hook counts and EngineLocal count equal the baseline", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 64 });
    try {
      const generations: number[] = [];
      const body = (n: number) =>
        defineSystem("P783Counter", () => {
          onUpdate(() => {
            generations.push(n);
          });
        });
      let current = body(0);
      await handle.engine.use(current());
      const id = marker(handle.engine);
      await proveClean(
        handle.engine,
        id,
        async (n) => {
          const next = body(n);
          const report = await hotReplaceSystem(current, next);
          current = next;
          return report;
        },
        () => generations.at(-1),
      );
    } finally {
      await handle.dispose();
    }
  });

  it("after 50 actor swaps the entity count, component bytes, type count, hook counts and EngineLocal count equal the baseline", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 64 });
    try {
      const generations: number[] = [];
      const body = (n: number) =>
        defineActor("P783Unit", Prefab, () => {
          onStart(() => {
            generations.push(n);
          });
          return {};
        });
      let current = body(0);
      await handle.engine.use(current._plugin);
      current._plugin.spawn();
      const id = marker(handle.engine);
      await proveClean(
        handle.engine,
        id,
        async (n) => {
          const next = body(n);
          const report = await hotReplaceActor(current, next);
          current = next;
          return report;
        },
        () => generations.at(-1),
      );
    } finally {
      await handle.dispose();
    }
  });

  it("after 50 scene swaps the entity count, component bytes, type count, hook counts and EngineLocal count equal the baseline", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 64 });
    try {
      const generations: number[] = [];
      const body = (n: number) =>
        defineScene("P783Room", () => {
          const Tick = defineSystem("P783Tick", () => {
            onUpdate(() => {
              generations.push(n);
            });
          });
          useSystem(Tick());
        });
      let current = body(0);
      await handle.engine.use(SceneEnginePlugin());
      const def = handle.engine.run(() => current({ register() {} }));
      registerSceneHandles(handle.engine, def.name, def.handles);
      for (const plugin of def.systems) await handle.engine.use(plugin);
      await handle.engine.hooks.callHook("scene:enter", def.name);
      const id = marker(handle.engine);
      await proveClean(
        handle.engine,
        id,
        async (n) => {
          const next = body(n);
          const report = await hotReplaceScene(current, next);
          current = next;
          return report;
        },
        () => generations.at(-1),
      );
    } finally {
      await handle.dispose();
    }
  });

  it("after 50 layout swaps the entity count, component bytes, type count, hook counts and EngineLocal count equal the baseline", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 64 });
    try {
      const generations: number[] = [];
      const Unit = defineActor("P783LayoutUnit", Prefab, () => ({}));
      await handle.engine.use(Unit._plugin);
      const body = (n: number) =>
        defineLayout(() => {
          generations.push(n);
          return { unit: placeActor(Unit, { at: [0, 0] }) };
        });
      let current = body(0);
      const layout = handle.engine.run(() => useLayout(current, { lazy: true }));
      await layout.load();
      const id = marker(handle.engine);
      await proveClean(
        handle.engine,
        id,
        async (n) => {
          const next = body(n);
          const report = await hotReplaceLayout(current, next);
          current = next;
          return report;
        },
        () => generations.at(-1),
      );
    } finally {
      await handle.dispose();
    }
  });

  it("after 50 plugin swaps the entity count, component bytes, type count, hook counts and EngineLocal count equal the baseline", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 64 });
    try {
      const setups: number[] = [];
      const id = marker(handle.engine);
      const localPlugin = (generation: number): GwenPlugin => {
        const Plug = defineComponent({
          name: `P783Plug${generation}`,
          schema: { v: Types.f32 },
        });
        let owned: ReturnType<GwenEngine["createEntity"]> | undefined;
        return definePlugin({ provides: noServices }, () => ({
          name: "Local",
          setup(host: GwenEngineBase) {
            setups.push(generation);
            host.hooks.hook("engine:tick", () => {});
            owned = handle.engine.createEntity();
            handle.engine.addComponent(owned, Plug, { v: 7 });
            handle.engine.addComponent(id, Marker, { v: 7 });
          },
          teardown() {
            if (owned !== undefined) handle.engine.destroyEntity(owned);
          },
        }))();
      };
      await handle.engine.use(localPlugin(0));
      await proveClean(
        handle.engine,
        id,
        (n) => hotReplacePlugin(handle.engine, "Local", localPlugin(n)),
        () => setups.at(-1),
      );
    } finally {
      await handle.dispose();
    }
  });

  it("after 50 plugin swaps with hot state and a service reader the counts equal the baseline and the state and the reader follow", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 64 });
    try {
      const id = marker(handle.engine);
      const restored: unknown[] = [];
      const seen: number[] = [];
      const Reader = defineSystem("P783Reader", () => {
        const svc = useService("p783:wasm-svc");
        onUpdate(() => {
          seen.push(svc.n);
        });
      });
      const localPlugin = (generation: number): GwenPlugin => ({
        name: "Local",
        provides: ["p783:wasm-svc"],
        setup(host: GwenEngineBase) {
          host.provide("p783:wasm-svc", { n: generation });
        },
        hot: { save: () => generation, restore: (state) => restored.push(state) },
      });
      await handle.engine.use(localPlugin(0));
      await handle.engine.use(Reader());
      await proveClean(
        handle.engine,
        id,
        (n) => hotReplacePlugin(handle.engine, "Local", localPlugin(n)),
        () => seen.at(-1),
      );
      expect(restored).toEqual(Array.from({ length: 50 }, (_, i) => i));
    } finally {
      await handle.dispose();
    }
  });

  it("a view re-created by name after a swap does not throw CORE:MEMORY_VIEW_INVALID", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 64 });
    const notes: string[] = [];
    const off = handle.engine.errors.on((event) => {
      notes.push(event.code);
    });
    try {
      const views: Array<{ dispose(): void }> = [];
      const withView = (): GwenPlugin =>
        definePlugin({ provides: noServices }, () => ({
          name: "Viewer",
          setup() {
            views.push(
              handle.engine.memory.view({
                name: "p783:wasm-view",
                type: "u8",
                ptr: () => 0,
                length: () => 1,
              }),
            );
          },
          teardown() {
            views.at(-1)?.dispose();
          },
        }))();
      await handle.engine.use(withView());

      const report = await hotReplacePlugin(handle.engine, "Viewer", withView());

      expect(report).toEqual({ status: "applied", kind: "plugin", name: "Viewer", count: 1 });
      expect(views).toHaveLength(2);
      expect(notes.filter((code) => code === "CORE:MEMORY_VIEW_INVALID")).toEqual([]);
      expect(handle.engine.getStats().plugins).toEqual(["Viewer"]);
    } finally {
      off();
      await handle.dispose();
    }
  });

  it("stop() after swaps leaves nothing behind", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 64 });
    const { engine, bridge } = handle;
    try {
      const teardowns: number[] = [];
      const localPlugin = (generation: number): GwenPlugin =>
        definePlugin({ provides: noServices }, () => ({
          name: "Local",
          setup(host: GwenEngineBase) {
            host.hooks.hook("engine:tick", () => {});
          },
          teardown() {
            teardowns.push(generation);
          },
        }))();
      await engine.use(localPlugin(0));
      let swapped = 0;
      for (let n = 1; n <= 50; n++) {
        const report = await hotReplacePlugin(engine, "Local", localPlugin(n));
        if (report.status === "applied") swapped += report.count;
      }
      const live = engineLocalCount(engine);

      expect(live).toBeGreaterThan(0);
      await handle.dispose();
      expect(engineLocalCount(engine)).toBe(0);
      expect(swapped).toBe(50);
      expect(teardowns).toEqual(Array.from({ length: 51 }, (_, index) => index));
      const error = caught(() => bridge.countEntities());
      expect(error).toBeInstanceOf(GwenError);
      if (error instanceof GwenError) expect(error.code).toBe("CORE:ENGINE_DISPOSED");
    } finally {
      await handle.dispose();
    }
  });
});
