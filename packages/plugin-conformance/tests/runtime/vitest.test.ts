import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PluginConformanceSpec } from "@gwenjs/plugin-conformance/runtime";
import { describe, expect, it } from "vitest";
import { registerPluginConformance } from "../../src/run-plugin-conformance-suite.js";
import { withPrivateTmpdir } from "../helpers/fixture.js";
import { factorySource, spec, writePluginPackage } from "../helpers/runtime.js";

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
    describe(name, body) {
      suites.push(name);
      body();
    },
    it(name, body) {
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
});
