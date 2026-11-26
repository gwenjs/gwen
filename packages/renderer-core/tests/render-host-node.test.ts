import { afterEach, describe, expect, it } from "vitest";
import { createEngine } from "@gwenjs/core/node";
import type { GwenEngine } from "@gwenjs/core";
import { recorder, renderHost, rendererPlugin, surface } from "./helpers/render-host.js";

const engines: GwenEngine[] = [];

afterEach(async () => {
  for (const engine of engines.splice(0)) await engine.stop();
});

describe("RenderHostPlugin without a document", () => {
  it("starts, registers the viewports and mounts nothing when there is no container and no document", async () => {
    expect(typeof document).toBe("undefined");
    const engine = await createEngine({ maxEntities: 32 });
    engines.push(engine);
    const reported: string[] = [];
    engine.errors.on((event) => reported.push(`${event.code}: ${event.message}`));
    const rec = recorder();
    await engine.use(renderHost());
    await engine.use(rendererPlugin(surface("renderer:one", 0, rec), false));
    await expect(engine.startExternal()).resolves.toBeUndefined();
    expect([...engine.inject("viewportManager").getAll().keys()]).toEqual(["main"]);
    expect(engine.inject("layerManager").has("renderer:one")).toBe(true);
    expect(rec.mounts).toBe(0);
    // A throw inside the `engine:init` hook does not reject `startExternal()`: the engine
    // reports it on the error bus and isolates the plugin. Neither may have happened.
    expect(reported).toEqual([]);
    expect(engine.isolated()).toEqual([]);
    expect(engine.state).toBe("running");
  });
});
