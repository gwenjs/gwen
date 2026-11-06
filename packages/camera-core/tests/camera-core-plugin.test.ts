// packages/camera-core/tests/camera-core-plugin.test.ts
import { afterEach, describe, expect, it } from "vitest";
import { createEngine } from "@gwenjs/core/node";
import type { GwenEngine } from "@gwenjs/core";
import { createViewportsPlugin } from "../../app/src/viewports-plugin.js";
import { CameraCorePlugin } from "../src/camera-core-plugin.js";

const openEngines: GwenEngine[] = [];

afterEach(async () => {
  while (openEngines.length > 0) await openEngines.pop()?.stop();
});

describe("CameraCorePlugin", () => {
  it("CameraCorePlugin installs without gwen:screen and provides no screenService", async () => {
    const engine = await createEngine({ maxEntities: 100 });
    openEngines.push(engine);
    await engine.use(createViewportsPlugin());
    await engine.use(CameraCorePlugin());
    expect(engine.tryInject("screenService")).toBeUndefined();
  });
});
