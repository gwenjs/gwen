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
    const plugin = new Factory() as { name: string };
    expect(plugin.name).toBe("Noop");
  });

  it("passes options to closure", () => {
    const Factory = definePlugin((opts: { value: number }) => ({
      name: "WithOpts",
      setup() {},
      provides: { result: opts.value } as unknown as Record<string, unknown>,
    }));
    const plugin = new Factory({ value: 42 }) as { provides: Record<string, unknown> };
    expect(plugin.provides?.["result"]).toBe(42);
  });
});

describe("satisfiesPluginContract", () => {
  it("is a runtime no-op — returns its argument", () => {
    const plugin = { name: "p", setup() {} };
    const result = satisfiesPluginContract(plugin);
    expect(result).toBe(plugin);
  });
});
