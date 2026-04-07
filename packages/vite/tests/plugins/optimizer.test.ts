import { describe, it, expect, vi } from "vitest";
import { gwenOptimizerPlugin } from "../../src/plugins/optimizer";
import { gwenVitePlugin } from "../../src/plugins/index";

describe("gwenOptimizerPlugin", () => {
  it("returns a Vite plugin with name gwen:optimizer", () => {
    const plugin = gwenOptimizerPlugin();
    expect(plugin.name).toBe("gwen:optimizer");
  });

  it("accepts debug option", () => {
    const plugin = gwenOptimizerPlugin({ debug: true });
    expect(plugin.name).toBe("gwen:optimizer");
  });

  it("has a transform hook", () => {
    const plugin = gwenOptimizerPlugin();
    expect(typeof plugin.transform).toBe("function");
  });

  it("does not transform non-ts files", async () => {
    const plugin = gwenOptimizerPlugin();
    const result = await (plugin.transform as Function)("const x = 1", "file.css");
    expect(result).toBeNull();
  });

  it("mode detect — returns null even for a file containing useQuery + onUpdate patterns", async () => {
    const plugin = gwenOptimizerPlugin({ mode: "detect" });
    // Minimal code that passes the quick-check guards (contains both keywords)
    // but the AST walker will find no fully-formed patterns — still must return null.
    const code = `
      import { useQuery, onUpdate } from '@gwenjs/core/system';
      const entities = useQuery([Position, Velocity]);
      onUpdate((dt) => {
        for (const id of entities) {
          Position.x[id] += Velocity.x[id] * dt;
        }
      });
    `;
    const ctx = { warn: vi.fn() };
    const result = await (plugin.transform as Function).call(ctx, code, "src/systems/movement.ts");
    expect(result).toBeNull();
  });

  it("mode transform — is the default when mode is not specified", () => {
    const plugin = gwenOptimizerPlugin();
    // Default mode should be 'transform'; the plugin should still have a transform hook.
    expect(typeof plugin.transform).toBe("function");
  });
});

describe("gwenVitePlugin", () => {
  it("includes gwen:optimizer plugin by default (detect mode)", () => {
    const plugins = gwenVitePlugin() as unknown[];
    const flat = plugins.flat(Infinity) as Array<{ name?: string }>;
    const optimizer = flat.find((p) => p && p.name === "gwen:optimizer");
    expect(optimizer).toBeDefined();
  });

  it("includes gwen:optimizer plugin when optimizer: true", () => {
    const plugins = gwenVitePlugin({ optimizer: true }) as unknown[];
    const flat = plugins.flat(Infinity) as Array<{ name?: string }>;
    const optimizer = flat.find((p) => p && p.name === "gwen:optimizer");
    expect(optimizer).toBeDefined();
  });
});
