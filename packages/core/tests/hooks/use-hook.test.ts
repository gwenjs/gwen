/**
 * @file useHook unit tests
 *
 * Verifies:
 * - useHook() throws GwenContextError when called outside engine context
 * - useHook() subscribes to hooks and fires handler when event triggers
 * - useHook() returns an unsubscribe function
 * - Handler is auto-removed when plugin is unregistered (plugin context cleanup)
 * - Handler is auto-removed when actor is despawned (actor context cleanup)
 */

import { describe, it, expect, vi } from "vitest";
import type { EntityId } from "../../src/engine/engine-api.js";
import { createEngine, useHook, GwenContextError } from "../../src/index";
import { definePrefab } from "../../src/actor/runtime/define-prefab";
import { defineActor } from "../../src/actor/runtime/define-actor";
import type { UnsubscribeFn } from "../../src/hooks/use-hook";

// ── useHook() outside engine context ─────────────────────────────────────────

describe("useHook() outside engine context", () => {
  it("throws GwenContextError when called outside engine context", () => {
    expect(() => {
      useHook("entity:spawn", (_id) => {});
    }).toThrow(GwenContextError);
  });
});

// ── useHook() basic subscription ─────────────────────────────────────────────

describe("useHook() basic subscription", () => {
  it("calls the handler when the event fires", async () => {
    const engine = await createEngine();
    const handler = vi.fn();

    await engine.use({
      name: "test-hook-subscription",
      setup() {
        useHook("entity:spawn", handler);
      },
    });

    engine.hooks.callHook("entity:spawn", 1n as unknown as EntityId);
    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(1n);
  });

  it("returns an unsubscribe function", async () => {
    const engine = await createEngine();
    let unsubscribe: (() => void) | null = null;

    engine.run(() => {
      unsubscribe = useHook("entity:spawn", (_id) => {});
    });

    expect(typeof unsubscribe).toBe("function");
  });

  it("unsubscribe stops the handler from firing", async () => {
    const engine = await createEngine();
    const handler = vi.fn();
    let unsubscribe: (() => void) | null = null;

    await engine.use({
      name: "test-unsubscribe",
      setup() {
        unsubscribe = useHook("entity:spawn", handler);
      },
    });

    engine.hooks.callHook("entity:spawn", 1n as unknown as EntityId);
    expect(handler).toHaveBeenCalledOnce();

    unsubscribe!();

    engine.hooks.callHook("entity:spawn", 2n as unknown as EntityId);
    expect(handler).toHaveBeenCalledOnce();
  });
});

// ── useHook() auto-cleanup in plugin context ────────────────────────────────

