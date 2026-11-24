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

const MANIFEST = "CONFORMANCE:MANIFEST";
const ARRAY_MESSAGE = "gwen.extends must be an array of package names";
const SELF_MESSAGE = "gwen.extends lists the package itself";

function entryMessage(index: number): string {
  return `gwen.extends[${index}] must be a package name string`;
}

function duplicateMessage(name: string): string {
  return `gwen.extends lists "${name}" twice`;
}

function invalidNameMessage(value: string): string {
  return `gwen.extends entry "${value}" is not a package name`;
}

/** Plugin manifest with a licence string (check-manifest.ts:49). `extendsValue` is written as is. */
function licensedPlugin(name: string, extendsValue: unknown): ExtensionManifest {
  return {
    name,
    license: "MIT",
    gwen: { type: "plugin", extends: extendsValue },
  };
}

/** Same as {@link licensedPlugin} with no `gwen.extends` key. */
function licensedPluginWithoutExtends(name: string): ExtensionManifest {
  return {
    name,
    license: "MIT",
    gwen: { type: "plugin" },
  };
}

/**
 * Temp package plus its `CONFORMANCE:MANIFEST` findings.
 * Writes `LICENSE` because the manifest rule requires that file (check-manifest.ts:57).
 */
async function openManifest(
  manifest: ExtensionManifest,
  profile: "plugin" | "package" = "plugin",
): Promise<{ readonly root: string; readonly findings: readonly ConformanceFinding[] }> {
  const fixture = await open(manifest, { LICENSE: "MIT\n" });
  return { root: fixture.root, findings: await fixture.checkOf(MANIFEST, profile) };
}

/** Manifest findings whose message is about `gwen.extends`. Other manifest messages stay out. */
function extendsShape(findings: readonly ConformanceFinding[]): ConformanceFinding[] {
  return findings.filter((finding) => finding.message.startsWith("gwen.extends"));
}

/** 1-based line of `gwen.extends[index]`, the line `valueLine` reports (src/json.ts:16). */
async function extendsElementLine(root: string, index: number): Promise<number> {
  const text = await readFile(path.join(root, "package.json"), "utf8");
  const line = indexJson(text).valueLine(["gwen", "extends", String(index)]);
  if (line === undefined) {
    throw new Error(`gwen.extends[${index}] has no value line`);
  }
  return line;
}

function expectExtendsAt(
  findings: readonly ConformanceFinding[],
  message: string,
  line: number,
): void {
  const matches = extendsShape(findings).filter((finding) => {
    return finding.message === message && finding.line === line;
  });
  expect(matches).toHaveLength(1);
  const finding = matches[0];
  if (finding === undefined) {
    throw new Error(`expected one finding: ${message}`);
  }
  const code: string = finding.code;
  expect(code).toBe(MANIFEST);
  expect(finding.file).toBe("package.json");
  expect(finding.hint.length).toBeGreaterThan(0);
}

function expectNoExtends(findings: readonly ConformanceFinding[]): void {
  expect(extendsShape(findings)).toEqual([]);
}

