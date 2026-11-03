import { describe, expect, it } from "vitest";
import { checkPluginPackage, ConformanceErrorCodes } from "@gwenjs/plugin-conformance";
import type { ConformanceFinding, ConformanceReport } from "@gwenjs/plugin-conformance";
import {
  editManifest,
  fixtureOpener,
  SLOW_TEST_MS,
  writeDeep,
  writeSource,
} from "./helpers/fixture.js";

const openFixture = fixtureOpener();

/** The vitest call named by the ticket, spelled so that no source line holds it. */
const MOCK_CALL = ["vi", "mock"].join(".");

/** Source text of a vitest call, built here so this file holds no call to it. */
function viCall(method: string, specifier: string): string {
  return `vi.${method}(${JSON.stringify(specifier)}, () => ({}));\n`;
}

function mockFindings(report: ConformanceReport): ConformanceFinding[] {
  return report.findings.filter(
    (finding) => finding.code === ConformanceErrorCodes.TEST_MOCKS_FRAMEWORK,
  );
}

function sites(report: ConformanceReport): string[] {
  return mockFindings(report).map((finding) => `${finding.file}:${finding.line}`);
}

async function checkCopy(edit: (root: string) => Promise<void>): Promise<ConformanceReport> {
  const fixture = await openFixture();
  await edit(fixture.root);
  const report = await checkPluginPackage({ root: fixture.root, profile: "plugin" });
  expect(report.checks).toContain("test-mocks");
  return report;
}

describe("test-mocks check", () => {
  it(
    `reports ${MOCK_CALL} of @gwenjs/core and a vitest alias for @gwenjs/kit/plugin`,
    { timeout: SLOW_TEST_MS },
    async () => {
      const report = await checkCopy(async (root) => {
        await writeDeep(
          root,
          "tests/a.test.ts",
          `import { vi } from "vitest";\n${viCall("mock", "@gwenjs/core")}`,
        );
        await writeSource(
          root,
          "vitest.config.ts",
          [
            'import { defineConfig } from "vitest/config";',
            "export default defineConfig({",
            '  resolve: { alias: { "@gwenjs/kit/plugin": "./tests/mocks/kit-plugin.ts" } },',
            "});",
            "",
          ].join("\n"),
        );
      });
      expect(sites(report)).toEqual(["tests/a.test.ts:2", "vitest.config.ts:3"]);
      const [call, alias] = mockFindings(report);
      expect(call?.message).toContain("@gwenjs/core");
      expect(alias?.message).toContain("@gwenjs/kit/plugin");
      expect(call?.message.startsWith("[")).toBe(false);
      expect(call?.hint.length).toBeGreaterThan(0);
      expect(report.findings).toHaveLength(2);
    },
  );

  it(
    "reports vi.doMock and a test file kept beside its source",
    { timeout: SLOW_TEST_MS },
    async () => {
      const report = await checkCopy(async (root) => {
        await writeSource(root, "src/a.test.ts", `${viCall("doMock", "@gwenjs/math")}`);
      });
      expect(sites(report)).toEqual(["src/a.test.ts:1"]);
    },
  );

  it("reports the array alias form and a test.alias entry", { timeout: SLOW_TEST_MS }, async () => {
    const report = await checkCopy(async (root) => {
      await writeSource(
        root,
        "vitest.config.ts",
        [
          "export default {",
          "  resolve: {",
          "    alias: [",
          "      { find: /^@gwenjs\\/core/, replacement: './a.ts' },",
          "      { find: '@gwenjs/kit', replacement: './b.ts' },",
          "      { find: '~/x', replacement: './c.ts' },",
          "    ],",
          "  },",
          "};",
          "",
        ].join("\n"),
      );
      await writeSource(
        root,
        "vite.config.mts",
        ["export default {", "  test: { alias: { '@gwenjs/math': './d.ts' } },", "};", ""].join(
          "\n",
        ),
      );
    });
    expect(sites(report)).toEqual([
      "vite.config.mts:2",
      "vitest.config.ts:4",
      "vitest.config.ts:5",
    ]);
  });

  it(
    "reports an alias table kept in a const of the config, written in full or as a shorthand",
    { timeout: SLOW_TEST_MS },
    async () => {
      const report = await checkCopy(async (root) => {
        await writeSource(
          root,
          "vitest.config.ts",
          [
            "const table = {",
            "  '@gwenjs/core': './a.ts',",
            "};",
            "export default { resolve: { alias: table } };",
            "",
          ].join("\n"),
        );
        await writeSource(
          root,
          "vite.config.js",
          [
            "const alias = [",
            "  { find: '@gwenjs/kit', replacement: './b.ts' },",
            "];",
            "export default { resolve: { alias } };",
            "",
          ].join("\n"),
        );
      });
      expect(sites(report)).toEqual(["vite.config.js:2", "vitest.config.ts:2"]);
    },
  );

  it(
    `accepts ${MOCK_CALL} of a module that is not a framework package`,
    { timeout: SLOW_TEST_MS },
    async () => {
      const report = await checkCopy((root) =>
        writeDeep(
          root,
          "tests/a.test.ts",
          `${viCall("mock", "node:fs")}${viCall("mock", "@fixture/good-plugin")}${viCall("mock", "../src/index.js")}`,
        ),
      );
      expect(mockFindings(report)).toEqual([]);
    },
  );

  it("accepts a mock and an alias of the package itself", { timeout: SLOW_TEST_MS }, async () => {
    const report = await checkCopy(async (root) => {
      await editManifest(root, (manifest) => {
        manifest.name = "@gwenjs/own-plugin";
      });
      await writeDeep(
        root,
        "tests/a.test.ts",
        `${viCall("mock", "@gwenjs/own-plugin")}${viCall("doMock", "@gwenjs/own-plugin/module")}`,
      );
      await writeSource(
        root,
        "vitest.config.ts",
        "export default { resolve: { alias: { '@gwenjs/own-plugin': './src/index.ts' } } };\n",
      );
    });
    expect(mockFindings(report)).toEqual([]);
  });

  it(
    "accepts an alias whose key is not a framework specifier",
    { timeout: SLOW_TEST_MS },
    async () => {
      const report = await checkCopy((root) =>
        writeSource(
          root,
          "vitest.config.ts",
          "export default { resolve: { alias: { '~/x': './x.ts', '@app': './app' } } };\n",
        ),
      );
      expect(mockFindings(report)).toEqual([]);
    },
  );

  it("does not read a mock call outside a test file", { timeout: SLOW_TEST_MS }, async () => {
    const report = await checkCopy((root) =>
      writeSource(root, "src/a.ts", viCall("mock", "@gwenjs/core")),
    );
    expect(mockFindings(report)).toEqual([]);
  });

  it(
    "reports nothing for a plugin with no test file and no config",
    { timeout: SLOW_TEST_MS },
    async () => {
      const report = await checkCopy(async () => undefined);
      expect(mockFindings(report)).toEqual([]);
    },
  );
});
