import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GwenContextErrorCodes } from "@gwenjs/kit";
import { ConformanceErrorCodes } from "@gwenjs/plugin-conformance";
import { runPluginConformance } from "@gwenjs/plugin-conformance/runtime";
import { withPrivateTmpdir } from "../helpers/fixture.js";
import {
  factorySource,
  findingsWithCode,
  ranChecks,
  spec,
  writePluginPackage,
} from "../helpers/runtime.js";

const wrongComposableRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/runtime/wrong-composable",
);

/** Root entry: factory `Plugin` plus `extra` function exports. The file imports nothing. */
function rootSource(extra: string): string {
  return `${factorySource("Plugin")}${extra}`;
}

/**
 * A `use*` export that throws a structural context error.
 * `code` is a `GwenContextErrorCodes` value and `composable` is the export name.
 */
function conformingUse(name: string): string {
  const code = GwenContextErrorCodes.OUTSIDE_ENGINE_CONTEXT;
  return [
    `export function ${name}() {`,
    '  const error = new Error("outside");',
    `  error.code = ${JSON.stringify(code)};`,
    `  error.composable = ${JSON.stringify(name)};`,
    "  throw error;",
    "}",
    "",
  ].join("\n");
}

describe("runPluginConformance composable", () => {
  it("reports a use* that does not throw GwenContextError outside a context", async () => {
    await withPrivateTmpdir(async (dir) => {
      const packageName = "@fixture/use-returns";
      await writePluginPackage(dir, {
        name: packageName,
        files: {
          "dist/index.js": rootSource("export function useThing() {\n  return 1;\n}\n"),
        },
      });

      const report = await runPluginConformance(spec({ root: dir, packageName }));
      const findings = findingsWithCode(report, ConformanceErrorCodes.RUNTIME_COMPOSABLE_CONTEXT);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain("useThing");
      expect(report.checks).toEqual(ranChecks());
    });
  });

  it("reports a GwenContextError whose composable is another name", async () => {
    const report = await runPluginConformance(
      spec({
        root: wrongComposableRoot,
        packageName: "@fixture/wrong-composable",
        factories: [{ export: "Plugin" }],
      }),
    );
    const findings = findingsWithCode(report, ConformanceErrorCodes.RUNTIME_COMPOSABLE_CONTEXT);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain("useA");
    expect(findings[0]?.message).toContain("useB");
    expect(report.checks).toEqual(ranChecks());
  });

  it("passes a conforming entry", async () => {
    await withPrivateTmpdir(async (dir) => {
      const packageName = "@fixture/use-conforms";
      await writePluginPackage(dir, {
        name: packageName,
        files: { "dist/index.js": rootSource(conformingUse("useThing")) },
      });

      const report = await runPluginConformance(spec({ root: dir, packageName }));
      expect(report.checks).toEqual(ranChecks());
      expect(report.findings).toEqual([]);
    });
  });

  it("an entry with zero use* and on* exports passes", async () => {
    await withPrivateTmpdir(async (dir) => {
      const packageName = "@fixture/no-composables";
      await writePluginPackage(dir, {
        name: packageName,
        files: {
          "dist/index.js": rootSource("export function createThing() {\n  return 1;\n}\n"),
        },
      });

      const report = await runPluginConformance(spec({ root: dir, packageName }));
      expect(report.checks).toEqual(ranChecks());
      expect(report.findings).toEqual([]);
    });
  });

  it("reports a use* that throws a plain Error", async () => {
    await withPrivateTmpdir(async (dir) => {
      const packageName = "@fixture/use-plain";
      await writePluginPackage(dir, {
        name: packageName,
        files: {
          "dist/index.js": rootSource(
            'export function useThing() {\n  throw new Error("plain");\n}\n',
          ),
        },
      });
      const report = await runPluginConformance(spec({ root: dir, packageName }));
      const findings = findingsWithCode(report, ConformanceErrorCodes.RUNTIME_COMPOSABLE_CONTEXT);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toBe('export "useThing" did not throw a context error');
    });
  });

  it("reports an on* that returns outside a context", async () => {
    await withPrivateTmpdir(async (dir) => {
      const packageName = "@fixture/on-returns";
      await writePluginPackage(dir, {
        name: packageName,
        files: {
          "dist/index.js": rootSource("export function onThing() {\n  return 1;\n}\n"),
        },
      });
      const report = await runPluginConformance(spec({ root: dir, packageName }));
      const findings = findingsWithCode(report, ConformanceErrorCodes.RUNTIME_COMPOSABLE_CONTEXT);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toBe('export "onThing" did not throw a context error');
    });
  });
});
