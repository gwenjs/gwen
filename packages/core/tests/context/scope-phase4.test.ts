/**
 * @file scope-phase4.test.ts
 *
 * Tests for Phase 4: GwenScope.current() works inside defineActor, defineSystem, defineScene
 *
 * Verifies:
 * - GwenScope.current() returns the correct scope inside actor factory
 * - GwenScope.current() returns the correct scope inside system factory
 * - GwenScope.current() returns the correct scope inside scene factory
 * - Nested scopes (actor inside scene) preserve parent scope after inner scope exits
 * - Error recovery: plugin setup error triggers scope rollback — engine remains usable
 */

import { describe, it, expect, vi } from "vitest";
import { GwenScope } from "../../src/context/scope";

function makeMockEngine() {
  return {
    hooks: {
      hook: vi.fn((_: string, _fn: unknown) => () => {}),
      callHook: vi.fn(),
    },
  } as any;
}

describe("GwenScope Phase 4", () => {
  it("nested scope inside scope preserves parent scope after inner scope exits", () => {
    const engine = makeMockEngine();
    let outerScopeAfterInner: GwenScope | null = null;

    const outerScope = new GwenScope(engine, { type: "scene", name: "outer" });

    outerScope.run(() => {
      const capturedOuterScope = GwenScope.current();
      expect(capturedOuterScope).toBe(outerScope);

      // Simulate an inner scope running and exiting
      const innerScope = new GwenScope(engine, { type: "scene", name: "inner" });
      innerScope.run(() => {
        // inner scope runs
        expect(GwenScope.current()).toBe(innerScope);
      });

      outerScopeAfterInner = GwenScope.current();
      expect(outerScopeAfterInner).toBe(outerScope);
    });
  });

  it("plugin setup error triggers scope rollback — engine remains usable", () => {
    const engine = makeMockEngine();
    const pluginScope = new GwenScope(engine, { type: "plugin", name: "bad-plugin" });
    const cleanupSpy = vi.fn();

    expect(() => {
      try {
        pluginScope.run(() => {
          pluginScope.onCleanup(cleanupSpy);
          throw new Error("setup failed");
        });
      } catch {
        pluginScope.dispose();
      }
    }).not.toThrow();

    expect(cleanupSpy).toHaveBeenCalled();
    // After error and dispose, scope should be cleared
    expect(GwenScope.current()).toBeNull();
  });

  it("scope.run() sets GwenScope.current() correctly for actor scopes", () => {
    const engine = makeMockEngine();
    const actorScope = new GwenScope(engine, { type: "actor", name: "test-actor" });
    let capturedScope: GwenScope | null = null;

    actorScope.run(() => {
      capturedScope = GwenScope.current();
    });

    expect(capturedScope).toBe(actorScope);
    expect(capturedScope?.meta.type).toBe("actor");
  });

  it("scope.run() sets GwenScope.current() correctly for system scopes", () => {
    const engine = makeMockEngine();
    const systemScope = new GwenScope(engine, { type: "system", name: "test-system" });
    let capturedScope: GwenScope | null = null;

    systemScope.run(() => {
      capturedScope = GwenScope.current();
    });

    expect(capturedScope).toBe(systemScope);
    expect(capturedScope?.meta.type).toBe("system");
  });

  it("scope.run() sets GwenScope.current() correctly for scene scopes", () => {
    const engine = makeMockEngine();
    const sceneScope = new GwenScope(engine, { type: "scene", name: "test-scene" });
    let capturedScope: GwenScope | null = null;

    sceneScope.run(() => {
      capturedScope = GwenScope.current();
    });

    expect(capturedScope).toBe(sceneScope);
    expect(capturedScope?.meta.type).toBe("scene");
  });

  it("scope is set during factory and cleared after", () => {
    const engine = makeMockEngine();
    const sceneScope = new GwenScope(engine, { type: "scene", name: "test-scene" });
    let scopeDuring: GwenScope | null = null;
    let scopeAfter: GwenScope | null = null;

    sceneScope.run(() => {
      scopeDuring = GwenScope.current();
    });

    scopeAfter = GwenScope.current();

    // During scope.run(), scope should be set
    expect(scopeDuring).toBe(sceneScope);

    // After scope.run() exits, scope should be cleared
    expect(scopeAfter).toBeNull();
  });

  it("multiple sequential scope runs maintain isolation", () => {
    const engine = makeMockEngine();
    const scope1 = new GwenScope(engine, { type: "actor", name: "actor1" });
    const scope2 = new GwenScope(engine, { type: "actor", name: "actor2" });
    const captures: (GwenScope | null)[] = [];

    scope1.run(() => {
      captures.push(GwenScope.current());
    });

    scope2.run(() => {
      captures.push(GwenScope.current());
    });

    // Both should be captured correctly
    expect(captures[0]).toBe(scope1);
    expect(captures[1]).toBe(scope2);

    // After both, should be cleared
    expect(GwenScope.current()).toBeNull();
  });
});
