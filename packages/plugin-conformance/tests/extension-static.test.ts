import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { checkPluginPackage } from "@gwenjs/plugin-conformance";
import type { ConformanceFinding } from "@gwenjs/plugin-conformance";
import { indexJson } from "../src/json.js";
import {
  copyExtensionPackage,
  extensionFindings,
  extensionFixtureRoot,
  installBase,
  openExtensionFixture,
} from "./helpers/extension.js";
import type { ExtensionFixture, ExtensionManifest } from "./helpers/extension.js";
import { SLOW_TEST_MS, writeDeep, writeInstalledPackage, writeSource } from "./helpers/fixture.js";

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

const ENTRY = "CONFORMANCE:EXTENSION_ENTRY";
const IMPORT_INTERNAL = "CONFORMANCE:IMPORT_INTERNAL";
const IMPORT_DEEP = "CONFORMANCE:IMPORT_DEEP";
const IMPORT_FOREIGN = "CONFORMANCE:IMPORT_FOREIGN_PLUGIN";
const SCOPED_BASE = "@acme/fx-base";
const CAMERA = "@gwenjs/camera2d";

/**
 * Community package whose `gwen.extends` names a base.
 * Only `<base>/extension` is accepted today (check-imports.ts:162-174).
 * `internal` and `wasm` stay an internal entry (check-imports.ts:317-326).
 * `dist` and `src` are deep; `src` is not deep for `@gwenjs/*` (check-imports.ts:329).
 * A test file is `*.test.*` or a file under `tests` (source-files.ts:68-74).
 * An official name keeps the foreign-plugin code (check-imports.ts:155-156).
 */
interface ExpectedSite {
  readonly code: string;
  readonly file: string;
  readonly line: number;
  readonly specifier: string;
  /** Substring the message must contain, besides the quoted specifier. */
  readonly detail: string;
  /** Exact hint. When omitted, the hint only has to be non-empty. */
  readonly hint?: string;
}

function entryDetail(base: string): string {
  return `is not the extension entry of ${base}, which is listed in gwen.extends`;
}

function entryHint(base: string): string {
  return `Import only "${base}/extension" from a base.`;
}

function entrySite(file: string, line: number, specifier: string, base: string): ExpectedSite {
  return {
    code: ENTRY,
    file,
    line,
    specifier,
    detail: entryDetail(base),
    hint: entryHint(base),
  };
}

function sitesOf(findings: readonly ConformanceFinding[]): string[] {
  return findings.map((finding) => {
    const code: string = finding.code;
    return `${code} ${finding.file}:${finding.line}`;
  });
}

function expectSites(findings: readonly ConformanceFinding[], rows: readonly ExpectedSite[]): void {
  expect(sitesOf(findings)).toEqual(rows.map((row) => `${row.code} ${row.file}:${row.line}`));
  for (const [index, row] of rows.entries()) {
    const finding = findings[index];
    if (finding === undefined) {
      throw new Error(`expected a finding at index ${index}`);
    }
    expect(finding.message).toContain(`"${row.specifier}"`);
    expect(finding.message).toContain(row.detail);
    if (row.hint === undefined) {
      expect(finding.hint.length).toBeGreaterThan(0);
    } else {
      expect(finding.hint).toBe(row.hint);
    }
  }
}

function inFiles(
  findings: readonly ConformanceFinding[],
  files: readonly string[],
): ConformanceFinding[] {
  const wanted = new Set(files);
  return findings.filter((finding) => {
    const file = finding.file;
    return file !== undefined && wanted.has(file);
  });
}

async function listedFindings(
  manifest: ExtensionManifest,
  sources: Readonly<Record<string, string>>,
  files: readonly string[],
  installed: readonly string[] = [],
): Promise<ConformanceFinding[]> {
  const fixture = await open(manifest, sources);
  for (const name of installed) {
    await writeInstalledPackage(fixture.root, name, { gwen: { type: "plugin" } });
  }
  const report = await checkPluginPackage({ root: fixture.root, profile: "plugin" });
  return inFiles(report.findings, files);
}

function lines(rows: readonly string[]): string {
  return `${rows.join("\n")}\n`;
}