describe("gwen.extends shape", () => {
  it("reports a gwen.extends that is not an array", async () => {
    const values: readonly unknown[] = ["fixture-base", { base: BASE }, null, 3];
    for (const value of values) {
      const { root, findings } = await openManifest(licensedPlugin(COMMUNITY_NAME, value));
      expect(extendsShape(findings)).toHaveLength(1);
      expectExtendsAt(findings, ARRAY_MESSAGE, await extendsKeyLine(root));
    }
    const sibling = await openManifest(licensedPlugin(COMMUNITY_NAME, [BASE]));
    expectNoExtends(sibling.findings);
  });

  it("reports an entry that is not a string at its own line", async () => {
    const { root, findings } = await openManifest(licensedPlugin(COMMUNITY_NAME, [BASE, 3, null]));
    expect(extendsShape(findings)).toHaveLength(2);
    const lineOfNumber = await extendsElementLine(root, 1);
    const lineOfNull = await extendsElementLine(root, 2);
    expectExtendsAt(findings, entryMessage(1), lineOfNumber);
    expectExtendsAt(findings, entryMessage(2), lineOfNull);
    const sibling = await openManifest(licensedPlugin(COMMUNITY_NAME, [BASE, OTHER_BASE]));
    expectNoExtends(sibling.findings);
  });

  it("reports a duplicate entry at the second element", async () => {
    const pair = await openManifest(licensedPlugin(COMMUNITY_NAME, [BASE, BASE]));
    expect(extendsShape(pair.findings)).toHaveLength(1);
    expectExtendsAt(pair.findings, duplicateMessage(BASE), await extendsElementLine(pair.root, 1));
    const triple = await openManifest(licensedPlugin(COMMUNITY_NAME, [BASE, BASE, BASE]));
    expect(extendsShape(triple.findings)).toHaveLength(2);
    expectExtendsAt(
      triple.findings,
      duplicateMessage(BASE),
      await extendsElementLine(triple.root, 1),
    );
    expectExtendsAt(
      triple.findings,
      duplicateMessage(BASE),
      await extendsElementLine(triple.root, 2),
    );
    const sibling = await openManifest(licensedPlugin(COMMUNITY_NAME, [BASE, OTHER_BASE]));
    expectNoExtends(sibling.findings);
  });

  it("reports the package listing itself", async () => {
    const listed = await openManifest(licensedPlugin(BASE, [OTHER_BASE, BASE]));
    expect(extendsShape(listed.findings)).toHaveLength(1);
    expectExtendsAt(listed.findings, SELF_MESSAGE, await extendsElementLine(listed.root, 1));
    const scoped = await openManifest(licensedPlugin("@acme/fx-base", ["@acme/fx-base"]));
    expect(extendsShape(scoped.findings)).toHaveLength(1);
    expectExtendsAt(scoped.findings, SELF_MESSAGE, await extendsElementLine(scoped.root, 0));
    const sibling = await openManifest(licensedPlugin(BASE, [OTHER_BASE]));
    expectNoExtends(sibling.findings);
  });

  it("reports a subpath or an invalid name entry", async () => {
    const entries = [
      "",
      "@gwenjs/camera2d/sub",
      "fixture-base/extension",
      "Bad Name",
      "@acme/fx-base",
      BASE,
    ];
    const { root, findings } = await openManifest(licensedPlugin(COMMUNITY_NAME, entries));
    expect(extendsShape(findings)).toHaveLength(4);
    expectExtendsAt(findings, invalidNameMessage(""), await extendsElementLine(root, 0));
    expectExtendsAt(
      findings,
      invalidNameMessage("@gwenjs/camera2d/sub"),
      await extendsElementLine(root, 1),
    );
    expectExtendsAt(
      findings,
      invalidNameMessage("fixture-base/extension"),
      await extendsElementLine(root, 2),
    );
    expectExtendsAt(findings, invalidNameMessage("Bad Name"), await extendsElementLine(root, 3));
  });

  it("accepts a well formed gwen.extends, an empty array and an absent field", async () => {
    const well = await openManifest(licensedPlugin(COMMUNITY_NAME, ["@acme/fx-base", BASE]));
    const empty = await openManifest(licensedPlugin(COMMUNITY_NAME, []));
    const absent = await openManifest(licensedPluginWithoutExtends(COMMUNITY_NAME));
    expectNoExtends(well.findings);
    expectNoExtends(empty.findings);
    expectNoExtends(absent.findings);
    const sibling = await openManifest(licensedPlugin(COMMUNITY_NAME, "fixture-base"));
    expect(extendsShape(sibling.findings)).toHaveLength(1);
    expectExtendsAt(sibling.findings, ARRAY_MESSAGE, await extendsKeyLine(sibling.root));
  });

  it("reports a malformed gwen.extends for the package profile too", async () => {
    const { root, findings } = await openManifest(
      licensedPlugin(COMMUNITY_NAME, "fixture-base"),
      "package",
    );
    expect(extendsShape(findings)).toHaveLength(1);
    expectExtendsAt(findings, ARRAY_MESSAGE, await extendsKeyLine(root));
    const sibling = await openManifest(licensedPlugin(COMMUNITY_NAME, [BASE]), "package");
    expectNoExtends(sibling.findings);
  });

  it("still reads the string entries of a partly malformed gwen.extends", async () => {
    const fixture = await open(licensedPlugin(OFFICIAL_NAME, [BASE, 3]), { LICENSE: "MIT\n" });
    const official = await fixture.checkOf(OFFICIAL);
    expectOfficial(official, OFFICIAL_NAME, [BASE], await extendsKeyLine(fixture.root));
    const manifest = await fixture.checkOf(MANIFEST);
    expect(extendsShape(manifest)).toHaveLength(1);
    expectExtendsAt(manifest, entryMessage(1), await extendsElementLine(fixture.root, 1));
    const sibling = await open(licensedPlugin(OFFICIAL_NAME, [BASE]), { LICENSE: "MIT\n" });
    expectNoExtends(await sibling.checkOf(MANIFEST));
    const siblingOfficial = await sibling.checkOf(OFFICIAL);
    expectOfficial(siblingOfficial, OFFICIAL_NAME, [BASE], await extendsKeyLine(sibling.root));
  });
});
