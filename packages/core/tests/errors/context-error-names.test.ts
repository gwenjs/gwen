/**
 * @file Context errors name the composable and the valid contexts (P-64-2a).
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  createEngine,
  defineComponent,
  GwenContextError,
  Types,
  useEngine,
  withAsyncContext,
  type GwenEngine,
} from "@gwenjs/core";
import {
  defineActor,
  definePrefab,
  onDestroy,
  onDisable,
  onEnable,
  onRelease,
  onReset,
  onStart,
  placeActor,
  placeGroup,
  placePrefab,
  useActor,
  useChildren,
  useComponent,
  useEntityId,
  useTransform,
} from "@gwenjs/core/actor";
import { getWasmBridge } from "@gwenjs/core/internal";
import {
  defineScene,
  defineSceneRouter,
  onEnter,
  onExit,
  onTransitionEnter,
  onTransitionLeave,
  useSceneRouter,
  useSystem,
} from "@gwenjs/core/scene";
import {
  defineSystem,
  onAfterUpdate,
  onBeforeUpdate,
  onRender,
  onUpdate,
} from "@gwenjs/core/system";
import { onCleanup } from "../../src/hooks/index.js";

const ENGINE_FIRST =
  "[useEngine()] Called outside defineSystem() or defineActor() or defineScene() or plugin setup() or engine.run().";
const ENGINE_SEE =
  "See https://gwenjs.github.io/gwen/api/errors#core-outside-engine-context (CORE:OUTSIDE_ENGINE_CONTEXT)";
const ENGINE_CONTEXTS = [
  "defineSystem()",
  "defineActor()",
  "defineScene()",
  "plugin setup()",
  "engine.run()",
];

function thrownBy(fn: () => unknown): GwenContextError {
  let error: unknown;
  try {
    fn();
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(GwenContextError);
  if (!(error instanceof GwenContextError)) throw new Error("expected GwenContextError");
  return error;
}

describe("context error names", () => {
  const engines: GwenEngine[] = [];

  afterEach(async () => {
    for (const engine of engines.splice(0)) await engine.stop();
  });

  async function open(): Promise<GwenEngine> {
    const engine = await createEngine({ maxEntities: 16 });
    engines.push(engine);
    return engine;
  }

  it("onUpdate outside a system names onUpdate and its two valid contexts", async () => {
    await open();
    const error = thrownBy(() => onUpdate(() => {}));
    expect(error.code).toBe("CORE:OUTSIDE_SYSTEM_CONTEXT");
    expect(error.composable).toBe("onUpdate");
    expect(error.validContexts).toEqual(["defineSystem()", "defineActor()"]);
  });

  it("useSystem outside a scene names useSystem", async () => {
    await open();
    const error = thrownBy(() => useSystem(defineSystem("T", () => {})()));
    expect(error.code).toBe("CORE:OUTSIDE_SCENE_CONTEXT");
    expect(error.composable).toBe("useSystem");
  });

  it("onCleanup outside its contexts names onCleanup and withCleanup()", async () => {
    await open();
    const error = thrownBy(() => onCleanup(() => {}));
    expect(error.code).toBe("CORE:OUTSIDE_CLEANUP_CONTEXT");
    expect(error.composable).toBe("onCleanup");
    expect(error.validContexts).toContain("withCleanup()");
  });

  it("useSceneRouter outside an engine names useSceneRouter", async () => {
    await open();
    const scene = defineScene("OutsideMenu", () => {});
    const router = defineSceneRouter({
      initial: "menu",
      routes: { menu: { scene, on: {} } },
    });
    expect(thrownBy(() => useSceneRouter(router)).composable).toBe("useSceneRouter");
  });

  it("useEngine outside an engine names useEngine and five contexts", async () => {
    await open();
    const error = thrownBy(() => useEngine());
    expect(error.composable).toBe("useEngine");
    expect(error.validContexts).toEqual(ENGINE_CONTEXTS);
  });

  it("withAsyncContext without a context names withAsyncContext", async () => {
    await open();
    const wrapped = withAsyncContext(async () => "done");
    expect(thrownBy(() => wrapped()).composable).toBe("withAsyncContext");
  });

  it("the first line and the See line are the same in production", async () => {
    await open();
    const error = thrownBy(() => useEngine());
    const lines = error.message.split("\n");
    expect(lines[0]).toBe(ENGINE_FIRST);
    expect(lines[lines.length - 1]).toBe(ENGINE_SEE);
    if (__GWEN_DEV__) {
      expect(lines.length).toBeGreaterThanOrEqual(3);
      expect(error.message).toContain("Fix:");
    } else {
      expect(lines).toHaveLength(2);
      expect(error.message.includes("Fix:")).toBe(false);
    }
  });

  it("two engines: a context error in engine A's system factory leaves engine B's factory working", async () => {
    const a = await open();
    const b = await open();
    const bad = defineSystem("Bad", () => {
      useSystem(defineSystem("Inner", () => {})());
    });
    let thrown: unknown;
    try {
      await a.use(bad());
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(GwenContextError);
    if (!(thrown instanceof GwenContextError)) return;
    expect(thrown.code).toBe("CORE:OUTSIDE_SCENE_CONTEXT");
    expect(thrown.composable).toBe("useSystem");
    let ran = false;
    const good = defineSystem("Good", () => {
      onUpdate(() => {
        ran = true;
      });
    });
    await b.use(good());
    await b.advance(0.016);
    expect(ran).toBe(true);
  });

  it("every defineSystem hook names itself", async () => {
    await open();
    const hooks: readonly [string, (fn: () => void) => void][] = [
      ["onBeforeUpdate", onBeforeUpdate],
      ["onUpdate", onUpdate],
      ["onAfterUpdate", onAfterUpdate],
      ["onRender", onRender],
    ];
    for (const [name, hook] of hooks) {
      const error = thrownBy(() => hook(() => {}));
      expect(error.code).toBe("CORE:OUTSIDE_SYSTEM_CONTEXT");
      expect(error.composable).toBe(name);
    }
  });

  it("every scene hook names itself", async () => {
    await open();
    const hooks: readonly [string, () => void][] = [
      ["useSystem", () => useSystem(defineSystem("Inner", () => {})())],
      ["onEnter", () => onEnter(() => {})],
      ["onExit", () => onExit(() => {})],
      ["onTransitionLeave", () => onTransitionLeave(() => {})],
      ["onTransitionEnter", () => onTransitionEnter(() => {})],
    ];
    for (const [name, hook] of hooks) {
      const error = thrownBy(() => hook());
      expect(error.code).toBe("CORE:OUTSIDE_SCENE_CONTEXT");
      expect(error.composable).toBe(name);
    }
  });

  it("getWasmBridge outside an engine names getWasmBridge", async () => {
    await open();
    expect(thrownBy(() => getWasmBridge()).composable).toBe("getWasmBridge");
  });

  it("an actor read with no engine names Actor.spawn", async () => {
    const a = await open();
    const b = await open();
    const Position = defineComponent({
      name: "ContextErrorPos",
      schema: { x: Types.f32, y: Types.f32 },
    });
    const Prefab = definePrefab([{ def: Position, defaults: { x: 0, y: 0 } }]);
    const Actor = defineActor(Prefab, () => ({}));
    await a.use(Actor._plugin);
    await b.use(Actor._plugin);
    const handle = a.run(() => useActor(Actor));
    a.run(() => handle.spawn());
    expect(thrownBy(() => handle.count()).composable).toBe("Actor.spawn");
  });

  it("useEntityId inside a system names useEntityId, not _getActorEntityId", async () => {
    const engine = await open();
    const system = defineSystem("EntityIdOutside", () => {
      useEntityId();
    });
    let error: unknown;
    try {
      await engine.use(system());
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(GwenContextError);
    if (!(error instanceof GwenContextError)) return;
    expect(error.code).toBe("CORE:OUTSIDE_ACTOR_CONTEXT");
    expect(error.composable).toBe("useEntityId");
    expect(error.message.includes("_getActor")).toBe(false);
  });

  it("useEntityId outside an actor has no Fix line in production", async () => {
    const engine = await open();
    const system = defineSystem("EntityIdProd", () => {
      useEntityId();
    });
    let error: unknown;
    try {
      await engine.use(system());
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(GwenContextError);
    if (!(error instanceof GwenContextError)) return;
    const lines = error.message.split("\n");
    expect(lines[0]).toBe("[useEntityId()] Called outside defineActor().");
    expect(lines[lines.length - 1]).toBe(
      "See https://gwenjs.github.io/gwen/api/errors#core-outside-actor-context (CORE:OUTSIDE_ACTOR_CONTEXT)",
    );
    if (__GWEN_DEV__) {
      expect(error.message).toContain("Fix:");
    } else {
      expect(lines).toHaveLength(2);
      expect(error.message.includes("Fix:")).toBe(false);
    }
  });

  it("useTransform outside an actor names useTransform", async () => {
    const engine = await open();
    const error = thrownBy(() => engine.run(() => useTransform()));
    expect(error.composable).toBe("useTransform");
    expect(error.message.includes("_getActor")).toBe(false);
  });

  it("placeActor outside a layout names placeActor", async () => {
    await open();
    const Position = defineComponent({
      name: "PlaceActorNamesPos",
      schema: { x: Types.f32 },
    });
    const prefab = definePrefab([{ def: Position, defaults: { x: 0 } }]);
    const actor = defineActor(prefab, () => ({}));
    const error = thrownBy(() => placeActor(actor));
    expect(error.code).toBe("CORE:OUTSIDE_LAYOUT_CONTEXT");
    expect(error.composable).toBe("placeActor");
  });

  it("the outer actor context is back after a nested factory throws", async () => {
    const engine = await open();
    const Position = defineComponent({
      name: "NestedCtxPos",
      schema: { x: Types.f32 },
    });
    const prefab = definePrefab([{ def: Position, defaults: { x: 0 } }]);
    const Inner = defineActor(prefab, () => {
      placeGroup();
    });
    let outerId: ReturnType<typeof useEntityId> | undefined;
    let caught: unknown;
    const Outer = defineActor(prefab, () => {
      try {
        Inner._plugin.spawn();
      } catch (error) {
        caught = error;
      }
      outerId = useEntityId();
    });
    await engine.use(Inner._plugin);
    await engine.use(Outer._plugin);
    const spawned = Outer._plugin.spawn();
    expect(outerId).toBe(spawned);
    expect(caught).toBeInstanceOf(GwenContextError);
    if (!(caught instanceof GwenContextError)) throw new Error("expected GwenContextError");
    expect(caught.code).toBe("CORE:OUTSIDE_LAYOUT_CONTEXT");
    expect(caught.composable).toBe("placeGroup");
  });

  it("every actor hook names itself", async () => {
    const engine = await open();
    const Position = defineComponent({
      name: "HookNamesPos",
      schema: { x: Types.f32 },
    });
    const hooks: readonly [string, () => void][] = [
      ["useEntityId", () => useEntityId()],
      ["onStart", () => onStart(() => {})],
      ["onDestroy", () => onDestroy(() => {})],
      ["onRelease", () => onRelease(() => {})],
      ["onReset", () => onReset(() => {})],
      ["onEnable", () => onEnable(() => {})],
      ["onDisable", () => onDisable(() => {})],
      ["useChildren", () => useChildren()],
      ["useComponent", () => useComponent(Position)],
    ];
    engine.run(() => {
      for (const [name, hook] of hooks) {
        const error = thrownBy(() => hook());
        expect(error.code).toBe("CORE:OUTSIDE_ACTOR_CONTEXT");
        expect(error.composable).toBe(name);
      }
    });
  });

  it("placeGroup and placePrefab outside a layout name themselves", async () => {
    await open();
    const Position = defineComponent({
      name: "PlaceNamesPos",
      schema: { x: Types.f32 },
    });
    const prefab = definePrefab([{ def: Position, defaults: { x: 0 } }]);
    const hooks: readonly [string, () => void][] = [
      ["placeGroup", () => placeGroup()],
      ["placePrefab", () => placePrefab(prefab)],
    ];
    for (const [name, hook] of hooks) {
      const error = thrownBy(() => hook());
      expect(error.code).toBe("CORE:OUTSIDE_LAYOUT_CONTEXT");
      expect(error.composable).toBe(name);
    }
  });
});
