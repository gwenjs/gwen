/**
 * Built-in modules are plain objects (`satisfies GwenModule`), not
 * `defineGwenModule()` results. They still have to pass the same checks.
 */

import { describe, expect, it } from "vitest";
import { validateGwenModule } from "@gwenjs/kit/module";
import type { GwenModule } from "@gwenjs/kit/module";
import { GwenApp } from "../src/app.js";
import { BUILT_IN_MODULES } from "../src/built-in-modules.js";
import { resolveLoadedConfig as resolveConfig } from "../src/config.js";

function builtInWithSetup(entry: GwenModule, setup: unknown): unknown {
  const copy: Record<string, unknown> = { meta: entry.meta, setup };
  if ("defaults" in entry) copy["defaults"] = entry.defaults;
  if ("validate" in entry) copy["validate"] = entry.validate;
  return copy;
}

describe("built-in modules", () => {
  it("every built-in module passes validateGwenModule", async () => {
    for (const entry of BUILT_IN_MODULES) {
      let failure: unknown;
      try {
        validateGwenModule(entry);
      } catch (error) {
        failure = error;
      }
      const seen = failure === undefined ? undefined : `${entry.meta.name}: ${String(failure)}`;
      expect(seen).toBeUndefined();
      expect(entry.meta.name.length).toBeGreaterThan(0);

      let invalid: unknown;
      try {
        validateGwenModule(builtInWithSetup(entry, 1));
      } catch (error) {
        invalid = error;
      }
      expect(invalid).toMatchObject({ fields: ["setup"] });
    }
    const app = new GwenApp();
    await app.setupModules(resolveConfig({ modules: [] }), () => {
      throw new Error("no user module");
    });
    const names = new Set(app.pluginDeclarations.map((item) => item.src));
    expect(names.has("@gwenjs/core/internal")).toBe(true);
  });
});
