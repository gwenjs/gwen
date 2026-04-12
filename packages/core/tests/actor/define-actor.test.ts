import { describe, it, expect, vi } from "vitest";
import { definePrefab } from "../../src/actor/defines/define-prefab";
import {
  defineActor,
  onStart,
  onDestroy,
  onEvent,
  useEntityId,
} from "../../src/actor/defines/define-actor";
import { onUpdate } from "../../src/system/defines/define-system";
import { createEngine } from "../../src/engine/gwen-engine";

// Minimal component defs
const Position = { __name__: "Position" };

const SimplePrefab = definePrefab([{ def: Position, defaults: { x: 0, y: 0 } }]);

describe("defineActor", () => {
  it("returns an ActorDefinition with _plugin, _instances, _prefab", () => {
    const Actor = defineActor(SimplePrefab, () => {});
    expect(typeof Actor._plugin).toBe("object");
    expect(Actor._instances).toBeInstanceOf(Map);
    expect(Actor._prefab).toBe(SimplePrefab);
    expect(typeof Actor.__actorName__).toBe("string");
    expect(Actor.__actorName__.length).toBeGreaterThan(0);
  });

  it("starts with zero instances", () => {
    const Actor = defineActor(SimplePrefab, () => {});
    expect(Actor._instances.size).toBe(0);
  });
});

describe("defineActor spawn/despawn", () => {
  it("spawn creates an entity and registers instance", async () => {
    const engine = await createEngine();
    const Actor = defineActor(SimplePrefab, () => {});
    await engine.use(Actor._plugin);

    const entityId = Actor._plugin.spawn?.();
    expect(typeof entityId).toBe("bigint");
    expect(Actor._instances.has(entityId!)).toBe(true);
  });

  it("despawn removes the instance and destroys the entity", async () => {
    const engine = await createEngine();
    const Actor = defineActor(SimplePrefab, () => {});
    await engine.use(Actor._plugin);

    const entityId = Actor._plugin.spawn?.();
    Actor._plugin.despawn?.(entityId!);
    expect(Actor._instances.has(entityId!)).toBe(false);
  });
});

describe("lifecycle hooks inside factory", () => {
  it("onStart is called once after spawn", async () => {
    const engine = await createEngine();
    const startSpy = vi.fn();
    const Actor = defineActor(SimplePrefab, () => {
      onStart(startSpy);
    });
    await engine.use(Actor._plugin);
    Actor._plugin.spawn?.();
    expect(startSpy).toHaveBeenCalledOnce();
  });

  it("onDestroy is called on despawn", async () => {
    const engine = await createEngine();
    const destroySpy = vi.fn();
    const Actor = defineActor(SimplePrefab, () => {
      onDestroy(destroySpy);
    });
    await engine.use(Actor._plugin);
    const id = Actor._plugin.spawn?.();
    Actor._plugin.despawn?.(id!);
    expect(destroySpy).toHaveBeenCalledOnce();
  });

  it("onUpdate callback is collected from factory", async () => {
    const engine = await createEngine();
    const updateSpy = vi.fn();
    const Actor = defineActor(SimplePrefab, () => {
      onUpdate(updateSpy);
    });
    await engine.use(Actor._plugin);
    const id = Actor._plugin.spawn?.();
    const instance = Actor._instances.get(id!);
    expect(instance?._update).toHaveLength(1);
  });

  it("onEvent registers and cleans up on despawn", async () => {
    const engine = await createEngine();
    const handler = vi.fn();
    const Actor = defineActor(SimplePrefab, () => {
      onEvent("entity:create" as never, handler as never);
    });
    await engine.use(Actor._plugin);
    const id = Actor._plugin.spawn?.();

    // handler registered — calling hook should invoke it
    (engine.hooks as { callHook(e: string, ...a: unknown[]): void }).callHook("entity:create", 0n);
    expect(handler).toHaveBeenCalledOnce();

    // after despawn — cleanup should have removed the handler
    Actor._plugin.despawn?.(id!);
    (engine.hooks as { callHook(e: string, ...a: unknown[]): void }).callHook("entity:create", 1n);
    expect(handler).toHaveBeenCalledOnce(); // still 1 — not called again
  });
});

