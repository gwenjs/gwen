import { describe, expect, it } from "vitest";
import { ConformanceErrorCodes } from "@gwenjs/plugin-conformance";
import { runPluginConformance } from "@gwenjs/plugin-conformance/runtime";
import { writeBasePackage, writeExtensionPackage } from "../helpers/extension-runtime.js";
import { withPrivateTmpdir } from "../helpers/fixture.js";
import { findingsWithCode, ranChecks, spec } from "../helpers/runtime.js";

describe("runPluginConformance extension", () => {
  it("a base outside gwen.extends in spec.bases is INVALID_SPEC", async () => {
    await withPrivateTmpdir(async (dir) => {
      await writeExtensionPackage(dir, {
        name: "fixture-ext",
        gwen: { extends: ["fixture-base"] },
      });

      const report = await runPluginConformance(
        spec({
          root: dir,
          packageName: "fixture-ext",
          bases: [{ packageName: "fixture-other", export: "Base" }],
        }),
      );
      const findings = findingsWithCode(report, ConformanceErrorCodes.INVALID_SPEC);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain("fixture-other");
      expect(findings[0]?.message).toContain("gwen.extends");
      expect(report.checks).toEqual([]);
    });
  });

  it("a base that is not installed is INVALID_SPEC", async () => {
    await withPrivateTmpdir(async (dir) => {
      await writeExtensionPackage(dir, {
        name: "fixture-ext",
        gwen: { extends: ["fixture-base"] },
      });

      const report = await runPluginConformance(
        spec({
          root: dir,
          packageName: "fixture-ext",
          bases: [{ packageName: "fixture-base", export: "Base" }],
        }),
      );
      const findings = findingsWithCode(report, ConformanceErrorCodes.INVALID_SPEC);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain("fixture-base");
      expect(findings[0]?.message).toContain(dir);
      expect(report.checks).toEqual([]);
    });
  });

  it("a base whose export is not a function is INVALID_SPEC", async () => {
    await withPrivateTmpdir(async (dir) => {
      await writeExtensionPackage(dir, {
        name: "fixture-ext",
        gwen: { extends: ["fixture-base"] },
      });
      await writeBasePackage(dir, {
        name: "fixture-base",
        source: 'export const Base = "nope";\n',
      });

      const report = await runPluginConformance(
        spec({
          root: dir,
          packageName: "fixture-ext",
          bases: [{ packageName: "fixture-base", export: "Base" }],
        }),
      );
      const findings = findingsWithCode(report, ConformanceErrorCodes.INVALID_SPEC);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain("Base");
      expect(report.checks).toEqual([]);
    });
  });

  it("a spec.bases that is not a list of packageName and export is INVALID_SPEC", async () => {
    await withPrivateTmpdir(async (dir) => {
      await writeExtensionPackage(dir, { name: "fixture-ext" });

      const asString = await runPluginConformance(
        spec({
          root: dir,
          packageName: "fixture-ext",
          bases: "fixture-base",
        }),
      );
      const stringFindings = findingsWithCode(asString, ConformanceErrorCodes.INVALID_SPEC);
      expect(stringFindings).toHaveLength(1);
      expect(stringFindings[0]?.message).toContain("bases");
      expect(asString.checks).toEqual([]);

      const badEntry = await runPluginConformance(
        spec({
          root: dir,
          packageName: "fixture-ext",
          bases: [{ packageName: 3 }],
        }),
      );
      const entryFindings = findingsWithCode(badEntry, ConformanceErrorCodes.INVALID_SPEC);
      expect(entryFindings).toHaveLength(1);
      expect(entryFindings[0]?.message).toContain("bases");
      expect(badEntry.checks).toEqual([]);
    });
  });

  it("a package that lists gwen.extends and passes no spec.bases is INVALID_SPEC", async () => {
    await withPrivateTmpdir(async (dir) => {
      await writeExtensionPackage(dir, {
        name: "fixture-ext",
        gwen: { extends: ["fixture-base"] },
      });

      const listed = await runPluginConformance(spec({ root: dir, packageName: "fixture-ext" }));
      const findings = findingsWithCode(listed, ConformanceErrorCodes.INVALID_SPEC);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain("fixture-base");
      expect(findings[0]?.message).toContain("spec.bases");
      expect(listed.checks).toEqual([]);

      await writeExtensionPackage(dir, { name: "fixture-ext" });
      const absent = await runPluginConformance(spec({ root: dir, packageName: "fixture-ext" }));
      expect(findingsWithCode(absent, ConformanceErrorCodes.INVALID_SPEC)).toEqual([]);
      expect(absent.checks).toEqual(ranChecks());

      await writeExtensionPackage(dir, {
        name: "fixture-ext",
        gwen: { extends: [] },
      });
      const empty = await runPluginConformance(spec({ root: dir, packageName: "fixture-ext" }));
      expect(findingsWithCode(empty, ConformanceErrorCodes.INVALID_SPEC)).toEqual([]);
      expect(empty.checks).toEqual(ranChecks());
    });
  });
});
