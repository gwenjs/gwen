import { describe, expect, it } from "vitest";
import { ConformanceErrorCodes } from "@gwenjs/plugin-conformance";
import { runPluginConformance } from "@gwenjs/plugin-conformance/runtime";
import { withPrivateTmpdir } from "../helpers/fixture.js";
import { factorySource, findingsWithCode, spec, writePluginPackage } from "../helpers/runtime.js";

describe("runPluginConformance frames", () => {
  it("rejects frames 0 with CONFORMANCE:INVALID_SPEC", async () => {
    await withPrivateTmpdir(async (dir) => {
      await writePluginPackage(dir, {
        name: "@fixture/plugin",
        files: { "dist/index.js": factorySource("Plugin") },
      });

      for (const frames of [0, 1.5, -1]) {
        const report = await runPluginConformance(spec({ root: dir, frames }));
        const findings = findingsWithCode(report, ConformanceErrorCodes.INVALID_SPEC);
        expect(report.checks).toEqual([]);
        expect(findings).toHaveLength(1);
        expect(findings[0]?.message).toContain("frames");
        expect(findings[0]?.message).toContain("1");
      }
    });
  });
});