describe("EXTENSION_ENTRY", () => {
  it("root-import reports EXTENSION_ENTRY at src/index.ts:1", async () => {
    const findings = await extensionFindings(extensionFixtureRoot("root-import"), ENTRY);
    expectSites(findings, [entrySite("src/index.ts", 1, BASE, BASE)]);
  });

  it("reports EXTENSION_ENTRY for module, testing, any other subpath, extension/sub and extension.js", async () => {
    const findings = await listedFindings(
      pluginManifest(COMMUNITY_NAME, [BASE]),
      {
        "src/index.ts": lines([
          'import { fromModule } from "fixture-base/module";',
          'import { fromTesting } from "fixture-base/testing";',
          'import { fromOther } from "fixture-base/other";',
          'import { fromSub } from "fixture-base/extension/sub";',
          'import { fromFile } from "fixture-base/extension.js";',
          "export { fromModule, fromTesting, fromOther, fromSub, fromFile };",
        ]),
      },
      ["src/index.ts"],
    );
    expectSites(findings, [
      entrySite("src/index.ts", 1, `${BASE}/module`, BASE),
      entrySite("src/index.ts", 2, `${BASE}/testing`, BASE),
      entrySite("src/index.ts", 3, `${BASE}/other`, BASE),
      entrySite("src/index.ts", 4, `${BASE}/extension/sub`, BASE),
      entrySite("src/index.ts", 5, `${BASE}/extension.js`, BASE),
    ]);
  });

  it("reports EXTENSION_ENTRY for import, export from, import(), require and import type", async () => {
    const findings = await listedFindings(
      pluginManifest(COMMUNITY_NAME, [BASE]),
      {
        "src/forms.ts": lines([
          'import { value } from "fixture-base";',
          'export { renamed } from "fixture-base";',
          'export const loaded = import("fixture-base");',
          'export const required = require("fixture-base");',
          'import type { Kind } from "fixture-base";',
          "export { value };",
          "export type { Kind };",
        ]),
      },
      ["src/forms.ts"],
    );
    expectSites(findings, [
      entrySite("src/forms.ts", 1, BASE, BASE),
      entrySite("src/forms.ts", 2, BASE, BASE),
      entrySite("src/forms.ts", 3, BASE, BASE),
      entrySite("src/forms.ts", 4, BASE, BASE),
      entrySite("src/forms.ts", 5, BASE, BASE),
    ]);
  });

  it("internal-import reports IMPORT_INTERNAL for fixture-base/internal and fixture-base/wasm", async () => {
    const findings = await extensionFindings(
      extensionFixtureRoot("internal-import"),
      IMPORT_INTERNAL,
    );
    expectSites(findings, [
      {
        code: IMPORT_INTERNAL,
        file: "src/index.ts",
        line: 1,
        specifier: `${BASE}/internal`,
        detail: `is an internal entry of ${BASE}`,
      },
      {
        code: IMPORT_INTERNAL,
        file: "src/index.ts",
        line: 2,
        specifier: `${BASE}/wasm`,
        detail: `is an internal entry of ${BASE}`,
      },
    ]);
  });

  it("deep-import reports IMPORT_DEEP for fixture-base/dist/extension.js and fixture-base/src/extension.ts", async () => {
    const findings = await extensionFindings(extensionFixtureRoot("deep-import"), IMPORT_DEEP);
    expectSites(findings, [
      {
        code: IMPORT_DEEP,
        file: "src/index.ts",
        line: 1,
        specifier: `${BASE}/dist/extension.js`,
        detail: BASE,
      },
      {
        code: IMPORT_DEEP,
        file: "src/index.ts",
        line: 2,
        specifier: `${BASE}/src/extension.ts`,
        detail: BASE,
      },
    ]);
  });

  it("reports a listed base internal specifier bundled into dist and ignores its other dist imports", async () => {
    const findings = await listedFindings(
      pluginManifest(COMMUNITY_NAME, [BASE]),
      {
        "dist/index.js": lines([
          'import { hidden } from "fixture-base/internal";',
          'import { root } from "fixture-base";',
          "export { hidden, root };",
        ]),
      },
      ["dist/index.js"],
    );
    expectSites(findings, [
      {
        code: IMPORT_INTERNAL,
        file: "dist/index.js",
        line: 1,
        specifier: `${BASE}/internal`,
        detail: `is an internal entry of ${BASE}`,
      },
    ]);
  });

  it("accepts fixture-base/extension and reports the root in the same file", async () => {
    const findings = await listedFindings(
      pluginManifest(COMMUNITY_NAME, [BASE]),
      {
        "src/index.ts": lines([
          'import { allowed } from "fixture-base/extension";',
          'import { root } from "fixture-base";',
          "export { allowed, root };",
        ]),
      },
      ["src/index.ts"],
    );
    expectSites(findings, [entrySite("src/index.ts", 2, BASE, BASE)]);
  });

  it("treats a scoped base the same", async () => {
    const findings = await listedFindings(
      pluginManifest(COMMUNITY_NAME, [SCOPED_BASE]),
      {
        "src/index.ts": lines([
          'import { allowed } from "@acme/fx-base/extension";',
          'import { root } from "@acme/fx-base";',
          "export { allowed, root };",
        ]),
      },
      ["src/index.ts"],
    );
    expectSites(findings, [entrySite("src/index.ts", 2, SCOPED_BASE, SCOPED_BASE)]);
  });

  it("does not take fixture-base-extra for the listed base", async () => {
    const findings = await listedFindings(
      pluginManifest(COMMUNITY_NAME, [BASE]),
      {
        "src/index.ts": lines([
          'import { extra } from "fixture-base-extra/extension";',
          'import { marker } from "fixture-base";',
          "export { extra, marker };",
        ]),
      },
      ["src/index.ts"],
      ["fixture-base-extra"],
    );
    expectSites(findings, [
      {
        code: IMPORT_FOREIGN,
        file: "src/index.ts",
        line: 1,
        specifier: "fixture-base-extra/extension",
        detail: "another plugin package",
      },
      entrySite("src/index.ts", 2, BASE, BASE),
    ]);
  });

  it("without gwen.extends the same imports stay IMPORT_FOREIGN_PLUGIN", async () => {
    const source = {
      "src/index.ts": lines(['import { marker } from "fixture-base";', "export { marker };"]),
    };
    const declared = await listedFindings(
      pluginManifest(COMMUNITY_NAME, [BASE]),
      source,
      ["src/index.ts"],
      [BASE],
    );
    const undeclared = await listedFindings(
      { name: COMMUNITY_NAME, gwen: { type: "plugin" } },
      source,
      ["src/index.ts"],
      [BASE],
    );
    expectSites(declared, [entrySite("src/index.ts", 1, BASE, BASE)]);
    expectSites(undeclared, [
      {
        code: IMPORT_FOREIGN,
        file: "src/index.ts",
        line: 1,
        specifier: BASE,
        detail: "another plugin package",
      },
    ]);
  });

  it("an official package keeps IMPORT_FOREIGN_PLUGIN for a listed base", async () => {
    const source = {
      "src/a.ts": lines(['import { shot } from "@gwenjs/camera2d/other";', "export { shot };"]),
    };
    const community = await listedFindings(pluginManifest(COMMUNITY_NAME, [CAMERA]), source, [
      "src/a.ts",
    ]);
    const official = await listedFindings(pluginManifest(RENAMED_OFFICIAL, [CAMERA]), source, [
      "src/a.ts",
    ]);
    expectSites(community, [entrySite("src/a.ts", 1, `${CAMERA}/other`, CAMERA)]);
    expectSites(official, [
      {
        code: IMPORT_FOREIGN,
        file: "src/a.ts",
        line: 1,
        specifier: `${CAMERA}/other`,
        detail: "another plugin package",
      },
    ]);
  });

  it("accepts the root and testing of a listed base in test files only", async () => {
    const findings = await listedFindings(
      pluginManifest(COMMUNITY_NAME, [BASE]),
      {
        "src/app.ts": lines([
          'import { root } from "fixture-base";',
          'import { testing } from "fixture-base/testing";',
          "export { root, testing };",
        ]),
        "tests/a.test.ts": lines([
          'import { root } from "fixture-base";',
          'import { testing } from "fixture-base/testing";',
          'import { extension } from "fixture-base/extension";',
          'import { fromModule } from "fixture-base/module";',
          'import { fromOther } from "fixture-base/other";',
          'import { fromSub } from "fixture-base/extension/sub";',
          'import { fromFile } from "fixture-base/extension.js";',
          'import { fromInternal } from "fixture-base/internal";',
          'import { fromWasm } from "fixture-base/wasm";',
          'import { fromDist } from "fixture-base/dist/extension.js";',
          'import { fromSrc } from "fixture-base/src/extension.ts";',
          "export {",
          "  root,",
          "  testing,",
          "  extension,",
          "  fromModule,",
          "  fromOther,",
          "  fromSub,",
          "  fromFile,",
          "  fromInternal,",
          "  fromWasm,",
          "  fromDist,",
          "  fromSrc,",
          "};",
        ]),
      },
      ["src/app.ts", "tests/a.test.ts"],
    );
    expectSites(findings, [
      entrySite("src/app.ts", 1, BASE, BASE),
      entrySite("src/app.ts", 2, `${BASE}/testing`, BASE),
      entrySite("tests/a.test.ts", 4, `${BASE}/module`, BASE),
      entrySite("tests/a.test.ts", 5, `${BASE}/other`, BASE),
      entrySite("tests/a.test.ts", 6, `${BASE}/extension/sub`, BASE),
      entrySite("tests/a.test.ts", 7, `${BASE}/extension.js`, BASE),
      {
        code: IMPORT_INTERNAL,
        file: "tests/a.test.ts",
        line: 8,
        specifier: `${BASE}/internal`,
        detail: `is an internal entry of ${BASE}`,
      },
      {
        code: IMPORT_INTERNAL,
        file: "tests/a.test.ts",
        line: 9,
        specifier: `${BASE}/wasm`,
        detail: `is an internal entry of ${BASE}`,
      },
      {
        code: IMPORT_DEEP,
        file: "tests/a.test.ts",
        line: 10,
        specifier: `${BASE}/dist/extension.js`,
        detail: BASE,
      },
      {
        code: IMPORT_DEEP,
        file: "tests/a.test.ts",
        line: 11,
        specifier: `${BASE}/src/extension.ts`,
        detail: BASE,
      },
    ]);
  });
});

