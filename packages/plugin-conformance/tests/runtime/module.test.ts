import { describe, expect, it } from "vitest";
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

/** Default export of a module file. `setupBody` is the body of `setup`. */
function moduleSource(metaName: string, setupBody: string): string {
  return [
    "export default {",
    `  meta: { name: ${JSON.stringify(metaName)} },`,
    "  defaults: {},",
    "  setup(_options, kit) {",
    `    ${setupBody}`,
    "  },",
    "};",
    "",
  ].join("\n");
}

/** Temp package whose built `./module` is `moduleBody` and whose root exports `Plugin`. */
async function writeModulePackage(
  dir: string,
  packageName: string,
  moduleBody: string,
): Promise<void> {
  await writePluginPackage(dir, {
    name: packageName,
    exports: {
      ".": { import: "./dist/index.js" },
      "./module": { import: "./dist/module.js" },
    },
    files: {
      "dist/index.js": factorySource("Plugin"),
      "dist/module.js": moduleBody,
    },
  });
}

describe("runPluginConformance module", () => {
  it("reports a module that calls addPlugin with an instance", async () => {
    await withPrivateTmpdir(async (dir) => {
      const packageName = "@fixture/module-instance";
      await writeModulePackage(
        dir,
        packageName,
        moduleSource(packageName, 'kit.addPlugin({ name: "Plugin", setup() {} });'),
      );

      const report = await runPluginConformance(spec({ root: dir, packageName }));
      const findings = findingsWithCode(report, ConformanceErrorCodes.RUNTIME_MODULE);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toBe(
        `module ${JSON.stringify(packageName)} called addPlugin with name, setup`,
      );
      expect(report.checks).toEqual(ranChecks({ module: true }));
    });
  });

  it("reports a module whose meta.name differs from packageName", async () => {
    await withPrivateTmpdir(async (dir) => {
      const packageName = "@fixture/module-meta";
      const metaName = "@fixture/other-name";
      await writeModulePackage(
        dir,
        packageName,
        moduleSource(
          metaName,
          `kit.addPlugin({ src: ${JSON.stringify(packageName)}, export: "Plugin" });`,
        ),
      );

      const report = await runPluginConformance(spec({ root: dir, packageName }));
      const findings = findingsWithCode(report, ConformanceErrorCodes.RUNTIME_MODULE);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain(packageName);
      expect(findings[0]?.message).toContain(metaName);
      expect(report.checks).toEqual(ranChecks({ module: true }));
    });
  });

  it("reports a declaration whose export is not a spec factory", async () => {
    await withPrivateTmpdir(async (dir) => {
      const packageName = "@fixture/module-ghost";
      await writeModulePackage(
        dir,
        packageName,
        moduleSource(
          packageName,
          `kit.addPlugin({ src: ${JSON.stringify(packageName)}, export: "Ghost" });`,
        ),
      );

      const report = await runPluginConformance(spec({ root: dir, packageName }));
      const findings = findingsWithCode(report, ConformanceErrorCodes.RUNTIME_MODULE);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain("Ghost");
      expect(report.checks).toEqual(ranChecks({ module: true }));
    });
  });

  it("reports a declaration whose src is not the package name", async () => {
    await withPrivateTmpdir(async (dir) => {
      const packageName = "@fixture/module-src";
      const src = "@other/src";
      await writeModulePackage(
        dir,
        packageName,
        moduleSource(
          packageName,
          `kit.addPlugin({ src: ${JSON.stringify(src)}, export: "Plugin" });`,
        ),
      );

      const report = await runPluginConformance(spec({ root: dir, packageName }));
      const findings = findingsWithCode(report, ConformanceErrorCodes.RUNTIME_MODULE);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain(packageName);
      expect(findings[0]?.message).toContain(src);
      expect(report.checks).toEqual(ranChecks({ module: true }));
    });
  });

  it("accepts a module that declares src and export of a spec factory", async () => {
    await withPrivateTmpdir(async (dir) => {
      const packageName = "@fixture/module-clean";
      await writeModulePackage(
        dir,
        packageName,
        moduleSource(
          packageName,
          `kit.addPlugin({ src: ${JSON.stringify(packageName)}, export: "Plugin" });`,
        ),
      );

      const report = await runPluginConformance(spec({ root: dir, packageName }));
      expect(report.checks).toEqual(ranChecks({ module: true }));
      expect(report.findings).toEqual([]);
    });
  });

  it("reports a module whose default export is not an object", async () => {
    await withPrivateTmpdir(async (dir) => {
      const packageName = "@fixture/module-number";
      await writeModulePackage(dir, packageName, "export default 42;\n");
      const report = await runPluginConformance(spec({ root: dir, packageName }));
      expect(report.findings.map((finding) => finding.code)).toEqual([
        ConformanceErrorCodes.RUNTIME_MODULE,
      ]);
    });
  });

  it("reports a module whose setup throws", async () => {
    await withPrivateTmpdir(async (dir) => {
      const packageName = "@fixture/module-throws";
      await writeModulePackage(
        dir,
        packageName,
        moduleSource(packageName, 'throw new Error("module boom");'),
      );
      await expect(runPluginConformance(spec({ root: dir, packageName }))).resolves.toEqual(
        expect.objectContaining({
          findings: [
            expect.objectContaining({
              code: ConformanceErrorCodes.RUNTIME_MODULE,
              message: expect.stringContaining("module boom"),
            }),
          ],
        }),
      );
    });
  });

  it("reports a module that fails to import", async () => {
    await withPrivateTmpdir(async (dir) => {
      const packageName = "@fixture/module-syntax";
      await writeModulePackage(dir, packageName, "export default {\n");
      const report = await runPluginConformance(spec({ root: dir, packageName }));
      expect(report.findings.map((finding) => finding.code)).toEqual([
        ConformanceErrorCodes.RUNTIME_MODULE,
      ]);
    });
  });

  it("reports a declaration name that differs from the instance name and accepts one that equals it", async () => {
    await withPrivateTmpdir(async (dir) => {
      const packageName = "@fixture/module-decl-name";
      await writeModulePackage(
        dir,
        packageName,
        moduleSource(
          packageName,
          `kit.addPlugin({ src: ${JSON.stringify(packageName)}, export: "Plugin", name: "other-name" });`,
        ),
      );

      const report = await runPluginConformance(spec({ root: dir, packageName }));
      const findings = findingsWithCode(report, ConformanceErrorCodes.RUNTIME_MODULE);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain("other-name");
      expect(findings[0]?.message).toContain("Plugin");
    });

    await withPrivateTmpdir(async (dir) => {
      const packageName = "@fixture/module-decl-equal";
      await writeModulePackage(
        dir,
        packageName,
        moduleSource(
          packageName,
          `kit.addPlugin({ src: ${JSON.stringify(packageName)}, export: "Plugin", name: "Plugin" });`,
        ),
      );

      const report = await runPluginConformance(spec({ root: dir, packageName }));
      expect(findingsWithCode(report, ConformanceErrorCodes.RUNTIME_MODULE)).toEqual([]);
      expect(report.checks).toContain("module");
    });
  });
});
