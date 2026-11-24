import { describe, expect, it } from "vitest";
import { createViewportsPlugin } from "@gwenjs/app";
import { CameraCorePlugin } from "@gwenjs/camera-core";
import { CoreErrorCodes } from "@gwenjs/core";
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

describe("runPluginConformance provides", () => {
  it("reports a declared provides key that is not injectable", async () => {
    await withPrivateTmpdir(async (dir) => {
      await writePluginPackage(dir, {
        name: "@fixture/declared-provide",
        files: {
          "dist/index.js":
            'export function Plugin() {\n  return { name: "declared-provide", provides: ["viewportManager"], setup() {} };\n}\n',
        },
      });

      const report = await runPluginConformance(
        spec({ root: dir, packageName: "@fixture/declared-provide" }),
      );
      const findings = findingsWithCode(report, ConformanceErrorCodes.RUNTIME_PROVIDES);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain(CoreErrorCodes.PLUGIN_PROVIDE_MISSING);
      expect(report.checks).toEqual(ranChecks());
    });
  });

  it("reports a provide of an undeclared key", async () => {
    await withPrivateTmpdir(async (dir) => {
      await writePluginPackage(dir, {
        name: "@fixture/undeclared-provide",
        files: {
          "dist/index.js":
            'export function Plugin() {\n  return {\n    name: "undeclared-provide",\n    setup(engine) { engine.provide("viewportManager", {}); },\n  };\n}\n',
        },
      });

      const report = await runPluginConformance(
        spec({ root: dir, packageName: "@fixture/undeclared-provide" }),
      );
      const findings = findingsWithCode(report, ConformanceErrorCodes.RUNTIME_PROVIDES);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain(CoreErrorCodes.PLUGIN_PROVIDE_UNDECLARED);
      expect(report.checks).toEqual(ranChecks());
    });
  });

  it("accepts a plugin that provides every declared key", async () => {
    await withPrivateTmpdir(async (dir) => {
      await writePluginPackage(dir, {
        name: "@fixture/clean-provide",
        files: {
          "dist/index.js":
            'export function Plugin() {\n  return {\n    name: "clean-provide",\n    provides: ["viewportManager"],\n    setup(engine) { engine.provide("viewportManager", {}); },\n  };\n}\n',
        },
      });

      const report = await runPluginConformance(
        spec({ root: dir, packageName: "@fixture/clean-provide" }),
      );
      expect(report.checks).toEqual(ranChecks());
      expect(report.findings).toEqual([]);
    });
  });

  it("a plugin with no provides passes with zero keys", async () => {
    await withPrivateTmpdir(async (dir) => {
      await writePluginPackage(dir, {
        name: "@fixture/no-provide",
        files: { "dist/index.js": factorySource("Plugin") },
      });

      const report = await runPluginConformance(
        spec({ root: dir, packageName: "@fixture/no-provide" }),
      );
      expect(report.checks).toEqual(ranChecks());
      expect(report.findings).toEqual([]);
    });
  });

  it("checks provides of a plugin that has requires", async () => {
    await withPrivateTmpdir(async (dir) => {
      await writePluginPackage(dir, {
        name: "@fixture/requires-provide",
        files: {
          "dist/index.js":
            'export function Plugin() {\n  return { name: "requires-provide", requires: { plugins: ["camera-core"] }, provides: ["absentKey"], setup() {} };\n}\n',
        },
      });
      const report = await runPluginConformance(
        spec({
          root: dir,
          packageName: "@fixture/requires-provide",
          frameworkProviders: [createViewportsPlugin, CameraCorePlugin],
        }),
      );
      const findings = findingsWithCode(report, ConformanceErrorCodes.RUNTIME_PROVIDES);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain(CoreErrorCodes.PLUGIN_PROVIDE_MISSING);
    });
  });

  it("reports a provide that duplicates another service", async () => {
    // One factory. viewportManager is already provided by createViewportsPlugin.
    await withPrivateTmpdir(async (dir) => {
      await writePluginPackage(dir, {
        name: "@fixture/duplicate-provide",
        files: {
          "dist/index.js":
            'export function Plugin() {\n  return {\n    name: "duplicate-provide",\n    requires: { plugins: ["camera-core"] },\n    provides: ["viewportManager"],\n    setup(engine) { engine.provide("viewportManager", {}); },\n  };\n}\n',
        },
      });
      const report = await runPluginConformance(
        spec({
          root: dir,
          packageName: "@fixture/duplicate-provide",
          frameworkProviders: [createViewportsPlugin, CameraCorePlugin],
        }),
      );
      const findings = findingsWithCode(report, ConformanceErrorCodes.RUNTIME_PROVIDES);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain(CoreErrorCodes.PLUGIN_PROVIDE_DUPLICATE);
    });
  });
});
