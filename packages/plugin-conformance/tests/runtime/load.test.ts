import path from "node:path";
import { describe, expect, it } from "vitest";
import { ConformanceErrorCodes } from "@gwenjs/plugin-conformance";
import { runPluginConformance } from "@gwenjs/plugin-conformance/runtime";
import { withPrivateTmpdir } from "../helpers/fixture.js";
import { factorySource, findingsWithCode, spec, writePluginPackage } from "../helpers/runtime.js";

describe("runPluginConformance load", () => {
  it("reports a root without package.json as CONFORMANCE:INVALID_SPEC", async () => {
    await withPrivateTmpdir(async (dir) => {
      const report = await runPluginConformance(spec({ root: dir }));
      const findings = findingsWithCode(report, ConformanceErrorCodes.INVALID_SPEC);
      expect(report.checks).toEqual([]);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain(path.join(dir, "package.json"));
    });
  });

  it("rejects a factory export that the built entry does not export", async () => {
    await withPrivateTmpdir(async (dir) => {
      await writePluginPackage(dir, {
        name: "@fixture/plugin",
        files: { "dist/index.js": factorySource("A") },
      });

      const report = await runPluginConformance(spec({ root: dir, factories: [{ export: "B" }] }));
      const findings = findingsWithCode(report, ConformanceErrorCodes.INVALID_SPEC);
      expect(report.checks).toEqual([]);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain("B");
    });
  });

  it("reads the factory from dist and not from src", async () => {
    await withPrivateTmpdir(async (dir) => {
      await writePluginPackage(dir, {
        name: "@fixture/plugin",
        files: {
          "src/index.ts": factorySource("Good"),
          "dist/index.js": factorySource("Other"),
        },
      });

      const report = await runPluginConformance(
        spec({ root: dir, factories: [{ export: "Good" }] }),
      );
      const findings = findingsWithCode(report, ConformanceErrorCodes.INVALID_SPEC);
      expect(report.checks).toEqual([]);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain("Good");
    });
  });
});
