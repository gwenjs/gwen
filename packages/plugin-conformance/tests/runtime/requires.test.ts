import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createViewportsPlugin } from "@gwenjs/app";
import { CoreErrorCodes } from "@gwenjs/core";
import { CameraCorePlugin } from "@gwenjs/camera-core";
import { ConformanceErrorCodes } from "@gwenjs/plugin-conformance";
import { runPluginConformance } from "@gwenjs/plugin-conformance/runtime";
import { withPrivateTmpdir } from "../helpers/fixture.js";
import { factorySource, findingsWithCode, spec, writePluginPackage } from "../helpers/runtime.js";

const RAN = ["shape", "requires", "provides"] as const;

const servicesRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/runtime/requires-camera-services",
);

const hiddenRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/runtime/installs-camera-core",
);

/** Plugins after viewports, then a setup that installs CameraCorePlugin. Observed on a real engine. */
const HIDDEN_PLUGINS = [
  "gwen:viewports",
  "CameraSystem",
  "camera-core",
  "installs-camera-core",
] as const;

describe("runPluginConformance requires", () => {
  it("a plugin without requires installs alone", async () => {
    await withPrivateTmpdir(async (dir) => {
      await writePluginPackage(dir, {
        name: "@fixture/no-requires",
        files: { "dist/index.js": factorySource("Plugin") },
      });

      const report = await runPluginConformance(
        spec({ root: dir, packageName: "@fixture/no-requires" }),
      );
      expect(report.checks).toEqual([...RAN]);
      expect(report.findings).toEqual([]);
    });
  });

  it("a plugin with requires camera-core fails alone with the dependency error and passes with CameraCorePlugin", async () => {
    const alone = await runPluginConformance(
      spec({
        root: servicesRoot,
        packageName: "@fixture/requires-camera-services",
        factories: [{ export: "RequiresCameraServices" }],
      }),
    );
    const aloneFindings = findingsWithCode(alone, ConformanceErrorCodes.RUNTIME_REQUIRES);
    expect(aloneFindings).toHaveLength(1);
    expect(aloneFindings[0]?.message).toContain(CoreErrorCodes.PLUGIN_DEPENDENCY_MISSING);

    const report = await runPluginConformance(
      spec({
        root: servicesRoot,
        packageName: "@fixture/requires-camera-services",
        factories: [{ export: "RequiresCameraServices" }],
        frameworkProviders: [createViewportsPlugin, CameraCorePlugin],
      }),
    );
    expect(report.checks).toEqual([...RAN]);
    expect(report.findings).toEqual([]);
  });

  it("reports a requires that frameworkProviders do not satisfy", async () => {
    const report = await runPluginConformance(
      spec({
        root: servicesRoot,
        packageName: "@fixture/requires-camera-services",
        factories: [{ export: "RequiresCameraServices" }],
      }),
    );
    const findings = findingsWithCode(report, ConformanceErrorCodes.RUNTIME_REQUIRES);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain("camera-core");
    expect(findings[0]?.message).toContain("cameraManager");
    expect(findings[0]?.message).toContain("viewportManager");
    expect(report.checks).toEqual([...RAN]);
  });

  it("reports a plugin that installs camera-core from setup", async () => {
    const report = await runPluginConformance(
      spec({
        root: hiddenRoot,
        packageName: "@fixture/installs-camera-core",
        factories: [{ export: "InstallsCameraCore" }],
        frameworkProviders: [createViewportsPlugin],
      }),
    );
    const findings = findingsWithCode(report, ConformanceErrorCodes.RUNTIME_REQUIRES);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain("camera-core");
    expect(findings[0]?.message).toContain(JSON.stringify(HIDDEN_PLUGINS));
    expect(report.checks).toEqual([...RAN]);
  });

  it("reports an official plugin that names a plugin of another package", async () => {
    await withPrivateTmpdir(async (dir) => {
      await writePluginPackage(dir, {
        name: "@fixture/official-foreign",
        files: {
          "dist/index.js":
            'export function Plugin() {\n  return {\n    name: "official-foreign",\n    requires: { plugins: ["@other/plugin"] },\n    setup() {},\n  };\n}\n',
        },
      });

      const report = await runPluginConformance(
        spec({
          root: dir,
          packageName: "@fixture/official-foreign",
          official: true,
        }),
      );
      const findings = findingsWithCode(report, ConformanceErrorCodes.RUNTIME_REQUIRES);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain("@other/plugin");
      expect(report.checks).toEqual([...RAN]);
    });
  });

  it("accepts an official plugin that names camera-core", async () => {
    await withPrivateTmpdir(async (dir) => {
      await writePluginPackage(dir, {
        name: "@fixture/official-camera",
        files: {
          "dist/index.js":
            'export function Plugin() {\n  return {\n    name: "official-camera",\n    requires: { plugins: ["camera-core"] },\n    setup() {},\n  };\n}\n',
        },
      });

      const report = await runPluginConformance(
        spec({
          root: dir,
          packageName: "@fixture/official-camera",
          official: true,
          frameworkProviders: [createViewportsPlugin, CameraCorePlugin],
        }),
      );
      expect(report.checks).toEqual([...RAN]);
      expect(report.findings).toEqual([]);
    });
  });

  it("a community plugin may name another package's plugin", async () => {
    await withPrivateTmpdir(async (dir) => {
      await writePluginPackage(dir, {
        name: "@gwenjs/community-foreign",
        files: {
          "dist/index.js":
            'export function Plugin() {\n  return {\n    name: "community-foreign",\n    requires: { plugins: ["@other/plugin"] },\n    setup() {},\n  };\n}\n',
        },
      });

      const report = await runPluginConformance(
        spec({
          root: dir,
          packageName: "@gwenjs/community-foreign",
          official: false,
        }),
      );
      const named = findingsWithCode(report, ConformanceErrorCodes.RUNTIME_REQUIRES).filter(
        (finding) => finding.message.includes("@other/plugin"),
      );
      expect(named).toEqual([]);
      expect(report.checks).toEqual([...RAN]);
    });
  });
});
