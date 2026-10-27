/**
 * GwenPluginDependencyError message grammar for missing requirements and in-use.
 */
import { describe, expect, it } from "vitest";
import { GwenError } from "@gwenjs/schema";
import * as core from "../../src/index";

describe("GwenPluginDependencyError", () => {
  it("GwenPluginDependencyError renders the MISSING message for several requirements", () => {
    expect(typeof core.GwenPluginDependencyError).toBe("function");
    const error = new core.GwenPluginDependencyError({
      code: core.CoreErrorCodes.PLUGIN_DEPENDENCY_MISSING,
      plugin: "A",
      missing: [
        { kind: "plugin", name: "B" },
        { kind: "service", name: "s" },
      ],
      dependents: [],
    });
    expect(error).toBeInstanceOf(GwenError);
    expect(error.name).toBe("GwenPluginDependencyError");
    expect(error.code).toBe("CORE:PLUGIN_DEPENDENCY_MISSING");
    expect(error.message.split("\n")[0]).toBe(
      '[engine.use()] Plugin "A" requires plugin "B", service "s", which is not installed.',
    );
    expect(error.missing).toEqual([
      { kind: "plugin", name: "B" },
      { kind: "service", name: "s" },
    ]);
    expect(error.dependents).toEqual([]);
    expect(Object.isFrozen(error.missing)).toBe(true);
    expect(Object.isFrozen(error.dependents)).toBe(true);
    const last = error.message.split("\n").at(-1) ?? "";
    const hint =
      "Call engine.use() for each missing requirement before the plugin that " + "requires it.";
    expect(last.endsWith("#core-plugin-dependency-missing (CORE:PLUGIN_DEPENDENCY_MISSING)")).toBe(
      true,
    );
    if (__GWEN_DEV__) expect(error.hint).toBe(hint);
    else {
      expect(error.hint).toBeUndefined();
      expect(error.message).not.toContain("Fix:");
    }
  });

  it("GwenPluginDependencyError renders the IN_USE message", () => {
    expect(typeof core.GwenPluginDependencyError).toBe("function");
    const error = new core.GwenPluginDependencyError({
      code: core.CoreErrorCodes.PLUGIN_IN_USE,
      plugin: "B",
      dependents: ["A"],
    });
    expect(error.name).toBe("GwenPluginDependencyError");
    expect(error.code).toBe("CORE:PLUGIN_IN_USE");
    expect(error.message.split("\n")[0]).toBe(
      '[engine.unuse()] Cannot unuse "B": required by "A".',
    );
    expect(error.missing).toEqual([]);
    expect(error.dependents).toEqual(["A"]);
    expect(Object.isFrozen(error.missing)).toBe(true);
    expect(Object.isFrozen(error.dependents)).toBe(true);
    if (__GWEN_DEV__) {
      expect(error.hint).toBe("Unuse the dependent plugins first, last installed first.");
    } else {
      expect(error.hint).toBeUndefined();
      expect(error.message).not.toContain("Fix:");
    }
  });
});
