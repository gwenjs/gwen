/**
 * @gwenjs/core — ScopedHookable unit tests.
 *
 * Verifies pause/resume/dispose behavior and that the active scope slot
 * correctly reflects the current execution context.
 */

import { describe, it, expect, vi } from "vitest";
import { createHooks } from "hookable";
import type { GwenRuntimeHooks } from "@gwenjs/schema";
import { ScopedHookable, _currentScopeSlot } from "../../src/hooks/scoped-hookable";

function makeParent() {
  return createHooks<GwenRuntimeHooks>();
}

describe("ScopedHookable — hook()", () => {
  it("invokes the handler when the parent calls the hook", () => {
    const parent = makeParent();
    const scope = new ScopedHookable(parent);
    const fn = vi.fn();

    scope.hook("engine:update", fn);
    parent.callHook("engine:update", 0.016);

    expect(fn).toHaveBeenCalledWith(0.016);
  });

  it("returns an unsubscribe function that immediately stops the handler", () => {
    const parent = makeParent();
    const scope = new ScopedHookable(parent);
    const fn = vi.fn();

    const unsub = scope.hook("engine:update", fn);
    unsub();
    parent.callHook("engine:update", 0.016);

    expect(fn).not.toHaveBeenCalled();
  });
});

describe("ScopedHookable — pause() / resume()", () => {
  it("silences all handlers while paused", () => {
    const parent = makeParent();
    const scope = new ScopedHookable(parent);
    const fn = vi.fn();

    scope.hook("engine:update", fn);
    scope.pause();
    parent.callHook("engine:update", 0.016);

    expect(fn).not.toHaveBeenCalled();
  });

  it("resumes dispatch after resume()", () => {
    const parent = makeParent();
    const scope = new ScopedHookable(parent);
    const fn = vi.fn();

    scope.hook("engine:update", fn);
    scope.pause();
    scope.resume();
    parent.callHook("engine:update", 0.016);

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("one paused = true flag covers all registered handlers", () => {
    const parent = makeParent();
    const scope = new ScopedHookable(parent);
    const a = vi.fn();
    const b = vi.fn();

    scope.hook("engine:update", a);
    scope.hook("engine:before-update", b);
    scope.pause();

    parent.callHook("engine:update", 0.016);
    parent.callHook("engine:before-update", 0.016);

    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
  });
});

describe("ScopedHookable — dispose()", () => {
  it("unregisters all handlers from the parent", () => {
    const parent = makeParent();
    const scope = new ScopedHookable(parent);
    const fn = vi.fn();

    scope.hook("engine:update", fn);
    scope.dispose();
    parent.callHook("engine:update", 0.016);

    expect(fn).not.toHaveBeenCalled();
  });

  it("is idempotent — second dispose() is a no-op", () => {
    const parent = makeParent();
    const scope = new ScopedHookable(parent);
    const fn = vi.fn();

    scope.hook("engine:update", fn);
    scope.dispose();
    scope.dispose(); // must not throw

    expect(fn).not.toHaveBeenCalled();
  });

  it("clears all disposers so they cannot be re-invoked", () => {
    const parent = makeParent();
    const scope = new ScopedHookable(parent);
    const a = vi.fn();
    const b = vi.fn();

    scope.hook("engine:update", a);
    scope.hook("engine:render", b);
    scope.dispose();

    // Registering again after dispose works on a fresh subscription
    scope.hook("engine:update", a);
    parent.callHook("engine:update", 0.016);

    expect(a).toHaveBeenCalledTimes(1); // only the new subscription fires
    expect(b).not.toHaveBeenCalled();
  });
});

describe("_currentScopeSlot", () => {
  it("returns null when no scope is active", () => {
    expect(_currentScopeSlot.get()).toBeNull();
  });

  it("returns the scope while inside ContextSlot.run()", () => {
    const parent = makeParent();
    const scope = new ScopedHookable(parent);
    let captured: ScopedHookable | null = null;

    _currentScopeSlot.run(scope, () => {
      captured = _currentScopeSlot.get();
    });

    expect(captured).toBe(scope);
    expect(_currentScopeSlot.get()).toBeNull(); // restored after run
  });

  it("restores the previous scope on nested run() calls", () => {
    const parent = makeParent();
    const outerScope = new ScopedHookable(parent);
    const innerScope = new ScopedHookable(parent);
    const captured: Array<ScopedHookable | null> = [];

    _currentScopeSlot.run(outerScope, () => {
      captured.push(_currentScopeSlot.get());
      _currentScopeSlot.run(innerScope, () => {
        captured.push(_currentScopeSlot.get());
      });
      captured.push(_currentScopeSlot.get());
    });

    expect(captured[0]).toBe(outerScope);
    expect(captured[1]).toBe(innerScope);
    expect(captured[2]).toBe(outerScope);
    expect(_currentScopeSlot.get()).toBeNull();
  });
});
