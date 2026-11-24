import { describe, it, expect } from "vitest";
import { createEngine } from "../../src/node";
import { SceneEnginePlugin, SceneHookRegistry } from "../../src/scene/engine-plugin";
import { defineScene } from "../../src/scene/runtime/define-scene";
import { onPreload } from "../../src/scene/runtime/scene-context";

describe("SceneEnginePlugin — cleanup via DisposableRegistry", () => {
  it("calls registry.dispose() when engine.stop() is called", async () => {
    const engine = await createEngine({});
    await engine.use(SceneEnginePlugin());

    const registry = engine.tryInject("scene:hook-registry") as SceneHookRegistry;
    expect(registry).toBeDefined();

    // Before stop: registry is active
    expect(engine.disposables.size).toBeGreaterThan(0);

    await engine.stop();

    // After stop: disposables cleared (disposeAll was called)
    expect(engine.disposables.size).toBe(0);
  });

  it("dispose removes the scene:preload handler of a scene", async () => {
    const engine = await createEngine();
    try {
      await engine.use(SceneEnginePlugin());
      const registry = engine.tryInject("scene:hook-registry");
      expect(registry).toBeDefined();
      if (registry === undefined) return;

      const baseline = engine.getStats().hookListeners;
      const Bare = defineScene("CleanupBare", () => {});
      engine.run(() => {
        Bare({ register: () => {} });
      });
      expect(engine.getStats().hookListeners).toBe(baseline);

      const Preloading = defineScene("CleanupPreload", () => {
        onPreload(() => {});
      });
      engine.run(() => {
        Preloading({ register: () => {} });
      });
      expect(engine.getStats().hookListeners).toBe(baseline + 1);

      registry.dispose();
      expect(engine.getStats().hookListeners).toBe(baseline);
    } finally {
      await engine.stop();
    }
  });
});
