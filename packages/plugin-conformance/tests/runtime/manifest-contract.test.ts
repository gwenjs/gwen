import path from "node:path";
import { describe, expect, it } from "vitest";
import { ConformanceErrorCodes } from "@gwenjs/plugin-conformance";
import type { ConformanceFinding } from "@gwenjs/plugin-conformance";
import { runPluginConformance } from "@gwenjs/plugin-conformance/runtime";
import type { RuntimeConformanceReport } from "@gwenjs/plugin-conformance/runtime";
import { withPrivateTmpdir } from "../helpers/fixture.js";
import { findingsWithCode, ranChecks, spec, writePluginPackage } from "../helpers/runtime.js";

/** One plain-object plugin factory written to `dist/index.js`. */
interface PluginDef {
  readonly exportName: string;
  readonly provides?: readonly string[];
  readonly requires?: unknown;
}

/**
 * A factory that returns a plain plugin.
 * `setup` provides each key of `provides`, so the provides check stays clean.
 */
function pluginSource(def: PluginDef): string {
  const provided = def.provides ?? [];
  const parts = [`name: ${JSON.stringify(def.exportName)}`];
  if (def.provides !== undefined) parts.push(`provides: ${JSON.stringify(def.provides)}`);
  if (def.requires !== undefined) parts.push(`requires: ${JSON.stringify(def.requires)}`);
  parts.push(
    `setup(engine) { for (const key of ${JSON.stringify(provided)}) engine.provide(key, {}); }`,
  );
  return `export function ${def.exportName}() {\n  return { ${parts.join(", ")} };\n}\n`;
}

const THROWING_SOURCE = 'export function Bad() {\n  throw new Error("boom");\n}\n';

/** Write the package at `dir` with `gwen`, then run the runtime conformance on every factory. */
async function runPackage(
  dir: string,
  packageName: string,
  source: string,
  gwen: unknown,
  factories: readonly string[],
): Promise<RuntimeConformanceReport> {
  await writePluginPackage(dir, { name: packageName, gwen, files: { "dist/index.js": source } });
  return runPluginConformance(
    spec({
      root: dir,
      packageName,
      factories: factories.map((factory) => ({ export: factory })),
    }),
  );
}

function manifestFindings(report: RuntimeConformanceReport): ConformanceFinding[] {
  return findingsWithCode(report, ConformanceErrorCodes.MANIFEST);
}

