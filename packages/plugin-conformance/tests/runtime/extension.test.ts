import { describe, expect, it } from "vitest";
import { ConformanceErrorCodes } from "@gwenjs/plugin-conformance";
import { runPluginConformance } from "@gwenjs/plugin-conformance/runtime";
import {
  baseModuleSource,
  recordedBaseApis,
  recordedBaseNames,
  writeBasePackage,
  writeBaseSurfacePackage,
  writeExtensionPackage,
  type BaseWriteOptions,
} from "../helpers/extension-runtime.js";
import { withPrivateTmpdir } from "../helpers/fixture.js";
import { findingsOfCode, findingsWithCode, ranChecks, spec } from "../helpers/runtime.js";

const RUNTIME_EXTENSION = "CONFORMANCE:RUNTIME_EXTENSION";
const RUNTIME_EXTENSION_API = "CONFORMANCE:RUNTIME_EXTENSION_API";

async function surfaceReport(dir: string, options: BaseWriteOptions = {}) {
  await writeBaseSurfacePackage(dir, options);
  return runPluginConformance(
    spec({
      root: dir,
      packageName: options.name ?? "fixture-base",
      factories: [{ export: options.exportName ?? "Base" }],
    }),
  );
}

function layeredModule(packageName: string): string {
  return [
    "export default {",
    `  meta: { name: ${JSON.stringify(packageName)} },`,
    "  defaults: {},",
    "  setup(_options, kit) {",
    `    kit.addPlugin({ src: ${JSON.stringify(packageName)}, export: "Plugin" });`,
    "  },",
    "};",
    "",
  ].join("\n");
}

