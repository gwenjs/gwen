import { describe, expect, it } from "vitest";
import { createScreenPlugin, createViewportsPlugin } from "@gwenjs/app";
import { createRealEngine } from "@gwenjs/core/testing";
import { CameraCorePlugin } from "@gwenjs/camera-core";
import { FRAMEWORK_PLUGIN_NAMES } from "@gwenjs/plugin-conformance";

describe("FRAMEWORK_PLUGIN_NAMES", () => {
  it("lists the name of every framework bootstrap plugin", async () => {
    const observed = [
      createViewportsPlugin().name,
      createScreenPlugin().name,
      CameraCorePlugin().name,
    ];
    const handle = await createRealEngine({
      variant: "light",
      maxEntities: 64,
      scenes: true,
    });
    try {
      observed.push(...handle.engine.getStats().plugins);
    } finally {
      await handle.dispose();
    }
    expect([...FRAMEWORK_PLUGIN_NAMES].sort()).toEqual([...observed].sort());
  });
});
