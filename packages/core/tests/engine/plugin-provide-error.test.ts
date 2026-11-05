/**
 * GwenPluginOptionsError and GwenPluginProvideError: fields, frozen arrays, message grammar.
 */
import { describe, expect, it } from "vitest";
import { GwenError, type GwenConfigIssue } from "@gwenjs/schema";
import * as core from "../../src/index";

const issues: readonly GwenConfigIssue[] = [
  { path: "gravity", expected: "a finite number", received: "NaN", owner: "test" },
  { path: "layers", expected: "an array of numbers", received: '"x"', owner: "test" },
];

function lastLine(message: string): string {
  return message.split("\n").at(-1) ?? "";
}

describe("GwenPluginOptionsError", () => {
  it("renders one line per issue, with fields and a frozen issues array", () => {
    expect(typeof core.GwenPluginOptionsError).toBe("function");
    const error = new core.GwenPluginOptionsError("physics", issues);
    expect(error).toBeInstanceOf(GwenError);
    expect(error.name).toBe("GwenPluginOptionsError");
    expect(error.code).toBe("CORE:PLUGIN_OPTIONS_INVALID");
    expect(error.composable).toBe("engine.use");
    expect(error.plugin).toBe("physics");
    expect(error.issues).toEqual(issues);
    expect(Object.isFrozen(error.issues)).toBe(true);
    const lines = error.message.split("\n");
    expect(lines[0]).toBe('[engine.use()] Plugin "physics" has invalid options:');
    expect(lines[1]).toBe('  "gravity" expected a finite number, received NaN');
    expect(lines[2]).toBe('  "layers" expected an array of numbers, received "x"');
    expect(
      lastLine(error.message).endsWith(
        "#core-plugin-options-invalid (CORE:PLUGIN_OPTIONS_INVALID)",
      ),
    ).toBe(true);
  });

  it("copies the issues it is given", () => {
    expect(typeof core.GwenPluginOptionsError).toBe("function");
    const source = [...issues];
    const error = new core.GwenPluginOptionsError("physics", source);
    source.pop();
    expect(error.issues).toHaveLength(2);
  });

  it("carries the dev hint only in dev builds", () => {
    expect(typeof core.GwenPluginOptionsError).toBe("function");
    const error = new core.GwenPluginOptionsError("physics", issues);
    if (__GWEN_DEV__) {
      expect(error.hint).toBe("Fix the listed options; validation runs before setup().");
      expect(error.message).toContain(
        "Fix: Fix the listed options; validation runs before setup().",
      );
    } else {
      expect(error.hint).toBeUndefined();
      expect(error.message).not.toContain("Fix:");
    }
  });
});

