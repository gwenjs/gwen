import { chmod, mkdir } from "node:fs/promises";
import path from "node:path";
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

/** `object.method(argument);` built here, so this file holds no literal call. */
function callOf(object: string, method: string, argument: string): string {
  return `${object}.${method}(${argument});\n`;
}

/** A directory mode 000 stays readable for root, and Windows has no such mode. */
const CAN_LOCK_DIRECTORY = process.platform !== "win32" && process.getuid?.() !== 0;

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

  it(
    "accepts the regular expression forms of the package's own name and reports a longer name",
    { timeout: SLOW_TEST_MS },
    async () => {
      const report = await checkCopy(async (root) => {
        await editManifest(root, (manifest) => {
          manifest.name = "@gwenjs/own";
        });
        await writeSource(
          root,
          "vitest.config.ts",
          String.raw`export default {
  resolve: {
    alias: [
      { find: /^@gwenjs\/own$/, replacement: './src/index.ts' },
      { find: /@gwenjs\/own\/(.*)/, replacement: './src/$1.ts' },
      { find: /^@gwenjs\/own-other$/, replacement: './x.ts' },
    ],
  },
};
`,
        );
      });
      expect(sites(report)).toEqual(["vitest.config.ts:6"]);
    },
  );

  it(
    "names an @gwenjs package, not a framework package, in the message of a call and of an alias",
    { timeout: SLOW_TEST_MS },
    async () => {
      const report = await checkCopy(async (root) => {
        await writeDeep(root, "tests/a.test.ts", viCall("mock", "@gwenjs/input"));
        await writeSource(
          root,
          "vitest.config.ts",
          "export default { resolve: { alias: { '@gwenjs/input': './i.ts' } } };\n",
        );
      });
      const [call, alias] = mockFindings(report);
      expect(call?.message).toBe(`${MOCK_CALL} replaces "@gwenjs/input", an @gwenjs package`);
      expect(alias?.message).toBe("alias for @gwenjs/input replaces an @gwenjs package");
      expect(call?.hint).toBe(alias?.hint);
      expect(call?.hint).toContain("createRealEngine");
      expect(call?.hint).not.toContain("framework");
    },
  );

  it(
    "reports a mock whose first argument is a template without substitution",
    { timeout: SLOW_TEST_MS },
    async () => {
      const report = await checkCopy((root) =>
        writeDeep(root, "tests/a.test.ts", callOf("vi", "mock", "`@gwenjs/schema`")),
      );
      expect(sites(report)).toEqual(["tests/a.test.ts:1"]);
    },
  );

  it.skipIf(!CAN_LOCK_DIRECTORY)(
    "rejects when a directory of the package cannot be read",
    { timeout: SLOW_TEST_MS },
    async () => {
      const fixture = await openFixture();
      const locked = path.join(fixture.root, "tests");
      await mkdir(locked);
      await chmod(locked, 0o000);
      try {
        await expect(
          checkPluginPackage({ root: fixture.root, profile: "plugin" }),
        ).rejects.toMatchObject({ code: "EACCES" });
      } finally {
        await chmod(locked, 0o755);
      }
    },
  );

  it("reads a *.test.* file outside src, tests and test", { timeout: SLOW_TEST_MS }, async () => {
    const report = await checkCopy((root) =>
      writeDeep(root, "e2e/a.test.ts", viCall("mock", "@gwenjs/core")),
    );
    expect(sites(report)).toEqual(["e2e/a.test.ts:1"]);
  });

  it("reads a *.spec.* file and a file under __tests__", { timeout: SLOW_TEST_MS }, async () => {
    const report = await checkCopy(async (root) => {
      await writeDeep(root, "e2e/b.spec.ts", viCall("mock", "@gwenjs/core"));
      await writeDeep(root, "lib/__tests__/c.ts", viCall("doMock", "@gwenjs/kit"));
    });
    expect(sites(report)).toEqual(["e2e/b.spec.ts:1", "lib/__tests__/c.ts:1"]);
  });

  it(
    "reads the js, mjs, cjs, jsx and tsx files under tests",
    { timeout: SLOW_TEST_MS },
    async () => {
      const report = await checkCopy(async (root) => {
        await writeDeep(root, "tests/a.test.mjs", viCall("mock", "@gwenjs/core"));
        await writeDeep(root, "tests/b.js", viCall("mock", "@gwenjs/kit"));
        await writeDeep(root, "tests/c.cjs", viCall("mock", "@gwenjs/math"));
        await writeDeep(root, "tests/d.jsx", viCall("mock", "@gwenjs/schema"));
        await writeDeep(root, "tests/e.tsx", viCall("mock", "@gwenjs/app"));
      });
      expect(sites(report)).toEqual([
        "tests/a.test.mjs:1",
        "tests/b.js:1",
        "tests/c.cjs:1",
        "tests/d.jsx:1",
        "tests/e.tsx:1",
      ]);
    },
  );

  it("reads the setup files at the package root", { timeout: SLOW_TEST_MS }, async () => {
    const report = await checkCopy(async (root) => {
      await writeSource(root, "vitest.setup.ts", viCall("mock", "@gwenjs/core"));
      await writeSource(root, "app.setup.mjs", viCall("mock", "@gwenjs/kit"));
    });
    expect(sites(report)).toEqual(["app.setup.mjs:1", "vitest.setup.ts:1"]);
  });

  it(
    "does not read node_modules, dist, a dot directory, a .d.ts file or a setup file below the root",
    { timeout: SLOW_TEST_MS },
    async () => {
      const report = await checkCopy(async (root) => {
        const text = viCall("mock", "@gwenjs/core");
        await writeDeep(root, "node_modules/dep/a.test.ts", text);
        await writeDeep(root, "dist/a.test.js", text);
        await writeDeep(root, ".cache/a.test.ts", text);
        await writeDeep(root, "tests/types.d.ts", text);
        await writeDeep(root, "src/vitest.setup.ts", text);
      });
      expect(mockFindings(report)).toEqual([]);
    },
  );

  it("reads a vi renamed by the vitest import", { timeout: SLOW_TEST_MS }, async () => {
    const report = await checkCopy((root) =>
      writeDeep(
        root,
        "tests/a.test.ts",
        `import { vi as v } from "vitest";\n${callOf("v", "mock", '"@gwenjs/core"')}`,
      ),
    );
    expect(sites(report)).toEqual(["tests/a.test.ts:2"]);
  });

  it(
    "reads a mock whose first argument is the typed import form",
    { timeout: SLOW_TEST_MS },
    async () => {
      const report = await checkCopy((root) =>
        writeDeep(root, "tests/a.test.ts", callOf("vi", "mock", 'import("@gwenjs/kit")')),
      );
      expect(sites(report)).toEqual(["tests/a.test.ts:1"]);
    },
  );

  it("reads a mock written with a string element access", { timeout: SLOW_TEST_MS }, async () => {
    const report = await checkCopy((root) =>
      writeDeep(
        root,
        "tests/a.test.ts",
        'vi["mock"]("@gwenjs/math");\nvi["doMock"]("@gwenjs/app");\n',
      ),
    );
    expect(sites(report)).toEqual(["tests/a.test.ts:1", "tests/a.test.ts:2"]);
  });

  it(
    "does not read a local v as vi when it is not imported from vitest",
    { timeout: SLOW_TEST_MS },
    async () => {
      const report = await checkCopy(async (root) => {
        await writeDeep(
          root,
          "tests/a.test.ts",
          `const v = { mock(name: string): string { return name; } };\n${callOf("v", "mock", '"@gwenjs/core"')}`,
        );
        await writeDeep(
          root,
          "tests/b.test.ts",
          `import { vi as v } from "./helpers.js";\n${callOf("v", "mock", '"@gwenjs/core"')}`,
        );
      });
      expect(mockFindings(report)).toEqual([]);
    },
  );

  it("reads vitest.config.unit.ts and vite.config.e2e.mts", { timeout: SLOW_TEST_MS }, async () => {
    const report = await checkCopy(async (root) => {
      await writeSource(
        root,
        "vitest.config.unit.ts",
        "export default { resolve: { alias: { '@gwenjs/core': './a.ts' } } };\n",
      );
      await writeSource(
        root,
        "vite.config.e2e.mts",
        "export default { resolve: { alias: { '@gwenjs/kit': './b.ts' } } };\n",
      );
    });
    expect(sites(report)).toEqual(["vite.config.e2e.mts:1", "vitest.config.unit.ts:1"]);
  });

  it("reports a computed string alias key", { timeout: SLOW_TEST_MS }, async () => {
    const report = await checkCopy((root) =>
      writeSource(
        root,
        "vitest.config.ts",
        [
          "export default {",
          "  resolve: { alias: {",
          "    ['@gwenjs/kit']: './a.ts',",
          "  } },",
          "};",
          "",
        ].join("\n"),
      ),
    );
    expect(sites(report)).toEqual(["vitest.config.ts:3"]);
  });

  it(
    "reports an alias key reached through a spread of an object literal",
    { timeout: SLOW_TEST_MS },
    async () => {
      const report = await checkCopy((root) =>
        writeSource(
          root,
          "vitest.config.ts",
          [
            "export default {",
            "  resolve: { alias: {",
            "    ...{ '@gwenjs/math': './a.ts' },",
            "  } },",
            "};",
            "",
          ].join("\n"),
        ),
      );
      expect(sites(report)).toEqual(["vitest.config.ts:3"]);
    },
  );

  it(
    "reports an alias key reached through a spread of a const table",
    { timeout: SLOW_TEST_MS },
    async () => {
      const report = await checkCopy((root) =>
        writeSource(
          root,
          "vitest.config.ts",
          [
            "const table = {",
            "  '@gwenjs/core': './a.ts',",
            "};",
            "export default { resolve: { alias: { ...table, '~/x': './x.ts' } } };",
            "",
          ].join("\n"),
        ),
      );
      expect(sites(report)).toEqual(["vitest.config.ts:2"]);
    },
  );

  it("reads a quoted alias property name", { timeout: SLOW_TEST_MS }, async () => {
    const report = await checkCopy((root) =>
      writeSource(
        root,
        "vitest.config.ts",
        [
          "export default { resolve: {",
          "  'alias': { '@gwenjs/core': './a.ts' },",
          "} };",
          "",
        ].join("\n"),
      ),
    );
    expect(sites(report)).toEqual(["vitest.config.ts:2"]);
  });

  it("reads a quoted find property name", { timeout: SLOW_TEST_MS }, async () => {
    const report = await checkCopy((root) =>
      writeSource(
        root,
        "vitest.config.ts",
        [
          "export default { resolve: { alias: [",
          "  { 'find': '@gwenjs/app', replacement: './a.ts' },",
          "] } };",
          "",
        ].join("\n"),
      ),
    );
    expect(sites(report)).toEqual(["vitest.config.ts:2"]);
  });

  it("reports a table that spreads itself once", { timeout: SLOW_TEST_MS }, async () => {
    const report = await checkCopy((root) =>
      writeSource(
        root,
        "vitest.config.ts",
        [
          "const table = { ...table, '@gwenjs/kit': './a.ts' };",
          "export default { resolve: { alias: table } };",
          "",
        ].join("\n"),
      ),
    );
    expect(sites(report)).toEqual(["vitest.config.ts:1"]);
  });
});
