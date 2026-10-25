import { GwenContextError } from "@gwenjs/core";
import { stubComponent } from "../helpers/stub-component";
import { describe, it, expect } from "vitest";
import { createEngine } from "../../src/engine/engine-factory";
import { defineActor, useEntityId, onStart, onDestroy } from "../../src/actor/runtime/define-actor";
import { definePrefab } from "../../src/actor/runtime/define-prefab";

// Minimal component def
const Position = stubComponent("Position");

const EmptyPrefab = definePrefab([{ def: Position, defaults: { x: 0, y: 0 } }]);

describe("define-actor — ContextSlot<ActorContext>", () => {
  it("useEntityId throws outside factory", () => {
    let thrown: unknown;
    try {
      useEntityId();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(GwenContextError);
    if (!(thrown instanceof GwenContextError)) return;
    expect(thrown.code).toBe("CORE:OUTSIDE_ACTOR_CONTEXT");
    expect(thrown.composable).toBe("useEntityId");
  });

  it("onStart throws outside factory", () => {
    let thrown: unknown;
    try {
      onStart(() => {});
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(GwenContextError);
    if (!(thrown instanceof GwenContextError)) return;
    expect(thrown.code).toBe("CORE:OUTSIDE_ACTOR_CONTEXT");
    expect(thrown.composable).toBe("onStart");
  });

  it("onDestroy throws outside factory", () => {
    let thrown: unknown;
    try {
      onDestroy(() => {});
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(GwenContextError);
    if (!(thrown instanceof GwenContextError)) return;
    expect(thrown.code).toBe("CORE:OUTSIDE_ACTOR_CONTEXT");
    expect(thrown.composable).toBe("onDestroy");
  });

  it("useEntityId returns stable id across callbacks", async () => {
    const engine = await createEngine({});
    let capturedId: bigint | undefined;
    const MyActor = defineActor("MyActor", EmptyPrefab, () => {
      const id = useEntityId();
      onStart(() => {
        capturedId = id;
      });
    });
    await engine.use(MyActor._plugin);
    const spawnedId = MyActor._plugin.spawn?.();
    await engine.advance(0.016);
    expect(capturedId).toBe(spawnedId);
    await engine.stop();
  });

  it("sequential spawns each get their own context", async () => {
    const engine = await createEngine({});
    const log: string[] = [];
    const Inner = defineActor("Inner", EmptyPrefab, () => {
      const id = useEntityId();
      log.push(`inner:${String(id)}`);
    });
    const Outer = defineActor("Outer", EmptyPrefab, () => {
      const id = useEntityId();
      log.push(`outer:${String(id)}`);
    });
    await engine.use(Inner._plugin);
    await engine.use(Outer._plugin);
    const outerId = Outer._plugin.spawn?.();
    const innerId = Inner._plugin.spawn?.();
    expect(log).toEqual([`outer:${String(outerId)}`, `inner:${String(innerId)}`]);
    await engine.stop();
  });
});
