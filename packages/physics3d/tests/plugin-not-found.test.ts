import { afterEach, describe, expect, it } from "vitest";
import { GwenError } from "@gwenjs/schema";
import { createEngine, type GwenEngine } from "@gwenjs/core";
import { usePhysics3D } from "../src/composables";

const engines: GwenEngine[] = [];

afterEach(async () => {
  const pending = engines.splice(0);
  for (const engine of pending) await engine.stop();
});

describe("usePhysics3D", () => {
  it("usePhysics3D without the plugin throws CORE:PLUGIN_NOT_FOUND naming usePhysics3D", async () => {
    const engine = await createEngine({ maxEntities: 8 });
    engines.push(engine);
    let error: unknown;
    await engine.run(() => {
      try {
        usePhysics3D();
      } catch (caught) {
        error = caught;
      }
    });
    expect(error).toBeInstanceOf(GwenError);
    if (!(error instanceof GwenError)) return;
    expect(error.code).toBe("CORE:PLUGIN_NOT_FOUND");
    expect(error.composable).toBe("usePhysics3D");
    expect(error.message).not.toContain("docsUrl");
    expect(error.message).not.toContain("gwenengine.dev");
  });
});
