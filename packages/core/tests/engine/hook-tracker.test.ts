/**
 * ScopedHooksTracker without an engine.
 * Each test registers a real hook, then checks who still runs after removal.
 */

import { createHooks, type Hookable } from "hookable";
import { describe, expect, it } from "vitest";
import type { GwenRuntimeHooks } from "../../src/engine/runtime-hooks";
import { ScopedHooksTracker } from "../../src/engine/hook-tracker";

function hooks(): Hookable<GwenRuntimeHooks> {
  return createHooks<GwenRuntimeHooks>();
}

describe("ScopedHooksTracker", () => {
  it("constructs without createEngine and removeAll drops only that plugin's hook", async () => {
    const bus = hooks();
    const tracker = new ScopedHooksTracker();
    let alpha = 0;
    let beta = 0;
    const alphaFn = () => {
      alpha += 1;
    };
    const betaFn = () => {
      beta += 1;
    };
    bus.hook("engine:update", alphaFn);
    bus.hook("engine:update", betaFn);
    tracker.track("alpha", "engine:update", alphaFn);
    tracker.track("beta", "engine:update", betaFn);

    await bus.callHook("engine:update", 0);
    tracker.removeAll("alpha", bus);
    await bus.callHook("engine:update", 0);

    expect(alpha).toBe(1);
    expect(beta).toBe(2);
  });

  it("constructs without createEngine and clearAll drops every plugin hook", async () => {
    const bus = hooks();
    const tracker = new ScopedHooksTracker();
    let hits = 0;
    const fn = () => {
      hits += 1;
    };
    bus.hook("engine:update", fn);
    tracker.track("alpha", "engine:update", fn);

    await bus.callHook("engine:update", 0);
    tracker.clearAll(bus);
    await bus.callHook("engine:update", 0);

    expect(hits).toBe(1);
  });

  it("constructs without createEngine and removeAll of an unknown name keeps the hook", async () => {
    const bus = hooks();
    const tracker = new ScopedHooksTracker();
    let hits = 0;
    const fn = () => {
      hits += 1;
    };
    bus.hook("engine:update", fn);
    tracker.track("alpha", "engine:update", fn);

    tracker.removeAll("missing", bus);
    await bus.callHook("engine:update", 0);

    expect(hits).toBe(1);
  });
});
