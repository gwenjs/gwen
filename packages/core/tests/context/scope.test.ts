import { describe, it, expect, vi } from "vitest";
import { GwenScope } from "../../src/context/scope.js";

function makeMockEngine() {
  return {
    hooks: {
      hook: vi.fn((_: string, _fn: unknown) => () => {}),
      callHook: vi.fn(),
    },
  } as any;
}

describe("GwenScope", () => {
  it("run() sets GwenScope.current() and restores it after", () => {
    const engine = makeMockEngine();
    const scope = new GwenScope(engine, { type: "plugin", name: "test" });
    expect(GwenScope.current()).toBeNull();
    let inner: GwenScope | null = null;
    scope.run(() => {
      inner = GwenScope.current();
    });
    expect(inner).toBe(scope);
    expect(GwenScope.current()).toBeNull();
  });

  it("run() restores parent scope when nested", () => {
    const engine = makeMockEngine();
    const parent = new GwenScope(engine, { type: "scene", name: "parent" });
    const child = new GwenScope(engine, { type: "actor", name: "child" }, parent);
    let innerDuringChild: GwenScope | null = null;
    parent.run(() => {
      child.run(() => {
        innerDuringChild = GwenScope.current();
      });
      expect(GwenScope.current()).toBe(parent);
    });
    expect(innerDuringChild).toBe(child);
  });

  it("dispose() runs cleanups in LIFO order", () => {
    const engine = makeMockEngine();
    const scope = new GwenScope(engine, { type: "plugin" });
    const order: number[] = [];
    scope.onCleanup(() => order.push(1));
    scope.onCleanup(() => order.push(2));
    scope.onCleanup(() => order.push(3));
    scope.dispose();
    expect(order).toEqual([3, 2, 1]);
  });

  it("dispose() is idempotent", () => {
    const engine = makeMockEngine();
    const scope = new GwenScope(engine, { type: "plugin" });
    scope.onCleanup(() => {});
    expect(() => {
      scope.dispose();
      scope.dispose();
    }).not.toThrow();
  });

  it("dispose() disposes children before parent cleanups", () => {
    const engine = makeMockEngine();
    const order: string[] = [];
    const parent = new GwenScope(engine, { type: "scene" });
    const child = new GwenScope(engine, { type: "actor" }, parent);
    parent.onCleanup(() => order.push("parent-cleanup"));
    child.onCleanup(() => order.push("child-cleanup"));
    parent.dispose();
    expect(order).toEqual(["child-cleanup", "parent-cleanup"]);
  });

  it("auto-generates id if not provided", () => {
    const engine = makeMockEngine();
    const scope = new GwenScope(engine, { type: "actor", name: "Player" });
    expect(scope.meta.id).toMatch(/^actor#\d+$/);
  });

  it("uses provided id when given", () => {
    const engine = makeMockEngine();
    const scope = new GwenScope(engine, { type: "plugin", id: "my-plugin" });
    expect(scope.meta.id).toBe("my-plugin");
  });

  it("exposes childCount and cleanupCount", () => {
    const engine = makeMockEngine();
    const parent = new GwenScope(engine, { type: "scene" });
    new GwenScope(engine, { type: "actor" }, parent);
    parent.onCleanup(() => {});
    expect(parent.childCount).toBe(1);
    expect(parent.cleanupCount).toBe(1);
  });

  it("hook() registers and unregisters handlers", () => {
    const engine = makeMockEngine();
    const scope = new GwenScope(engine, { type: "plugin" });
    const fn = vi.fn();
    const unsub = scope.hook("engine:tick", fn as any);
    expect(scope.hookCount).toBe(1);
    unsub();
    expect(scope.hookCount).toBe(0);
  });

  it("pause() and resume() toggle paused state", () => {
    const engine = makeMockEngine();
    const scope = new GwenScope(engine, { type: "actor" });
    expect(scope.paused).toBe(false);
    scope.pause();
    expect(scope.paused).toBe(true);
    scope.resume();
    expect(scope.paused).toBe(false);
  });

  it("dispose() unregisters all children from parent", () => {
    const engine = makeMockEngine();
    const parent = new GwenScope(engine, { type: "scene" });
    const child1 = new GwenScope(engine, { type: "actor" }, parent);
    const child2 = new GwenScope(engine, { type: "actor" }, parent);
    expect(parent.childCount).toBe(2);
    child1.dispose();
    expect(parent.childCount).toBe(1);
    child2.dispose();
    expect(parent.childCount).toBe(0);
  });

  it("dispose() clears cleanups after running them", () => {
    const engine = makeMockEngine();
    const scope = new GwenScope(engine, { type: "plugin" });
    scope.onCleanup(() => {});
    expect(scope.cleanupCount).toBe(1);
    scope.dispose();
    expect(scope.cleanupCount).toBe(0);
  });

  it("parent property is set correctly", () => {
    const engine = makeMockEngine();
    const parent = new GwenScope(engine, { type: "scene" });
    const child = new GwenScope(engine, { type: "actor" }, parent);
    expect(child.parent).toBe(parent);
    expect(parent.parent).toBeNull();
  });

  it("meta object is immutable", () => {
    const engine = makeMockEngine();
    const scope = new GwenScope(engine, { type: "plugin", id: "test", name: "Test" });
    expect(() => {
      (scope.meta as any).id = "other";
    }).toThrow();
  });
});
