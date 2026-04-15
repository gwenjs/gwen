/**
 * engine.use() — async cleanup rollback on rejection.
 *
 * Verifies that onCleanup() callbacks registered during the synchronous phase
 * of an async plugin setup are executed (not leaked) when the async phase rejects.
 * Also verifies that scoped hooks registered during the sync phase are removed.
 */

import { describe, it, expect, vi } from "vitest";
import { createEngine, onCleanup } from "../../src/index";

describe("engine.use() — async setup rejection cleanup", () => {
  it("calls onCleanup callbacks registered during sync phase when async setup rejects", async () => {
    const engine = await createEngine();
    const cleanup = vi.fn();

    const plugin = {
      name: "AsyncFail",
      async setup() {
        // onCleanup registered synchronously before the first await
        onCleanup(cleanup);
        await Promise.resolve(); // yield to event loop
        throw new Error("setup failed");
      },
    };

    await expect(engine.use(plugin)).rejects.toThrow("setup failed");

    // cleanup must have been called by the catch block rollback
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("removes the plugin cleanup entry from _pluginCleanups so it does not re-run on unuse()", async () => {
    const engine = await createEngine();
    const cleanup = vi.fn();

    const plugin = {
      name: "AsyncFail2",
      async setup() {
        onCleanup(cleanup);
        await Promise.resolve();
        throw new Error("setup failed");
      },
    };

    await expect(engine.use(plugin)).rejects.toThrow("setup failed");

    // cleanup was called once during rollback
    expect(cleanup).toHaveBeenCalledOnce();

    // The plugin was never added to _plugins so unuse() is a no-op — cleanup must not fire again
    await engine.unuse("AsyncFail2");
    expect(cleanup).toHaveBeenCalledOnce(); // still once, not twice
  });

  it("removes scoped hooks registered during the sync phase when async setup rejects", async () => {
    const engine = await createEngine();
    const tickSpy = vi.fn();

    const plugin = {
      name: "AsyncFailHooks",
      async setup(eng: typeof engine) {
        // register a hook synchronously before the first await
        eng.hooks.hook("engine:tick", tickSpy);
        await Promise.resolve();
        throw new Error("setup failed");
      },
    };

    await expect(engine.use(plugin)).rejects.toThrow("setup failed");

    // Manually fire engine:tick — the hook must have been removed by rollback
    engine.hooks.callHook("engine:tick", 0.016);
    expect(tickSpy).not.toHaveBeenCalled();
  });
});
