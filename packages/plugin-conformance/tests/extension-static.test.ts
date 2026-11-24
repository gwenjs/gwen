import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ConformanceFinding } from "@gwenjs/plugin-conformance";
import { indexJson } from "../src/json.js";
import {
  extensionFindings,
  extensionFixtureRoot,
  openExtensionFixture,
} from "./helpers/extension.js";
import type { ExtensionManifest } from "./helpers/extension.js";

const open = openExtensionFixture();

const OFFICIAL = "CONFORMANCE:EXTENSION_OFFICIAL";
const OFFICIAL_NAME = "@gwenjs/fixture-official";
const COMMUNITY_NAME = "fixture-community";
const FRAMEWORK_NAME = "@gwenjs/camera-core";
const RENAMED_OFFICIAL = "@gwenjs/x";
const BASE = "fixture-base";
const OTHER_BASE = "fixture-other";

function quoted(value: string): string {
  return `"${value}"`;
}

/** 1-based line of the `gwen.extends` key, the same line `keyLine` reports. */
async function extendsKeyLine(root: string): Promise<number> {
  const text = await readFile(path.join(root, "package.json"), "utf8");
  const line = indexJson(text).keyLine(["gwen", "extends"]);
  if (line === undefined) {
    throw new Error("gwen.extends has no key line");
  }
  return line;
}

function pluginManifest(name: string, extendsValue: unknown): ExtensionManifest {
  return {
    name,
    gwen: { type: "plugin", extends: extendsValue },
  };
}

function officialManifest(extendsValue: unknown): ExtensionManifest {
  return pluginManifest(OFFICIAL_NAME, extendsValue);
}

async function check(
  manifest: ExtensionManifest,
  profile: "plugin" | "package" = "plugin",
): Promise<{ readonly root: string; readonly findings: readonly ConformanceFinding[] }> {
  const fixture = await open(manifest);
  return { root: fixture.root, findings: await fixture.checkOf(OFFICIAL, profile) };
}

function expectOfficial(
  findings: readonly ConformanceFinding[],
  name: string,
  bases: readonly string[],
  line: number,
): void {
  expect(findings).toHaveLength(1);
  const finding = findings[0];
  if (finding === undefined) {
    throw new Error("expected one EXTENSION_OFFICIAL finding");
  }
  const code: string = finding.code;
  expect(code).toBe(OFFICIAL);
  expect(finding.file).toBe("package.json");
  expect(finding.line).toBe(line);
  expect(finding.message).toContain(quoted(name));
  expect(finding.message).toContain("is an official package");
  expect(finding.message).toContain("in gwen.extends");
  for (const base of bases) {
    expect(finding.message).toContain(quoted(base));
  }
  expect(finding.hint.length).toBeGreaterThan(0);
}

describe("EXTENSION_OFFICIAL", () => {
  it("official-cross-package reports EXTENSION_OFFICIAL at the gwen.extends line", async () => {
    const root = extensionFixtureRoot("official-cross-package");
    const findings = await extensionFindings(root, OFFICIAL);
    expectOfficial(findings, OFFICIAL_NAME, [BASE], await extendsKeyLine(root));
  });

  it("reports one EXTENSION_OFFICIAL for an official package that lists two bases", async () => {
    const { root, findings } = await check(officialManifest([BASE, OTHER_BASE]));
    expectOfficial(findings, OFFICIAL_NAME, [BASE, OTHER_BASE], await extendsKeyLine(root));
  });

  it("accepts an absent or empty gwen.extends on an official package", async () => {
    const absent = await check({ name: OFFICIAL_NAME, gwen: { type: "plugin" } });
    const empty = await check(officialManifest([]));
    expect(absent.findings).toEqual([]);
    expect(empty.findings).toEqual([]);
    const sibling = await check(officialManifest([BASE]));
    expectOfficial(sibling.findings, OFFICIAL_NAME, [BASE], await extendsKeyLine(sibling.root));
  });

  it("accepts a community package that lists a base", async () => {
    const community = await check(pluginManifest(COMMUNITY_NAME, [BASE]));
    expect(community.findings).toEqual([]);
    const sibling = await check(pluginManifest(RENAMED_OFFICIAL, [BASE]));
    expectOfficial(sibling.findings, RENAMED_OFFICIAL, [BASE], await extendsKeyLine(sibling.root));
  });

  it("does not report a framework package that lists a base", async () => {
    const framework = await check(pluginManifest(FRAMEWORK_NAME, [BASE]));
    expect(framework.findings).toEqual([]);
    const sibling = await check(pluginManifest(OFFICIAL_NAME, [BASE]));
    expectOfficial(sibling.findings, OFFICIAL_NAME, [BASE], await extendsKeyLine(sibling.root));
  });

  it("reports for the package profile too", async () => {
    const { root, findings } = await check(officialManifest([BASE]), "package");
    expectOfficial(findings, OFFICIAL_NAME, [BASE], await extendsKeyLine(root));
  });

  it("ignores a gwen.extends that is not an array", async () => {
    const text = await check(officialManifest("fixture-base"));
    const record = await check(officialManifest({ base: BASE }));
    const none = await check(officialManifest(null));
    expect(text.findings).toEqual([]);
    expect(record.findings).toEqual([]);
    expect(none.findings).toEqual([]);
    const sibling = await check(officialManifest([BASE]));
    expectOfficial(sibling.findings, OFFICIAL_NAME, [BASE], await extendsKeyLine(sibling.root));
  });
});
