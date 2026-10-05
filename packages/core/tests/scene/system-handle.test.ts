import { describe, it, expect, vi } from "vitest";
import { createSystemHandle } from "../../src/scene/runtime/system-handle";
import type { GwenPlugin } from "../../src/engine/gwen-engine.js";

type FramePlugin = GwenPlugin & {
  onUpdate?: (dt: number) => void;
  onBeforeUpdate?: (dt: number) => void;
  onAfterUpdate?: (dt: number) => void;
  onRender?: () => void;
};

function framePlugin(plugin: GwenPlugin): FramePlugin {
  return plugin as FramePlugin;
}

function makeInnerPlugin(onUpdateSpy = vi.fn()): FramePlugin {
  return {
    name: "test-plugin",
    setup() {},
    onUpdate: onUpdateSpy,
    onBeforeUpdate: vi.fn(),
    onAfterUpdate: vi.fn(),
    onRender: vi.fn(),
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

describe("SystemHandle — frame callback gating", () => {
  it("onUpdate fires when active", () => {
    const spy = vi.fn();
    const { plugin } = createSystemHandle(makeInnerPlugin(spy));
    framePlugin(plugin).onUpdate!(0.016);
    expect(spy).toHaveBeenCalledOnce();
  });

  it("onUpdate does NOT fire when paused", () => {
    const spy = vi.fn();
    const { plugin, handle } = createSystemHandle(makeInnerPlugin(spy));
    handle.pause();
    framePlugin(plugin).onUpdate!(0.016);
    expect(spy).not.toHaveBeenCalled();
  });

  it("onUpdate fires again after resume", () => {
    const spy = vi.fn();
    const { plugin, handle } = createSystemHandle(makeInnerPlugin(spy));
    handle.pause();
    framePlugin(plugin).onUpdate!(0.016);
    handle.resume();
    framePlugin(plugin).onUpdate!(0.016);
    expect(spy).toHaveBeenCalledOnce();
  });

  it("onUpdate does NOT fire after destroy", () => {
    const spy = vi.fn();
    const { plugin, handle } = createSystemHandle(makeInnerPlugin(spy));
    handle.destroy();
    framePlugin(plugin).onUpdate!(0.016);
    expect(spy).not.toHaveBeenCalled();
  });

  it("onBeforeUpdate and onAfterUpdate are also gated", () => {
    const inner = makeInnerPlugin();
    const beforeSpy = vi.fn();
    const afterSpy = vi.fn();
    inner.onBeforeUpdate = beforeSpy;
    inner.onAfterUpdate = afterSpy;
    const { plugin, handle } = createSystemHandle(inner);

    handle.pause();
    framePlugin(plugin).onBeforeUpdate!(0.016);
    framePlugin(plugin).onAfterUpdate!(0.016);

    expect(beforeSpy).not.toHaveBeenCalled();
    expect(afterSpy).not.toHaveBeenCalled();
  });

  it("onRender is also gated", () => {
    const inner = makeInnerPlugin();
    const renderSpy = vi.fn();
    inner.onRender = renderSpy;
    const { plugin, handle } = createSystemHandle(inner);

    handle.pause();
    framePlugin(plugin).onRender!();
    expect(renderSpy).not.toHaveBeenCalled();
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

  it("user-paused system ticks again only after explicit resume()", () => {
    const spy = vi.fn();
    const { plugin, handle } = createSystemHandle(makeInnerPlugin(spy));

    handle.pause();
    handle._scenePause();
    handle._sceneResume();
    framePlugin(plugin).onUpdate!(0.016);
    expect(spy).not.toHaveBeenCalled(); // still user-paused

    handle.resume();
    framePlugin(plugin).onUpdate!(0.016);
    expect(spy).toHaveBeenCalledOnce(); // now active
  });

  it("scene-paused system resumes when _sceneResume() is called (no user pause)", () => {
    const spy = vi.fn();
    const { plugin, handle } = createSystemHandle(makeInnerPlugin(spy));

    handle._scenePause();
    framePlugin(plugin).onUpdate!(0.016);
    expect(spy).not.toHaveBeenCalled();

    handle._sceneResume();
    framePlugin(plugin).onUpdate!(0.016);
    expect(spy).toHaveBeenCalledOnce();
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

  it("plugin with no onUpdate produces wrapped plugin with no onUpdate", () => {
    const inner: GwenPlugin = { name: "bare", setup() {} };
    const { plugin } = createSystemHandle(inner);
    expect(framePlugin(plugin).onUpdate).toBeUndefined();
  });
});
