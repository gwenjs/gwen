/**
 * Actor, layout, router, component and reporter errors use the grammar codes.
 */

import { afterEach, describe, expect, it } from "vitest";
import { GwenError } from "@gwenjs/schema";
import { entityIndex } from "@gwenjs/schema";
import { useErrorReporter } from "@gwenjs/kit";
import { createEngine, type GwenEngine } from "@gwenjs/core";
import {
  defineActor,
  defineActorPool,
  defineLayout,
  definePrefab,
  placeGroup,
  PoolExhaustedError,
  useActor,
  useActorPool,
  useChildren,
  useLayout,
  type PlaceHandle,
} from "@gwenjs/core/actor";
import { defineSystem } from "@gwenjs/core/system";
import { defineScene } from "@gwenjs/core/scene";
import { defineSceneRouter } from "../../src/router/defines/define-scene-router";
import { defineComponent, Types, type ComponentSchema } from "../../src/schema";
import { normalizeComponentType } from "../../src/core/component-type-normalizer";
import { GwenActorError } from "../../src/engine/engine-errors";
import { onStart } from "../../src/actor/runtime/define-actor";

const engines: GwenEngine[] = [];

afterEach(async () => {
  const pending = engines.splice(0);
  for (const engine of pending) await engine.stop();
});

function caught(run: () => void): unknown {
  try {
    run();
    return undefined;
  } catch (error) {
    return error;
  }
}

function isGwen(error: unknown): error is GwenError {
  return error instanceof GwenError;
}

