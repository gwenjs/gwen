import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ConformanceErrorCodes } from "@gwenjs/plugin-conformance";
import { runPluginConformance } from "@gwenjs/plugin-conformance/runtime";
import { withPrivateTmpdir } from "../helpers/fixture.js";
import { findingsWithCode, ranChecks, spec, writePluginPackage } from "../helpers/runtime.js";

const optionsRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/runtime/options-validate",
);

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
});
