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
import { createEngine, useHook, GwenContextError } from "../../src/index";
import { definePrefab } from "../../src/scene/define-prefab";
import { defineActor } from "../../src/scene/define-actor";

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

    engine.hooks.callHook("entity:spawn", 1n);
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

    engine.hooks.callHook("entity:spawn", 1n);
    expect(handler).toHaveBeenCalledOnce();

    unsubscribe!();

    engine.hooks.callHook("entity:spawn", 2n);
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
    engine.hooks.callHook("entity:spawn", 1n);
    expect(handler).toHaveBeenCalledOnce();

    await engine.unuse(plugin.name);
    engine.hooks.callHook("entity:spawn", 2n);
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
    engine.hooks.callHook("entity:spawn", 1n);
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

    let entityId: bigint | undefined;
    engine.run(() => {
      entityId = Actor._plugin.spawn?.();
    });

    engine.hooks.callHook("entity:spawn", 1n);
    expect(handler).toHaveBeenCalledOnce();

    engine.run(() => {
      Actor._plugin.despawn?.(entityId!);
    });
    engine.hooks.callHook("entity:spawn", 2n);
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

    let entityId: bigint | undefined;
    engine.run(() => {
      entityId = Actor._plugin.spawn?.();
    });
    expect(events).toEqual([]);

    engine.hooks.callHook("entity:spawn", 10n);
    expect(events).toEqual([10]);

    engine.hooks.callHook("entity:spawn", 20n);
    expect(events).toEqual([10, 20]);

    engine.run(() => {
      Actor._plugin.despawn?.(entityId!);
    });
    engine.hooks.callHook("entity:spawn", 30n);
    expect(events).toEqual([10, 20]);
  });
});
