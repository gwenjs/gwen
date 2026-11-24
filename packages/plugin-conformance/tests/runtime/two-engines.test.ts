import { describe, expect, it } from "vitest";
import { ConformanceErrorCodes } from "@gwenjs/plugin-conformance";
import { runPluginConformance } from "@gwenjs/plugin-conformance/runtime";
import { withPrivateTmpdir } from "../helpers/fixture.js";
import { findingsWithCode, ranChecks, spec, writePluginPackage } from "../helpers/runtime.js";

const sharedSource = `const shared = { id: "k" };
export function Plugin() {
  return {
    name: "shared-k",
    provides: ["k"],
    setup(engine) {
      engine.provide("k", shared);
    },
  };
}
`;

const separateSource = `export function Plugin() {
  return {
    name: "separate-k",
    provides: ["k"],
    setup(engine) {
      engine.provide("k", {});
    },
  };
}
`;

describe("runPluginConformance two engines", () => {
  it("reports a plugin that shares one module-global service between engines", async () => {
    await withPrivateTmpdir(async (dir) => {
      await writePluginPackage(dir, {
        name: "@fixture/shared-k",
        files: { "dist/index.js": sharedSource },
      });

      const report = await runPluginConformance(
        spec({ root: dir, packageName: "@fixture/shared-k" }),
      );
      const findings = findingsWithCode(report, ConformanceErrorCodes.RUNTIME_TWO_ENGINES);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain("k");
      expect(report.checks).toEqual(ranChecks());
    });
  });

  it("accepts a plugin whose engines hold separate services and survive each other's unuse", async () => {
    await withPrivateTmpdir(async (dir) => {
      await writePluginPackage(dir, {
        name: "@fixture/separate-k",
        files: { "dist/index.js": separateSource },
      });

      const report = await runPluginConformance(
        spec({ root: dir, packageName: "@fixture/separate-k" }),
      );
      expect(report.checks).toEqual(ranChecks());
      expect(report.findings).toEqual([]);
    });
  });
});
