/**
 * RFC-001: engine.use / engine.unuse lifecycle tests
 */
import { describe, it, expect, vi } from "vitest";
import { GwenError } from "@gwenjs/schema";
import { createEngine, GwenPluginNotFoundError } from "../src/index";

declare module "@gwenjs/schema" {
  interface GwenProvides {
    testSvc: { value: number };
  }
}

describe("engine.use / engine.unuse", () => {
  it("calls setup with engine instance", async () => {
    const engine = await createEngine();
    const setup = vi.fn();
    await engine.use({ name: "P", setup });
    expect(setup).toHaveBeenCalledWith(expect.objectContaining({ use: expect.any(Function) }));
  });

  it("deduplicates by name — second use() is a no-op", async () => {
    const engine = await createEngine();
    const setup = vi.fn();
    const plugin = { name: "P", setup };
    await engine.use(plugin);
    await engine.use(plugin);
    expect(setup).toHaveBeenCalledOnce();
  });

  it("awaits async setup before resolving", async () => {
    const engine = await createEngine();
    let resolved = false;
    await engine.use({
      name: "Async",
      async setup() {
        await new Promise<void>((r) => setTimeout(r, 10));
        resolved = true;
      },
    });
    expect(resolved).toBe(true);
  });

  it("calls teardown on unuse()", async () => {
    const engine = await createEngine();
    const teardown = vi.fn();
    await engine.use({ name: "T", setup() {}, teardown });
    await engine.unuse("T");
    expect(teardown).toHaveBeenCalledOnce();
  });

  it("unuse() unknown name is a no-op", async () => {
    const engine = await createEngine();
    await expect(engine.unuse("Unknown")).resolves.toBeUndefined();
  });

  it("all 4 frame hooks called in order", async () => {
    const calls: string[] = [];
    const engine = await createEngine();
    await engine.use({
      name: "Hooks",
      setup(e) {
        e.hooks.hook("engine:before-update", () => {
          calls.push("before");
        });
        e.hooks.hook("engine:update", () => {
          calls.push("update");
        });
        e.hooks.hook("engine:after-update", () => {
          calls.push("after");
        });
        e.hooks.hook("engine:render", () => {
          calls.push("render");
        });
      },
    });
    await engine.advance(1 / 60);
    expect(calls).toEqual(["before", "update", "after", "render"]);
  });
});

describe("engine.provide / inject / tryInject", () => {
  it("inject() returns provided value", async () => {
    const engine = await createEngine();
    engine.provide("testSvc" as never, { value: 42 } as never);
    expect(engine.inject("testSvc" as never)).toEqual({ value: 42 });
  });

  it("inject() throws GwenPluginNotFoundError when absent", async () => {
    const engine = await createEngine();
    try {
      expect(() => engine.inject("testSvc" as never)).toThrow(GwenPluginNotFoundError);
    } finally {
      await engine.stop();
    }
  });

  it("GwenPluginNotFoundError has plugin, hint, docsUrl", async () => {
    const engine = await createEngine();
    try {
      engine.inject("testSvc" as never);
    } catch (e) {
      expect(e).toBeInstanceOf(GwenPluginNotFoundError);
      if (!(e instanceof GwenPluginNotFoundError)) return;
      expect(e.pluginName).toBe("testSvc");
      expect(e.docsUrl).toBe("https://gwenjs.github.io/gwen/api/errors#core-plugin-not-found");
      if (__GWEN_DEV__) expect(e.hint).toContain('provides: ["testSvc"]');
      else expect(e.hint).toBeUndefined();
    } finally {
      await engine.stop();
    }
  });

  it("tryInject() returns undefined when absent", async () => {
    const engine = await createEngine();
    expect(engine.tryInject("testSvc" as never)).toBeUndefined();
  });
});

describe("engine.advance()", () => {
  it("caps delta time at maxDeltaSeconds", async () => {
    const dts: number[] = [];
    const engine = await createEngine({ maxDeltaSeconds: 0.05 });
    await engine.use({
      name: "dt",
      setup(e) {
        e.hooks.hook("engine:update", (dt) => {
          dts.push(dt);
        });
      },
    });
    await engine.advance(1); // 1s > maxDeltaSeconds cap of 0.05s
    expect(dts[0]).toBe(0.05); // capped to maxDeltaSeconds
  });

  it("throws on re-entrant advance()", async () => {
    const engine = await createEngine();
    let secondCallError: unknown = null;
    await engine.use({
      name: "reentrant",
      setup(e) {
        e.hooks.hook("engine:update", () => {
          engine.advance(0.016).catch((caught: unknown) => {
            secondCallError = caught;
          });
        });
      },
    });
    try {
      await engine.advance(0.016);
      expect(secondCallError).toBeInstanceOf(GwenError);
      if (!(secondCallError instanceof GwenError)) return;
      expect(secondCallError.composable).toBe("engine.advance");
      expect(secondCallError.message).toContain("re-entrantly");
    } finally {
      await engine.stop();
    }
  });
});