describe("public API", () => {
  it("factory return value becomes instance.api", async () => {
    const engine = await createEngine();
    const Actor = defineActor(SimplePrefab, () => {
      return { greet: () => "hello" };
    });
    await engine.use(Actor._plugin);
    const id = Actor._plugin.spawn?.();
    const instance = Actor._instances.get(id!);
    expect(instance?.api?.greet()).toBe("hello");
  });
});

describe("useEntityId", () => {
  it("returns the entity ID of the actor being spawned", async () => {
    const engine = await createEngine();
    let capturedId: bigint | undefined;

    const Actor = defineActor(SimplePrefab, () => {
      capturedId = useEntityId();
    });
    await engine.use(Actor._plugin);
    const spawnedId = Actor._plugin.spawn?.();

    expect(capturedId).toBe(spawnedId);
  });

  it("returns a different ID for each spawn", async () => {
    const engine = await createEngine();
    const ids: bigint[] = [];

    const Actor = defineActor(SimplePrefab, () => {
      ids.push(useEntityId());
    });
    await engine.use(Actor._plugin);
    Actor._plugin.spawn?.();
    Actor._plugin.spawn?.();

    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it("ID returned by useEntityId matches the instance's entityId", async () => {
    const engine = await createEngine();
    let capturedId: bigint | undefined;

    const Actor = defineActor(SimplePrefab, () => {
      capturedId = useEntityId();
    });
    await engine.use(Actor._plugin);
    const spawnedId = Actor._plugin.spawn?.();
    const instance = Actor._instances.get(spawnedId!);

    expect(capturedId).toBe(instance?.entityId);
  });

  it("is valid inside a composable called from the factory", async () => {
    const engine = await createEngine();
    let composableId: bigint | undefined;

    function useMyComposable() {
      composableId = useEntityId();
    }

    const Actor = defineActor(SimplePrefab, () => {
      useMyComposable();
    });
    await engine.use(Actor._plugin);
    const spawnedId = Actor._plugin.spawn?.();

    expect(composableId).toBe(spawnedId);
  });

  it("throws when called outside a defineActor factory", () => {
    expect(() => useEntityId()).toThrow(
      /\[GWEN\] useEntityId\(\) must be called inside a defineActor\(\) factory function\./,
    );
  });

  it("throws when called inside onStart (not setup phase)", async () => {
    const engine = await createEngine();

    const Actor = defineActor(SimplePrefab, () => {
      onStart(() => {
        // onStart runs after setup — no actor context active here
        expect(() => useEntityId()).toThrow(
          /\[GWEN\] useEntityId\(\) must be called inside a defineActor\(\) factory function\./,
        );
      });
    });
    await engine.use(Actor._plugin);
    Actor._plugin.spawn?.();
  });
});

describe("useEntityId — public entrypoint export", () => {
  it("is exported from @gwenjs/core/actor entrypoint", async () => {
    // Verify the export is present on the public entrypoint to prevent
    // accidental removal from actor/index.ts.
    const actorModule = await import("@gwenjs/core/actor");
    expect(typeof actorModule.useEntityId).toBe("function");
  });
});

describe("defineActor — plugin naming", () => {
  it("uses the provided name string as _plugin.name", () => {
    const Actor = defineActor("MyHero", SimplePrefab, () => {});
    expect(Actor._plugin.name).toBe("MyHero");
    expect(Actor.__actorName__).toBe("MyHero");
  });

  it("falls back to a unique counter name when no name is given", () => {
    const A = defineActor(SimplePrefab, () => {});
    const B = defineActor(SimplePrefab, () => {});
    // Both should be non-empty strings and different from each other
    expect(typeof A._plugin.name).toBe("string");
    expect(A._plugin.name).not.toBe("anonymous-actor");
    expect(A._plugin.name).not.toBe(B._plugin.name);
  });

  it("two different defineActor calls never share a name", () => {
    const actors = Array.from({ length: 10 }, () => defineActor(SimplePrefab, () => {}));
    const names = actors.map((a) => a._plugin.name);
    const unique = new Set(names);
    expect(unique.size).toBe(10);
  });

  it("named form: plugin name matches the provided name", async () => {
    const engine = await createEngine();
    const Actor = defineActor("TestActor", SimplePrefab, () => {});
    await engine.use(Actor._plugin);
    // The plugin was installed — no deduplication issue
    Actor._plugin.spawn?.();
    expect(Actor._instances.size).toBe(1);
  });
});