const PEER = "CONFORMANCE:EXTENSION_PEER";
const UNUSED = "CONFORMANCE:PEER_UNUSED";

/** Same sentences as `unusedFindings` (src/check-peers.ts:131-132). */
function unusedMessage(base: string): string {
  return `peer ${JSON.stringify(base)} is declared but src never uses it`;
}

function unusedHint(base: string): string {
  return `Remove ${JSON.stringify(base)} from peerDependencies, or import it from src.`;
}

function absentPeerMessage(base: string): string {
  return `base ${JSON.stringify(base)} is listed in gwen.extends but not in peerDependencies`;
}

function sectionMessage(base: string, section: "dependencies" | "optionalDependencies"): string {
  return `base ${JSON.stringify(base)} is declared in ${section}, not in peerDependencies`;
}

function unusableRangeMessage(base: string, range: string): string {
  return `peer ${JSON.stringify(base)} has range ${JSON.stringify(range)}, which is not a usable semver range`;
}

function pinAbsentMessage(base: string): string {
  return `base ${JSON.stringify(base)} has no exact devDependency pin`;
}

function pinMessage(base: string, pin: string, range: string): string {
  return `devDependency ${JSON.stringify(base)} is ${JSON.stringify(pin)}, not an exact version inside the peer range ${JSON.stringify(range)}`;
}

interface PeerShape {
  readonly code: string;
  readonly file: string | undefined;
  readonly line: number | undefined;
  readonly message: string;
}

function peerShape(finding: ConformanceFinding): PeerShape {
  const code: string = finding.code;
  return { code, file: finding.file, line: finding.line, message: finding.message };
}

function sortShapes(shapes: readonly PeerShape[]): PeerShape[] {
  return [...shapes].sort((left, right) => {
    if (left.message < right.message) return -1;
    if (left.message > right.message) return 1;
    return 0;
  });
}

function sortedShapes(findings: readonly ConformanceFinding[]): PeerShape[] {
  return sortShapes(findings.map(peerShape));
}

function named(findings: readonly ConformanceFinding[], base: string): ConformanceFinding[] {
  const quoted = JSON.stringify(base);
  return findings.filter((finding) => finding.message.includes(quoted));
}

function expectPeerAt(
  findings: readonly ConformanceFinding[],
  message: string,
  line: number,
): void {
  const matches = findings.filter((finding) => finding.message === message);
  expect(matches.map(peerShape)).toEqual([{ code: PEER, file: "package.json", line, message }]);
  const finding = matches[0];
  if (finding === undefined) {
    throw new Error(`expected one finding: ${message}`);
  }
  expect(finding.hint.length).toBeGreaterThan(0);
}

function expectHints(findings: readonly ConformanceFinding[]): void {
  for (const finding of findings) expect(finding.hint.length).toBeGreaterThan(0);
}

async function manifestKeyLine(root: string, section: string, name: string): Promise<number> {
  const text = await readFile(path.join(root, "package.json"), "utf8");
  const line = indexJson(text).keyLine([section, name]);
  if (line === undefined) {
    throw new Error(`package.json has no key line for ${section}/${name}`);
  }
  return line;
}

function positionOf(bases: readonly string[], name: string): number {
  const index = bases.indexOf(name);
  if (index < 0) throw new Error(`base ${name} is not listed`);
  return index;
}

/** Community plugin whose `gwen.extends` lists `bases`, plus the dependency fields. */
function listedPeers(
  bases: readonly string[],
  peerDependencies: Readonly<Record<string, string>>,
  devDependencies: Readonly<Record<string, string>>,
  extra: ExtensionManifest = {},
): ExtensionManifest {
  return {
    ...pluginManifest(COMMUNITY_NAME, [...bases]),
    ...extra,
    peerDependencies,
    devDependencies,
  };
}

function extensionSource(base: string): string {
  return `import { marker } from ${JSON.stringify(`${base}/extension`)};\nexport { marker };\n`;
}