describe("runPluginConformance manifest contract", () => {
  it("reports a provided service that gwen.provides omits", async () => {
    await withPrivateTmpdir(async (dir) => {
      const report = await runPackage(
        dir,
        "@fixture/omits-provides",
        pluginSource({ exportName: "Plugin", provides: ["fixture:svc"] }),
        { type: "plugin" },
        ["Plugin"],
      );
      expect(manifestFindings(report)).toEqual([
        {
          code: ConformanceErrorCodes.MANIFEST,
          message: 'gwen.provides [] differs from the provides of the plugins ["fixture:svc"]',
          hint: 'Set gwen.provides in package.json to ["fixture:svc"].',
          file: "package.json",
          line: 10,
        },
      ]);
      expect(report.checks).toEqual(ranChecks({ manifestContract: true }));
    });
  });

  it("reports a gwen.provides key that no plugin provides", async () => {
    await withPrivateTmpdir(async (dir) => {
      const report = await runPackage(
        dir,
        "@fixture/extra-provides",
        pluginSource({ exportName: "Plugin", provides: ["fixture:svc"] }),
        { type: "plugin", provides: ["fixture:svc", "other"] },
        ["Plugin"],
      );
      const findings = manifestFindings(report);
      expect(findings.map((finding) => finding.message)).toEqual([
        'gwen.provides ["fixture:svc","other"] differs from the provides of the plugins ["fixture:svc"]',
      ]);
      expect(findings[0]?.hint).toBe('Set gwen.provides in package.json to ["fixture:svc"].');
    });
  });

  it("reports gwen.requires.services that differ from the plugin", async () => {
    await withPrivateTmpdir(async (dir) => {
      const report = await runPackage(
        dir,
        "@fixture/services-drift",
        pluginSource({ exportName: "Plugin", requires: { services: ["fixture:svc"] } }),
        { type: "plugin", requires: { services: [] } },
        ["Plugin"],
      );
      const findings = manifestFindings(report);
      expect(findings.map((finding) => finding.message)).toEqual([
        'gwen.requires.services [] differs from the requires.services of the plugins ["fixture:svc"]',
      ]);
      expect(findings[0]?.hint).toBe(
        'Set gwen.requires.services in package.json to ["fixture:svc"].',
      );
    });
  });

  it("reports gwen.requires.optional that differ from the plugin", async () => {
    await withPrivateTmpdir(async (dir) => {
      const report = await runPackage(
        dir,
        "@fixture/optional-drift",
        pluginSource({ exportName: "Plugin", requires: { optional: ["assets"] } }),
        { type: "plugin" },
        ["Plugin"],
      );
      expect(manifestFindings(report).map((finding) => finding.message)).toEqual([
        'gwen.requires.optional [] differs from the requires.optional of the plugins ["assets"]',
      ]);
    });
  });

  it("reports a requires.plugins name that gwen.requires.plugins omits", async () => {
    await withPrivateTmpdir(async (dir) => {
      const report = await runPackage(
        dir,
        "@fixture/plugins-drift",
        pluginSource({ exportName: "Plugin", requires: { plugins: ["camera-core"] } }),
        { type: "plugin" },
        ["Plugin"],
      );
      expect(manifestFindings(report).map((finding) => finding.message)).toEqual([
        'gwen.requires.plugins [] differs from the requires.plugins of the plugins ["camera-core"]',
      ]);
    });
  });

  it("compares requires.plugins by name for an object entry", async () => {
    await withPrivateTmpdir(async (dir) => {
      const report = await runPackage(
        dir,
        "@fixture/plugins-object",
        pluginSource({
          exportName: "Plugin",
          provides: ["fixture:svc"],
          requires: { plugins: [{ name: "fixture-base", extensionApi: { major: 1, minor: 0 } }] },
        }),
        { type: "plugin", requires: { plugins: ["fixture-base"] } },
        ["Plugin"],
      );
      expect(manifestFindings(report).map((finding) => finding.message)).toEqual([
        'gwen.provides [] differs from the provides of the plugins ["fixture:svc"]',
      ]);
    });
  });

  it("accepts lists in any order", async () => {
    await withPrivateTmpdir(async (dir) => {
      const report = await runPackage(
        dir,
        "@fixture/any-order",
        pluginSource({
          exportName: "Plugin",
          provides: ["a", "b"],
          requires: { optional: ["y"] },
        }),
        { type: "plugin", provides: ["b", "a"], requires: { optional: ["z"] } },
        ["Plugin"],
      );
      expect(manifestFindings(report).map((finding) => finding.message)).toEqual([
        'gwen.requires.optional ["z"] differs from the requires.optional of the plugins ["y"]',
      ]);
      expect(report.checks).toEqual(ranChecks({ manifestContract: true }));
    });
  });

  it("unions the plugins of every factory of the package", async () => {
    await withPrivateTmpdir(async (dir) => {
      const source = `${pluginSource({ exportName: "A", provides: ["x"] })}${pluginSource({ exportName: "B", provides: ["y"] })}`;
      const covered = await runPackage(
        dir,
        "@fixture/union",
        source,
        { type: "plugin", provides: ["x", "y"] },
        ["A", "B"],
      );
      expect(manifestFindings(covered)).toEqual([]);
      expect(covered.checks).toEqual(ranChecks({ manifestContract: true }));

      const partial = await runPackage(
        dir,
        "@fixture/union",
        source,
        { type: "plugin", provides: ["x"] },
        ["A", "B"],
      );
      expect(manifestFindings(partial).map((finding) => finding.message)).toEqual([
        'gwen.provides ["x"] differs from the provides of the plugins ["x","y"]',
      ]);
    });
  });

  it("reports a drift once when two factories agree", async () => {
    await withPrivateTmpdir(async (dir) => {
      const source = `${pluginSource({ exportName: "A", provides: ["x"] })}${pluginSource({ exportName: "B", provides: ["x"] })}`;
      const report = await runPackage(dir, "@fixture/twice", source, { type: "plugin" }, [
        "A",
        "B",
      ]);
      expect(manifestFindings(report).map((finding) => finding.message)).toEqual([
        'gwen.provides [] differs from the provides of the plugins ["x"]',
      ]);
    });
  });

  it("treats an absent gwen.provides as an empty list", async () => {
    await withPrivateTmpdir(async (dir) => {
      const report = await runPackage(
        dir,
        "@fixture/no-provides",
        pluginSource({ exportName: "Plugin" }),
        { type: "plugin" },
        ["Plugin"],
      );
      expect(report.checks).toEqual(ranChecks({ manifestContract: true }));
      expect(manifestFindings(report)).toEqual([]);
    });
  });

  it("runs only when gwen.type is plugin", async () => {
    await withPrivateTmpdir(async (dir) => {
      const source = pluginSource({ exportName: "Plugin", provides: ["x"] });
      const without = await runPackage(dir, "@fixture/gate", source, undefined, ["Plugin"]);
      expect(without.checks).toEqual(ranChecks());
      expect(manifestFindings(without)).toEqual([]);

      const withType = await runPackage(dir, "@fixture/gate", source, { type: "plugin" }, [
        "Plugin",
      ]);
      expect(withType.checks).toEqual(ranChecks({ manifestContract: true }));
      expect(manifestFindings(withType)).toHaveLength(1);
    });
  });

  it("does not run when gwen.type is another type", async () => {
    await withPrivateTmpdir(async (dir) => {
      const source = pluginSource({ exportName: "Plugin", provides: ["x"] });
      const other = await runPackage(dir, "@fixture/gate-other", source, { type: "package" }, [
        "Plugin",
      ]);
      expect(other.checks).toEqual(ranChecks());
      expect(manifestFindings(other)).toEqual([]);

      const plugin = await runPackage(dir, "@fixture/gate-other", source, { type: "plugin" }, [
        "Plugin",
      ]);
      expect(plugin.checks).toEqual(ranChecks({ manifestContract: true }));
      expect(manifestFindings(plugin)).toHaveLength(1);
    });
  });

  it("leaves a malformed gwen field to the manifest check", async () => {
    await withPrivateTmpdir(async (dir) => {
      const report = await runPackage(
        dir,
        "@fixture/malformed",
        pluginSource({ exportName: "Plugin", provides: ["x"] }),
        { type: "plugin", provides: "x" },
        ["Plugin"],
      );
      expect(report.checks).toEqual(ranChecks({ manifestContract: true }));
      expect(manifestFindings(report)).toEqual([]);
    });
  });

  it("skips every key when the gwen field has a shape problem", async () => {
    await withPrivateTmpdir(async (dir) => {
      // `requires.optionalServices` is malformed; `provides` drifts on another key.
      const report = await runPackage(
        dir,
        "@fixture/cross-key",
        pluginSource({ exportName: "Plugin", provides: ["fixture:svc"] }),
        { type: "plugin", provides: [], requires: { optionalServices: [] } },
        ["Plugin"],
      );
      expect(report.checks).toEqual(ranChecks({ manifestContract: true }));
      expect(manifestFindings(report)).toEqual([]);
    });
  });

  it("pins each finding to the package.json line of its key", async () => {
    await withPrivateTmpdir(async (dir) => {
      // writePluginPackage: `name` line 2, `type` 3, `exports` 4-9, then `gwen` at line 10.
      // One directory per call: a built entry is imported once per path.
      const keyed = await runPackage(
        path.join(dir, "keyed"),
        "@fixture/lines",
        pluginSource({
          exportName: "Plugin",
          provides: ["fixture:svc"],
          requires: { optional: ["assets"] },
        }),
        { type: "plugin", provides: [], requires: { optional: [] } },
        ["Plugin"],
      );
      // gwen 10, type 11, provides 12, requires 13, optional 14.
      const keyedFindings = manifestFindings(keyed);
      expect(keyedFindings.map((finding) => finding.line)).toEqual([12, 14]);
      expect(keyedFindings.map((finding) => finding.file)).toEqual([
        "package.json",
        "package.json",
      ]);
      expect(keyedFindings.map((finding) => finding.message)).toEqual([
        'gwen.provides [] differs from the provides of the plugins ["fixture:svc"]',
        'gwen.requires.optional [] differs from the requires.optional of the plugins ["assets"]',
      ]);

      // Absent key: the line of the `gwen` key.
      const absent = await runPackage(
        path.join(dir, "absent"),
        "@fixture/lines",
        pluginSource({ exportName: "Plugin", provides: ["fixture:svc"] }),
        { type: "plugin" },
        ["Plugin"],
      );
      expect(manifestFindings(absent).map((finding) => finding.line)).toEqual([10]);

      // `requires` is present, `services` is not: still the `gwen` key line.
      const partial = await runPackage(
        path.join(dir, "partial"),
        "@fixture/lines",
        pluginSource({ exportName: "Plugin", requires: { services: ["s"] } }),
        { type: "plugin", requires: { optional: [] } },
        ["Plugin"],
      );
      expect(manifestFindings(partial).map((finding) => finding.line)).toEqual([10]);
    });
  });

  it("leaves out a factory that throws", async () => {
    await withPrivateTmpdir(async (dir) => {
      const report = await runPackage(
        dir,
        "@fixture/throwing",
        `${THROWING_SOURCE}${pluginSource({ exportName: "Good", provides: ["x"] })}`,
        { type: "plugin", provides: ["x"] },
        ["Bad", "Good"],
      );
      expect(report.checks).toEqual(ranChecks({ manifestContract: true }));
      expect(manifestFindings(report)).toEqual([]);
      const shape = findingsWithCode(report, ConformanceErrorCodes.RUNTIME_SHAPE);
      expect(shape.map((finding) => finding.message)).toEqual([
        '"@fixture/throwing" export "Bad" threw: boom',
      ]);
    });
  });
});
