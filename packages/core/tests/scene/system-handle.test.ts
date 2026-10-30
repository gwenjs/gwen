import { afterEach, describe, it, expect, vi } from "vitest";
import { createEngine, type GwenEngine } from "../../src/index";
import { createSystemHandle } from "../../src/scene/runtime/system-handle";
import type { GwenPlugin } from "../../src/engine/engine-types.js";

const FORBIDDEN = [
  "onBeforeUpdate",
  "onUpdate",
  "onAfterUpdate",
  "onRender",
  "onStart",
  "onStop",
  "onDestroy",
];

type WidePlugin = GwenPlugin & {
  onBeforeUpdate?: (dt: number) => void;
  onUpdate?: (dt: number) => void;
  onAfterUpdate?: (dt: number) => void;
  onRender?: () => void;
};

const engines: GwenEngine[] = [];

afterEach(async () => {
  const pending = engines.splice(0);
  for (const engine of pending) await engine.stop();
});

function makeInnerPlugin(): GwenPlugin {
  return {
    name: "test-plugin",
    setup() {},
  };
}

describe("createSystemHandle", () => {
  it("returns a plugin and a handle", () => {
    const { plugin, handle } = createSystemHandle(makeInnerPlugin());
    expect(typeof plugin).toBe("object");
    expect(typeof handle).toBe("object");
    expect(typeof handle.pause).toBe("function");
    expect(typeof handle.resume).toBe("function");
    expect(typeof handle.destroy).toBe("function");
  });

  it("wrapped plugin preserves the original plugin name", () => {
    const inner = makeInnerPlugin();
    inner.name = "MySystem";
    const { plugin } = createSystemHandle(inner);
    expect(plugin.name).toBe("MySystem");
  });
});

describe("SystemHandle — active state", () => {
  it("is active by default", () => {
    const { handle } = createSystemHandle(makeInnerPlugin());
    expect(handle.active).toBe(true);
  });

  it("pause() deactivates the handle", () => {
    const { handle } = createSystemHandle(makeInnerPlugin());
    handle.pause();
    expect(handle.active).toBe(false);
  });

  it("resume() reactivates a paused handle", () => {
    const { handle } = createSystemHandle(makeInnerPlugin());
    handle.pause();
    handle.resume();
    expect(handle.active).toBe(true);
  });

  it("destroy() permanently deactivates the handle", () => {
    const { handle } = createSystemHandle(makeInnerPlugin());
    handle.destroy();
    expect(handle.active).toBe(false);
  });

  it("resume() after destroy() does NOT reactivate", () => {
    const { handle } = createSystemHandle(makeInnerPlugin());
    handle.destroy();
    handle.resume();
    expect(handle.active).toBe(false);
  });
});

describe("SystemHandle — two-flag pause model (user + scene)", () => {
  it("_scenePause() deactivates the handle", () => {
    const { handle } = createSystemHandle(makeInnerPlugin());
    handle._scenePause();
    expect(handle.active).toBe(false);
  });

  it("_sceneResume() reactivates a scene-paused handle", () => {
    const { handle } = createSystemHandle(makeInnerPlugin());
    handle._scenePause();
    handle._sceneResume();
    expect(handle.active).toBe(true);
  });

  it("user-paused system stays paused after _sceneResume()", () => {
    // Scenario: dev pauses combat, then player opens pause menu.
    // On resume from pause menu, combat must NOT restart.
    const { handle } = createSystemHandle(makeInnerPlugin());
    handle.pause(); // developer pauses
    handle._scenePause(); // scene overlay freezes
    handle._sceneResume(); // scene overlay resumes
    // developer pause is still in effect
    expect(handle.active).toBe(false);
  });

  it("destroyed system ignores _sceneResume()", () => {
    const { handle } = createSystemHandle(makeInnerPlugin());
    handle.destroy();
    handle._sceneResume();
    expect(handle.active).toBe(false);
  });

  it("plugin setup is forwarded unchanged", () => {
    const setupSpy = vi.fn();
    const inner: GwenPlugin = {
      name: "test",
      setup: setupSpy,
    };
    const { plugin } = createSystemHandle(inner);
    plugin.setup?.({} as never);
    expect(setupSpy).toHaveBeenCalledOnce();
  });
});

describe("wrapped system shape", () => {
  it("a wrapped system has no forbidden own key", () => {
    const inner: WidePlugin = {
      name: "inner",
      setup() {},
      onBeforeUpdate() {},
      onUpdate() {},
      onAfterUpdate() {},
      onRender() {},
    };
    const { plugin } = createSystemHandle(inner);
    expect(Object.keys(plugin).filter((key) => FORBIDDEN.includes(key))).toEqual([]);
  });

  it("a wrapped system omits teardown and onError when the inner has none", () => {
    const inner: GwenPlugin = { name: "bare", setup() {} };
    const { plugin } = createSystemHandle(inner);
    expect(Object.keys(plugin)).toEqual(["name", "setup"]);
  });

  it("a wrapped system forwards teardown and onError to the inner plugin", () => {
    class BoundInner implements GwenPlugin {
      name = "cls";
      closed = false;
      seen: unknown = undefined;
      setup(): void {}
      teardown(): void {
        this.closed = true;
      }
      onError(error: unknown): void {
        this.seen = error;
      }
    }
    const inner = Object.assign(new BoundInner(), { onUpdate() {} });
    const { plugin } = createSystemHandle(inner);
    expect(Object.keys(plugin).filter((key) => FORBIDDEN.includes(key))).toEqual([]);
    const failure = new Error("boom");
    try {
      plugin.teardown?.();
    } catch {
      /* unbound teardown leaves closed false */
    }
    try {
      plugin.onError?.(failure, { phase: "teardown", frame: 0, recover() {} });
    } catch {
      /* unbound onError leaves seen unset */
    }
    expect(inner.closed).toBe(true);
    expect(inner.seen).toBe(failure);
  });

  it("a wrapped system installs with engine.use()", async () => {
    const tick = { n: 0 };
    const inner: WidePlugin = {
      name: "wrapped",
      setup() {
        tick.n += 1;
      },
      onUpdate() {},
    };
    const { plugin } = createSystemHandle(inner);
    expect(Object.keys(plugin).filter((key) => FORBIDDEN.includes(key))).toEqual([]);
    const engine = await createEngine();
    engines.push(engine);
    await engine.use(plugin);
    expect(tick.n).toBe(1);
  });
});
