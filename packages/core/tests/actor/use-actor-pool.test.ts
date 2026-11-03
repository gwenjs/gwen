/**
 * useActorPool returns the handle in any engine context (#75).
 */
import { describe, expect, it } from "vitest";
import { GwenContextError } from "@gwenjs/core";
import { defineActor, definePrefab } from "../../src/actor/index";
import { defineActorPool } from "../../src/actor/runtime/pool/define-actor-pool";
import { useActorPool } from "../../src/actor/runtime/pool/use-actor-pool";
import { createEngine } from "../../src/node";
import { defineScene } from "../../src/scene/index";
import { defineSystem } from "../../src/system/runtime/define-system";
import type { ActorPool } from "../../src/actor/runtime/pool/types";
import { stubValue } from "../helpers/stub-component";

const Hp = stubValue("UseActorPoolHp");
const Prefab = definePrefab([{ def: Hp, defaults: { value: 100 } }]);

describe("useActorPool", () => {
  it("returns the handle outside a scene and registers no scene hook", async () => {
    const engine = await createEngine({ maxEntities: 32 });
    try {
      const Actor = defineActor(Prefab, () => {});
      const definition = defineActorPool(Actor, { size: 2 });
      await engine.use(Actor._plugin);
      await engine.use(definition.plugin);

      const handle = engine.run(() => useActorPool(definition));
      handle.acquire();
      expect(handle.stats().active).toBe(1);

      await engine.hooks.callHook("scene:beforeLeave", "any");
      expect(handle.stats().active).toBe(1);
    } finally {
      await engine.stop();
    }
  });

  it("registers no scene hook in a system after a scene ran on the engine", async () => {
    const engine = await createEngine({ maxEntities: 32 });
    try {
      const Actor = defineActor(Prefab, () => {});
      const definition = defineActorPool(Actor, { size: 2 });
      await engine.use(Actor._plugin);
      await engine.use(definition.plugin);

      // A routed game: a scene factory has already run on this engine, so
      // `scene:registrar` stays provided for every later composable call.
      let sceneFactoryRan = false;
      engine.run(() => {
        defineScene("use-actor-pool-home", () => {
          sceneFactoryRan = true;
        })({ register: () => {} });
      });
      expect(sceneFactoryRan).toBe(true);

      let handle: ActorPool<void, void> | undefined;
      await engine.use(
        defineSystem("use-actor-pool-spawner", () => {
          handle = useActorPool(definition);
        })(),
      );
      expect(handle).toBeDefined();
      if (handle === undefined) return;
      handle.acquire();
      expect(handle.stats().active).toBe(1);

      await engine.hooks.callHook("scene:beforeLeave", "any");
      expect(handle.stats().active).toBe(1);
    } finally {
      await engine.stop();
    }
  });

  it("outside an engine context throws CORE:OUTSIDE_ENGINE_CONTEXT", () => {
    const Actor = defineActor(Prefab, () => {});
    const definition = defineActorPool(Actor, { size: 2 });

    let thrown: unknown;
    try {
      useActorPool(definition);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(GwenContextError);
    if (!(thrown instanceof GwenContextError)) return;
    expect(thrown.code).toBe("CORE:OUTSIDE_ENGINE_CONTEXT");
    expect(thrown.composable).toBe("useActorPool");
  });
});
