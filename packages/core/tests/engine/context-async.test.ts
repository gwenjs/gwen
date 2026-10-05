import { describe, it, expect } from "vitest";
import { withAsyncContext, createEngine, useEngine, GwenContextError } from "../../src";
import { engineContext, executeAsync } from "../../src/internal";
import { GwenScope } from "../../src/context/scope.js";

describe("GwenContextError — error codes", () => {
  it("has code OUTSIDE_ENGINE when called outside any context", () => {
    engineContext.unset();
    let err: GwenContextError | null = null;
    try {
      useEngine();
    } catch (e) {
      err = e as GwenContextError;
    }
    expect(err).toBeInstanceOf(GwenContextError);
    expect(err!.code).toBe("OUTSIDE_ENGINE");
  });

  it("error message mentions withAsyncContext and capture pattern", () => {
    engineContext.unset();
    let msg = "";
    try {
      useEngine();
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toContain("withAsyncContext");
    expect(msg).toContain("onEnter");
    expect(msg).toContain("@gwenjs/vite");
  });

  it("GwenContextError has a code property", () => {
    const err = new GwenContextError("test", "OUTSIDE_ENGINE");
    expect(err.code).toBe("OUTSIDE_ENGINE");
  });

  it("GwenContextError defaults code to OUTSIDE_ENGINE", () => {
    const err = new GwenContextError("test");
    expect(err.code).toBe("OUTSIDE_ENGINE");
  });
});

describe("executeAsync", () => {
  it("is a function", () => {
    expect(typeof executeAsync).toBe("function");
  });

  it("captures current context and returns [promise, restore]", async () => {
    const engine = await createEngine({ maxEntities: 100 });
    engine.activate();
    const [p, restore] = executeAsync(() => Promise.resolve(42));
    engine.deactivate();
    expect(engineContext.tryUse()).toBeFalsy();
    restore();
    expect(engineContext.tryUse()).toBe(engine);
    engineContext.unset();
    await p;
  });
});

describe("withAsyncContext", () => {
  it("is a function", () => {
    expect(typeof withAsyncContext).toBe("function");
  });

  it("sets captured engine context when the returned function is called", async () => {
    const engine = await createEngine({ maxEntities: 100 });
    let capturedInsideFn: unknown;

    // withAsyncContext is called during factory (engine context active)
    const wrappedFn = engine.run(() =>
      withAsyncContext(async () => {
        capturedInsideFn = engineContext.tryUse();
      }),
    );

    // wrappedFn is called later — outside engine context
    engineContext.unset();
    await wrappedFn();

    expect(capturedInsideFn).toBe(engine);
  });

  it("restores null context when _ctx was null at definition time", async () => {
    engineContext.unset();
    let capturedInsideFn: unknown = "not-set";

    const wrappedFn = withAsyncContext(async () => {
      capturedInsideFn = engineContext.tryUse();
    });

    await wrappedFn();
    // context was falsy when withAsyncContext was defined — remains falsy inside fn
    expect(capturedInsideFn).toBeFalsy();
  });

  it("does not permanently pollute the context after fn completes", async () => {
    const engine = await createEngine({ maxEntities: 100 });
    const wrappedFn = engine.run(() =>
      withAsyncContext(async () => {
        /* noop */
      }),
    );
    engineContext.unset();
    await wrappedFn();
    // context should be falsy after completion — no leak
    expect(engineContext.tryUse()).toBeFalsy();
  });
});

// ─── Phase 3: GwenScope propagation across async boundaries ────────────────

describe("executeAsync — GwenScope propagation", () => {
  it("captures the current GwenScope", async () => {
    const engine = await createEngine();
    const scope = new GwenScope(engine, { type: "plugin", name: "test" });

    let capturedScope: GwenScope | null = null;
    engine.run(() => {
      scope.run(() => {
        const [_promise, restore] = executeAsync(async () => {
          // scope will be captured by executeAsync
        });
        capturedScope = GwenScope.current();
        // Clear the scope
        GwenScope._setCurrent(null);
        // Restore should restore the scope
        restore();
        expect(GwenScope.current()).toBe(scope);
      });
    });

    expect(capturedScope).toBe(scope);
  });
});
