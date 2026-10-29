import { describe, expect, it } from "vitest";
import type { ScreenSizeProvider } from "@gwenjs/renderer-core";
import { GwenApp } from "../src/app.js";
import { GwenAppConfigError } from "../src/config-error.js";
import { resolveLoadedConfig } from "../src/config.js";

class FixedSize implements ScreenSizeProvider {
  getSize(): { width: number; height: number } {
    return { width: 320, height: 240 };
  }

  subscribe(): () => void {
    return () => undefined;
  }
}

describe("renderer-core screen module", () => {
  it("one screen plugin when renderer-core is listed", async () => {
    const sizeProvider = new FixedSize();
    const loaded = resolveLoadedConfig({
      modules: ["@gwenjs/renderer-core"],
      screen: { sizeProvider },
    });
    expect(loaded.screen?.sizeProvider).toBe(sizeProvider);

    const renderer = await import("@gwenjs/renderer-core/module");
    const app = new GwenApp();
    let conflict: GwenAppConfigError | undefined;
    try {
      await app.setupModules(loaded, async (name) => {
        if (name !== "@gwenjs/renderer-core") {
          throw new Error(`unexpected module ${name}`);
        }
        return renderer.default;
      });
    } catch (error) {
      if (!(error instanceof GwenAppConfigError) || error.code !== "APP:CONFIG_CONFLICT") {
        throw error;
      }
      conflict = error;
    }
    expect(conflict).toBeUndefined();
    expect(
      app.plugins.map((plugin) => plugin.name).filter((name) => name === "gwen:screen"),
    ).toEqual(["gwen:screen"]);
  });
});
