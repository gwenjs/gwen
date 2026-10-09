/**
 * Robustness tests for the actor system — covers the five fixes:
 *
 * 1. `despawn` cleanup chain: each phase is wrapped in try/catch so a
 *    throwing callback never leaks instances, event handlers, or WASM entities.
 * 2. Re-entrancy guard: registries are cleared before callbacks fire, so a
 *    re-entrant `despawn` call inside `onDestroy` is a no-op.
 * 3. Explicit `deps` option on `defineActor`: child actor dependencies can be
 *    declared statically instead of relying solely on the Vite transform.
 * 4. `useComponent.$set`: batch-writes multiple component fields in a single
 *    `addComponent` call instead of one allocation per property.
 * 5. `onEvent` dormancy guard via `_createDormancyGuard`: preserves handler
 *    type signature while skipping dispatch for dormant pool instances.
 */

import { stubComponent } from "../helpers/stub-component";
import { describe, it, expect, vi } from "vitest";
import { definePrefab } from "../../src/actor/runtime/define-prefab";
import { defineActor, onStart, onDestroy, useEntityId } from "../../src/actor/runtime/define-actor";
import { useHook } from "../../src/hooks/use-hook";
import { onUpdate } from "../../src/system/runtime/define-system";
import { useComponent } from "../../src/actor/runtime/use-actor";
import { defineActorPool } from "../../src/actor/runtime/pool/define-actor-pool";
import { createEngine } from "../../src/engine/gwen-engine";
import type { ActorDefinition } from "../../src/actor/runtime/types";

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const Position = stubComponent("Position");
const SimplePrefab = definePrefab([{ def: Position, defaults: { x: 0, y: 0 } }]);

// ─── 1. despawn cleanup chain — try/catch isolation ───────────────────────────

describe("despawn — cleanup chain robustness", () => {
  it("does not propagate an exception thrown by onDestroy", async () => {
    const engine = await createEngine();
    const Actor = defineActor(SimplePrefab, () => {
      onDestroy(() => {
        throw new Error("onDestroy explosion");
      });
    });
    await engine.use(Actor._plugin);
    const id = Actor._plugin.spawn!();

    expect(() => Actor._plugin.despawn!(id)).not.toThrow();
  });

  it("removes the instance from the registry even when onDestroy throws", async () => {
    const engine = await createEngine();
    const Actor = defineActor(SimplePrefab, () => {
      onDestroy(() => {
        throw new Error("boom");
      });
    });
    await engine.use(Actor._plugin);
    const id = Actor._plugin.spawn!();

    Actor._plugin.despawn!(id);

    expect(Actor._instances.has(id)).toBe(false);
  });

  it("runs all onDestroy callbacks even when an earlier one throws", async () => {
    const engine = await createEngine();
    const secondSpy = vi.fn();
    const thirdSpy = vi.fn();

    const Actor = defineActor(SimplePrefab, () => {
      onDestroy(() => {
        throw new Error("first throws");
      });
      onDestroy(secondSpy);
      onDestroy(thirdSpy);
    });
    await engine.use(Actor._plugin);
    const id = Actor._plugin.spawn!();

    Actor._plugin.despawn!(id);

    expect(secondSpy).toHaveBeenCalledOnce();
    expect(thirdSpy).toHaveBeenCalledOnce();
  });

  it("runs scope cleanup even when onDestroy throws", async () => {
    const engine = await createEngine();
    const handler = vi.fn();

    const Actor = defineActor(SimplePrefab, () => {
      onDestroy(() => {
        throw new Error("boom");
      });
      useHook("entity:create" as never, handler as never);
    });
    await engine.use(Actor._plugin);
    const id = Actor._plugin.spawn!();

    Actor._plugin.despawn!(id);

    // scope.dispose() removes all handlers even when onDestroy throws.
    (engine.hooks as { callHook(e: string, ...a: unknown[]): void }).callHook("entity:create", 0n);
    expect(handler).not.toHaveBeenCalled();
  });
});

// ─── 2. Re-entrancy guard ─────────────────────────────────────────────────────

describe("despawn — re-entrancy guard", () => {
  it("ignores a re-entrant despawn call made inside onDestroy", async () => {
    const engine = await createEngine();
    const destroySpy = vi.fn();

    const Actor = defineActor(SimplePrefab, () => {
      // Capture the entity ID at spawn time so the closure does not need a
      // module-level `let` variable — useEntityId() runs in setup phase.
      const selfId = useEntityId();
      onDestroy(() => {
        destroySpy();
        // Re-entrant call: entity is already removed from registry at this point.
        Actor._plugin.despawn!(selfId);
      });
    });
    await engine.use(Actor._plugin);
    const id = Actor._plugin.spawn!();

    Actor._plugin.despawn!(id);

    // onDestroy must have been called exactly once, not recursively.
    expect(destroySpy).toHaveBeenCalledOnce();
  });
});

// ─── 3. Explicit `deps` option ────────────────────────────────────────────────

