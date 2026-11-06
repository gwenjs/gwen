/**
 * GwenPluginExtensionApiError: message, frozen mismatches, dev hint.
 */
import { describe, expect, it } from "vitest";
import { GwenError } from "@gwenjs/schema";
import * as core from "../../src/index";

const HINT =
  "Install a version of the base whose extension API has the same major and an equal or higher minor, or a version of the extension built for the installed base.";

describe("GwenPluginExtensionApiError", () => {
  it("renders one and two mismatches with code, plugin and frozen mismatches", () => {
    expect(typeof core.GwenPluginExtensionApiError).toBe("function");
    const one = new core.GwenPluginExtensionApiError({
      plugin: "ext",
      mismatches: [
        { base: "base", required: { major: 1, minor: 0 }, actual: { major: 2, minor: 0 } },
      ],
    });
    expect(one).toBeInstanceOf(GwenError);
    expect(one.name).toBe("GwenPluginExtensionApiError");
    expect(one.code).toBe("CORE:PLUGIN_EXTENSION_API_MISMATCH");
    expect(one.plugin).toBe("ext");
    expect(one.composable).toBe("engine.use");
    expect(one.mismatches).toEqual([
      { base: "base", required: { major: 1, minor: 0 }, actual: { major: 2, minor: 0 } },
    ]);
    expect(Object.isFrozen(one.mismatches)).toBe(true);
    expect(one.message.split("\n")[0]).toBe(
      '[engine.use()] Plugin "ext" needs extension API 1.0 of "base", which provides 2.0.',
    );

    const source = [
      { base: "base", required: { major: 1, minor: 2 }, actual: null },
      { base: "other", required: { major: 3, minor: 0 }, actual: { major: 3, minor: 4 } },
    ];
    const two = new core.GwenPluginExtensionApiError({ plugin: "stack", mismatches: source });
    source.pop();
    expect(two.mismatches).toEqual([
      { base: "base", required: { major: 1, minor: 2 }, actual: null },
      { base: "other", required: { major: 3, minor: 0 }, actual: { major: 3, minor: 4 } },
    ]);
    expect(Object.isFrozen(two.mismatches)).toBe(true);
    expect(two.code).toBe(core.CoreErrorCodes.PLUGIN_EXTENSION_API_MISMATCH);
    expect(two.plugin).toBe("stack");
    expect(two.message.split("\n")[0]).toBe(
      '[engine.use()] Plugin "stack" needs extension API 1.2 of "base", which provides none; extension API 3.0 of "other", which provides 3.4.',
    );
  });

  it("the Fix line exists in dev and is absent in prod", () => {
    expect(typeof core.GwenPluginExtensionApiError).toBe("function");
    const error = new core.GwenPluginExtensionApiError({
      plugin: "ext",
      mismatches: [
        { base: "base", required: { major: 1, minor: 0 }, actual: { major: 2, minor: 0 } },
      ],
    });
    if (__GWEN_DEV__) {
      expect(error.hint).toBe(HINT);
      expect(error.message).toContain(`Fix: ${HINT}`);
    } else {
      expect(error.hint).toBeUndefined();
      expect(error.message).not.toContain("Fix:");
    }
  });
});
