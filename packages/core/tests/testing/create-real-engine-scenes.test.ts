import { describe, expect, it } from "vitest";
import { SceneEnginePlugin } from "../../src/scene/engine-plugin.js";
import { createRealEngine, type RealEngineHandle } from "../../src/testing/create-real-engine.js";

describe("createRealEngine scenes", () => {
  it("createRealEngine with scenes true installs the scene plugin once", async () => {
    const handles: RealEngineHandle[] = [];
    try {
      const withScenes = await createRealEngine({
        variant: "light",
        maxEntities: 4,
        scenes: true,
      });
      handles.push(withScenes);
      const registry = withScenes.engine.tryInject("scene:hook-registry");
      expect(registry).toBeDefined();
      await withScenes.engine.use(SceneEnginePlugin());
      expect(withScenes.engine.tryInject("scene:hook-registry")).toBe(registry);

      const bare = await createRealEngine({ variant: "light", maxEntities: 4 });
      handles.push(bare);
      expect(bare.engine.tryInject("scene:hook-registry")).toBeUndefined();
    } finally {
      for (const handle of handles) await handle.dispose();
    }
  });
});