describe("actor and layout error grammar", () => {
  it("spawn before the actor plugin is installed throws CORE:ACTOR_PLUGIN_NOT_READY naming Actor.spawn", async () => {
    const engine = await createEngine({ maxEntities: 32 });
    engines.push(engine);
    const Actor = defineActor(definePrefab([]), () => ({}));
    const error = caught(() => {
      engine.run(() => {
        Actor._plugin.spawn();
      });
    });
    expect(isGwen(error)).toBe(true);
    if (!isGwen(error)) return;
    expect(error.code).toBe("CORE:ACTOR_PLUGIN_NOT_READY");
    expect(error.composable).toBe("Actor.spawn");
    expect(error.message.split("\n")[0]).not.toContain("[GWEN]");
  });

  it("useActor with no live instance throws CORE:ACTOR_NO_LIVE_INSTANCE", async () => {
    const engine = await createEngine({ maxEntities: 32 });
    engines.push(engine);
    const Actor = defineActor(definePrefab([]), () => ({
      shoot(): string {
        return "pew";
      },
    }));
    await engine.use(Actor._plugin);
    const handle = engine.run(() => useActor(Actor));
    const error = caught(() => {
      handle.shoot();
    });
    expect(isGwen(error)).toBe(true);
    if (!isGwen(error)) return;
    expect(error.code).toBe("CORE:ACTOR_NO_LIVE_INSTANCE");
    expect(error.composable).toBe("useActor");
  });

  it("adopting an ancestor throws CORE:ACTOR_CIRCULAR_OWNERSHIP naming useChildren().adopt", async () => {
    const engine = await createEngine({ maxEntities: 32 });
    engines.push(engine);
    let childrenB: ReturnType<typeof useChildren> | undefined;
    const ActorB = defineActor(definePrefab([]), () => {
      childrenB = useChildren();
    });
    const ActorA = defineActor(definePrefab([]), () => {
      const children = useChildren();
      onStart(() => {
        children.add(ActorB);
      });
    });
    await engine.use(ActorB._plugin);
    await engine.use(ActorA._plugin);
    const parentId = ActorA._plugin.spawn();
    const parent: PlaceHandle<void> = {
      entityId: parentId,
      api: undefined,
      moveTo() {},
      despawn() {},
    };
    const error = caught(() => {
      childrenB?.adopt(parent);
    });
    expect(isGwen(error)).toBe(true);
    if (!isGwen(error)) return;
    expect(error.code).toBe("CORE:ACTOR_CIRCULAR_OWNERSHIP");
    expect(error.composable).toBe("useChildren().adopt");
    expect(error.message).not.toContain("Code:");
  });

  it("an exhausted pool throws PoolExhaustedError, a GwenActorError with CORE:ACTOR_POOL_EXHAUSTED", async () => {
    const engine = await createEngine({ maxEntities: 32 });
    engines.push(engine);
    const Actor = defineActor(definePrefab([]), () => ({}));
    await engine.use(Actor._plugin);
    const pool = defineActorPool(Actor, { size: 2 });
    await engine.use(pool.plugin);
    const first = pool.acquire();
    const second = pool.acquire();
    expect(typeof first).toBe("bigint");
    expect(second).not.toBe(first);
    const error = caught(() => {
      pool.acquire();
    });
    expect(error).toBeInstanceOf(PoolExhaustedError);
    expect(error).toBeInstanceOf(GwenActorError);
    expect(error).toBeInstanceOf(GwenError);
    if (!(error instanceof PoolExhaustedError)) return;
    expect(error.code).toBe("CORE:ACTOR_POOL_EXHAUSTED");
    expect(error.composable).toBe("pool.acquire");
  });

  it("useLayout with chunkSize 0 throws CORE:INVALID_CHUNK_SIZE", async () => {
    const engine = await createEngine({ maxEntities: 32 });
    engines.push(engine);
    const layout = defineLayout(() => ({ group: placeGroup({}) }));
    await engine.run(() => {
      for (const chunkSize of [0, -1, 1.5]) {
        const error = caught(() => {
          useLayout(layout, { lazy: true, chunkSize });
        });
        expect(isGwen(error)).toBe(true);
        if (!isGwen(error)) return;
        expect(error.code).toBe("CORE:INVALID_CHUNK_SIZE");
        expect(error.composable).toBe("useLayout");
        expect(error.message).toContain(String(chunkSize));
      }
      const handle = useLayout(layout, { lazy: true, chunkSize: 1 });
      expect(handle.active).toBe(false);
    });
  });

  it("an unknown scene route throws CORE:INVALID_SCENE_ROUTE naming defineSceneRouter", () => {
    const menu = defineScene("menu", () => {});
    const initial = caught(() => {
      defineSceneRouter({
        initial: "missing" as "menu",
        routes: { menu: { scene: menu } },
      });
    });
    expect(isGwen(initial)).toBe(true);
    if (!isGwen(initial)) return;
    expect(initial.code).toBe("CORE:INVALID_SCENE_ROUTE");
    expect(initial.composable).toBe("defineSceneRouter");
    const transition = caught(() => {
      defineSceneRouter({
        initial: "menu",
        routes: { menu: { scene: menu, on: { GO: "missing" as "menu" } } },
      });
    });
    expect(isGwen(transition)).toBe(true);
    if (!isGwen(transition)) return;
    expect(transition.code).toBe("CORE:INVALID_SCENE_ROUTE");
    expect(transition.composable).toBe("defineSceneRouter");
  });

  it("an invalid component schema names defineComponent", () => {
    const schema: ComponentSchema = { position: Types.f32 };
    Object.assign(schema, { position: { x: Types.f32, y: Types.f32 } });
    const error = caught(() => {
      defineComponent({ name: "Bad", schema });
    });
    expect(isGwen(error)).toBe(true);
    if (!isGwen(error)) return;
    expect(error.code).toBe("CORE:INVALID_COMPONENT_SCHEMA");
    expect(error.composable).toBe("defineComponent");
  });

  it.each([
    ["empty string", "", "Component type must not be an empty string."],
    ["empty definition name", { name: "" }, "ComponentDefinition.name must not be empty."],
    ["non-component value", 1, "Invalid component type. Expected string or ComponentDefinition."],
  ])("normalizeComponentType %s throws CORE:INVALID_COMPONENT_TYPE", (label, input, what) => {
    const error = caught(() => normalizeComponentType(input));
    expect(isGwen(error), label).toBe(true);
    if (!isGwen(error)) return;
    expect(error.code).toBe("CORE:INVALID_COMPONENT_TYPE");
    expect(error.message.split("\n")[0]).toBe(`[GWEN] ${what}`);
    expect(error.message.endsWith("(CORE:INVALID_COMPONENT_TYPE)")).toBe(true);
    expect(error.message.match(/\[[^\]]+\]/g)).toEqual(["[GWEN]"]);
  });

  it("entityIndex rejects a number with EntityId must be a bigint.", () => {
    const error = caught(() => {
      entityIndex(1 as never);
    });
    expect(isGwen(error)).toBe(true);
    if (!isGwen(error)) return;
    expect(error.code).toBe("CORE:INVALID_ENTITY_ID");
    expect(error.message).toContain("EntityId must be a bigint.");
  });

  it("useErrorReporter().report names useErrorReporter and has no code tag", async () => {
    const engine = await createEngine({ maxEntities: 32 });
    engines.push(engine);
    const plugin = defineSystem("Reporter", () => {
      useErrorReporter().report("KIT:X", "Missing API key.");
    })();
    const error = await engine
      .run(async () => {
        await engine.use(plugin);
      })
      .then(
        () => undefined,
        (rejection: unknown) => rejection,
      );
    expect(isGwen(error)).toBe(true);
    if (!isGwen(error)) return;
    expect(error.code).toBe("KIT:X");
    expect(error.composable).toBe("useErrorReporter");
    expect(error.message).not.toContain("[KIT:X]");
  });

  it("null handle adopt throws CORE:ACTOR_CIRCULAR_OWNERSHIP", async () => {
    const engine = await createEngine({ maxEntities: 32 });
    engines.push(engine);
    let children: ReturnType<typeof useChildren> | undefined;
    const actor = defineActor(definePrefab([]), () => {
      children = useChildren();
    });
    await engine.use(actor._plugin);
    actor._plugin.spawn();
    const error = caught(() => children?.adopt(null as never));
    if (!(error instanceof GwenError)) throw error;
    expect(error.code).toBe("CORE:ACTOR_CIRCULAR_OWNERSHIP");
    expect(error.composable).toBe("useChildren().adopt");
  });

  it("foreign pool throws CORE:ACTOR_PLUGIN_NOT_READY naming useActorPool", async () => {
    const engine = await createEngine({ maxEntities: 32 });
    engines.push(engine);
    const scene = defineScene("bare-pool", () => {
      useActorPool({} as never);
    });
    const error = caught(() => engine.run(() => scene({ register: () => {} })));
    expect(isGwen(error)).toBe(true);
    if (!isGwen(error)) return;
    expect(error.code).toBe("CORE:ACTOR_PLUGIN_NOT_READY");
    expect(error.composable).toBe("useActorPool");
  });

  it("pool.acquire before install throws CORE:ACTOR_PLUGIN_NOT_READY naming pool.acquire", () => {
    const pool = defineActorPool(
      defineActor(definePrefab([]), () => ({})),
      { size: 1 },
    );
    const error = caught(() => pool.acquire());
    expect(isGwen(error)).toBe(true);
    if (!isGwen(error)) return;
    expect(error.code).toBe("CORE:ACTOR_PLUGIN_NOT_READY");
    expect(error.composable).toBe("pool.acquire");
  });
});