async function readFixtureManifest(name: string): Promise<ExtensionManifest> {
  const text = await readFile(path.join(extensionFixtureRoot(name), "package.json"), "utf8");
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${name} package.json is not an object`);
  }
  const manifest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed)) manifest[key] = value;
  return manifest;
}

function withPeerRange(
  manifest: ExtensionManifest,
  base: string,
  range: string,
): ExtensionManifest {
  const peers = manifest.peerDependencies;
  if (typeof peers !== "object" || peers === null || Array.isArray(peers)) {
    throw new Error("peerDependencies is not an object");
  }
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(peers)) next[key] = value;
  next[base] = range;
  return { ...manifest, peerDependencies: next };
}

describe("EXTENSION_PEER", () => {
  it("missing-peer reports EXTENSION_PEER when the base is only in devDependencies", async () => {
    const root = extensionFixtureRoot("missing-peer");
    const findings = await extensionFindings(root, PEER);
    expectPeerAt(findings, absentPeerMessage(BASE), await extendsElementLine(root, 0));
    expect(findings).toHaveLength(1);
  });

  it('star-peer reports EXTENSION_PEER for the peer range "*"', async () => {
    const root = extensionFixtureRoot("star-peer");
    const findings = await extensionFindings(root, PEER);
    expectPeerAt(
      findings,
      unusableRangeMessage(BASE, "*"),
      await manifestKeyLine(root, "peerDependencies", BASE),
    );
    expect(findings).toHaveLength(1);
  });

  it("base-in-dependencies reports EXTENSION_PEER", async () => {
    const root = extensionFixtureRoot("base-in-dependencies");
    const findings = await extensionFindings(root, PEER);
    expectPeerAt(
      findings,
      sectionMessage(BASE, "dependencies"),
      await manifestKeyLine(root, "dependencies", BASE),
    );
    expect(findings).toHaveLength(1);
    const optional = await open(
      listedPeers(
        [BASE],
        { [BASE]: "^1.0.0" },
        { [BASE]: "1.0.0" },
        { optionalDependencies: { [BASE]: "^1.0.0" } },
      ),
      { "src/index.ts": extensionSource(BASE) },
    );
    const optionalFindings = await optional.checkOf(PEER);
    expectPeerAt(
      optionalFindings,
      sectionMessage(BASE, "optionalDependencies"),
      await manifestKeyLine(optional.root, "optionalDependencies", BASE),
    );
    expect(optionalFindings).toHaveLength(1);
  });

  it("reports each unusable peer range", async () => {
    const rejected: readonly { readonly name: string; readonly range: string }[] = [
      { name: "base-star", range: "*" },
      { name: "base-x", range: "x" },
      { name: "base-capital-x", range: "X" },
      { name: "base-latest", range: "latest" },
      { name: "base-empty", range: "" },
      { name: "base-workspace", range: "workspace:^" },
      { name: "base-file", range: "file:../b" },
      { name: "base-link", range: "link:../b" },
      { name: "base-caret", range: "^^1" },
      { name: "base-any", range: ">=0.0.0" },
      { name: "base-triple-x", range: "x.x.x" },
    ];
    const accepted: readonly {
      readonly name: string;
      readonly range: string;
      readonly pin: string;
    }[] = [
      { name: "base-ok-caret", range: "^1.0.0", pin: "1.0.0" },
      { name: "base-ok-tilde", range: "~1.2.0", pin: "1.2.0" },
      { name: "base-ok-span", range: ">=1.0.0 <2.0.0", pin: "1.5.0" },
      { name: "base-ok-minor", range: "1.x", pin: "1.2.3" },
    ];
    const peers: Record<string, string> = {};
    const pins: Record<string, string> = {};
    for (const row of rejected) peers[row.name] = row.range;
    for (const row of accepted) {
      peers[row.name] = row.range;
      pins[row.name] = row.pin;
    }
    const bases = [...rejected.map((row) => row.name), ...accepted.map((row) => row.name)];
    const fixture = await open(listedPeers(bases, peers, pins));
    const findings = await fixture.checkOf(PEER);
    const expected: PeerShape[] = [];
    for (const row of rejected) {
      expected.push({
        code: PEER,
        file: "package.json",
        line: await manifestKeyLine(fixture.root, "peerDependencies", row.name),
        message: unusableRangeMessage(row.name, row.range),
      });
    }
    expect(sortedShapes(findings)).toEqual(sortShapes(expected));
    expectHints(findings);
  });

  it("reports a devDependency pin that is missing, a range, or outside the peer range", async () => {
    const noPin = "base-no-pin";
    const rangePin = "base-range-pin";
    const lowPin = "base-low-pin";
    const bases = [noPin, rangePin, lowPin];
    const fixture = await open(
      listedPeers(
        bases,
        { [noPin]: "^1.0.0", [rangePin]: "^1.0.0", [lowPin]: "^1.0.0" },
        { [rangePin]: "^1.0.0", [lowPin]: "0.9.0" },
      ),
    );
    const findings = await fixture.checkOf(PEER);
    expect(sortedShapes(findings)).toEqual(
      sortShapes([
        {
          code: PEER,
          file: "package.json",
          line: await extendsElementLine(fixture.root, positionOf(bases, noPin)),
          message: pinAbsentMessage(noPin),
        },
        {
          code: PEER,
          file: "package.json",
          line: await manifestKeyLine(fixture.root, "devDependencies", rangePin),
          message: pinMessage(rangePin, "^1.0.0", "^1.0.0"),
        },
        {
          code: PEER,
          file: "package.json",
          line: await manifestKeyLine(fixture.root, "devDependencies", lowPin),
          message: pinMessage(lowPin, "0.9.0", "^1.0.0"),
        },
      ]),
    );
    expectHints(findings);
  });

  it("accepts an exact pin inside the range, a stamp and a build pin", async () => {
    const exact = "base-exact";
    const stamp = "base-stamp";
    const build = "base-build";
    const alpha = "base-alpha";
    const high = "base-high";
    const rcMinor = "base-rc-minor";
    const stampMinor = "base-stamp-minor";
    const stampPin = "1.0.0-integration.20261123120000.gabc1234";
    const stampMinorPin = "1.2.0-integration.20261123120000.gabc1234";
    const fixture = await open(
      listedPeers(
        [exact, stamp, build, alpha, high, rcMinor, stampMinor],
        {
          [exact]: "^1.0.0",
          [stamp]: "^1.0.0-alpha.0",
          [build]: "^1.0.0",
          [alpha]: "^1.0.0-alpha.0",
          [high]: "^1.0.0",
          [rcMinor]: "^1.0.0-alpha.0",
          [stampMinor]: "^1.0.0",
        },
        {
          [exact]: "1.0.0",
          [stamp]: stampPin,
          [build]: "1.0.0+build.5",
          [alpha]: "1.0.0-alpha.0",
          [high]: "2.0.0",
          [rcMinor]: "1.1.0-rc.1",
          [stampMinor]: stampMinorPin,
        },
      ),
    );
    const findings = await fixture.checkOf(PEER);
    expectPeerAt(
      named(findings, high),
      pinMessage(high, "2.0.0", "^1.0.0"),
      await manifestKeyLine(fixture.root, "devDependencies", high),
    );
    expect(named(findings, exact)).toEqual([]);
    expect(named(findings, stamp)).toEqual([]);
    expect(named(findings, build)).toEqual([]);
    expect(named(findings, alpha)).toEqual([]);
    expect(named(findings, rcMinor)).toEqual([]);
    expect(named(findings, stampMinor)).toEqual([]);
    expect(findings).toHaveLength(1);
  });

  it("reports each base once per problem", async () => {
    const good = "base-good";
    const bad = "base-bad";
    const fixture = await open(
      listedPeers(
        [good, bad],
        { [good]: "^1.0.0", [bad]: "^1.0.0" },
        { [good]: "1.0.0", [bad]: "2.0.0" },
        { dependencies: { [bad]: "^1.0.0" } },
      ),
    );
    const findings = await fixture.checkOf(PEER);
    expect(named(findings, good)).toEqual([]);
    expect(sortedShapes(named(findings, bad))).toEqual(
      sortShapes([
        {
          code: PEER,
          file: "package.json",
          line: await manifestKeyLine(fixture.root, "dependencies", bad),
          message: sectionMessage(bad, "dependencies"),
        },
        {
          code: PEER,
          file: "package.json",
          line: await manifestKeyLine(fixture.root, "devDependencies", bad),
          message: pinMessage(bad, "2.0.0", "^1.0.0"),
        },
      ]),
    );
    expectHints(named(findings, bad));
    expect(findings).toHaveLength(2);
  });

  it("reports nothing when gwen.extends is absent or empty", async () => {
    const absent = await open({ name: COMMUNITY_NAME, gwen: { type: "plugin" } });
    const empty = await open(pluginManifest(COMMUNITY_NAME, []));
    expect(await absent.checkOf(PEER)).toEqual([]);
    expect(await empty.checkOf(PEER)).toEqual([]);
    const sibling = await open(pluginManifest(COMMUNITY_NAME, [BASE]));
    const findings = await sibling.checkOf(PEER);
    expectPeerAt(findings, absentPeerMessage(BASE), await extendsElementLine(sibling.root, 0));
    expect(findings).toHaveLength(1);
  });

  it("layered-ok reports nothing and its mutated twin reports EXTENSION_PEER", async () => {
    const root = extensionFixtureRoot("layered-ok");
    expect(await extensionFindings(root, PEER)).toEqual([]);
    const source = await readFile(path.join(root, "src/index.ts"), "utf8");
    const twin = await open(withPeerRange(await readFixtureManifest("layered-ok"), BASE, "*"), {
      "src/index.ts": source,
    });
    const findings = await twin.checkOf(PEER);
    expectPeerAt(
      findings,
      unusableRangeMessage(BASE, "*"),
      await manifestKeyLine(twin.root, "peerDependencies", BASE),
    );
    expect(findings).toHaveLength(1);
  });

  it("runs for the package profile and with a malformed block", async () => {
    const fixture = await open({
      name: COMMUNITY_NAME,
      gwen: { type: "plugin", extends: [BASE] },
      peerDependencies: [],
      devDependencies: "x",
    });
    const report = await checkPluginPackage({ root: fixture.root, profile: "package" });
    expect(report.checks).toContain("peers");
    const findings = report.findings.filter((finding) => {
      const code: string = finding.code;
      return code === PEER;
    });
    expectPeerAt(findings, absentPeerMessage(BASE), await extendsElementLine(fixture.root, 0));
    expect(findings).toHaveLength(1);
  });

  it("reports a base peer that src never imports", async () => {
    // A subpath counts as its package (src/imported-packages.ts:16-28).
    // A `*.test.*` file is a test file and is not a use (src/source-files.ts:65-74,
    // src/imported-packages.ts:66-67). `<base>/extension` in a non-test file of src is a use.
    const valid = listedPeers([BASE], { [BASE]: "^1.0.0" }, { [BASE]: "1.0.0" });
    const idle = await open(valid, { "src/index.ts": "export const marker = 1;\n" });
    const used = await open(valid, { "src/index.ts": extensionSource(BASE) });
    const testsOnly = await open(valid, {
      "src/index.ts": "export const marker = 1;\n",
      "src/base.test.ts": extensionSource(BASE),
    });
    const idleFindings = await idle.checkOf(UNUSED);
    const usedFindings = await used.checkOf(UNUSED);
    const testFindings = await testsOnly.checkOf(UNUSED);
    expectUnused(idleFindings, await manifestKeyLine(idle.root, "peerDependencies", BASE));
    expectUnused(testFindings, await manifestKeyLine(testsOnly.root, "peerDependencies", BASE));
    expect(usedFindings).toEqual([]);
  });
});

function expectUnused(findings: readonly ConformanceFinding[], line: number): void {
  expect(
    findings.map((finding) => {
      const code: string = finding.code;
      return {
        code,
        file: finding.file,
        line: finding.line,
        message: finding.message,
        hint: finding.hint,
      };
    }),
  ).toEqual([
    {
      code: UNUSED,
      file: "package.json",
      line,
      message: unusedMessage(BASE),
      hint: unusedHint(BASE),
    },
  ]);
}

const BASE_NOT = "CONFORMANCE:BASE_NOT_EXTENSIBLE";
const HOOK_INVALID = "CONFORMANCE:HOOK_NAMESPACE_INVALID";
const HOOK_FOREIGN = "CONFORMANCE:HOOK_FOREIGN_NAMESPACE";
const EXTENSION_NAMESPACE = "fixture-ext";
const UNINSTALLED_BASE = "fixture-not-installed";
const STRING_BASE = "fixture-string";
const RENAMED_BASE = "other-base";

function noExtensionMessage(base: string): string {
  return `base "${base}" has no "./extension" export`;
}

function noNamespaceMessage(base: string): string {
  return `base "${base}" has no gwen.hookNamespace`;
}

function unresolvedMessage(base: string): string {
  return `base "${base}" cannot be resolved from node_modules`;
}

function unparsedMessage(base: string): string {
  return `base "${base}" has a package.json that cannot be parsed`;
}

function sharedNamespaceMessage(namespace: string, base: string): string {
  return `gwen.hookNamespace "${namespace}" is the hookNamespace of base "${base}"`;
}

function baseShape(finding: ConformanceFinding): {
  code: string;
  file: string;
  line: number;
  message: string;
} {
  const code: string = finding.code;
  const file = finding.file;
  const line = finding.line;
  if (file === undefined || line === undefined) {
    throw new Error("finding has no file or line");
  }
  return { code, file, line, message: finding.message };
}

function expectBaseAt(
  findings: readonly ConformanceFinding[],
  message: string,
  line: number,
  code: string = BASE_NOT,
): void {
  expect(findings.map(baseShape)).toEqual([{ code, file: "package.json", line, message }]);
  const finding = findings[0];
  if (finding === undefined) {
    throw new Error(`expected one finding: ${message}`);
  }
  expect(finding.hint.length).toBeGreaterThan(0);
}

async function openCopied(name: string) {
  const manifest = await readFixtureManifest(name);
  const source = await readFile(path.join(extensionFixtureRoot(name), "src/index.ts"), "utf8");
  return open(manifest, { "src/index.ts": source });
}

/** Package nested under a temp root whose `node_modules` holds `fixtureName` as `listed`. */
async function withBaseAbove(listed: string, fixtureName: string): Promise<string> {
  const parent = await open({ name: "fixture-holder", gwen: { type: "plugin" } });
  if (fixtureName === listed) await installBase(parent.root, fixtureName);
  else await installBase(parent.root, fixtureName, listed);
  await writeDeep(
    parent.root,
    "pkg/package.json",
    `${JSON.stringify(pluginManifest(COMMUNITY_NAME, [listed]), null, 2)}\n`,
  );
  return path.join(parent.root, "pkg");
}

function emitInBaseNamespace(): string {
  return [
    "export function tick(bus: { callHook(name: string): void }): void {",
    '  bus.callHook("fixture-base:tick");',
    "}",
    "",
  ].join("\n");
}

function extensionWithNamespace(namespace: string, base: string): ExtensionManifest {
  return {
    name: EXTENSION_NAMESPACE,
    gwen: { type: "plugin", hookNamespace: namespace, extends: [base] },
  };
}

describe("BASE_NOT_EXTENSIBLE", () => {
  it("base-not-extensible reports BASE_NOT_EXTENSIBLE for a base without ./extension", async () => {
    const fixture = await openCopied("base-not-extensible");
    await installBase(fixture.root, "fixture-plain");
    const findings = await fixture.checkOf(BASE_NOT);
    expectBaseAt(
      findings,
      noExtensionMessage("fixture-plain"),
      await extendsElementLine(fixture.root, 0),
    );
  });

  it("reports a base that exports ./extension and has no gwen.hookNamespace", async () => {
    const fixture = await open(pluginManifest(COMMUNITY_NAME, ["fixture-nons"]));
    await installBase(fixture.root, "fixture-nons");
    const findings = await fixture.checkOf(BASE_NOT);
    expectBaseAt(
      findings,
      noNamespaceMessage("fixture-nons"),
      await extendsElementLine(fixture.root, 0),
    );
  });

  it("reports a base that is not installed", async () => {
    const fixture = await open(pluginManifest(COMMUNITY_NAME, [UNINSTALLED_BASE]));
    const findings = await fixture.checkOf(BASE_NOT);
    expectBaseAt(
      findings,
      unresolvedMessage(UNINSTALLED_BASE),
      await extendsElementLine(fixture.root, 0),
    );
  });

  it("reports a base whose package.json cannot be parsed", async () => {
    const base = "fixture-bad-json";
    const fixture = await open(pluginManifest(COMMUNITY_NAME, [base]));
    await writeDeep(fixture.root, `node_modules/${base}/package.json`, "{");
    const findings = await fixture.checkOf(BASE_NOT);
    expectBaseAt(findings, unparsedMessage(base), await extendsElementLine(fixture.root, 0));
  });

  it("accepts ./extension declared as a string or as a condition object", async () => {
    const accepted = await open(pluginManifest(COMMUNITY_NAME, ["fixture-base", STRING_BASE]));
    await installBase(accepted.root, "fixture-base");
    await writeInstalledPackage(accepted.root, STRING_BASE, {
      exports: { "./extension": "./dist/extension.js" },
      gwen: { type: "plugin", hookNamespace: STRING_BASE },
    });
    expect(await accepted.checkOf(BASE_NOT)).toEqual([]);
    const sibling = await open(pluginManifest(COMMUNITY_NAME, ["fixture-plain"]));
    await installBase(sibling.root, "fixture-plain");
    const findings = await sibling.checkOf(BASE_NOT);
    expectBaseAt(
      findings,
      noExtensionMessage("fixture-plain"),
      await extendsElementLine(sibling.root, 0),
    );
  });

  it("reports only the bad base when two are listed", async () => {
    const fixture = await open(pluginManifest(COMMUNITY_NAME, ["fixture-base", "fixture-plain"]));
    await installBase(fixture.root, "fixture-base");
    await installBase(fixture.root, "fixture-plain");
    const findings = await fixture.checkOf(BASE_NOT);
    expect(findings.map((finding) => finding.message)).toEqual([
      noExtensionMessage("fixture-plain"),
    ]);
    expectBaseAt(
      findings,
      noExtensionMessage("fixture-plain"),
      await extendsElementLine(fixture.root, 1),
    );
  });

  it("finds the base installed above the package root", async () => {
    // Ancestor walk: src/check-imports.ts:122-130. The base sits in the parent node_modules.
    const above = await withBaseAbove("fixture-base", "fixture-base");
    expect(await extensionFindings(above, BASE_NOT)).toEqual([]);
    const sibling = await withBaseAbove("fixture-plain", "fixture-plain");
    const findings = await extensionFindings(sibling, BASE_NOT);
    expectBaseAt(
      findings,
      noExtensionMessage("fixture-plain"),
      await extendsElementLine(sibling, 0),
    );
  });

  it("ext-of-ext reports nothing for fixture-top and reports fixture-mid without ./extension", async () => {
    const top = await openCopied("ext-of-ext/fixture-top");
    await installBase(top.root, "fixture-mid");
    expect(await top.checkOf(BASE_NOT)).toEqual([]);
    const twin = await openCopied("ext-of-ext/fixture-top");
    await installBase(twin.root, "fixture-plain", "fixture-mid");
    const findings = await twin.checkOf(BASE_NOT);
    expectBaseAt(
      findings,
      noExtensionMessage("fixture-mid"),
      await extendsElementLine(twin.root, 0),
    );
  });

  it("reports a hookNamespace equal to the hookNamespace of a base", async () => {
    // The namespace finding is package.json line 1 (src/check-hooks.ts:82-89).
    const fixture = await open(extensionWithNamespace("fixture-base", RENAMED_BASE));
    await installBase(fixture.root, "fixture-base", RENAMED_BASE);
    const findings = await fixture.checkOf(HOOK_INVALID);
    expectBaseAt(findings, sharedNamespaceMessage("fixture-base", RENAMED_BASE), 1, HOOK_INVALID);
  });

  it("accepts a different hookNamespace and still flags an emit in the base namespace", async () => {
    // Emit outside the package namespace: src/check-hooks.ts:163-171.
    const different = await open(extensionWithNamespace(EXTENSION_NAMESPACE, "fixture-base"), {
      "src/index.ts": emitInBaseNamespace(),
    });
    await installBase(different.root, "fixture-base");
    expect(await different.checkOf(HOOK_INVALID)).toEqual([]);
    const foreign = await different.checkOf(HOOK_FOREIGN);
    expect(foreign.map(baseShape)).toEqual([
      {
        code: HOOK_FOREIGN,
        file: "src/index.ts",
        line: 2,
        message: `${EXTENSION_NAMESPACE} emits "fixture-base:tick", outside its hook namespace "${EXTENSION_NAMESPACE}"`,
      },
    ]);
    const foreignFinding = foreign[0];
    if (foreignFinding === undefined) {
      throw new Error("expected one HOOK_FOREIGN_NAMESPACE finding");
    }
    expect(foreignFinding.hint.length).toBeGreaterThan(0);
    const sibling = await open(extensionWithNamespace("fixture-base", RENAMED_BASE));
    await installBase(sibling.root, "fixture-base", RENAMED_BASE);
    const findings = await sibling.checkOf(HOOK_INVALID);
    expectBaseAt(findings, sharedNamespaceMessage("fixture-base", RENAMED_BASE), 1, HOOK_INVALID);
  });
});

const NOT_PUBLIC = "CONFORMANCE:IMPORT_NOT_PUBLIC";
const AUGMENT = "CONFORMANCE:AUGMENT_TARGET";
const EXTENSION_SPECIFIER = "fixture-base/extension";
const SCHEMA_TYPES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../schema/dist/index.d.ts",
);
const SERVICE_HINT = 'Pick a service key of your own, for example "<plugin>:<service>".';
const HOOK_KEY_HINT = 'Pick a hook key of your own, for example "<plugin>:<event>".';
const REGISTRY_HINT = "Pick a registry key of your own.";
const NEGATIVE_SURFACE = [
  'import "fixture-base/extension";',
  'import type { GwenProvides } from "@gwenjs/schema";',
  "",
  'export type Bad = GwenProvides["fixture-base:nope"];',
  "",
].join("\n");

function publicHint(specifier: string): string {
  return `Use a name listed in the public API of ${specifier}.`;
}

function notExported(name: string): string {
  return `"${name}" is not exported by "${EXTENSION_SPECIFIER}"`;
}

function schemaMember(interfaceName: string, member: string): string {
  return [
    "export {};",
    'declare module "@gwenjs/schema" {',
    `  interface ${interfaceName} {`,
    `    ${member}`,
    "  }",
    "}",
    "",
  ].join("\n");
}

function augmentMessage(interfaceName: string, key: string): string {
  return `${interfaceName} key "${key}" is already declared by fixture-base`;
}

async function openWithBase(name: string, source: string): Promise<ExtensionFixture> {
  const fixture = await open(await readFixtureManifest(name), { "src/index.ts": source });
  await installBase(fixture.root, "fixture-base");
  return fixture;
}

function expectCodeAt(
  findings: readonly ConformanceFinding[],
  code: string,
  message: string,
  line: number,
  hint?: string,
): void {
  expect(findings.map(baseShape)).toEqual([{ code, file: "src/index.ts", line, message }]);
  const finding = findings[0];
  if (finding === undefined) {
    throw new Error(`expected one finding: ${message}`);
  }
  if (hint === undefined) expect(finding.hint.length).toBeGreaterThan(0);
  else expect(finding.hint).toBe(hint);
}

async function rewriteExtensionTarget(root: string, entry: unknown): Promise<void> {
  const relative = path.join("node_modules", "fixture-base", "package.json");
  const text = await readFile(path.join(root, relative), "utf8");
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("base package.json is not an object");
  }
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed)) next[key] = value;
  const exportsValue = next.exports;
  if (typeof exportsValue !== "object" || exportsValue === null || Array.isArray(exportsValue)) {
    throw new Error("base exports is not an object");
  }
  const exportsNext: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(exportsValue)) exportsNext[key] = value;
  exportsNext["./extension"] = entry;
  next.exports = exportsNext;
  await writeSource(root, relative, `${JSON.stringify(next, null, 2)}\n`);
}

async function extensionTypeDiagnostics(root: string): Promise<readonly ts.Diagnostic[]> {
  const parsed = ts.parseJsonConfigFileContent(
    {
      compilerOptions: {
        strict: true,
        noEmit: true,
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        types: [],
        lib: ["ES2022", "DOM", "DOM.Iterable", "esnext.disposable"],
        skipLibCheck: false,
        paths: { "@gwenjs/schema": [SCHEMA_TYPES] },
      },
      files: [
        path.join(root, "tests/extension-surface.test-d.ts"),
        path.join(root, "src/index.ts"),
      ],
    },
    ts.sys,
    root,
  );
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  return [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
}

describe("IMPORT_NOT_PUBLIC from ./extension", () => {
  it("not-extension-point reports IMPORT_NOT_PUBLIC for a name the base does not export from ./extension", async () => {
    const fixture = await openCopied("not-extension-point");
    await installBase(fixture.root, "fixture-base");
    const findings = await fixture.checkOf(NOT_PUBLIC);
    expectCodeAt(findings, NOT_PUBLIC, notExported("nope"), 1, publicHint(EXTENSION_SPECIFIER));
  });

  it("not-extension-point accepts a type and a value exported by ./extension", async () => {
    const accepted = await openWithBase(
      "not-extension-point",
      [
        'import { marker } from "fixture-base/extension";',
        'import type { Marker } from "fixture-base/extension";',
        "export { marker };",
        "export type { Marker };",
        "",
      ].join("\n"),
    );
    expect(await accepted.checkOf(NOT_PUBLIC)).toEqual([]);
    const sibling = await openCopied("not-extension-point");
    await installBase(sibling.root, "fixture-base");
    const findings = await sibling.checkOf(NOT_PUBLIC);
    expectCodeAt(findings, NOT_PUBLIC, notExported("nope"), 1, publicHint(EXTENSION_SPECIFIER));
  });

  it("reports IMPORT_NOT_PUBLIC for a default import of ./extension", async () => {
    const imported = await openWithBase(
      "not-extension-point",
      'import base from "fixture-base/extension";\n',
    );
    const findings = await imported.checkOf(NOT_PUBLIC);
    expectCodeAt(
      findings,
      NOT_PUBLIC,
      `"${EXTENSION_SPECIFIER}" has no default export`,
      1,
      publicHint(EXTENSION_SPECIFIER),
    );
    const sibling = await openWithBase("not-extension-point", extensionSource("fixture-base"));
    expect(await sibling.checkOf(NOT_PUBLIC)).toEqual([]);
  });

  it("reports IMPORT_NOT_PUBLIC for a property read on a namespace import of ./extension", async () => {
    const imported = await openWithBase(
      "not-extension-point",
      ['import * as ns from "fixture-base/extension";', "export const bad = ns.nope;", ""].join(
        "\n",
      ),
    );
    const findings = await imported.checkOf(NOT_PUBLIC);
    expectCodeAt(findings, NOT_PUBLIC, notExported("nope"), 2, publicHint(EXTENSION_SPECIFIER));
    const sibling = await openWithBase(
      "not-extension-point",
      ['import * as ns from "fixture-base/extension";', "export const fine = ns.marker;", ""].join(
        "\n",
      ),
    );
    expect(await sibling.checkOf(NOT_PUBLIC)).toEqual([]);
  });

  it("reports IMPORT_NOT_PUBLIC when the base ./extension types file is not built", async () => {
    const fixture = await openWithBase("not-extension-point", extensionSource("fixture-base"));
    await rm(path.join(fixture.root, "node_modules", "fixture-base", "dist", "extension.d.ts"));
    const findings = await fixture.checkOf(NOT_PUBLIC);
    expectCodeAt(
      findings,
      NOT_PUBLIC,
      `"${EXTENSION_SPECIFIER}" declares "./dist/extension.d.ts", which is not built`,
      1,
    );
  });

  it("reports IMPORT_NOT_PUBLIC when ./extension declares no types or import file", async () => {
    const fixture = await openWithBase("not-extension-point", extensionSource("fixture-base"));
    await rewriteExtensionTarget(fixture.root, { default: "./dist/extension.js" });
    const findings = await fixture.checkOf(NOT_PUBLIC);
    expectCodeAt(
      findings,
      NOT_PUBLIC,
      `"${EXTENSION_SPECIFIER}" declares no types or import file`,
      1,
    );
  });
});

describe("AUGMENT_TARGET against a base", () => {
  it('redeclares-base-key reports AUGMENT_TARGET for GwenProvides["fixture-base:extension"]', async () => {
    const fixture = await openWithBase(
      "redeclares-base-key",
      schemaMember("GwenProvides", '"fixture-base:extension": { readonly marker: 1 };'),
    );
    const findings = await fixture.checkOf(AUGMENT);
    expectCodeAt(
      findings,
      AUGMENT,
      augmentMessage("GwenProvides", "fixture-base:extension"),
      4,
      SERVICE_HINT,
    );
  });

  it('redeclares-base-key reports AUGMENT_TARGET for GwenRuntimeHooks["fixture-base:ready"]', async () => {
    const fixture = await openWithBase(
      "redeclares-base-key",
      schemaMember("GwenRuntimeHooks", '"fixture-base:ready": () => void;'),
    );
    const findings = await fixture.checkOf(AUGMENT);
    expectCodeAt(
      findings,
      AUGMENT,
      augmentMessage("GwenRuntimeHooks", "fixture-base:ready"),
      4,
      HOOK_KEY_HINT,
    );
  });

  it('redeclares-base-key reports AUGMENT_TARGET for GwenPluginRegistry["fixture-base"]', async () => {
    const fixture = await openWithBase(
      "redeclares-base-key",
      schemaMember(
        "GwenPluginRegistry",
        '"fixture-base": { readonly extensionApi: { readonly major: 1; readonly minor: 0 } };',
      ),
    );
    const findings = await fixture.checkOf(AUGMENT);
    expectCodeAt(
      findings,
      AUGMENT,
      augmentMessage("GwenPluginRegistry", "fixture-base"),
      4,
      REGISTRY_HINT,
    );
  });

  it("redeclares-base-key reports nothing for a key of its own", async () => {
    const fixture = await openCopied("redeclares-base-key");
    await installBase(fixture.root, "fixture-base");
    expect(await fixture.checkOf(AUGMENT)).toEqual([]);
    const sibling = await openWithBase(
      "redeclares-base-key",
      schemaMember("GwenProvides", '"fixture-base:extension": { readonly marker: 1 };'),
    );
    const findings = await sibling.checkOf(AUGMENT);
    expectCodeAt(
      findings,
      AUGMENT,
      augmentMessage("GwenProvides", "fixture-base:extension"),
      4,
      SERVICE_HINT,
    );
  });
});

describe("layered-ok extension surface", () => {
  it("layered-ok runs every check and reports nothing", { timeout: SLOW_TEST_MS * 2 }, async () => {
    const root = await copyExtensionPackage("layered-ok");
    await installBase(root, "fixture-base");
    expect((await checkPluginPackage({ root, profile: "plugin" })).findings).toEqual([]);
    const sibling = await copyExtensionPackage("layered-ok");
    await installBase(sibling, "fixture-base");
    await writeSource(
      sibling,
      "src/index.ts",
      'import { nope } from "fixture-base/extension";\nexport { nope };\n',
    );
    const findings = await extensionFindings(sibling, NOT_PUBLIC);
    expectCodeAt(findings, NOT_PUBLIC, notExported("nope"), 1, publicHint(EXTENSION_SPECIFIER));
  });

  it(
    "layered-ok types see the base registry, service and hooks through ./extension only",
    { timeout: SLOW_TEST_MS * 2 },
    async () => {
      const root = await copyExtensionPackage("layered-ok");
      try {
        await installBase(root, "fixture-base");
        const diagnostics = await extensionTypeDiagnostics(root);
        expect(diagnostics).toEqual([]);
        await writeSource(root, "tests/extension-surface.test-d.ts", NEGATIVE_SURFACE);
        const negative = await extensionTypeDiagnostics(root);
        expect(negative).toHaveLength(1);
        const diagnostic = negative[0];
        if (diagnostic === undefined) {
          throw new Error("expected one diagnostic");
        }
        expect(diagnostic.code).toBe(2339);
        expect(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")).toBe(
          "Property 'fixture-base:nope' does not exist on type 'GwenProvides'.",
        );
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );
});