describe("defineActor — explicit deps option", () => {
  it("sets _plugin._deps from the deps option", () => {
    const ChildActor = defineActor(SimplePrefab, () => {});

    // Cast until the overload is added to the public signature.
    const Actor = (
      defineActor as unknown as (
        prefab: typeof SimplePrefab,
        factory: () => void,
        options: { deps: ActorDefinition<unknown, unknown>[] },
      ) => ActorDefinition<void, void>
    )(SimplePrefab, () => {}, { deps: [ChildActor] });

    expect(Actor._plugin._deps).toBeDefined();
    expect(Actor._plugin._deps).toContain(ChildActor._plugin);
  });

  it("_deps is undefined when no deps option is provided", () => {
    const Actor = defineActor(SimplePrefab, () => {});
    // Without the option, _deps should remain undefined (Vite may inject it later).
    expect(Actor._plugin._deps).toBeUndefined();
  });

  it("named form also accepts the deps option", () => {
    const ChildActor = defineActor(SimplePrefab, () => {});

    const Actor = (
      defineActor as unknown as (
        name: string,
        prefab: typeof SimplePrefab,
        factory: () => void,
        options: { deps: ActorDefinition<unknown, unknown>[] },
      ) => ActorDefinition<void, void>
    )("ParentActor", SimplePrefab, () => {}, { deps: [ChildActor] });

    expect(Actor._plugin._deps).toContain(ChildActor._plugin);
  });
});

// ─── 4. useComponent.$set ─────────────────────────────────────────────────────

describe("useComponent — $set batch write", () => {
  it("exposes $set as a function on the proxy", async () => {
    const engine = await createEngine();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let capturedProxy: any;

    const Actor = defineActor(SimplePrefab, () => {
      capturedProxy = useComponent(Position);
    });
    await engine.use(Actor._plugin);
    Actor._plugin.spawn!();

    expect(typeof capturedProxy.$set).toBe("function");
  });

  it("$set writes multiple fields and the values are readable afterwards", async () => {
    const engine = await createEngine();

    const Actor = defineActor(SimplePrefab, () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pos = useComponent(Position) as any;
      onUpdate(() => {
        pos.$set({ x: 42, y: 99 });
      });
    });
    await engine.use(Actor._plugin);
    const entityId = Actor._plugin.spawn!();

    await engine.advance(0.016);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const component = engine.getComponent(entityId! as never, Position as any) as any;
    expect(component?.x).toBe(42);
    expect(component?.y).toBe(99);
  });

  it("$set with a partial update preserves untouched fields", async () => {
    const engine = await createEngine();

    const Actor = defineActor(SimplePrefab, () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pos = useComponent(Position) as any;
      onStart(() => {
        // Set initial y value.
        pos.y = 77;
      });
      onUpdate(() => {
        // Only update x — y should remain 77.
        pos.$set({ x: 5 });
      });
    });
    await engine.use(Actor._plugin);
    const entityId = Actor._plugin.spawn!();

    await engine.advance(0.016);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const component = engine.getComponent(entityId as never, Position as any) as any;
    expect(component?.x).toBe(5);
    expect(component?.y).toBe(77);
  });
});

// ─── 5. ScopedHookable dormancy — handler silenced via scope.pause() ──────────

describe("useHook — ScopedHookable silences dormant actors", () => {
  it("handler is called when actor is active", async () => {
    const engine = await createEngine();
    const handler = vi.fn();

    const Actor = defineActor(SimplePrefab, () => {
      useHook("entity:create" as never, handler as never);
    });
    await engine.use(Actor._plugin);
    Actor._plugin.spawn!();

    (engine.hooks as { callHook(e: string, ...a: unknown[]): void }).callHook("entity:create", 42n);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(42n);
  });

  it("handler is NOT called when actor is dormant (pool release)", async () => {
    const engine = await createEngine();
    const handler = vi.fn();

    const Actor = defineActor(SimplePrefab, () => {
      useHook("entity:create" as never, handler as never);
    });
    await engine.use(Actor._plugin);
    const pool = defineActorPool(Actor, { size: 1 });
    await engine.use(pool.plugin);

    const id = pool.acquire();
    pool.release(id);
    // release() is deferred — advance one frame to flush it and pause the scope.
    await engine.advance(0.016);

    // Scope is paused — hook must not invoke the handler.
    (engine.hooks as { callHook(e: string, ...a: unknown[]): void }).callHook("entity:create", 99n);

    expect(handler).not.toHaveBeenCalled();
  });

  it("handler resumes after actor is re-acquired from pool", async () => {
    const engine = await createEngine();
    const handler = vi.fn();

    const Actor = defineActor(SimplePrefab, () => {
      useHook("entity:create" as never, handler as never);
    });
    await engine.use(Actor._plugin);
    const pool = defineActorPool(Actor, { size: 1 });
    await engine.use(pool.plugin);

    const id = pool.acquire();
    pool.release(id);
    // Flush deferred release so the slot becomes available.
    await engine.advance(0.016);
    pool.acquire(); // re-acquire — scope.resume() called

    (engine.hooks as { callHook(e: string, ...a: unknown[]): void }).callHook("entity:create", 1n);

    expect(handler).toHaveBeenCalledOnce();
  });
});
