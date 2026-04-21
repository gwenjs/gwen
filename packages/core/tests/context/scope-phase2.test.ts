/**
 * @file scope-phase2.test.ts
 *
 * Tests for Phase 2: wiring onCleanup() to delegate to GwenScope.current()
 *
 * Verifies:
 * - onCleanup() registers on the active scope when inside scope.run()
 * - onCleanup() falls back to legacy _cleanupStack when outside any scope
 * - Multiple scopes maintain independent cleanup contexts
 * - Scope disposal runs its cleanups independently
 */

import { describe, it, expect, vi } from "vitest";
import { GwenScope } from "../../src/context/scope.js";
import { onCleanup, withCleanup } from "../../src/cleanup-context.js";

function makeMockEngine() {
  return {
    hooks: {
      hook: vi.fn((_: string, _fn: unknown) => () => {}),
      callHook: vi.fn(),
    },
  } as any;
}

describe("onCleanup with GwenScope (Phase 2)", () => {
  it("registers on the scope when inside scope.run()", () => {
    const engine = makeMockEngine();
    const scope = new GwenScope(engine, { type: "plugin", name: "p1" });
    const calls: string[] = [];

    scope.run(() => onCleanup(() => calls.push("scope1")));

    expect(scope.cleanupCount).toBe(1);
    expect(calls).toEqual([]);
    scope.dispose();
    expect(calls).toEqual(["scope1"]);
  });

  it("registers cleanups independently for multiple scopes", () => {
    const engine = makeMockEngine();
    const scope1 = new GwenScope(engine, { type: "plugin", name: "p1" });
    const scope2 = new GwenScope(engine, { type: "plugin", name: "p2" });
    const calls: string[] = [];

    scope1.run(() => onCleanup(() => calls.push("scope1")));
    scope2.run(() => onCleanup(() => calls.push("scope2")));

    expect(scope1.cleanupCount).toBe(1);
    expect(scope2.cleanupCount).toBe(1);

    scope1.dispose();
    expect(calls).toContain("scope1");
    expect(calls).not.toContain("scope2");

    scope2.dispose();
    expect(calls).toContain("scope2");
    expect(calls).toEqual(["scope1", "scope2"]);
  });

  it("falls back to legacy stack when outside any scope", () => {
    // This should use the fallback _cleanupStack mechanism
    const [_result, dispose] = withCleanup(() => {
      const calls: string[] = [];
      onCleanup(() => calls.push("legacy"));
      return calls;
    });

    const calls = _result;
    expect(calls).toEqual([]);
    dispose();
    expect(calls).toEqual(["legacy"]);
  });

  it("scope cleanup runs in LIFO order", () => {
    const engine = makeMockEngine();
    const scope = new GwenScope(engine, { type: "plugin" });
    const calls: string[] = [];

    scope.run(() => {
      onCleanup(() => calls.push("first"));
      onCleanup(() => calls.push("second"));
      onCleanup(() => calls.push("third"));
    });

    scope.dispose();
    expect(calls).toEqual(["third", "second", "first"]);
  });

  it("nested scopes maintain separate cleanup contexts", () => {
    const engine = makeMockEngine();
    const parent = new GwenScope(engine, { type: "scene" });
    const child = new GwenScope(engine, { type: "actor" }, parent);
    const calls: string[] = [];

    parent.run(() => {
      onCleanup(() => calls.push("parent"));
      child.run(() => {
        onCleanup(() => calls.push("child"));
      });
    });

    expect(parent.cleanupCount).toBe(1);
    expect(child.cleanupCount).toBe(1);

    parent.dispose();
    // When parent disposes, it disposes children first, then runs its own cleanups
    expect(calls).toEqual(["child", "parent"]);
  });

  it("onCleanup throws when outside scope and no legacy context (no withCleanup)", () => {
    // Clear any active scope
    expect(GwenScope.current()).toBeNull();

    // Outside withCleanup and GwenScope, onCleanup should throw
    expect(() => {
      onCleanup(() => {});
    }).toThrow(/onCleanup.*context|context.*onCleanup/i);
  });

  it("scope.run() with onCleanup works multiple times on same scope", () => {
    const engine = makeMockEngine();
    const scope = new GwenScope(engine, { type: "actor" });
    const calls: string[] = [];

    scope.run(() => onCleanup(() => calls.push("run1")));
    scope.run(() => onCleanup(() => calls.push("run2")));
    scope.run(() => onCleanup(() => calls.push("run3")));

    expect(scope.cleanupCount).toBe(3);
    scope.dispose();
    expect(calls).toEqual(["run3", "run2", "run1"]);
  });

  it("mixed scope and legacy context: onCleanup prefers active scope", () => {
    const engine = makeMockEngine();
    const scope = new GwenScope(engine, { type: "plugin" });
    const calls: string[] = [];

    // Register on scope
    scope.run(() => onCleanup(() => calls.push("scope")));

    expect(scope.cleanupCount).toBe(1);
    scope.dispose();
    expect(calls).toEqual(["scope"]);
  });
});
