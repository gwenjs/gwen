import { afterEach, describe, expect, it } from "vitest";
import { checkPluginPackage } from "@gwenjs/plugin-conformance";
import { createFixture, stripPluginManifest } from "./helpers/fixture.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  const pending = cleanups.splice(0);
  for (const cleanup of pending) {
    await cleanup();
  }
});

describe("conformance report", () => {
  it("every finding has a hint and a message without a leading bracket", async () => {
    const fixture = await createFixture();
    cleanups.push(fixture.cleanup);
    await stripPluginManifest(fixture.root);

    const report = await checkPluginPackage({ root: fixture.root, profile: "plugin" });
    expect(report.checks).toContain("manifest");
    expect(report.findings).toHaveLength(3);
    for (const finding of report.findings) {
      expect(typeof finding.hint).toBe("string");
      expect(finding.hint.length).toBeGreaterThan(0);
      expect(finding.message.startsWith("[")).toBe(false);
    }
  });
});