describe("useHook() auto-cleanup in plugin context", () => {
  it("handler is removed when plugin is unregistered via engine.unuse()", async () => {
    const engine = await createEngine();
    const handler = vi.fn();

    const plugin = {
      name: "test-auto-cleanup-plugin",
      setup() {
        useHook("entity:spawn", handler);
      },
    };

    await engine.use(plugin);
    engine.hooks.callHook("entity:spawn", 1n as unknown as EntityId);
    expect(handler).toHaveBeenCalledOnce();

    await engine.unuse(plugin.name);
    engine.hooks.callHook("entity:spawn", 2n as unknown as EntityId);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("handler fires before plugin is unregistered", async () => {
    const engine = await createEngine();
    const calls: string[] = [];

    const plugin = {
      name: "test-handler-before-unregister",
      setup() {
        useHook("entity:spawn", () => {
          calls.push("handler");
        });
      },
      teardown() {
        calls.push("teardown");
      },
    };

    await engine.use(plugin);
    engine.hooks.callHook("entity:spawn", 1n as unknown as EntityId);
    expect(calls).toEqual(["handler"]);

    await engine.unuse(plugin.name);
    expect(calls).toEqual(["handler", "teardown"]);
  });
});

// ── useHook() auto-cleanup in actor context ─────────────────────────────────

describe("useHook() auto-cleanup in actor context", () => {
  it("handler is removed when actor is despawned", async () => {
    const engine = await createEngine();

    const Position = { __name__: "Position" };
    const SimplePrefab = definePrefab([{ def: Position, defaults: { x: 0, y: 0 } }]);

    const handler = vi.fn();
    const Actor = defineActor(SimplePrefab, () => {
      useHook("entity:spawn", handler);
    });

    await engine.use(Actor._plugin);

    let entityId: EntityId | undefined;
    engine.run(() => {
      entityId = Actor._plugin.spawn?.();
    });

    engine.hooks.callHook("entity:spawn", 1n as unknown as EntityId);
    expect(handler).toHaveBeenCalledOnce();

    engine.run(() => {
      Actor._plugin.despawn?.(entityId!);
    });
    engine.hooks.callHook("entity:spawn", 2n as unknown as EntityId);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("handler fires while actor is alive", async () => {
    const engine = await createEngine();

    const Position = { __name__: "Position" };
    const SimplePrefab = definePrefab([{ def: Position, defaults: { x: 0, y: 0 } }]);

    const events: number[] = [];
    const Actor = defineActor(SimplePrefab, () => {
      useHook("entity:spawn", (id) => {
        events.push(Number(id));
      });
    });

    await engine.use(Actor._plugin);

    let entityId: EntityId | undefined;
    engine.run(() => {
      entityId = Actor._plugin.spawn?.();
    });
    expect(events).toEqual([]);

    engine.hooks.callHook("entity:spawn", 10n as unknown as EntityId);
    expect(events).toEqual([10]);

    engine.hooks.callHook("entity:spawn", 20n as unknown as EntityId);
    expect(events).toEqual([10, 20]);

    engine.run(() => {
      Actor._plugin.despawn?.(entityId!);
    });
    engine.hooks.callHook("entity:spawn", 30n as unknown as EntityId);
    expect(events).toEqual([10, 20]);
  });
});

// ── useHook() in actor context — ScopedHookable silences dormant actors ──────

describe("useHook() in actor context — dormancy via ScopedHookable", () => {
  const Hp = { __name__: "Hp" };
  const TestPrefab = definePrefab([{ def: Hp, defaults: { value: 100 } }]);

  it("handler fires normally when the actor is active", async () => {
    const engine = await createEngine();
    const handler = vi.fn();

    const Actor = defineActor(TestPrefab, () => {
      useHook("entity:spawn", handler);
    });
    await engine.use(Actor._plugin);

    engine.run(() => {
      Actor._plugin.spawn?.();
    });

    await engine.hooks.callHook("entity:spawn", 1n as unknown as EntityId);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("handler is silenced when scope is paused (no warning)", async () => {
    const engine = await createEngine();
    const warnSpy = vi.spyOn(engine.logger, "warn");
    const handler = vi.fn();

    const Actor = defineActor(TestPrefab, () => {
      useHook("entity:spawn", handler);
    });
    await engine.use(Actor._plugin);

    let id: EntityId;
    engine.run(() => {
      id = Actor._plugin.spawn!();
    });

    // Pause the scope (as the pool would via scope.pause())
    Actor._instances.get(id!)!._scope.pause();

    await engine.hooks.callHook("entity:spawn", 1n as unknown as EntityId);
    expect(handler).not.toHaveBeenCalled();

    const dormancyWarnings = warnSpy.mock.calls.filter(
      ([msg]) => typeof msg === "string" && msg.includes("dormant actor"),
    );
    expect(dormancyWarnings).toHaveLength(0);
  });

  it("handler fires again after scope is resumed", async () => {
    const engine = await createEngine();
    const handler = vi.fn();

    const Actor = defineActor(TestPrefab, () => {
      useHook("entity:spawn", handler);
    });
    await engine.use(Actor._plugin);

    let id: EntityId;
    engine.run(() => {
      id = Actor._plugin.spawn!();
    });
    const inst = Actor._instances.get(id!)!;

    // Active → fires
    await engine.hooks.callHook("entity:spawn", 1n as unknown as EntityId);
    expect(handler).toHaveBeenCalledTimes(1);

    // Paused → silenced
    inst._scope.pause();
    await engine.hooks.callHook("entity:spawn", 2n as unknown as EntityId);
    expect(handler).toHaveBeenCalledTimes(1);

    // Resumed → fires again
    inst._scope.resume();
    await engine.hooks.callHook("entity:spawn", 3n as unknown as EntityId);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("two independent instances each have their own scope", async () => {
    const engine = await createEngine();
    const handler = vi.fn();

    const Actor = defineActor(TestPrefab, () => {
      useHook("entity:spawn", handler);
    });
    await engine.use(Actor._plugin);

    // oxlint-disable-next-line no-unused-vars id2 mandatory for test
    let id1: EntityId, id2: EntityId;
    engine.run(() => {
      id1 = Actor._plugin.spawn!();
      id2 = Actor._plugin.spawn!();
    });

    // Pause only instance 1
    Actor._instances.get(id1!)!._scope.pause();

    await engine.hooks.callHook("entity:spawn", 1n as unknown as EntityId);
    // Only instance 2 fires
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("useHook in plugin setup (no scope) registers directly on engine.hooks", async () => {
    const engine = await createEngine();
    const handler = vi.fn();

    await engine.use({
      name: "test-no-scope",
      setup() {
        useHook("entity:spawn", handler);
      },
    });

    await engine.hooks.callHook("entity:spawn", 1n as unknown as EntityId);
    expect(handler).toHaveBeenCalledOnce();
  });
});

describe("UnsubscribeFn", () => {
  it("UnsubscribeFn is exported and assignable from useHook return value", async () => {
    const engine = await createEngine();
    await engine.startExternal();

    const handler = vi.fn();
    let unsub: UnsubscribeFn | undefined;

    engine.run(() => {
      unsub = useHook("engine:afterTick" as never, handler as never);
    });

    // Before unsubscribe — handler fires.
    await engine.advance(0.016);
    expect(handler).toHaveBeenCalledOnce();

    // After unsubscribe — handler no longer fires.
    unsub!();
    await engine.advance(0.016);
    expect(handler).toHaveBeenCalledOnce(); // still once, not twice

    await engine.stop();
  });
});
