import { describe, it, expect } from "vitest";
import { createEngine } from "../../src/engine/gwen-engine";
import { SceneEnginePlugin, SceneHookRegistry } from "../../src/scene/engine-plugin";

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
});
