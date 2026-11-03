import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkPluginPackage, ConformanceErrorCodes } from "@gwenjs/plugin-conformance";
import type { ConformanceFinding } from "@gwenjs/plugin-conformance";
import {
  BARE_MANIFEST_MESSAGES,
  createFixture,
  editManifest,
  readPackageText,
  SLOW_TEST_MS,
  stripPluginManifest,
  writeManifestText,
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

function requireFinding(finding: ConformanceFinding | undefined): ConformanceFinding {
  expect(finding).toBeDefined();
  if (finding === undefined) throw new Error("missing finding");
  return finding;
}

describe("checkPluginPackage manifest", () => {
  it(
    "reports a missing gwen.type plugin, licence and LICENSE file",
    { timeout: SLOW_TEST_MS },
    async () => {
      const root = await openPackage();
      await stripPluginManifest(root);

      const report = await checkPluginPackage({ root, profile: "plugin" });
      expect(report.checks).toContain("manifest");
      expect(report.findings).toHaveLength(BARE_MANIFEST_MESSAGES.length);
      const messages = report.findings.map((finding) => finding.message);
      expect(messages).toEqual([...BARE_MANIFEST_MESSAGES]);
      for (const finding of report.findings) {
        expect(finding.code).toBe(ConformanceErrorCodes.MANIFEST);
        expect(finding.file).toBe("package.json");
        expect(finding.line).toBe(1);
      }
    },
  );

  it("accepts a package profile without gwen.type", { timeout: SLOW_TEST_MS }, async () => {
    const root = await openPackage();
    await editManifest(root, (manifest) => {
      delete manifest.gwen;
    });

    const report = await checkPluginPackage({ root, profile: "package" });
    expect(report.checks).toContain("manifest");
    expect(report.findings).toEqual([]);
  });

  it("reports a package.json that is not valid JSON", async () => {
    const root = await openPackage();
    await writeFile(path.join(root, "package.json"), "{");

    const report = await checkPluginPackage({ root, profile: "plugin" });
    expect(report.checks).toContain("manifest");
    expect(report.checks).toEqual(["manifest"]);
    expect(report.findings).toHaveLength(1);
    const finding = requireFinding(report.findings[0]);
    expect(finding.code).toBe(ConformanceErrorCodes.MANIFEST);
    expect(finding.file).toBe("package.json");
    expect(finding.message).toBe("package.json is not valid JSON");
  });

  it("reports a root without package.json", async () => {
    const root = await openPackage();
    await rm(path.join(root, "package.json"));

    const report = await checkPluginPackage({ root, profile: "plugin" });
    expect(report.checks).toContain("manifest");
    expect(report.checks).toEqual(["manifest"]);
    expect(report.findings).toHaveLength(1);
    const finding = requireFinding(report.findings[0]);
    expect(finding.code).toBe(ConformanceErrorCodes.MANIFEST);
    expect(finding.file).toBe("package.json");
    expect(finding.message).toBe("package.json is missing");
  });

  it(
    "runs the exports check when package.json starts with a BOM",
    { timeout: SLOW_TEST_MS },
    async () => {
      const root = await openPackage();
      const text = await readPackageText(root);
      await writeManifestText(root, `\uFEFF${text}`);

      const report = await checkPluginPackage({ root, profile: "plugin" });
      expect(report.checks).toEqual([
        "exports",
        "snapshot-values",
        "snapshot-types",
        "publint",
        "attw",
        "readme",
        "hooks",
        "test-mocks",
        "manifest",
      ]);
      // publint cannot parse a BOM package.json: that is its one finding.
      expect(report.findings).toHaveLength(1);
      const finding = requireFinding(report.findings[0]);
      expect(finding.code).toBe(ConformanceErrorCodes.PUBLINT);
      expect(finding.file).toBe("package.json");
      expect(finding.line).toBe(1);
      expect(finding.message).toBe("publint failed: Unexpected token '\uFEFF', \"\uFEFF{");
    },
  );

  it("reports a package.json that cannot be read", async () => {
    const root = await openPackage();
    await rm(path.join(root, "package.json"));
    await mkdir(path.join(root, "package.json"));

    const report = await checkPluginPackage({ root, profile: "plugin" });
    expect(report.checks).toEqual(["manifest"]);
    expect(report.findings).toHaveLength(1);
    const finding = requireFinding(report.findings[0]);
    expect(finding.code).toBe(ConformanceErrorCodes.MANIFEST);
    expect(finding.file).toBe("package.json");
    expect(finding.message).toBe("package.json cannot be read");
  });

  it("accepts LICENSE.md in place of LICENSE", { timeout: SLOW_TEST_MS }, async () => {
    const root = await openPackage();
    await rm(path.join(root, "LICENSE"));
    await writeFile(path.join(root, "LICENSE.md"), "license\n");

    const report = await checkPluginPackage({ root, profile: "plugin" });
    expect(report.checks).toContain("manifest");
    expect(report.findings).toEqual([]);
  });

  it("accepts LICENSE.txt in place of LICENSE", { timeout: SLOW_TEST_MS }, async () => {
    const root = await openPackage();
    await rm(path.join(root, "LICENSE"));
    await writeFile(path.join(root, "LICENSE.txt"), "license\n");

    const report = await checkPluginPackage({ root, profile: "plugin" });
    expect(report.checks).toContain("manifest");
    expect(report.findings).toEqual([]);
  });
});
