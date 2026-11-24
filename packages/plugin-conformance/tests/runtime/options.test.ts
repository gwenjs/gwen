import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createViewportsPlugin } from "@gwenjs/app";
import { CameraCorePlugin } from "@gwenjs/camera-core";
import { CoreErrorCodes } from "@gwenjs/core";
import { ConformanceErrorCodes } from "@gwenjs/plugin-conformance";
import { runPluginConformance } from "@gwenjs/plugin-conformance/runtime";
import { withPrivateTmpdir } from "../helpers/fixture.js";
import { findingsWithCode, ranChecks, spec, writePluginPackage } from "../helpers/runtime.js";

const optionsRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/runtime/options-validate",
);

const eagerSource =
  'export function Plugin(o){ if (o && o.bad) throw new Error("eager"); return { name: "eager", setup() {} }; }\n';

describe("runPluginConformance options", () => {
  it("reports invalid options that install without CORE:PLUGIN_OPTIONS_INVALID", async () => {
    await withPrivateTmpdir(async (dir) => {
      await writePluginPackage(dir, {
        name: "@fixture/open-options",
        files: {
          "dist/index.js":
            'export function Plugin() {\n  return { name: "open-options", setup() {} };\n}\n',
        },
      });

      const report = await runPluginConformance(
        spec({
          root: dir,
          packageName: "@fixture/open-options",
          factories: [{ export: "Plugin", invalidOptions: { speed: -1 } }],
        }),
      );
      const findings = findingsWithCode(report, ConformanceErrorCodes.RUNTIME_OPTIONS);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toBe(
        `"@fixture/open-options" export "Plugin" installed instead of rejecting with ${CoreErrorCodes.PLUGIN_OPTIONS_INVALID}`,
      );
      expect(report.checks).toEqual(ranChecks({ options: true }));
    });
  });

  it("accepts invalid options that reject with CORE:PLUGIN_OPTIONS_INVALID", async () => {
    const report = await runPluginConformance(
      spec({
        root: optionsRoot,
        packageName: "@fixture/options-validate",
        factories: [{ export: "OptionsPlugin", invalidOptions: { speed: -1 } }],
      }),
    );
    expect(report.checks).toEqual(ranChecks({ options: true }));
    expect(report.findings).toEqual([]);
  });

  it("skips the options check when invalidOptions is absent", async () => {
    await withPrivateTmpdir(async (dir) => {
      await writePluginPackage(dir, {
        name: "@fixture/no-invalid-options",
        files: {
          "dist/index.js":
            'export function Plugin() {\n  return { name: "no-invalid-options", setup() {} };\n}\n',
        },
      });

      const report = await runPluginConformance(
        spec({ root: dir, packageName: "@fixture/no-invalid-options" }),
      );
      expect(report.checks).toEqual(ranChecks());
      expect(report.findings).toEqual([]);
    });
  });

  it("passes factory options to every check", async () => {
    await withPrivateTmpdir(async (dir) => {
      await writePluginPackage(dir, {
        name: "@fixture/reads-options",
        files: {
          "dist/index.js":
            'export function Plugin(options) {\n  if (options === undefined || options.k !== 1) throw new Error("options");\n  return { name: "reads-options", setup() {} };\n}\n',
        },
      });
      const report = await runPluginConformance(
        spec({
          root: dir,
          packageName: "@fixture/reads-options",
          factories: [{ export: "Plugin", options: { k: 1 } }],
        }),
      );
      expect(report.findings).toEqual([]);
    });
  });

  it("reports invalid options rejected with another code", async () => {
    await withPrivateTmpdir(async (dir) => {
      await writePluginPackage(dir, {
        name: "@fixture/bad-options",
        files: {
          "dist/index.js":
            'export function Plugin() {\n  return { name: "bad-options", setup() { throw new Error("options-rejected"); } };\n}\n',
        },
      });
      const report = await runPluginConformance(
        spec({
          root: dir,
          packageName: "@fixture/bad-options",
          factories: [{ export: "Plugin", invalidOptions: { speed: -1 } }],
        }),
      );
      const findings = findingsWithCode(report, ConformanceErrorCodes.RUNTIME_OPTIONS);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain("Plugin");
      expect(findings[0]?.message).toContain("options-rejected");
      expect(findings[0]?.message).not.toContain("installed instead of rejecting");
    });
  });

  it("installs frameworkProviders before the options check", async () => {
    await withPrivateTmpdir(async (dir) => {
      await writePluginPackage(dir, {
        name: "@fixture/camera-options",
        files: {
          "dist/index.js": `export function Plugin(options) {
  return {
    name: "camera-options",
    requires: { plugins: ["camera-core"] },
    validateOptions() {
      const speed = options === undefined || options === null ? 0 : options.speed;
      if (typeof speed === "number" && speed < 0) {
        return [{ path: "speed", expected: "a number greater than or equal to 0", received: String(speed), owner: "camera-options" }];
      }
      return [];
    },
    setup() {},
  };
}
`,
        },
      });
      const report = await runPluginConformance(
        spec({
          root: dir,
          packageName: "@fixture/camera-options",
          factories: [{ export: "Plugin", invalidOptions: { speed: -1 } }],
          frameworkProviders: [createViewportsPlugin, CameraCorePlugin],
        }),
      );
      expect(report.findings).toEqual([]);
    });
  });

  it("reports a factory that throws when built with invalidOptions", async () => {
    await withPrivateTmpdir(async (dir) => {
      await writePluginPackage(dir, {
        name: "@fixture/plugin",
        files: { "dist/index.js": eagerSource },
      });
      const report = await runPluginConformance(
        spec({ root: dir, factories: [{ export: "Plugin", invalidOptions: { bad: true } }] }),
      );
      const findings = findingsWithCode(report, ConformanceErrorCodes.RUNTIME_OPTIONS);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain("Plugin");
      expect(findings[0]?.message).toContain("eager");
      expect(report.checks).toEqual(ranChecks({ options: true }));
    });
  });
});
