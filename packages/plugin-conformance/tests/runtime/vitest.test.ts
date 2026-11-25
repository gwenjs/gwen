import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  runPluginConformance,
  type PluginConformanceSpec,
} from "@gwenjs/plugin-conformance/runtime";
import { describe, expect, it } from "vitest";
import { registerPluginConformance } from "../../src/run-plugin-conformance-suite.js";
import {
  baseModuleSource,
  writeBasePackage,
  writeBaseSurfacePackage,
  writeExtensionPackage,
} from "../helpers/extension-runtime.js";
import { withPrivateTmpdir } from "../helpers/fixture.js";
import { factorySource, findingsOfCode, spec, writePluginPackage } from "../helpers/runtime.js";

interface RecordedRow {
  readonly name: string;
  readonly body: () => void;
}

/** Runs the registration against a recording `describe`/`it` pair. */
function record(input: PluginConformanceSpec): {
  readonly suites: readonly string[];
  readonly rows: readonly RecordedRow[];
} {
  const suites: string[] = [];
  const rows: RecordedRow[] = [];
  registerPluginConformance(input, {
    describe: (name, body) => {
      suites.push(name);
      body();
    },
    it: (name, body) => {
      rows.push({ name, body });
    },
  });
  return { suites, rows };
}

/** The message a row body throws, or `undefined` when the row passes. */
async function thrownMessage(row: RecordedRow): Promise<string | undefined> {
  try {
    await row.body();
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

describe("registerPluginConformance", () => {
  it("registers one row per check and factory with the R<n> names", async () => {
    await withPrivateTmpdir(async (dir) => {
      const packageName = "@fixture/row-names";
      await writePluginPackage(dir, {
        name: packageName,
        exports: {
          ".": { import: "./dist/index.js" },
          "./module": { import: "./dist/module.js" },
        },
        files: {
          "dist/index.js": `${factorySource("Alpha")}${factorySource("Beta")}`,
          "dist/module.js": [
            "export default {",
            `  meta: { name: ${JSON.stringify(packageName)} },`,
            "  defaults: {},",
            "  setup(_options, kit) {",
            `    kit.addPlugin({ src: ${JSON.stringify(packageName)}, export: "Alpha" });`,
            "  },",
            "};",
            "",
          ].join("\n"),
        },
      });

      const { suites, rows } = record(
        spec({
          root: dir,
          packageName,
          factories: [{ export: "Alpha" }, { export: "Beta", invalidOptions: { speed: -1 } }],
        }),
      );
      expect(rows.map((row) => row.name)).toEqual([
        "R1 shape (Alpha)",
        "R1 shape (Beta)",
        "R2 installs alone (Alpha)",
        "R2 installs alone (Beta)",
        "R3 provides (Alpha)",
        "R3 provides (Beta)",
        "R4 quiet frames (Alpha)",
        "R4 quiet frames (Beta)",
        "R5 remove (Alpha)",
        "R5 remove (Beta)",
        "R6 re-entry (Alpha)",
        "R6 re-entry (Beta)",
        "R7 two engines (Alpha)",
        "R7 two engines (Beta)",
        "R8 stop (Alpha)",
        "R8 stop (Beta)",
        "R9 options (Beta)",
        "R10 module",
        "R11 hooks (Alpha)",
        "R11 hooks (Beta)",
        "R12 composable surface",
      ]);
      expect(suites).toEqual([`plugin conformance: ${packageName}`]);
    });
  });

  it("a finding fails its own row only", async () => {
    await withPrivateTmpdir(async (dir) => {
      const packageName = "@fixture/shape-bad";
      // `onUpdate` throws at use (packages/core/src/engine/plugin-registry.ts:218).
      // Any other unknown key warns when debug is on (packages/core/src/engine/plugin-registry.ts:224).
      // A key that starts with `_` is left out of that warning (packages/core/src/engine/plugin-registry.ts:223),
      // so the frames row stays quiet and only the shape row fails.
      await writePluginPackage(dir, {
        name: packageName,
        files: {
          "dist/index.js":
            'export function Plugin() {\n  return { name: "Plugin", setup() {}, _extra: true };\n}\n',
        },
      });

      const { rows } = record(spec({ root: dir, packageName }));
      const thrown: { readonly name: string; readonly message: string }[] = [];
      for (const row of rows) {
        const message = await thrownMessage(row);
        if (message !== undefined) thrown.push({ name: row.name, message });
      }
      expect(thrown.map((entry) => entry.name)).toEqual(["R1 shape (Plugin)"]);
      const shape = thrown.find((entry) => entry.name === "R1 shape (Plugin)");
      expect(shape?.message).toContain(
        'CONFORMANCE:RUNTIME_SHAPE: "@fixture/shape-bad" export "Plugin" has _extra',
      );
    });
  });

  it("the rows of a clean fixture all pass", async () => {
    await withPrivateTmpdir(async (dir) => {
      const packageName = "@fixture/clean-rows";
      await writePluginPackage(dir, {
        name: packageName,
        files: {
          "dist/index.js": `${factorySource("One")}${factorySource("Two")}`,
        },
      });

      const { rows } = record(
        spec({
          root: dir,
          packageName,
          factories: [{ export: "One" }, { export: "Two" }],
        }),
      );
      expect(rows.length).toBeGreaterThanOrEqual(12);
      const thrown: string[] = [];
      for (const row of rows) {
        const message = await thrownMessage(row);
        if (message !== undefined) thrown.push(`${row.name}: ${message}`);
      }
      expect(thrown).toEqual([]);
    });
  });

  it("an invalid spec fails every row", async () => {
    await withPrivateTmpdir(async (dir) => {
      const packageName = "@fixture/invalid-rows";
      await writePluginPackage(dir, {
        name: packageName,
        files: { "dist/index.js": factorySource("Plugin") },
      });

      const { rows } = record(spec({ root: dir, packageName, frames: 0 }));
      expect(rows.length).toBeGreaterThan(0);
      const messages: string[] = [];
      for (const row of rows) {
        messages.push((await thrownMessage(row)) ?? "");
      }
      expect(
        messages.every((message) =>
          message.includes(
            "CONFORMANCE:INVALID_SPEC: frames must be an integer greater than or equal to 1",
          ),
        ),
      ).toBe(true);
    });
  });

  it("each row runs its own check on its own factory", async () => {
    const root = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../fixtures/runtime/unscoped-engine",
    );
    const { rows } = record(
      spec({
        root,
        packageName: "@fixture/unscoped-engine",
        factories: [{ export: "Good" }, { export: "LeakHook" }],
      }),
    );
    const thrown: string[] = [];
    for (const row of rows) {
      const message = await thrownMessage(row);
      if (message !== undefined) thrown.push(row.name);
    }
    expect(thrown).toEqual(["R5 remove (LeakHook)", "R8 stop (LeakHook)"]);
  });

  it("a per-factory row keeps a sibling in the allowed names", async () => {
    await withPrivateTmpdir(async (dir) => {
      const packageName = "@fixture/row-siblings";
      await writePluginPackage(dir, {
        name: packageName,
        files: {
          "dist/index.js":
            'export function A() {\n  return { name: "a", setup() {} };\n}\nexport function B() {\n  return { name: "b", requires: { plugins: ["a"] }, setup() {} };\n}\n',
        },
      });
      const { rows } = record(
        spec({
          root: dir,
          packageName,
          official: true,
          factories: [{ export: "A" }, { export: "B" }],
        }),
      );
      const row = rows.find((item) => item.name === "R2 installs alone (B)");
      expect(row).toBeDefined();
      if (row === undefined) return;
      expect(await thrownMessage(row)).toBeUndefined();
    });
  });

  it("a root without package.json fails the rows with INVALID_SPEC", async () => {
    await withPrivateTmpdir(async (dir) => {
      let recorded: ReturnType<typeof record> | undefined;
      let registration: unknown;
      try {
        recorded = record(spec({ root: dir, packageName: "@fixture/no-manifest" }));
      } catch (error) {
        registration = error;
      }
      expect(registration).toBeUndefined();
      const rows = recorded === undefined ? [] : recorded.rows;
      expect(rows.length).toBeGreaterThan(0);
      const messages: string[] = [];
      for (const row of rows) messages.push((await thrownMessage(row)) ?? "");
      expect(messages.every((message) => message.includes("CONFORMANCE:INVALID_SPEC"))).toBe(true);
    });
  });

  it("registers the extension rows for a package with spec.bases", async () => {
    const plainNames = [
      "R1 shape (Alpha)",
      "R1 shape (Beta)",
      "R2 installs alone (Alpha)",
      "R2 installs alone (Beta)",
      "R3 provides (Alpha)",
      "R3 provides (Beta)",
      "R4 quiet frames (Alpha)",
      "R4 quiet frames (Beta)",
      "R5 remove (Alpha)",
      "R5 remove (Beta)",
      "R6 re-entry (Alpha)",
      "R6 re-entry (Beta)",
      "R7 two engines (Alpha)",
      "R7 two engines (Beta)",
      "R8 stop (Alpha)",
      "R8 stop (Beta)",
      "R9 options (Beta)",
      "R10 module",
      "R11 hooks (Alpha)",
      "R11 hooks (Beta)",
      "R12 composable surface",
    ];
    const extensionNames = [
      ...plainNames.slice(0, 18),
      "RX1-RX5 extension (Alpha)",
      "RX1-RX5 extension (Beta)",
      "RX6 requirement form (Alpha)",
      "RX6 requirement form (Beta)",
      "RB1 base surface",
      ...plainNames.slice(18),
    ];

    await withPrivateTmpdir(async (dir) => {
      const packageName = "@fixture/extension-rows";
      await writePluginPackage(dir, {
        name: packageName,
        exports: {
          ".": { import: "./dist/index.js" },
          "./module": { import: "./dist/module.js" },
          "./extension": { import: "./dist/extension.js" },
        },
        files: {
          "dist/index.js": `${factorySource("Alpha")}${factorySource("Beta")}`,
          "dist/module.js": 'export default { meta: { name: "pkg" }, defaults: {}, setup() {} };\n',
          "dist/extension.js": "export const ready = true;\n",
        },
      });
      const { rows } = record(
        spec({
          root: dir,
          packageName,
          factories: [{ export: "Alpha" }, { export: "Beta", invalidOptions: { speed: -1 } }],
          bases: [{ packageName: "fixture-base", export: "Base" }],
        }),
      );
      expect(rows.map((row) => row.name)).toEqual(extensionNames);
    });

    await withPrivateTmpdir(async (dir) => {
      const packageName = "@fixture/plain-rows";
      await writePluginPackage(dir, {
        name: packageName,
        exports: {
          ".": { import: "./dist/index.js" },
          "./module": { import: "./dist/module.js" },
        },
        files: {
          "dist/index.js": `${factorySource("Alpha")}${factorySource("Beta")}`,
          "dist/module.js": 'export default { meta: { name: "pkg" }, defaults: {}, setup() {} };\n',
        },
      });
      const { rows } = record(
        spec({
          root: dir,
          packageName,
          factories: [{ export: "Alpha" }, { export: "Beta", invalidOptions: { speed: -1 } }],
        }),
      );
      expect(rows.map((row) => row.name)).toEqual(plainNames);
    });
  });

  it("the RB1 row passes when a second factory is not a base", async () => {
    await withPrivateTmpdir(async (dir) => {
      const packageName = "fixture-two-factories";
      const source = `${baseModuleSource({
        exportName: "Base",
        packageName,
        pluginName: packageName,
        hookNamespace: packageName,
      })}${factorySource("Helper")}`;
      await writeBaseSurfacePackage(dir, { name: packageName, source });
      const input = spec({
        root: dir,
        packageName,
        factories: [{ export: "Base" }, { export: "Helper" }],
      });
      const report = await runPluginConformance(input);
      expect(findingsOfCode(report, "CONFORMANCE:RUNTIME_EXTENSION_API")).toEqual([]);
      const { rows } = record(input);
      const rb1 = rows.filter((row) => row.name.startsWith("RB1"));
      const thrown: string[] = [];
      for (const row of rb1) {
        const message = await thrownMessage(row);
        if (message !== undefined) thrown.push(`${row.name}: ${message}`);
      }
      expect(thrown).toEqual([]);
      expect(rb1.map((row) => row.name)).toEqual(["RB1 base surface"]);
    });
  });

  it("a finding of an extension check fails its own row only", async () => {
    await withPrivateTmpdir(async (dir) => {
      await writeBasePackage(dir, { name: "fixture-base" });
      await writeExtensionPackage(dir, {
        name: "fixture-ext",
        gwen: { extends: ["fixture-base"] },
        sourceOptions: { requiresPlugins: "object", setup: "leak" },
      });
      const { rows } = record(
        spec({
          root: dir,
          packageName: "fixture-ext",
          bases: [{ packageName: "fixture-base", export: "Base" }],
        }),
      );
      const thrown: { readonly name: string; readonly message: string }[] = [];
      for (const row of rows) {
        const message = await thrownMessage(row);
        if (message !== undefined) thrown.push({ name: row.name, message });
      }
      expect(thrown.map((entry) => entry.name)).toEqual(["RX1-RX5 extension (Plugin)"]);
      const extension = thrown.find((entry) => entry.name === "RX1-RX5 extension (Plugin)");
      expect(extension?.message).toContain("CONFORMANCE:RUNTIME_EXTENSION");
    });
  });

  it("registers the RD1 row for a package whose gwen.type is plugin", async () => {
    const perFactory = [
      "R1 shape",
      "R2 installs alone",
      "R3 provides",
      "R4 quiet frames",
      "R5 remove",
      "R6 re-entry",
      "R7 two engines",
      "R8 stop",
    ].flatMap((title) => [`${title} (Alpha)`, `${title} (Beta)`]);

    await withPrivateTmpdir(async (dir) => {
      const packageName = "@fixture/rd1-rows";
      await writePluginPackage(dir, {
        name: packageName,
        gwen: { type: "plugin" },
        files: { "dist/index.js": `${factorySource("Alpha")}${factorySource("Beta")}` },
      });
      const { rows } = record(
        spec({ root: dir, packageName, factories: [{ export: "Alpha" }, { export: "Beta" }] }),
      );
      expect(rows.map((row) => row.name)).toEqual([
        ...perFactory,
        "RD1 manifest contract",
        "R11 hooks (Alpha)",
        "R11 hooks (Beta)",
        "R12 composable surface",
      ]);
    });

    await withPrivateTmpdir(async (dir) => {
      const packageName = "@fixture/rd1-rows-module";
      await writePluginPackage(dir, {
        name: packageName,
        gwen: { type: "plugin" },
        exports: {
          ".": { import: "./dist/index.js" },
          "./module": { import: "./dist/module.js" },
        },
        files: {
          "dist/index.js": `${factorySource("Alpha")}${factorySource("Beta")}`,
          "dist/module.js": 'export default { meta: { name: "pkg" }, defaults: {}, setup() {} };\n',
        },
      });
      const { rows } = record(
        spec({ root: dir, packageName, factories: [{ export: "Alpha" }, { export: "Beta" }] }),
      );
      expect(rows.map((row) => row.name)).toEqual([
        ...perFactory,
        "R10 module",
        "RD1 manifest contract",
        "R11 hooks (Alpha)",
        "R11 hooks (Beta)",
        "R12 composable surface",
      ]);
    });

    await withPrivateTmpdir(async (dir) => {
      const packageName = "@fixture/rd1-rows-absent";
      await writePluginPackage(dir, {
        name: packageName,
        files: { "dist/index.js": `${factorySource("Alpha")}${factorySource("Beta")}` },
      });
      const { rows } = record(
        spec({ root: dir, packageName, factories: [{ export: "Alpha" }, { export: "Beta" }] }),
      );
      expect(rows.filter((row) => row.name.startsWith("RD1"))).toEqual([]);
    });

    await withPrivateTmpdir(async (dir) => {
      const packageName = "@fixture/rd1-rows-other-type";
      await writePluginPackage(dir, {
        name: packageName,
        gwen: { type: "package" },
        files: { "dist/index.js": `${factorySource("Alpha")}${factorySource("Beta")}` },
      });
      const { rows } = record(
        spec({ root: dir, packageName, factories: [{ export: "Alpha" }, { export: "Beta" }] }),
      );
      expect(rows.filter((row) => row.name.startsWith("RD1"))).toEqual([]);
    });

    await withPrivateTmpdir(async (dir) => {
      const packageName = "@fixture/rd1-rows-bom";
      await writePluginPackage(dir, {
        name: packageName,
        gwen: { type: "plugin" },
        files: { "dist/index.js": `${factorySource("Alpha")}${factorySource("Beta")}` },
      });
      const manifestPath = path.join(dir, "package.json");
      await writeFile(manifestPath, `\uFEFF${await readFile(manifestPath, "utf8")}`);
      const { rows } = record(
        spec({ root: dir, packageName, factories: [{ export: "Alpha" }, { export: "Beta" }] }),
      );
      expect(rows.filter((row) => row.name.startsWith("RD1")).map((row) => row.name)).toEqual([
        "RD1 manifest contract",
      ]);
    });
  });

  it("a manifest contract finding fails the RD1 row only", async () => {
    await withPrivateTmpdir(async (dir) => {
      const packageName = "@fixture/rd1-drift";
      await writePluginPackage(dir, {
        name: packageName,
        gwen: { type: "plugin" },
        files: {
          "dist/index.js":
            'export function Plugin() {\n  return { name: "Plugin", provides: ["fixture:svc"], setup(engine) { engine.provide("fixture:svc", {}); } };\n}\n',
        },
      });
      const { rows } = record(spec({ root: dir, packageName }));
      const thrown: { readonly name: string; readonly message: string }[] = [];
      for (const row of rows) {
        const message = await thrownMessage(row);
        if (message !== undefined) thrown.push({ name: row.name, message });
      }
      expect(thrown.map((entry) => entry.name)).toEqual(["RD1 manifest contract"]);
      expect(thrown[0]?.message).toContain(
        'gwen.provides [] differs from the provides of the plugins ["fixture:svc"]',
      );
    });
  });
});
