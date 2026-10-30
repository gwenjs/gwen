import { describe, expect, it } from "vitest";
import * as cameraCore from "../src/index";
import * as cameraCoreInternal from "../src/internal";

describe("camera-core module", () => {
  it("setup declares CameraCorePlugin", async () => {
    const { GwenApp } = await import("@gwenjs/app/resolve");
    const { resolveLoadedConfig } = await import("../../app/src/config");
    const loaded = await import("@gwenjs/camera-core/module");
    const resolved = resolveLoadedConfig({ modules: ["@gwenjs/camera-core"] });
    const app = new GwenApp();
    const declaration = await app
      .setupModules(resolved, async (name) => {
        if (name !== "@gwenjs/camera-core") throw new Error(`unexpected module ${name}`);
        return loaded.default;
      })
      .then(
        () => app.pluginDeclarations.find((item) => item.src === "@gwenjs/camera-core"),
        () => undefined,
      );
    expect(declaration).toEqual({
      src: "@gwenjs/camera-core",
      export: "CameraCorePlugin",
    });
  });
});

describe("camera-core module globals (#59)", () => {
  it("drops the module-global camera stores from every entry (#59)", () => {
    for (const name of ["cameraViewportMap", "cameraPathStore", "cameraMatrixStore"]) {
      expect(name in cameraCore).toBe(false);
      expect(name in cameraCoreInternal).toBe(false);
    }
    expect(typeof cameraCoreInternal.getCameraStores).toBe("function");
  });
});