describe("GwenPluginProvideError", () => {
  it("renders DUPLICATE with a plugin owner", () => {
    expect(typeof core.GwenPluginProvideError).toBe("function");
    const error = new core.GwenPluginProvideError({
      code: core.CoreErrorCodes.PLUGIN_PROVIDE_DUPLICATE,
      plugin: "B",
      keys: ["lc:alpha", "lc:beta"],
      owner: "A",
    });
    expect(error).toBeInstanceOf(GwenError);
    expect(error.name).toBe("GwenPluginProvideError");
    expect(error.code).toBe("CORE:PLUGIN_PROVIDE_DUPLICATE");
    expect(error.composable).toBe("engine.use");
    expect(error.plugin).toBe("B");
    expect(error.keys).toEqual(["lc:alpha", "lc:beta"]);
    expect(error.owner).toBe("A");
    expect(Object.isFrozen(error.keys)).toBe(true);
    expect(error.message.split("\n")[0]).toBe(
      '[engine.use()] Plugin "B" provides "lc:alpha", "lc:beta", already provided by plugin "A".',
    );
    expect(
      lastLine(error.message).endsWith(
        "#core-plugin-provide-duplicate (CORE:PLUGIN_PROVIDE_DUPLICATE)",
      ),
    ).toBe(true);
  });

  it("renders DUPLICATE with the engine as owner", () => {
    expect(typeof core.GwenPluginProvideError).toBe("function");
    const error = new core.GwenPluginProvideError({
      code: core.CoreErrorCodes.PLUGIN_PROVIDE_DUPLICATE,
      plugin: "B",
      keys: ["logger"],
      owner: "<engine>",
    });
    expect(error.owner).toBe("<engine>");
    expect(error.message.split("\n")[0]).toBe(
      '[engine.use()] Plugin "B" provides "logger", already provided by the engine.',
    );
  });

  it("renders UNDECLARED with composable engine.provide and a null owner", () => {
    expect(typeof core.GwenPluginProvideError).toBe("function");
    const error = new core.GwenPluginProvideError({
      code: core.CoreErrorCodes.PLUGIN_PROVIDE_UNDECLARED,
      plugin: "U",
      keys: ["lc:beta"],
    });
    expect(error.code).toBe("CORE:PLUGIN_PROVIDE_UNDECLARED");
    expect(error.composable).toBe("engine.provide");
    expect(error.owner).toBeNull();
    expect(error.keys).toEqual(["lc:beta"]);
    expect(Object.isFrozen(error.keys)).toBe(true);
    expect(error.message.split("\n")[0]).toBe(
      '[engine.provide()] Plugin "U" provided "lc:beta" without declaring it.',
    );
    expect(
      lastLine(error.message).endsWith(
        "#core-plugin-provide-undeclared (CORE:PLUGIN_PROVIDE_UNDECLARED)",
      ),
    ).toBe(true);
  });

  it("renders MISSING with the declared keys and the absent ones", () => {
    expect(typeof core.GwenPluginProvideError).toBe("function");
    const error = new core.GwenPluginProvideError({
      code: core.CoreErrorCodes.PLUGIN_PROVIDE_MISSING,
      plugin: "M",
      keys: ["lc:beta"],
      declared: ["lc:alpha", "lc:beta"],
    });
    expect(error.code).toBe("CORE:PLUGIN_PROVIDE_MISSING");
    expect(error.composable).toBe("engine.use");
    expect(error.owner).toBeNull();
    expect(error.keys).toEqual(["lc:beta"]);
    expect(Object.isFrozen(error.keys)).toBe(true);
    expect(error.message.split("\n")[0]).toBe(
      '[engine.use()] Plugin "M" declared "lc:alpha", "lc:beta" but did not provide "lc:beta".',
    );
    expect(
      lastLine(error.message).endsWith(
        "#core-plugin-provide-missing (CORE:PLUGIN_PROVIDE_MISSING)",
      ),
    ).toBe(true);
  });

  it("copies the keys it is given", () => {
    expect(typeof core.GwenPluginProvideError).toBe("function");
    const source = ["lc:alpha", "lc:beta"];
    const error = new core.GwenPluginProvideError({
      code: core.CoreErrorCodes.PLUGIN_PROVIDE_MISSING,
      plugin: "M",
      keys: source,
    });
    source.pop();
    expect(error.keys).toEqual(["lc:alpha", "lc:beta"]);
  });

  it("carries a dev hint per code only in dev builds", () => {
    expect(typeof core.GwenPluginProvideError).toBe("function");
    const codes = [
      core.CoreErrorCodes.PLUGIN_PROVIDE_DUPLICATE,
      core.CoreErrorCodes.PLUGIN_PROVIDE_UNDECLARED,
      core.CoreErrorCodes.PLUGIN_PROVIDE_MISSING,
    ] as const;
    for (const code of codes) {
      const error = new core.GwenPluginProvideError({
        code,
        plugin: "P",
        keys: ["lc:alpha"],
        owner: code === core.CoreErrorCodes.PLUGIN_PROVIDE_DUPLICATE ? "A" : null,
      });
      if (__GWEN_DEV__) {
        expect(error.hint).toEqual(expect.any(String));
        expect(error.message).toContain(`Fix: ${error.hint}`);
      } else {
        expect(error.hint).toBeUndefined();
        expect(error.message).not.toContain("Fix:");
      }
    }
  });
});
