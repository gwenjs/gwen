import { chmod, rm } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkPluginPackage, ConformanceErrorCodes } from "@gwenjs/plugin-conformance";
import type { ConformanceFinding, ConformanceReport } from "@gwenjs/plugin-conformance";
import {
  declarePeers,
  editManifest,
  fixtureOpener,
  goodPluginRoot,
  importLines,
  SLOW_TEST_MS,
  writeDeep,
  writeInstalledPackage,
  writeSource,
} from "./helpers/fixture.js";

const openFixture = fixtureOpener();

/** A directory mode 000 stays readable for root, and Windows has no such mode. */
const CAN_LOCK_DIRECTORY = process.platform !== "win32" && process.getuid?.() !== 0;

const ALL_CHECKS = [
  "exports",
  "snapshot-values",
  "snapshot-types",
  "publint",
  "attw",
  "readme",
  "imports",
  "hooks",
  "test-mocks",
  "manifest",
];

function importFindings(report: ConformanceReport): ConformanceFinding[] {
  return report.findings.filter((finding) => finding.code.startsWith("CONFORMANCE:IMPORT_"));
}

/** `<code> <file>:<line>` of each import finding, in report order. */
function sites(report: ConformanceReport): string[] {
  return importFindings(report).map((finding) => {
    const code: string = finding.code;
    return `${code.replace("CONFORMANCE:", "")} ${finding.file}:${finding.line}`;
  });
}

async function checkCopy(
  edit: (root: string) => Promise<void>,
  profile: "plugin" | "package" = "plugin",
): Promise<ConformanceReport> {
  const fixture = await openFixture();
  await edit(fixture.root);
  const report = await checkPluginPackage({ root: fixture.root, profile });
  expect(report.checks).toContain("imports");
  return report;
}

function only(report: ConformanceReport): ConformanceFinding {
  const [first, ...rest] = importFindings(report);
  expect(rest).toEqual([]);
  if (first === undefined) throw new Error("expected one import finding, got none");
  return first;
}

