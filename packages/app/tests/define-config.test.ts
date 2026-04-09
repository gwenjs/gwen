import { describe, expect, it } from "vitest";
import type { GwenPlugin } from "@gwenjs/core";
import { defineConfig } from "../src/index";

const PluginA: GwenPlugin = { name: "A", setup(_engine) {} };
const PluginB: GwenPlugin = { name: "B", setup(_engine) {} };

describe("defineConfig", () => {
  it("keeps runtime payload unchanged", () => {
    const conf = defineConfig({
      engine: { maxEntities: 10_000 },
      plugins: [PluginA, PluginB],
      html: { title: "Game", background: "#000000" },
    });

    expect(conf.engine?.maxEntities).toBe(10_000);
    expect((conf.plugins ?? []).length).toBe(2);
  });

  it("returns the same config object", () => {
    const input = { engine: { maxEntities: 5_000 } };
    const conf = defineConfig(input);
    expect(conf).toEqual(input);
  });
});
