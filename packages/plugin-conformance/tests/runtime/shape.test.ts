import { describe, expect, it } from "vitest";
import { GWEN_PLUGIN_KEYS } from "@gwenjs/schema";
import { ConformanceErrorCodes } from "@gwenjs/plugin-conformance";
import { runPluginConformance } from "@gwenjs/plugin-conformance/runtime";
import { withPrivateTmpdir } from "../helpers/fixture.js";
import {
  factorySource,
  findingsWithCode,
  ranChecks,
  spec,
  writePluginPackage,
} from "../helpers/runtime.js";

/** Own-key value for one `GWEN_PLUGIN_KEYS` entry, so the object is built from the constant. */
function keyValue(key: string, exportName: string): string {
  if (key === "name") return JSON.stringify(exportName);
  if (key === "setup" || key === "teardown" || key === "onError") return `function ${key}() {}`;
  if (key === "provides") return "[]";
  if (key === "requires") return "{}";
  if (key === "validateOptions") return "function validateOptions() { return []; }";
  if (key === "extensionApi") return "{ major: 1, minor: 0 }";
  return "null";
}

/** Factory whose return lists every key of `GWEN_PLUGIN_KEYS`. */
function allKeysSource(exportName: string): string {
  const fields = GWEN_PLUGIN_KEYS.map((key) => `${key}: ${keyValue(key, exportName)}`).join(
    ",\n    ",
  );
  return `export function ${exportName}() {\n  return {\n    ${fields},\n  };\n}\n`;
}

describe("runPluginConformance shape", () => {
  it("reports a plugin that returns onUpdate", async () => {
    await withPrivateTmpdir(async (dir) => {
      await writePluginPackage(dir, {
        name: "@fixture/on-update",
        files: {
          "dist/index.js":
            'export function Plugin() {\n  return { name: "Plugin", setup() {}, onUpdate() {} };\n}\n',
        },
      });

      const report = await runPluginConformance(
        spec({ root: dir, packageName: "@fixture/on-update" }),
      );
      const findings = findingsWithCode(report, ConformanceErrorCodes.RUNTIME_SHAPE);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain("@fixture/on-update");
      expect(findings[0]?.message).toContain("Plugin");
      expect(findings[0]?.message).toContain("onUpdate");
      expect(report.checks).toEqual(ranChecks());
    });
  });

  it("accepts a plugin whose keys are all in GWEN_PLUGIN_KEYS", async () => {
    await withPrivateTmpdir(async (dir) => {
      await writePluginPackage(dir, {
        name: "@fixture/all-keys",
        files: { "dist/index.js": allKeysSource("Plugin") },
      });

      const report = await runPluginConformance(
        spec({ root: dir, packageName: "@fixture/all-keys" }),
      );
      expect(report.checks).toEqual(ranChecks());
      expect(report.findings).toEqual([]);
    });
  });

  it("reports each offending factory once", async () => {
    await withPrivateTmpdir(async (dir) => {
      await writePluginPackage(dir, {
        name: "@fixture/two-factories",
        files: {
          "dist/index.js": `${factorySource("Good")}export function Second() {\n  return { name: "Second", setup() {}, onUpdate() {} };\n}\n`,
        },
      });

      const report = await runPluginConformance(
        spec({
          root: dir,
          packageName: "@fixture/two-factories",
          factories: [{ export: "Good" }, { export: "Second" }],
        }),
      );
      const findings = findingsWithCode(report, ConformanceErrorCodes.RUNTIME_SHAPE);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain("Second");
      expect(report.checks).toEqual(ranChecks());
    });
  });
});
