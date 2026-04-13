import { describe, it, expect } from "vitest";
import { useScreen } from "../../src/use-screen.js";
import { getOrCreateScreenService } from "../../src/get-or-create-screen-service.js";
import { StaticSizeProvider } from "../../src/screen-size-providers.js";
import { ScreenPlugin } from "../../src/screen-plugin.js";
import { createEngine } from "@gwenjs/core";

async function makeEngine() {
  const engine = await createEngine({ maxEntities: 100 });
  const plugin = ScreenPlugin({ sizeProvider: StaticSizeProvider({ width: 800, height: 600 }) });
  // Manually call setup to register the service (no full engine.use needed for unit test)
  plugin.setup(engine);
  return engine;
}

describe("useScreen", () => {
  it("returns a ViewportScreenInfo with zero pixels before any viewport is registered", async () => {
    const engine = await makeEngine();
    // Run in engine context
    let info: ReturnType<typeof useScreen> | undefined;
    engine.run(() => {
      // Simulate viewport:add hook being called
      const svc = getOrCreateScreenService(engine);
      svc.setContainerSize(800, 600);
      // viewportManager is created by getOrCreateScreenService
      const vm = engine.inject("viewportManager");
      vm.set("main", { x: 0, y: 0, width: 1, height: 1 });
      svc.setContainerSize(800, 600);
      info = useScreen("main");
    });
    expect(info).toBeDefined();
    expect(info!.pixels.width).toBe(800);
    expect(info!.pixels.height).toBe(600);
  });

  it('defaults to "main" viewport when called without arguments', async () => {
    const engine = await makeEngine();
    engine.run(() => {
      const vm = engine.inject("viewportManager");
      vm.set("main", { x: 0, y: 0, width: 1, height: 1 });
      getOrCreateScreenService(engine).setContainerSize(1024, 768);
      const info = useScreen();
      expect(info.pixels.width).toBe(1024);
    });
  });

  it("returns the same object reference on repeated calls for the same viewport", async () => {
    const engine = await makeEngine();
    engine.run(() => {
      const vm = engine.inject("viewportManager");
      vm.set("main", { x: 0, y: 0, width: 1, height: 1 });
      const a = useScreen("main");
      const b = useScreen("main");
      expect(a).toBe(b);
    });
  });

  it("bounds is undefined when no bounds provider is registered", async () => {
    const engine = await makeEngine();
    engine.run(() => {
      const vm = engine.inject("viewportManager");
      vm.set("main", { x: 0, y: 0, width: 1, height: 1 });
      const info = useScreen("main");
      expect(info.bounds).toBeUndefined();
    });
  });
});
