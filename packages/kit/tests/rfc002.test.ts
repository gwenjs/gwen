/**
 * RFC-002: satisfiesPluginContract tests
 * (definePlugin uses the existing class-based factory, which is the current implementation)
 */
import { describe, it, expect } from "vitest";
import { definePlugin, satisfiesPluginContract } from "../src/plugin";

describe("definePlugin", () => {
  it("returns a callable constructor", () => {
    const Factory = definePlugin(() => ({ name: "p", setup() {} }));
    expect(typeof Factory).toBe("function");
  });

  it("creates plugin with correct name", () => {
    const Factory = definePlugin(() => ({ name: "Noop", setup() {} }));
    const plugin = Factory();
    expect(plugin.name).toBe("Noop");
  });

  it("passes options to closure", () => {
    const Factory = definePlugin((opts: { value?: number } = {}) => ({
      name: `WithOpts-${String(opts.value)}`,
      setup() {},
    }));
    const plugin = Factory({ value: 42 });
    expect(plugin.name).toBe("WithOpts-42");
  });
});

describe("satisfiesPluginContract", () => {
  it("is a runtime no-op — returns its argument", () => {
    const plugin = { name: "p", setup() {} };
    const result = satisfiesPluginContract(plugin);
    expect(result).toBe(plugin);
  });
});
