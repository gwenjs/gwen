import { describe, expect, it } from "vitest";
import { ConformanceErrorCodes } from "@gwenjs/plugin-conformance";
import { runPluginConformance } from "@gwenjs/plugin-conformance/runtime";
import { withPrivateTmpdir } from "../helpers/fixture.js";
import { factorySource, findingsWithCode, spec, writePluginPackage } from "../helpers/runtime.js";

describe("runPluginConformance spec", () => {
  it("rejects an empty factories list with CONFORMANCE:INVALID_SPEC", async () => {
    await withPrivateTmpdir(async (dir) => {
      await writePluginPackage(dir, {
        name: "@fixture/plugin",
        files: { "dist/index.js": factorySource("Plugin") },
      });

      const report = await runPluginConformance(spec({ root: dir, factories: [] }));
      const findings = findingsWithCode(report, ConformanceErrorCodes.INVALID_SPEC);
      expect(report.checks).toEqual([]);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain("factories");
    });
  });

  it("rejects a packageName that differs from the package.json name", async () => {
    await withPrivateTmpdir(async (dir) => {
      await writePluginPackage(dir, {
        name: "@fixture/a",
        files: { "dist/index.js": factorySource("Plugin") },
      });

      const report = await runPluginConformance(spec({ root: dir, packageName: "@fixture/b" }));
      const findings = findingsWithCode(report, ConformanceErrorCodes.INVALID_SPEC);
      expect(report.checks).toEqual([]);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain("@fixture/a");
      expect(findings[0]?.message).toContain("@fixture/b");
    });
  });

  it('rejects variant "heavy" with CONFORMANCE:INVALID_SPEC', async () => {
    await withPrivateTmpdir(async (dir) => {
      await writePluginPackage(dir, {
        name: "@fixture/plugin",
        files: { "dist/index.js": factorySource("Plugin") },
      });

      const report = await runPluginConformance(spec({ root: dir, variant: "heavy" }));
      const findings = findingsWithCode(report, ConformanceErrorCodes.INVALID_SPEC);
      expect(report.checks).toEqual([]);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain("light");
      expect(findings[0]?.message).toContain("physics2d");
      expect(findings[0]?.message).toContain("physics3d");
    });
  });

  it("rejects a frameworkProviders entry that is not a framework plugin", async () => {
    await withPrivateTmpdir(async (dir) => {
      await writePluginPackage(dir, {
        name: "@fixture/plugin",
        files: { "dist/index.js": factorySource("Plugin") },
      });

      const report = await runPluginConformance(
        spec({
          root: dir,
          frameworkProviders: [() => ({ name: "@other/plugin", setup() {} })],
        }),
      );
      const findings = findingsWithCode(report, ConformanceErrorCodes.INVALID_SPEC);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain("@other/plugin");
      expect(report.checks).toEqual([]);
    });
  });

  it("rejects an empty packageName", async () => {
    const report = await runPluginConformance(spec({ packageName: "" }));
    expect(report.checks).toEqual([]);
    expect(report.findings).toEqual([
      expect.objectContaining({
        code: ConformanceErrorCodes.INVALID_SPEC,
        message: "packageName must be a non-empty string",
      }),
    ]);
  });

  it("rejects a factory export that is an empty string", async () => {
    const report = await runPluginConformance(spec({ factories: [{ export: "" }] }));
    expect(report.checks).toEqual([]);
    expect(report.findings).toEqual([
      expect.objectContaining({
        code: ConformanceErrorCodes.INVALID_SPEC,
        message: "factory export must be a non-empty string",
      }),
    ]);
  });

  it("reports a frameworkProviders factory that throws as CONFORMANCE:INVALID_SPEC", async () => {
    await expect(
      runPluginConformance(
        spec({
          frameworkProviders: [
            () => {
              throw new Error("provider boom");
            },
          ],
        }),
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        checks: [],
        findings: [
          expect.objectContaining({
            code: ConformanceErrorCodes.INVALID_SPEC,
            message: expect.stringContaining("provider boom"),
          }),
        ],
      }),
    );
  });
});