describe("imports check", () => {
  it(
    "reports an import of @gwenjs/core/internal with its file and line",
    { timeout: SLOW_TEST_MS },
    async () => {
      const report = await checkCopy((root) =>
        writeSource(
          root,
          "src/a.ts",
          '// header\nexport const marker = 1;\nimport { engineInternals } from "@gwenjs/core/internal";\nexport { engineInternals };\n',
        ),
      );
      const finding = only(report);
      expect(finding.code).toBe(ConformanceErrorCodes.IMPORT_INTERNAL);
      expect(finding.file).toBe("src/a.ts");
      expect(finding.line).toBe(3);
      expect(finding.message).toContain("@gwenjs/core/internal");
      expect(finding.message.startsWith("[")).toBe(false);
      expect(finding.hint.length).toBeGreaterThan(0);
      expect(report.findings).toHaveLength(1);
    },
  );

  it("reports an internal specifier bundled into dist", { timeout: SLOW_TEST_MS }, async () => {
    const report = await checkCopy((root) =>
      writeSource(
        root,
        "dist/index.js",
        'export const ready = true;\nexport const lazy = () => import("@gwenjs/core/internal");\n',
      ),
    );
    expect(sites(report)).toEqual(["IMPORT_INTERNAL dist/index.js:2"]);
  });

  it("reports an import of another plugin package", { timeout: SLOW_TEST_MS }, async () => {
    const report = await checkCopy((root) =>
      writeSource(root, "src/a.ts", 'export { useInput } from "@gwenjs/input";\n'),
    );
    const finding = only(report);
    expect(finding.code).toBe(ConformanceErrorCodes.IMPORT_FOREIGN_PLUGIN);
    expect(finding.file).toBe("src/a.ts");
    expect(finding.line).toBe(1);
    expect(finding.message).toContain("@gwenjs/input");
  });

  it(
    "reports a third-party package that peers on @gwenjs/core as another plugin",
    { timeout: SLOW_TEST_MS },
    async () => {
      const report = await checkCopy(async (root) => {
        await writeInstalledPackage(root, "lib-plugin", {
          peerDependencies: { "@gwenjs/core": "*" },
        });
        await writeInstalledPackage(root, "lib-plain", { dependencies: { left: "1.0.0" } });
        await writeSource(
          root,
          "src/a.ts",
          'import { a } from "lib-plugin/sub";\nimport { b } from "lib-plain";\nexport { a, b };\n',
        );
      });
      expect(sites(report)).toEqual(["IMPORT_FOREIGN_PLUGIN src/a.ts:1"]);
      expect(importFindings(report)[0]?.message).toContain("lib-plugin");
    },
  );

  it(
    "reports a third-party package of type plugin found above the root",
    { timeout: SLOW_TEST_MS },
    async () => {
      const fixture = await openFixture();
      const parent = path.dirname(fixture.root);
      await writeInstalledPackage(parent, "lib-up", { gwen: { type: "plugin" } });
      await writeSource(fixture.root, "src/a.ts", 'export { a } from "lib-up";\n');
      const report = await checkPluginPackage({ root: fixture.root, profile: "plugin" });
      expect(sites(report)).toEqual(["IMPORT_FOREIGN_PLUGIN src/a.ts:1"]);
    },
  );

  it(
    "accepts <base>/extension of a package listed in gwen.extends",
    { timeout: SLOW_TEST_MS },
    async () => {
      const report = await checkCopy(async (root) => {
        await editManifest(root, (manifest) => {
          manifest.name = "community-plugin";
          manifest.gwen = { type: "plugin", extends: ["@gwenjs/camera2d"] };
        });
        await writeSource(
          root,
          "src/a.ts",
          'export { cameraExtension } from "@gwenjs/camera2d/extension";\n',
        );
      });
      expect(report.checks).toEqual(ALL_CHECKS);
      expect(report.findings).toEqual([]);
    },
  );

  it("reports the same import without gwen.extends", { timeout: SLOW_TEST_MS }, async () => {
    const report = await checkCopy(async (root) => {
      await editManifest(root, (manifest) => {
        manifest.name = "community-plugin";
      });
      await writeSource(
        root,
        "src/a.ts",
        'export { cameraExtension } from "@gwenjs/camera2d/extension";\n',
      );
    });
    expect(sites(report)).toEqual(["IMPORT_FOREIGN_PLUGIN src/a.ts:1"]);
  });

  it(
    "never grants the gwen.extends exception to an official package",
    { timeout: SLOW_TEST_MS },
    async () => {
      const report = await checkCopy(async (root) => {
        await editManifest(root, (manifest) => {
          manifest.name = "@gwenjs/official-plugin";
          manifest.gwen = { type: "plugin", extends: ["@gwenjs/camera2d"] };
        });
        await writeSource(
          root,
          "src/a.ts",
          'export { cameraExtension } from "@gwenjs/camera2d/extension";\n',
        );
      });
      expect(sites(report)).toEqual(["IMPORT_FOREIGN_PLUGIN src/a.ts:1"]);
    },
  );

  it(
    "reports cameraPathStore imported from the camera-core root",
    { timeout: SLOW_TEST_MS },
    async () => {
      const report = await checkCopy(async (root) => {
        await declarePeers(root, ["@gwenjs/camera-core"]);
        await writeSource(
          root,
          "src/a.ts",
          'import { CameraCorePlugin, cameraPathStore } from "@gwenjs/camera-core";\nexport { CameraCorePlugin, cameraPathStore };\n',
        );
      });
      const finding = only(report);
      expect(finding.code).toBe(ConformanceErrorCodes.IMPORT_NOT_PUBLIC);
      expect(finding.file).toBe("src/a.ts");
      expect(finding.line).toBe(1);
      expect(finding.message).toContain("cameraPathStore");
      expect(finding.message).toContain("@gwenjs/camera-core");
    },
  );

  it(
    "reports a namespace import whose accessed property is not public",
    { timeout: SLOW_TEST_MS },
    async () => {
      const report = await checkCopy(async (root) => {
        await declarePeers(root, ["@gwenjs/core"]);
        await writeSource(
          root,
          "src/a.ts",
          [
            'import * as core from "@gwenjs/core";',
            "export const fine = core.createEngine;",
            "export const bad = core.notPublic;",
            'export const worse = core["alsoNotPublic"];',
            "export type Typed = core.NotPublicType;",
            "",
          ].join("\n"),
        );
      });
      expect(sites(report)).toEqual([
        "IMPORT_NOT_PUBLIC src/a.ts:3",
        "IMPORT_NOT_PUBLIC src/a.ts:4",
        "IMPORT_NOT_PUBLIC src/a.ts:5",
      ]);
      const names = importFindings(report).map((finding) => finding.message);
      expect(names[0]).toContain("notPublic");
      expect(names[1]).toContain("alsoNotPublic");
      expect(names[2]).toContain("NotPublicType");
    },
  );

  it(
    "reports @gwenjs/core/testing in src and accepts it in tests",
    { timeout: SLOW_TEST_MS },
    async () => {
      const text =
        'import { createRealEngine } from "@gwenjs/core/testing";\nexport { createRealEngine };\n';
      const report = await checkCopy(async (root) => {
        await declarePeers(root, ["@gwenjs/core"]);
        await writeSource(root, "src/a.ts", text);
        await writeSource(root, "src/b.test.ts", text);
        await writeDeep(root, "tests/c.ts", text);
      });
      const finding = only(report);
      expect(finding.code).toBe(ConformanceErrorCodes.IMPORT_FORBIDDEN_ENTRY);
      expect(finding.file).toBe("src/a.ts");
      expect(finding.line).toBe(1);
      expect(finding.message).toContain("@gwenjs/core/testing");
    },
  );

  it(
    "reports @gwenjs/core/dist/index.js and a relative path leaving the root",
    { timeout: SLOW_TEST_MS },
    async () => {
      const report = await checkCopy(async (root) => {
        await writeSource(
          root,
          "src/a.ts",
          [
            'import { a } from "@gwenjs/core/dist/index.js";',
            'import { b } from "../../outside.js";',
            'import { c } from "./local.js";',
            'import d from "../package.json";',
            "export { a, b, c, d };",
            "",
          ].join("\n"),
        );
      });
      expect(sites(report)).toEqual(["IMPORT_DEEP src/a.ts:1", "IMPORT_DEEP src/a.ts:2"]);
    },
  );

  it(
    "reports a dist path of another plugin as deep, not as foreign",
    { timeout: SLOW_TEST_MS },
    async () => {
      const report = await checkCopy((root) =>
        writeSource(root, "src/a.ts", 'export { a } from "@gwenjs/input/dist/index.js";\n'),
      );
      expect(sites(report)).toEqual(["IMPORT_DEEP src/a.ts:1"]);
    },
  );

  it(
    "reports an unknown subpath of a framework package as deep",
    { timeout: SLOW_TEST_MS },
    async () => {
      const report = await checkCopy(async (root) => {
        await declarePeers(root, ["@gwenjs/core"]);
        await writeSource(root, "src/a.ts", 'export { a } from "@gwenjs/core/nope";\n');
      });
      expect(sites(report)).toEqual(["IMPORT_DEEP src/a.ts:1"]);
    },
  );

  it(
    "reports an @gwenjs import missing from peerDependencies",
    { timeout: SLOW_TEST_MS },
    async () => {
      const report = await checkCopy(async (root) => {
        await editManifest(root, (manifest) => {
          manifest.devDependencies = { "@gwenjs/kit": "*" };
        });
        await writeSource(
          root,
          "src/a.ts",
          'import { useLogger } from "@gwenjs/kit";\nexport { useLogger };\n',
        );
        await writeDeep(
          root,
          "tests/b.test.ts",
          'import { useLogger } from "@gwenjs/kit";\nexport { useLogger };\n',
        );
      });
      const finding = only(report);
      expect(finding.code).toBe(ConformanceErrorCodes.IMPORT_UNDECLARED);
      expect(finding.file).toBe("src/a.ts");
      expect(finding.line).toBe(1);
      expect(finding.message).toContain("@gwenjs/kit");
      expect(finding.message).toContain("peerDependencies");
    },
  );

  it(
    "reports one finding per line that imports an undeclared framework package",
    { timeout: SLOW_TEST_MS },
    async () => {
      const report = await checkCopy((root) =>
        writeSource(
          root,
          "src/a.ts",
          'import { useLogger } from "@gwenjs/kit";\nexport { definePlugin } from "@gwenjs/kit/plugin";\nexport { useLogger };\n',
        ),
      );
      expect(sites(report)).toEqual([
        "IMPORT_UNDECLARED src/a.ts:1",
        "IMPORT_UNDECLARED src/a.ts:2",
      ]);
    },
  );

  it(
    "reports a default import of an entry without a default export",
    { timeout: SLOW_TEST_MS },
    async () => {
      const report = await checkCopy(async (root) => {
        await declarePeers(root, ["@gwenjs/core"]);
        await writeSource(root, "src/a.ts", 'import core from "@gwenjs/core";\nexport { core };\n');
      });
      expect(sites(report)).toEqual(["IMPORT_NOT_PUBLIC src/a.ts:1"]);
      expect(importFindings(report)[0]?.message).toContain("default");
    },
  );

  it("accepts a module entry through its default export", { timeout: SLOW_TEST_MS }, async () => {
    const report = await checkCopy(async (root) => {
      await declarePeers(root, ["@gwenjs/core", "@gwenjs/renderer-core"]);
      await writeSource(
        root,
        "src/a.ts",
        [
          'import systemModule from "@gwenjs/core/system/module";',
          'import rendererModule from "@gwenjs/renderer-core/module";',
          "export { systemModule, rendererModule };",
          "",
        ].join("\n"),
      );
    });
    expect(importFindings(report)).toEqual([]);
  });

  it(
    "reports an app, vite or physics package as a forbidden entry",
    { timeout: SLOW_TEST_MS },
    async () => {
      const report = await checkCopy((root) =>
        writeSource(
          root,
          "src/a.ts",
          [
            'import { defineConfig } from "@gwenjs/app";',
            'import { gwen } from "@gwenjs/vite";',
            'import { usePhysics2D } from "@gwenjs/physics2d";',
            "export { defineConfig, gwen, usePhysics2D };",
            "",
          ].join("\n"),
        ),
      );
      expect(sites(report)).toEqual([
        "IMPORT_FORBIDDEN_ENTRY src/a.ts:1",
        "IMPORT_FORBIDDEN_ENTRY src/a.ts:2",
        "IMPORT_FORBIDDEN_ENTRY src/a.ts:3",
      ]);
    },
  );

  it(
    "reads export-from, type-only, dynamic, require and import-equals specifiers",
    { timeout: SLOW_TEST_MS },
    async () => {
      const report = await checkCopy(async (root) => {
        await declarePeers(root, ["@gwenjs/kit"]);
        await writeSource(
          root,
          "src/a.ts",
          [
            'export { missingA } from "@gwenjs/kit";',
            'import type { MissingB } from "@gwenjs/kit";',
            'export const lazy = () => import("@gwenjs/core/internal");',
            'export const loaded = require("@gwenjs/core/internal");',
            'import legacy = require("@gwenjs/core/internal");',
            'export type Shape = import("@gwenjs/kit").MissingC;',
            "export { legacy, type MissingB };",
            "",
          ].join("\n"),
        );
      });
      expect(sites(report)).toEqual([
        "IMPORT_NOT_PUBLIC src/a.ts:1",
        "IMPORT_NOT_PUBLIC src/a.ts:2",
        "IMPORT_INTERNAL src/a.ts:3",
        "IMPORT_INTERNAL src/a.ts:4",
        "IMPORT_INTERNAL src/a.ts:5",
        "IMPORT_NOT_PUBLIC src/a.ts:6",
      ]);
    },
  );

  it("accepts the package's own name and subpaths", { timeout: SLOW_TEST_MS }, async () => {
    const report = await checkCopy(async (root) => {
      await editManifest(root, (manifest) => {
        manifest.name = "@gwenjs/official-plugin";
      });
      await writeSource(
        root,
        "src/a.ts",
        'export { ready } from "@gwenjs/official-plugin";\nexport { x } from "@gwenjs/official-plugin/internal";\n',
      );
    });
    expect(importFindings(report)).toEqual([]);
  });

  it("reports the same specifier in src and in tests", { timeout: SLOW_TEST_MS }, async () => {
    const text = 'import { x } from "@gwenjs/core/internal";\nexport { x };\n';
    const report = await checkCopy(async (root) => {
      await writeSource(root, "src/a.ts", text);
      await writeDeep(root, "tests/a.test.ts", text);
    });
    expect(sites(report)).toEqual([
      "IMPORT_INTERNAL src/a.ts:1",
      "IMPORT_INTERNAL tests/a.test.ts:1",
    ]);
  });

  it(
    "does not accept a framework package that is only in dependencies",
    { timeout: SLOW_TEST_MS },
    async () => {
      const report = await checkCopy(async (root) => {
        await editManifest(root, (manifest) => {
          manifest.dependencies = { "@gwenjs/kit": "*" };
        });
        await writeSource(
          root,
          "src/a.ts",
          'import { useLogger } from "@gwenjs/kit";\nexport { useLogger };\n',
        );
      });
      expect(sites(report)).toEqual(["IMPORT_UNDECLARED src/a.ts:1"]);
    },
  );

  it(
    "reads the imports of a test file outside src and tests",
    { timeout: SLOW_TEST_MS },
    async () => {
      const report = await checkCopy(async (root) => {
        await declarePeers(root, ["@gwenjs/core"]);
        await writeDeep(
          root,
          "e2e/a.test.ts",
          'import { x } from "@gwenjs/core/internal";\nimport { createRealEngine } from "@gwenjs/core/testing";\nexport { x, createRealEngine };\n',
        );
      });
      expect(sites(report)).toEqual(["IMPORT_INTERNAL e2e/a.test.ts:1"]);
    },
  );

  it(
    "ignores a script outside src that is not a test file",
    { timeout: SLOW_TEST_MS },
    async () => {
      const report = await checkCopy((root) =>
        writeDeep(root, "scripts/a.ts", 'export { x } from "@gwenjs/core/internal";\n'),
      );
      expect(importFindings(report)).toEqual([]);
    },
  );

  it("skips a declaration file of src", { timeout: SLOW_TEST_MS }, async () => {
    const report = await checkCopy((root) =>
      writeSource(root, "src/types.d.ts", 'export { x } from "@gwenjs/core/internal";\n'),
    );
    expect(importFindings(report)).toEqual([]);
  });

  it(
    "reads .mjs and .d.ts files of dist and only their internal specifiers",
    { timeout: SLOW_TEST_MS },
    async () => {
      const report = await checkCopy(async (root) => {
        await writeSource(
          root,
          "dist/index.js",
          [
            'export { createEngine } from "@gwenjs/core";',
            'export { a } from "@gwenjs/core/testing";',
            'export { b } from "../../outside.js";',
            'export { c } from "lib-plain";',
            "",
          ].join("\n"),
        );
        await writeDeep(root, "dist/chunk.mjs", 'export * from "@gwenjs/core/internal";\n');
        await writeDeep(
          root,
          "dist/types/a.d.ts",
          'export type Shape = import("@gwenjs/core/wasm/glue").Glue;\n',
        );
        await writeDeep(root, "dist/notes.txt", 'import "@gwenjs/core/internal"\n');
      });
      expect(sites(report)).toEqual([
        "IMPORT_INTERNAL dist/chunk.mjs:1",
        "IMPORT_INTERNAL dist/types/a.d.ts:1",
      ]);
    },
  );

  it.skipIf(!CAN_LOCK_DIRECTORY)(
    "rejects when an installed package cannot be read",
    { timeout: SLOW_TEST_MS },
    async () => {
      const fixture = await openFixture();
      await writeInstalledPackage(fixture.root, "lib-locked", {});
      await writeSource(fixture.root, "src/a.ts", 'export { a } from "lib-locked";\n');
      const locked = path.join(fixture.root, "node_modules", "lib-locked");
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

  it("reports nothing for an empty source file", { timeout: SLOW_TEST_MS }, async () => {
    const report = await checkCopy((root) => writeSource(root, "src/empty.ts", ""));
    expect(report.findings).toEqual([]);
  });

  it(
    "runs every check and reports nothing for the clean fixture",
    { timeout: SLOW_TEST_MS },
    async () => {
      const report = await checkPluginPackage({ root: goodPluginRoot(), profile: "plugin" });
      expect(report.checks).toEqual(ALL_CHECKS);
      expect(report.findings).toEqual([]);
    },
  );

  it("reports a plugin with no source file", { timeout: SLOW_TEST_MS }, async () => {
    const report = await checkCopy((root) => rm(path.join(root, "src"), { recursive: true }));
    expect(report.checks).toContain("imports");
    expect(importFindings(report)).toEqual([]);
  });

  it("reports all 200 offending lines of one file", { timeout: SLOW_TEST_MS }, async () => {
    const report = await checkCopy((root) =>
      writeSource(root, "src/long.ts", importLines("@gwenjs/core/internal", 200)),
    );
    const found = importFindings(report);
    expect(found).toHaveLength(200);
    expect(found.map((finding) => finding.line)).toEqual(
      Array.from({ length: 200 }, (_, index) => index + 1),
    );
  });

  it("reports 201 offending lines as 201 findings", { timeout: SLOW_TEST_MS }, async () => {
    const report = await checkCopy((root) =>
      writeSource(root, "src/long.ts", importLines("@gwenjs/core/internal", 201)),
    );
    expect(importFindings(report)).toHaveLength(201);
  });
});
