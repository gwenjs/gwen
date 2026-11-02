import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkPluginPackage, ConformanceErrorCodes } from "@gwenjs/plugin-conformance";
import type { ConformanceFinding, ConformanceReport } from "@gwenjs/plugin-conformance";
import {
  createFixture,
  editManifest,
  goodPluginRoot,
  lineOf,
  manifestExports,
  readPackageText,
  type ExportCondition,
} from "./helpers/fixture.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  const pending = cleanups.splice(0);
  for (const cleanup of pending) {
    await cleanup();
  }
});

async function openPackage(): Promise<string> {
  const fixture = await createFixture();
  cleanups.push(fixture.cleanup);
  return fixture.root;
}

function condition(value: string | ExportCondition | undefined): ExportCondition {
  if (value === undefined || typeof value === "string") {
    throw new Error("expected an exports condition object");
  }
  return value;
}

function requireFinding(finding: ConformanceFinding | undefined): ConformanceFinding {
  expect(finding).toBeDefined();
  if (finding === undefined) throw new Error("missing finding");
  return finding;
}

describe("checkPluginPackage", () => {
  it("reports an exports target missing from dist", async () => {
    const root = await openPackage();
    await rm(path.join(root, "dist/index.js"));
    const text = await readPackageText(root);

    const report = await checkPluginPackage({ root, profile: "plugin" });
    expect(report.checks).toContain("exports");
    expect(report.findings).toHaveLength(1);
    const finding = requireFinding(report.findings[0]);
    expect(finding.code).toBe(ConformanceErrorCodes.EXPORTS_INVALID);
    expect(finding.file).toBe("package.json");
    expect(finding.line).toBe(lineOf(text, '"./dist/index.js"'));
    expect(finding.message).toBe('export "./dist/index.js" of subpath "." is missing');
  });

  it("reports a types condition that is not first", async () => {
    const root = await openPackage();
    await editManifest(root, (manifest) => {
      const dot = condition(manifestExports(manifest)["."]);
      const types = dot.types;
      const imported = dot.import;
      if (types === undefined || imported === undefined) {
        throw new Error("fixture dot export is incomplete");
      }
      manifestExports(manifest)["."] = { import: imported, types };
    });
    const text = await readPackageText(root);

    const report = await checkPluginPackage({ root, profile: "plugin" });
    expect(report.checks).toContain("exports");
    expect(report.findings).toHaveLength(1);
    const finding = requireFinding(report.findings[0]);
    expect(finding.code).toBe(ConformanceErrorCodes.EXPORTS_INVALID);
    expect(finding.file).toBe("package.json");
    expect(finding.line).toBe(lineOf(text, '".":'));
    expect(finding.message).toBe('subpath "." lists condition "types" after another key');
  });

  it("reports a plugin without ./module and one with ./internal", async () => {
    const missingModule = await openPackage();
    const internal = await openPackage();
    await editManifest(missingModule, (manifest) => {
      delete manifestExports(manifest)["./module"];
    });
    await editManifest(internal, (manifest) => {
      manifestExports(manifest)["./internal"] = "./dist/index.js";
    });
    const internalText = await readPackageText(internal);

    const missingReport = await checkPluginPackage({ root: missingModule, profile: "plugin" });
    expect(missingReport.checks).toContain("exports");
    expect(missingReport.findings).toHaveLength(1);
    const missing = requireFinding(missingReport.findings[0]);
    expect(missing.code).toBe(ConformanceErrorCodes.EXPORTS_INVALID);
    expect(missing.file).toBe("package.json");
    expect(missing.line).toBe(1);
    expect(missing.message).toBe('subpath "./module" is required for profile plugin');

    const internalReport = await checkPluginPackage({ root: internal, profile: "plugin" });
    expect(internalReport.checks).toContain("exports");
    expect(internalReport.findings).toHaveLength(1);
    const banned = requireFinding(internalReport.findings[0]);
    expect(banned.code).toBe(ConformanceErrorCodes.EXPORTS_INVALID);
    expect(banned.file).toBe("package.json");
    expect(banned.line).toBe(lineOf(internalText, '"./internal"'));
    expect(banned.message).toBe('subpath "./internal" is not a public export');
  });

  it("reports an exports target that leaves the package root", async () => {
    const root = await openPackage();
    await writeFile(path.resolve(root, "..", "outside.js"), "export {}\n");
    await editManifest(root, (manifest) => {
      const dot = condition(manifestExports(manifest)["."]);
      const types = dot.types;
      if (types === undefined) throw new Error("fixture dot export is incomplete");
      manifestExports(manifest)["."] = { types, import: "../outside.js" };
    });
    const text = await readPackageText(root);

    const report = await checkPluginPackage({ root, profile: "plugin" });
    expect(report.checks).toContain("exports");
    expect(report.findings).toHaveLength(1);
    const finding = requireFinding(report.findings[0]);
    expect(finding.code).toBe(ConformanceErrorCodes.EXPORTS_INVALID);
    expect(finding.file).toBe("package.json");
    expect(finding.line).toBe(lineOf(text, '"../outside.js"'));
    expect(finding.message).toBe(
      'export "../outside.js" of subpath "." resolves outside the package root',
    );
  });

  it("accepts a package profile without ./module", async () => {
    const root = await openPackage();
    await editManifest(root, (manifest) => {
      delete manifestExports(manifest)["./module"];
    });

    const report = await checkPluginPackage({ root, profile: "package" });
    expect(report.checks).toContain("exports");
    expect(report.findings).toEqual([]);
  });

  it("runs the exports and manifest checks on the clean fixture and reports nothing", async () => {
    const report: ConformanceReport = await checkPluginPackage({
      root: goodPluginRoot(),
      profile: "plugin",
    });
    expect(report.checks).toEqual(["exports", "manifest"]);
    expect(report.findings).toEqual([]);
  });

  it("does not existence-check a subpath pattern target", async () => {
    const root = await openPackage();
    await editManifest(root, (manifest) => {
      manifestExports(manifest)["./x/*"] = "./dist/x/*.js";
    });

    const report = await checkPluginPackage({ root, profile: "plugin" });
    expect(report.checks).toContain("exports");
    expect(report.findings).toEqual([]);
  });
});
