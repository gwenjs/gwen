import { describe, expect, it } from "vitest";
import { checkPluginPackage } from "@gwenjs/plugin-conformance";
import type { ConformanceFinding, ConformanceReport } from "@gwenjs/plugin-conformance";
import { openPeersFixture } from "./helpers/peers.js";
import type { PeersManifest } from "./helpers/peers.js";

const open = openPeersFixture();

const MANIFEST: string = "CONFORMANCE:MANIFEST";

/**
 * The fixture is written as `{` (1), `name` (2), `license` (3), `"gwen": {` (4), then the
 * members of `gwen` one per line, and every array element on its own line. The expected lines
 * of each test are counted by hand from that layout.
 */
function manifestOf(gwen: unknown): PeersManifest {
  return { name: "fixture-plugin", license: "MIT", gwen };
}

/** The `MANIFEST` findings about `gwen.provides` or `gwen.requires`, in report order. */
function gwenFieldFindings(report: ConformanceReport): ConformanceFinding[] {
  return report.findings.filter(
    (finding) =>
      finding.code === MANIFEST &&
      (finding.message.startsWith("gwen.provides") || finding.message.startsWith("gwen.requires")),
  );
}

async function checkField(
  gwen: unknown,
  profile: "plugin" | "package" = "plugin",
): Promise<ConformanceFinding[]> {
  const fixture = await open(manifestOf(gwen));
  return gwenFieldFindings(await checkPluginPackage({ root: fixture.root, profile }));
}

describe("gwen field shape", () => {
  it("reports gwen.provides that is not an array", async () => {
    const findings = await checkField({ type: "plugin", provides: "audio" });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      code: MANIFEST,
      message: "gwen.provides must be an array of service keys",
      file: "package.json",
      line: 6,
    });
    expect(findings[0]?.hint).not.toBe("");
  });

  it("reports a gwen.provides entry that is not a non-empty string", async () => {
    const findings = await checkField({ type: "plugin", provides: ["audio", "", 3] });
    expect(findings.map((finding) => [finding.message, finding.line])).toEqual([
      ["gwen.provides[1] must be a non-empty string", 8],
      ["gwen.provides[2] must be a non-empty string", 9],
    ]);
    expect(findings.every((finding) => finding.file === "package.json")).toBe(true);
  });

  it("reports a service listed twice in gwen.provides", async () => {
    const findings = await checkField({ type: "plugin", provides: ["audio", "audio"] });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      code: MANIFEST,
      message: 'gwen.provides lists "audio" twice',
      file: "package.json",
      line: 8,
    });
  });

  it("reports a gwen.requires that is not an object", async () => {
    const findings = await checkField({ type: "plugin", requires: [] });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      code: MANIFEST,
      message: "gwen.requires must be an object",
      file: "package.json",
      line: 6,
    });
  });

  it("reports an unknown key of gwen.requires", async () => {
    const findings = await checkField({ type: "plugin", requires: { optionalServices: [] } });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      code: MANIFEST,
      message: 'gwen.requires has the unknown key "optionalServices"',
      hint: "Use plugins, services or optional.",
      file: "package.json",
      line: 7,
    });
  });

  it("reports a gwen.requires list that is not an array of non-empty names", async () => {
    const findings = await checkField({
      type: "plugin",
      requires: { services: "x", plugins: [1], optional: ["a", "a"] },
    });
    expect(findings.map((finding) => [finding.message, finding.line])).toEqual([
      ["gwen.requires.services must be an array of names", 7],
      ["gwen.requires.plugins[0] must be a non-empty string", 9],
      ['gwen.requires.optional lists "a" twice', 13],
    ]);
  });

  it("accepts empty gwen.provides and gwen.requires lists", async () => {
    const findings = await checkField({
      type: "plugin",
      provides: [],
      requires: { plugins: [], services: [], optional: [1] },
    });
    expect(findings.map((finding) => [finding.message, finding.line])).toEqual([
      ["gwen.requires.optional[0] must be a non-empty string", 11],
    ]);
  });

  it("ignores unknown keys directly under gwen", async () => {
    const fixture = await open(
      manifestOf({ type: "plugin", starter: true, future: 1, provides: "x" }),
    );
    const report = await checkPluginPackage({ root: fixture.root, profile: "plugin" });
    const findings = gwenFieldFindings(report);
    expect(findings.map((finding) => [finding.message, finding.line])).toEqual([
      ["gwen.provides must be an array of service keys", 8],
    ]);
    const text = report.findings.map((finding) => `${finding.message} ${finding.hint}`).join("\n");
    expect(text).not.toContain("starter");
    expect(text).not.toContain("future");
  });

  it("reports a malformed gwen field for the package profile", async () => {
    const findings = await checkField({ provides: "x" }, "package");
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      code: MANIFEST,
      message: "gwen.provides must be an array of service keys",
      file: "package.json",
      line: 5,
    });
  });
});