/** Base whose `setup` throws when the installed major is not 1. */
function raisedMajorBaseSource(pluginName: string): string {
  const key = `${pluginName}:extension`;
  return `export function Base() {
  return {
    name: ${JSON.stringify(pluginName)},
    extensionApi: { major: 1, minor: 2 },
    provides: [${JSON.stringify(key)}],
    setup(engine) {
      const extensionApi = this.extensionApi;
      if (extensionApi !== undefined && extensionApi.major !== 1) throw new Error("copy-major");
      const list = globalThis.__fixtureBaseApis ?? [];
      list.push(extensionApi);
      globalThis.__fixtureBaseApis = list;
      const names = globalThis.__fixtureBaseNames ?? [];
      names.push(this.name);
      globalThis.__fixtureBaseNames = names;
      let registrations = 0;
      const api = {
        extensionApi: { major: 1, minor: 2 },
        get registrations() {
          return registrations;
        },
        register() {
          registrations += 1;
          let disposed = false;
          return () => {
            if (disposed) return;
            disposed = true;
            registrations -= 1;
          };
        },
      };
      engine.provide(${JSON.stringify(key)}, api);
    },
  };
}
`;
}

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

  it("RX1 reports an extension that installs alone without declaring its base", async () => {
    await withPrivateTmpdir(async (dir) => {
      await writeBasePackage(dir, { name: "fixture-base" });
      await writeExtensionPackage(dir, {
        name: "fixture-ext",
        gwen: { extends: ["fixture-base"] },
        sourceOptions: { requiresPlugins: "none", setup: "empty" },
      });

      const report = await runPluginConformance(
        spec({
          root: dir,
          packageName: "fixture-ext",
          bases: [{ packageName: "fixture-base", export: "Base" }],
        }),
      );
      const findings = findingsOfCode(report, RUNTIME_EXTENSION).filter((finding) =>
        finding.message.startsWith("RX1"),
      );
      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain("fixture-ext");
      expect(findings[0]?.message).toContain("fixture-base");
      expect(report.checks).toContain("extension");
    });
  });

  it("RX1 accepts an extension that the engine rejects alone with the dependency error naming each base", async () => {
    await withPrivateTmpdir(async (dir) => {
      await writeBasePackage(dir, { name: "fixture-base" });
      await writeExtensionPackage(dir, {
        name: "fixture-ext",
        gwen: { extends: ["fixture-base"] },
        sourceOptions: { requiresPlugins: "object", setup: "register" },
      });

      const report = await runPluginConformance(
        spec({
          root: dir,
          packageName: "fixture-ext",
          bases: [{ packageName: "fixture-base", export: "Base" }],
        }),
      );
      expect(report.findings).toEqual([]);
      expect(report.checks).toContain("extension");
      expect(report.checks).toContain("requirement-form");
      expect(report.checks).toEqual(ranChecks({ extension: true, requirementForm: true }));
    });
  });

  it("RX2 reports an extension that the engine rejects after its bases are installed", async () => {
    await withPrivateTmpdir(async (dir) => {
      await writeBasePackage(dir, { name: "fixture-base", major: 1, minor: 2 });
      await writeExtensionPackage(dir, {
        name: "fixture-ext",
        gwen: { extends: ["fixture-base"] },
        sourceOptions: {
          requiresPlugins: "object",
          requiredMajor: 1,
          requiredMinor: 3,
          setup: "empty",
        },
      });

      const report = await runPluginConformance(
        spec({
          root: dir,
          packageName: "fixture-ext",
          bases: [{ packageName: "fixture-base", export: "Base" }],
        }),
      );
      const findings = findingsOfCode(report, RUNTIME_EXTENSION);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.message.startsWith("RX2")).toBe(true);
      expect(findings[0]?.message).toContain("CORE:PLUGIN_EXTENSION_API_MISMATCH");
    });
  });

  it("RX2 runs the frames check with the bases installed and reports a warning of the extension", async () => {
    await withPrivateTmpdir(async (dir) => {
      await writeBasePackage(dir, { name: "fixture-base" });
      await writeExtensionPackage(dir, {
        name: "fixture-ext",
        gwen: { extends: ["fixture-base"] },
        sourceOptions: { requiresPlugins: "object", setup: "warn" },
      });

      const report = await runPluginConformance(
        spec({
          root: dir,
          packageName: "fixture-ext",
          bases: [{ packageName: "fixture-base", export: "Base" }],
        }),
      );
      const frames = findingsWithCode(report, ConformanceErrorCodes.RUNTIME_FRAME_EVENT);
      expect(frames).toHaveLength(1);
      expect(frames[0]?.message).toContain("frame 2");
      expect(report.checks).toEqual(ranChecks({ extension: true, requirementForm: true }));
    });
  });

  it("RX2 installs the bases in spec.bases order before the extension", async () => {
    await withPrivateTmpdir(async (dir) => {
      await writeBasePackage(dir, { name: "fixture-base" });
      await writeBasePackage(dir, {
        name: "fixture-mid",
        gwen: { extends: ["fixture-base"], hookNamespace: "fixture-mid" },
      });
      await writeExtensionPackage(dir, {
        name: "fixture-ext",
        gwen: { extends: ["fixture-mid"] },
        sourceOptions: {
          requiresPlugins: "object",
          requiredBase: "fixture-mid",
          hookNamespace: "fixture-mid",
          setup: "register",
        },
      });

      const report = await runPluginConformance(
        spec({
          root: dir,
          packageName: "fixture-ext",
          bases: [
            { packageName: "fixture-base", export: "Base" },
            { packageName: "fixture-mid", export: "Base" },
          ],
        }),
      );
      const names = recordedBaseNames();
      expect(names.length).toBeGreaterThan(0);
      expect(names.length % 2).toBe(0);
      for (let index = 0; index < names.length; index += 2) {
        expect(names[index]).toBe("fixture-base");
        expect(names[index + 1]).toBe("fixture-mid");
      }
      expect(report.checks).toEqual(ranChecks({ extension: true, requirementForm: true }));
    });
  });

  it("RX3 reports a registration that unuse leaves in the base registry", async () => {
    await withPrivateTmpdir(async (dir) => {
      await writeBasePackage(dir, { name: "fixture-base" });
      await writeExtensionPackage(dir, {
        name: "fixture-ext",
        gwen: { extends: ["fixture-base"] },
        sourceOptions: { requiresPlugins: "object", setup: "leak" },
      });

      const report = await runPluginConformance(
        spec({
          root: dir,
          packageName: "fixture-ext",
          bases: [{ packageName: "fixture-base", export: "Base" }],
        }),
      );
      const findings = findingsOfCode(report, RUNTIME_EXTENSION);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.message.startsWith("RX3")).toBe(true);
      expect(findings[0]?.message).toContain("registrations");
      expect(findings[0]?.message).toContain("before 0, after 1");
      expect(findings[0]?.message).toContain("fixture-base:extension");
    });
  });

  it("RX3 reports a hook listener that unuse leaves on the engine", async () => {
    await withPrivateTmpdir(async (dir) => {
      await writeBasePackage(dir, { name: "fixture-base" });
      await writeExtensionPackage(dir, {
        name: "fixture-ext",
        gwen: { extends: ["fixture-base"] },
        sourceOptions: { requiresPlugins: "object", setup: "hook" },
      });

      const report = await runPluginConformance(
        spec({
          root: dir,
          packageName: "fixture-ext",
          bases: [{ packageName: "fixture-base", export: "Base" }],
        }),
      );
      const findings = findingsOfCode(report, RUNTIME_EXTENSION);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain("hookListeners");
    });
  });

  it("RX3 accepts an extension that disposes its registration in teardown", async () => {
    await withPrivateTmpdir(async (dir) => {
      await writeBasePackage(dir, { name: "fixture-base" });
      await writeExtensionPackage(dir, {
        name: "fixture-ext",
        gwen: { extends: ["fixture-base"] },
        sourceOptions: { requiresPlugins: "object", setup: "register" },
      });

      const report = await runPluginConformance(
        spec({
          root: dir,
          packageName: "fixture-ext",
          bases: [{ packageName: "fixture-base", export: "Base" }],
        }),
      );
      expect(report.findings).toEqual([]);
      expect(report.checks).toContain("extension");
    });
  });

  it("RX3 reports a teardown that throws and the later rules still run", async () => {
    await withPrivateTmpdir(async (dir) => {
      await writeBasePackage(dir, { name: "fixture-base" });
      await writeExtensionPackage(dir, {
        name: "fixture-ext",
        gwen: { extends: ["fixture-base"] },
        source: [
          "export function Plugin() {",
          "  return {",
          '    name: "fixture-ext",',
          '    requires: { plugins: [{ name: "fixture-base", extensionApi: { major: 1, minor: 2 } }] },',
          "    setup() {},",
          "    teardown() {",
          '      throw new Error("teardown-boom");',
          "    },",
          "  };",
          "}",
          "",
        ].join("\n"),
      });

      const report = await runPluginConformance(
        spec({
          root: dir,
          packageName: "fixture-ext",
          bases: [{ packageName: "fixture-base", export: "Base" }],
        }),
      );
      const extensionFindings = findingsOfCode(report, RUNTIME_EXTENSION);
      expect(extensionFindings).toHaveLength(1);
      expect(extensionFindings[0]?.message.startsWith("RX3")).toBe(true);
      expect(extensionFindings[0]?.message).toContain("teardown-boom");
      expect(recordedBaseApis()).toContainEqual({ major: 2, minor: 2 });
      expect(report.checks).toContain("extension");
    });
  });

  it("RX4 reports a base that unuse removes while its extension is installed", async () => {
    await withPrivateTmpdir(async (dir) => {
      await writeBasePackage(dir, { name: "fixture-base" });
      await writeExtensionPackage(dir, {
        name: "fixture-ext",
        gwen: { extends: ["fixture-base"] },
        sourceOptions: { requiresPlugins: "none", setup: "empty" },
      });

      const report = await runPluginConformance(
        spec({
          root: dir,
          packageName: "fixture-ext",
          bases: [{ packageName: "fixture-base", export: "Base" }],
        }),
      );
      const findings = findingsOfCode(report, RUNTIME_EXTENSION).filter((finding) =>
        finding.message.startsWith("RX4"),
      );
      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain("fixture-base");
      expect(findings[0]?.message).toContain("fixture-ext");
    });
  });

  it("RX4 accepts a base that unuse rejects with the in-use error naming the extension", async () => {
    await withPrivateTmpdir(async (dir) => {
      await writeBasePackage(dir, { name: "fixture-base" });
      await writeExtensionPackage(dir, {
        name: "fixture-ext",
        gwen: { extends: ["fixture-base"] },
        sourceOptions: { requiresPlugins: "object", setup: "register" },
      });

      const report = await runPluginConformance(
        spec({
          root: dir,
          packageName: "fixture-ext",
          bases: [{ packageName: "fixture-base", export: "Base" }],
        }),
      );
      const rx4 = findingsOfCode(report, RUNTIME_EXTENSION).filter((finding) =>
        finding.message.startsWith("RX4"),
      );
      expect(rx4).toEqual([]);
      expect(report.checks).toContain("extension");
    });
  });

  it("RX5 reports an extension that installs on a base with another major", async () => {
    await withPrivateTmpdir(async (dir) => {
      await writeBasePackage(dir, { name: "fixture-base" });
      await writeExtensionPackage(dir, {
        name: "fixture-ext",
        gwen: { extends: ["fixture-base"] },
        sourceOptions: { requiresPlugins: "string", setup: "empty" },
      });

      const report = await runPluginConformance(
        spec({
          root: dir,
          packageName: "fixture-ext",
          bases: [{ packageName: "fixture-base", export: "Base" }],
        }),
      );
      const findings = findingsOfCode(report, RUNTIME_EXTENSION);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.message.startsWith("RX5")).toBe(true);
      expect(findings[0]?.message).toContain("major 2");
      expect(findings[0]?.message).toContain("fixture-base");
    });
  });

  it("RX5 installs a base copy with the major raised and one with the minor lowered", async () => {
    await withPrivateTmpdir(async (dir) => {
      await writeBasePackage(dir, { name: "fixture-base", major: 1, minor: 2 });
      await writeExtensionPackage(dir, {
        name: "fixture-ext",
        gwen: { extends: ["fixture-base"] },
        sourceOptions: {
          requiresPlugins: "object",
          requiredMajor: 1,
          requiredMinor: 2,
          setup: "register",
        },
      });

      await runPluginConformance(
        spec({
          root: dir,
          packageName: "fixture-ext",
          bases: [{ packageName: "fixture-base", export: "Base" }],
        }),
      );
      const genuine = { major: 1, minor: 2 };
      // provides, frames, remove, reentry, two engines, stop, RX2, RX3, RX4,
      // then the raised copy and the lowered copy, then hooks.
      const expected = [
        ...Array.from({ length: 10 }, () => genuine),
        { major: 2, minor: 2 },
        { major: 1, minor: 1 },
        genuine,
      ];
      expect(recordedBaseApis()).toEqual(expected);
    });
  });

  it("RX5 skips the minor variant when the required minor is 0", async () => {
    await withPrivateTmpdir(async (dir) => {
      await writeBasePackage(dir, { name: "fixture-base", major: 1, minor: 0 });
      await writeExtensionPackage(dir, {
        name: "fixture-ext",
        gwen: { extends: ["fixture-base"] },
        sourceOptions: {
          requiresPlugins: "object",
          requiredMajor: 1,
          requiredMinor: 0,
          setup: "empty",
        },
      });

      await runPluginConformance(
        spec({
          root: dir,
          packageName: "fixture-ext",
          bases: [{ packageName: "fixture-base", export: "Base" }],
        }),
      );
      const apis = recordedBaseApis();
      expect(apis).toContainEqual({ major: 2, minor: 0 });
      expect(apis.some((api) => api.minor === -1)).toBe(false);
    });
  });

  it("RX5 reports a base plugin that declares no extensionApi", async () => {
    await withPrivateTmpdir(async (dir) => {
      await writeBasePackage(dir, { name: "fixture-base", extensionApi: false });
      await writeExtensionPackage(dir, {
        name: "fixture-ext",
        gwen: { extends: ["fixture-base"] },
        sourceOptions: { requiresPlugins: "object", setup: "empty" },
      });

      const report = await runPluginConformance(
        spec({
          root: dir,
          packageName: "fixture-ext",
          bases: [{ packageName: "fixture-base", export: "Base" }],
        }),
      );
      const findings = findingsOfCode(report, RUNTIME_EXTENSION).filter((finding) =>
        finding.message.startsWith("RX5"),
      );
      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain("fixture-base");
    });
  });

  it("two direct bases one over the other report no finding", async () => {
    await withPrivateTmpdir(async (dir) => {
      await writeBasePackage(dir, { name: "fixture-base" });
      await writeBasePackage(dir, {
        name: "fixture-mid",
        gwen: { extends: ["fixture-base"], hookNamespace: "fixture-mid" },
        requiresPlugins: "object",
        requiredBase: "fixture-base",
      });
      await writeExtensionPackage(dir, {
        name: "fixture-ext",
        gwen: { extends: ["fixture-base", "fixture-mid"] },
        source: [
          "export function Plugin() {",
          "  return {",
          '    name: "fixture-ext",',
          "    requires: { plugins: [",
          '      { name: "fixture-base", extensionApi: { major: 1, minor: 2 } },',
          '      { name: "fixture-mid", extensionApi: { major: 1, minor: 2 } },',
          "    ] },",
          "    setup() {},",
          "  };",
          "}",
          "",
        ].join("\n"),
      });

      const report = await runPluginConformance(
        spec({
          root: dir,
          packageName: "fixture-ext",
          bases: [
            { packageName: "fixture-base", export: "Base" },
            { packageName: "fixture-mid", export: "Base" },
          ],
        }),
      );
      expect(report.findings).toEqual([]);
      const apis = recordedBaseApis();
      const names = recordedBaseNames();
      expect(apis.length).toBe(names.length);
      expect(
        apis.some(
          (api, index) => api.major === 2 && api.minor === 2 && names[index] === "fixture-base",
        ),
      ).toBe(true);
      expect(report.checks).toContain("extension");
    });
  });

  it("RX5 reports a copy whose setup throws", async () => {
    await withPrivateTmpdir(async (dir) => {
      await writeBasePackage(dir, {
        name: "fixture-base",
        source: raisedMajorBaseSource("fixture-base"),
      });
      await writeExtensionPackage(dir, {
        name: "fixture-ext",
        gwen: { extends: ["fixture-base"] },
        sourceOptions: { requiresPlugins: "object", setup: "empty" },
      });

      const report = await runPluginConformance(
        spec({
          root: dir,
          packageName: "fixture-ext",
          bases: [{ packageName: "fixture-base", export: "Base" }],
        }),
      );
      const findings = findingsOfCode(report, RUNTIME_EXTENSION);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.message.startsWith("RX5")).toBe(true);
      expect(findings[0]?.message).toContain("copy-major");
      expect(report.checks).toContain("extension");
    });
  });

  it("a base installed above the package root is found", async () => {
    await withPrivateTmpdir(async (dir) => {
      await writeBasePackage(dir, { name: "fixture-base" });
      const pkg = `${dir}/pkg`;
      await writeExtensionPackage(pkg, {
        name: "fixture-ext",
        gwen: { extends: ["fixture-base"] },
        sourceOptions: { requiresPlugins: "object", setup: "register" },
      });

      const report = await runPluginConformance(
        spec({
          root: pkg,
          packageName: "fixture-ext",
          bases: [{ packageName: "fixture-base", export: "Base" }],
        }),
      );
      expect(report.findings).toEqual([]);
      expect(report.checks).toContain("extension");
      expect(report.checks).toContain("requirement-form");
      expect(report.checks).toEqual(ranChecks({ extension: true, requirementForm: true }));
    });
  });

  it("a base reachable through the gwen.extends of a listed base is accepted", async () => {
    await withPrivateTmpdir(async (dir) => {
      await writeBasePackage(dir, { name: "fixture-base" });
      await writeBasePackage(dir, {
        name: "fixture-mid",
        gwen: { extends: ["fixture-base"], hookNamespace: "fixture-mid" },
      });
      await writeExtensionPackage(dir, {
        name: "fixture-top",
        pluginName: "fixture-top",
        gwen: { extends: ["fixture-mid"] },
        sourceOptions: {
          requiresPlugins: "object",
          requiredBase: "fixture-mid",
          hookNamespace: "fixture-mid",
          setup: "register",
        },
      });

      const report = await runPluginConformance(
        spec({
          root: dir,
          packageName: "fixture-top",
          bases: [
            { packageName: "fixture-base", export: "Base" },
            { packageName: "fixture-mid", export: "Base" },
          ],
        }),
      );
      expect(findingsWithCode(report, ConformanceErrorCodes.INVALID_SPEC)).toEqual([]);
      expect(report.checks).toContain("extension");
    });
  });

  it("ext-of-ext reports nothing for fixture-top over fixture-mid", async () => {
    await withPrivateTmpdir(async (dir) => {
      await writeBasePackage(dir, { name: "fixture-base" });
      await writeBasePackage(dir, {
        name: "fixture-mid",
        gwen: { extends: ["fixture-base"], hookNamespace: "fixture-mid" },
        requiresPlugins: "object",
        requiredBase: "fixture-base",
      });
      await writeExtensionPackage(dir, {
        name: "fixture-top",
        pluginName: "fixture-top",
        gwen: { extends: ["fixture-mid"] },
        sourceOptions: {
          requiresPlugins: "object",
          requiredBase: "fixture-mid",
          hookNamespace: "fixture-mid",
          setup: "register",
        },
      });

      const report = await runPluginConformance(
        spec({
          root: dir,
          packageName: "fixture-top",
          bases: [
            { packageName: "fixture-base", export: "Base" },
            { packageName: "fixture-mid", export: "Base" },
          ],
        }),
      );
      expect(report.findings).toEqual([]);
      expect(report.checks).toContain("extension");
      expect(report.checks).toContain("requirement-form");
    });
  });

  it("layered-ok runs every runtime check and reports nothing", async () => {
    await withPrivateTmpdir(async (dir) => {
      await writeBasePackage(dir, { name: "fixture-base" });
      await writeExtensionPackage(dir, {
        name: "fixture-layered-ok",
        pluginName: "fixture-layered-ok",
        gwen: { extends: ["fixture-base"], hookNamespace: "layered-ok" },
        sourceOptions: { requiresPlugins: "object", setup: "register" },
        moduleSource: layeredModule("fixture-layered-ok"),
      });

      const report = await runPluginConformance(
        spec({
          root: dir,
          packageName: "fixture-layered-ok",
          bases: [{ packageName: "fixture-base", export: "Base" }],
        }),
      );
      expect(report.findings).toEqual([]);
      expect(report.checks).toContain("extension");
      expect(report.checks).toContain("requirement-form");
      expect(report.checks).toEqual(
        ranChecks({ module: true, extension: true, requirementForm: true }),
      );
    });
  });

  it("RX6 reports a requires.plugins string that names a base", async () => {
    await withPrivateTmpdir(async (dir) => {
      await writeBasePackage(dir, { name: "fixture-base" });
      await writeExtensionPackage(dir, {
        name: "fixture-ext",
        gwen: { extends: ["fixture-base"] },
        sourceOptions: { requiresPlugins: "string", setup: "empty" },
      });

      const report = await runPluginConformance(
        spec({
          root: dir,
          packageName: "fixture-ext",
          bases: [{ packageName: "fixture-base", export: "Base" }],
        }),
      );
      const findings = findingsWithCode(report, ConformanceErrorCodes.RUNTIME_REQUIRES);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain("fixture-base");
      expect(findings[0]?.message).toContain("object form");
      expect(report.checks).toContain("requirement-form");
    });
  });

  it("RX6 reports a gwen.extends package that no requires entry names", async () => {
    await withPrivateTmpdir(async (dir) => {
      await writeBasePackage(dir, { name: "fixture-base" });
      await writeExtensionPackage(dir, {
        name: "fixture-ext",
        gwen: { extends: ["fixture-base"] },
        sourceOptions: { requiresPlugins: "empty", setup: "empty" },
      });

      const report = await runPluginConformance(
        spec({
          root: dir,
          packageName: "fixture-ext",
          bases: [{ packageName: "fixture-base", export: "Base" }],
        }),
      );
      const findings = findingsWithCode(report, ConformanceErrorCodes.RUNTIME_REQUIRES);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain("fixture-base");
      expect(report.checks).toContain("requirement-form");
    });
  });

  it("RX6 accepts an object entry for every base", async () => {
    await withPrivateTmpdir(async (dir) => {
      await writeBasePackage(dir, { name: "fixture-base" });
      await writeExtensionPackage(dir, {
        name: "fixture-ext",
        gwen: { extends: ["fixture-base"] },
        sourceOptions: { requiresPlugins: "object", setup: "register" },
      });

      const report = await runPluginConformance(
        spec({
          root: dir,
          packageName: "fixture-ext",
          bases: [{ packageName: "fixture-base", export: "Base" }],
        }),
      );
      expect(report.checks).toContain("requirement-form");
      expect(report.findings).toEqual([]);
    });
  });

  it("RX6 reports a module declaration whose requires differ from the instance", async () => {
    await withPrivateTmpdir(async (dir) => {
      const packageName = "fixture-ext";
      const declared =
        '{ plugins: [{ name: "other-base", extensionApi: { major: 1, minor: 0 } }] }';
      await writeExtensionPackage(dir, {
        name: packageName,
        sourceOptions: { requiresPlugins: "object", setup: "empty" },
        moduleSource: [
          "export default {",
          `  meta: { name: ${JSON.stringify(packageName)} },`,
          "  defaults: {},",
          "  setup(_options, kit) {",
          `    kit.addPlugin({ src: ${JSON.stringify(packageName)}, export: "Plugin", requires: ${declared} });`,
          "  },",
          "};",
          "",
        ].join("\n"),
      });

      const report = await runPluginConformance(spec({ root: dir, packageName }));
      const findings = findingsWithCode(report, ConformanceErrorCodes.RUNTIME_REQUIRES);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain("other-base");
    });
  });

  it("accepts a declaration requires that equals the instance requires in another key order", async () => {
    await withPrivateTmpdir(async (dir) => {
      const packageName = "fixture-ext";
      const declared =
        '{ plugins: [{ extensionApi: { minor: 2, major: 1 }, name: "fixture-base" }] }';
      await writeExtensionPackage(dir, {
        name: packageName,
        sourceOptions: { requiresPlugins: "object", setup: "empty" },
        moduleSource: [
          "export default {",
          `  meta: { name: ${JSON.stringify(packageName)} },`,
          "  defaults: {},",
          "  setup(_options, kit) {",
          `    kit.addPlugin({ src: ${JSON.stringify(packageName)}, export: "Plugin", requires: ${declared} });`,
          "  },",
          "};",
          "",
        ].join("\n"),
      });

      const report = await runPluginConformance(spec({ root: dir, packageName }));
      expect(findingsWithCode(report, ConformanceErrorCodes.RUNTIME_REQUIRES)).toEqual([]);
      expect(report.checks).toContain("module");
    });

    await withPrivateTmpdir(async (dir) => {
      const packageName = "fixture-ext-order";
      const declared =
        '{ plugins: [{ name: "other-base", extensionApi: { major: 1, minor: 0 } }] }';
      await writeExtensionPackage(dir, {
        name: packageName,
        sourceOptions: { requiresPlugins: "object", setup: "empty" },
        moduleSource: [
          "export default {",
          `  meta: { name: ${JSON.stringify(packageName)} },`,
          "  defaults: {},",
          "  setup(_options, kit) {",
          `    kit.addPlugin({ src: ${JSON.stringify(packageName)}, export: "Plugin", requires: ${declared} });`,
          "  },",
          "};",
          "",
        ].join("\n"),
      });

      const report = await runPluginConformance(spec({ root: dir, packageName }));
      expect(findingsWithCode(report, ConformanceErrorCodes.RUNTIME_REQUIRES)).toHaveLength(1);
    });
  });

  it("hidden-base-install reports RUNTIME_REQUIRES for a base installed from setup", async () => {
    await withPrivateTmpdir(async (dir) => {
      await writeBasePackage(dir, { name: "fixture-base" });
      await writeExtensionPackage(dir, {
        name: "fixture-ext",
        gwen: { extends: ["fixture-base"] },
        sourceOptions: { requiresPlugins: "none", setup: "import-base" },
      });

      const report = await runPluginConformance(
        spec({
          root: dir,
          packageName: "fixture-ext",
          bases: [{ packageName: "fixture-base", export: "Base" }],
        }),
      );
      const hidden = findingsWithCode(report, ConformanceErrorCodes.RUNTIME_REQUIRES).filter(
        (finding) => finding.message.includes("installed"),
      );
      expect(hidden).toHaveLength(1);
      expect(hidden[0]?.message).toContain("fixture-base");
      expect(report.checks).toContain("requirement-form");
      expect(report.checks).toContain("extension");
    });
  });

  it("RB1 reports a base plugin that has no extensionApi", async () => {
    await withPrivateTmpdir(async (dir) => {
      const report = await surfaceReport(dir, { extensionApi: false });
      const findings = findingsOfCode(report, RUNTIME_EXTENSION_API);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain('"Base"');
    });
  });

  it("RB1 reports a base that does not provide its hookNamespace extension service", async () => {
    await withPrivateTmpdir(async (dir) => {
      const report = await surfaceReport(dir, { provides: false });
      const findings = findingsOfCode(report, RUNTIME_EXTENSION_API);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain("fixture-base:extension");
    });
  });

  it("RB1 reports a service whose extensionApi differs from the plugin", async () => {
    await withPrivateTmpdir(async (dir) => {
      const report = await surfaceReport(dir, { serviceMajor: 1, serviceMinor: 1 });
      const findings = findingsOfCode(report, RUNTIME_EXTENSION_API);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain('{"major":1,"minor":1}');
      expect(findings[0]?.message).toContain('{"major":1,"minor":2}');
    });
  });

  it("RB1 reports a base whose registrations are not 0 after use", async () => {
    await withPrivateTmpdir(async (dir) => {
      const report = await surfaceReport(dir, { registrations: 1 });
      const findings = findingsOfCode(report, RUNTIME_EXTENSION_API);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain("registrations 1");
    });
  });

  it("RB1 runs only for a package that exports ./extension", async () => {
    await withPrivateTmpdir(async (dir) => {
      const withExport = await surfaceReport(dir, { extensionExport: true });
      expect(withExport.checks).toContain("base-surface");
      const without = await surfaceReport(dir, { extensionExport: false });
      expect(without.checks).not.toContain("base-surface");
    });
  });

  it("RB1 accepts a base that declares everything", async () => {
    await withPrivateTmpdir(async (dir) => {
      const report = await surfaceReport(dir);
      expect(report.checks).toContain("base-surface");
      expect(report.checks).toEqual(ranChecks({ extensionExport: true }));
      expect(report.findings).toEqual([]);
    });
  });

  it("RB1 reports a package that exports ./extension and has no gwen.hookNamespace", async () => {
    await withPrivateTmpdir(async (dir) => {
      await writeExtensionPackage(dir, {
        name: "fixture-base",
        extensionExport: true,
        source: baseModuleSource({
          packageName: "fixture-base",
          pluginName: "fixture-base",
          hookNamespace: "fixture-base",
        }),
      });

      const report = await runPluginConformance(
        spec({
          root: dir,
          packageName: "fixture-base",
          factories: [{ export: "Base" }],
        }),
      );
      const findings = findingsOfCode(report, RUNTIME_EXTENSION_API);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain("gwen.hookNamespace");
    });
  });

  it("RB1 reports a package whose ./extension has no qualifying factory", async () => {
    await withPrivateTmpdir(async (dir) => {
      const report = await surfaceReport(dir, { extensionApi: false, provides: false });
      const findings = findingsOfCode(report, RUNTIME_EXTENSION_API);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain("no factory");
    });
  });

  it("a spec.bases entry with an empty export is INVALID_SPEC", async () => {
    await withPrivateTmpdir(async (dir) => {
      await writeExtensionPackage(dir, { name: "fixture-ext" });

      const report = await runPluginConformance(
        spec({
          root: dir,
          packageName: "fixture-ext",
          bases: [{ packageName: "fixture-base", export: "" }],
        }),
      );
      const findings = findingsWithCode(report, ConformanceErrorCodes.INVALID_SPEC);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain("bases");
      expect(findings[0]?.message).toContain("non-empty");
    });
  });

  it("RX4 names only the direct base of ext-of-ext", async () => {
    await withPrivateTmpdir(async (dir) => {
      await writeBasePackage(dir, { name: "fixture-base" });
      await writeBasePackage(dir, {
        name: "fixture-mid",
        gwen: { extends: ["fixture-base"], hookNamespace: "fixture-mid" },
        requiresPlugins: "object",
        requiredBase: "fixture-base",
      });
      await writeExtensionPackage(dir, {
        name: "fixture-top",
        pluginName: "fixture-top",
        gwen: { extends: ["fixture-mid"] },
        sourceOptions: { requiresPlugins: "none", setup: "empty" },
      });

      const report = await runPluginConformance(
        spec({
          root: dir,
          packageName: "fixture-top",
          bases: [
            { packageName: "fixture-base", export: "Base" },
            { packageName: "fixture-mid", export: "Base" },
          ],
        }),
      );
      const rx4 = findingsOfCode(report, RUNTIME_EXTENSION).filter((finding) =>
        finding.message.startsWith("RX4"),
      );
      expect(rx4).toHaveLength(1);
      expect(rx4[0]?.message).toContain("fixture-mid");
      expect(rx4[0]?.message).not.toContain("fixture-base");
    });
  });
});
