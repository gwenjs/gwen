import { chmod, rm } from "node:fs/promises";
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

/** A file mode 000 stays readable for root, and Windows has no such mode. */
const CAN_LOCK_FILE = process.platform !== "win32" && process.getuid?.() !== 0;

function augmentFindings(report: ConformanceReport): ConformanceFinding[] {
  return report.findings.filter((finding) => finding.code === ConformanceErrorCodes.AUGMENT_TARGET);
}

/** `<file>:<line>` of each augment finding, in report order. */
function sites(report: ConformanceReport): string[] {
  return augmentFindings(report).map((finding) => `${finding.file}:${finding.line}`);
}

async function checkCopy(edit: (root: string) => Promise<void>): Promise<ConformanceReport> {
  const fixture = await openFixture();
  await edit(fixture.root);
  const report = await checkPluginPackage({ root: fixture.root, profile: "plugin" });
  expect(report.checks).toContain("augment");
  return report;
}

/** Source text that adds `members` to `GwenProvides` of `@gwenjs/schema`. */
function providesAugmentation(...members: string[]): string {
  return [
    "export {};",
    'declare module "@gwenjs/schema" {',
    "  interface GwenProvides {",
    ...members.map((member) => `    ${member}`),
    "  }",
    "}",
    "",
  ].join("\n");
}

describe("augment check", () => {
  it('reports declare module "@gwenjs/core"', { timeout: SLOW_TEST_MS }, async () => {
    const report = await checkCopy((root) =>
      writeSource(
        root,
        "src/a.ts",
        'export {};\ndeclare module "@gwenjs/core" {\n  interface Extra {\n    x: number;\n  }\n}\n',
      ),
    );
    const [finding, ...rest] = augmentFindings(report);
    expect(rest).toEqual([]);
    expect(finding?.file).toBe("src/a.ts");
    expect(finding?.line).toBe(2);
    expect(finding?.message).toContain("@gwenjs/core");
    expect(finding?.message.startsWith("[")).toBe(false);
    expect(finding?.hint).toContain("@gwenjs/schema");
    expect(report.findings).toHaveLength(1);
  });

  it(
    "reports a GwenProvides key already declared by renderer-core",
    { timeout: SLOW_TEST_MS },
    async () => {
      // renderer-core declares no GwenProvides member: `cameraManager` is declared by
      // @gwenjs/schema (packages/schema/src/plugin.ts), and the finding names that package.
      const report = await checkCopy((root) =>
        writeSource(
          root,
          "src/a.ts",
          providesAugmentation("cameraManager: object;", "ownService: number;"),
        ),
      );
      const [finding, ...rest] = augmentFindings(report);
      expect(rest).toEqual([]);
      expect(finding?.file).toBe("src/a.ts");
      expect(finding?.line).toBe(4);
      expect(finding?.message).toBe(
        'GwenProvides key "cameraManager" is already declared by @gwenjs/schema',
      );
      expect(finding?.message.startsWith("[")).toBe(false);
      expect(finding?.hint).not.toBe("");
      expect(report.findings).toHaveLength(1);
    },
  );

  it(
    "names the package that declares a key added by an augmentation",
    { timeout: SLOW_TEST_MS },
    async () => {
      const report = await checkCopy((root) =>
        writeSource(root, "src/a.ts", providesAugmentation("physics2d: object;")),
      );
      const [finding, ...rest] = augmentFindings(report);
      expect(rest).toEqual([]);
      expect(finding?.line).toBe(4);
      expect(finding?.message).toBe(
        'GwenProvides key "physics2d" is already declared by @gwenjs/physics2d',
      );
    },
  );

  it("reports every framework key of a GwenProvides block", { timeout: SLOW_TEST_MS }, async () => {
    const report = await checkCopy((root) =>
      writeSource(
        root,
        "src/a.ts",
        providesAugmentation("logger: object;", "ownService: number;", "assets: object;"),
      ),
    );
    expect(sites(report)).toEqual(["src/a.ts:4", "src/a.ts:6"]);
  });

  it("reports a framework key written as a string literal", { timeout: SLOW_TEST_MS }, async () => {
    const report = await checkCopy((root) =>
      writeSource(root, "src/a.ts", providesAugmentation('"scene:registrar": object;')),
    );
    const [finding, ...rest] = augmentFindings(report);
    expect(rest).toEqual([]);
    expect(finding?.line).toBe(4);
    expect(finding?.message).toBe(
      'GwenProvides key "scene:registrar" is already declared by @gwenjs/core',
    );
  });

  it(
    "reports a framework key written as a computed string",
    { timeout: SLOW_TEST_MS },
    async () => {
      const report = await checkCopy((root) =>
        writeSource(root, "src/a.ts", providesAugmentation('["transform:2d"]: object;')),
      );
      const [finding, ...rest] = augmentFindings(report);
      expect(rest).toEqual([]);
      expect(finding?.line).toBe(4);
      expect(finding?.message).toBe(
        'GwenProvides key "transform:2d" is already declared by @gwenjs/schema',
      );
    },
  );

  it(
    "reports a framework key declared as a method signature",
    { timeout: SLOW_TEST_MS },
    async () => {
      const report = await checkCopy((root) =>
        writeSource(root, "src/a.ts", providesAugmentation("errors(): void;")),
      );
      const [finding, ...rest] = augmentFindings(report);
      expect(rest).toEqual([]);
      expect(finding?.line).toBe(4);
      expect(finding?.message).toBe(
        'GwenProvides key "errors" is already declared by @gwenjs/core',
      );
    },
  );

  it("reports a subpath of a framework package", { timeout: SLOW_TEST_MS }, async () => {
    const report = await checkCopy((root) =>
      writeSource(root, "src/a.ts", 'declare module "@gwenjs/core/system" {}\nexport {};\n'),
    );
    const [finding, ...rest] = augmentFindings(report);
    expect(rest).toEqual([]);
    expect(finding?.file).toBe("src/a.ts");
    expect(finding?.line).toBe(1);
    expect(finding?.message).toContain("@gwenjs/core/system");
  });

  it("reports a declare module in a test file", { timeout: SLOW_TEST_MS }, async () => {
    const report = await checkCopy((root) =>
      writeDeep(root, "tests/b.test.ts", 'declare module "@gwenjs/kit" {}\nexport {};\n'),
    );
    expect(sites(report)).toEqual(["tests/b.test.ts:1"]);
  });

  it(
    "reports a declare module of a test directory under src once",
    { timeout: SLOW_TEST_MS },
    async () => {
      // src/__tests__/a.ts is both a runtime file and a test file.
      const report = await checkCopy((root) =>
        writeDeep(root, "src/__tests__/a.ts", 'declare module "@gwenjs/kit" {}\nexport {};\n'),
      );
      expect(sites(report)).toEqual(["src/__tests__/a.ts:1"]);
    },
  );

  it(
    "reports the same declaration in src and in a test file",
    { timeout: SLOW_TEST_MS },
    async () => {
      const text = 'export {};\ndeclare module "@gwenjs/core" {}\n';
      const report = await checkCopy(async (root) => {
        await writeSource(root, "src/a.ts", text);
        await writeDeep(root, "tests/a.test.ts", text);
      });
      expect(sites(report)).toEqual(["src/a.ts:2", "tests/a.test.ts:2"]);
    },
  );

  it("accepts the own package name and its subpaths", { timeout: SLOW_TEST_MS }, async () => {
    const report = await checkCopy(async (root) => {
      await editManifest(root, (manifest) => {
        manifest.name = "@gwenjs/community-thing";
      });
      await writeSource(
        root,
        "src/a.ts",
        [
          "export {};",
          'declare module "@gwenjs/community-thing" {',
          "  interface Own {}",
          "}",
          'declare module "@gwenjs/community-thing/module" {',
          "  interface OwnModule {}",
          "}",
          "",
        ].join("\n"),
      );
    });
    expect(augmentFindings(report)).toEqual([]);
  });

  it(
    "reports another framework package from a plugin named @gwenjs",
    { timeout: SLOW_TEST_MS },
    async () => {
      const report = await checkCopy(async (root) => {
        await editManifest(root, (manifest) => {
          manifest.name = "@gwenjs/community-thing";
        });
        await writeSource(
          root,
          "src/a.ts",
          [
            "export {};",
            'declare module "@gwenjs/core" {}',
            'declare module "@gwenjs/community-thing-extra" {}',
            "",
          ].join("\n"),
        );
      });
      const found = augmentFindings(report);
      expect(found.map((finding) => finding.line)).toEqual([2, 3]);
      expect(found[0]?.message).toContain("@gwenjs/core");
      expect(found[1]?.message).toContain("@gwenjs/community-thing-extra");
    },
  );

  it(
    "accepts a new GwenProvides key and a module that is not a framework package",
    { timeout: SLOW_TEST_MS },
    async () => {
      const report = await checkCopy(async (root) => {
        await editManifest(root, (manifest) => {
          manifest.name = "@fixture/good-plugin";
        });
        await writeSource(
          root,
          "src/a.ts",
          [
            "export {};",
            'declare module "@gwenjs/schema" {',
            "  interface GwenProvides {",
            "    ownService: number;",
            "  }",
            "}",
            'declare module "@fixture/good-plugin" {',
            "  interface Own {}",
            "}",
            'declare module "vue" {',
            "  interface Other {}",
            "}",
            "",
          ].join("\n"),
        );
      });
      expect(augmentFindings(report)).toEqual([]);
    },
  );

  it("leaves a GwenRuntimeHooks member to the hooks check", { timeout: SLOW_TEST_MS }, async () => {
    const report = await checkCopy((root) =>
      writeSource(
        root,
        "src/a.ts",
        [
          "export {};",
          'declare module "@gwenjs/schema" {',
          "  interface GwenRuntimeHooks {",
          '    "cameraManager": () => void;',
          "  }",
          "}",
          "",
        ].join("\n"),
      ),
    );
    expect(augmentFindings(report)).toEqual([]);
  });

  it("reports nothing for a plugin with no declare module", { timeout: SLOW_TEST_MS }, async () => {
    const report = await checkCopy((root) =>
      writeSource(root, "src/a.ts", "export const a = 1;\n"),
    );
    expect(augmentFindings(report)).toEqual([]);
  });

  it("reports nothing for a plugin with no source file", { timeout: SLOW_TEST_MS }, async () => {
    const report = await checkCopy((root) => rm(path.join(root, "src"), { recursive: true }));
    expect(augmentFindings(report)).toEqual([]);
  });

  it(
    "reports nothing for a declare global, a namespace and a module named by an identifier",
    { timeout: SLOW_TEST_MS },
    async () => {
      const report = await checkCopy((root) =>
        writeSource(
          root,
          "src/a.ts",
          [
            "export {};",
            "declare global {",
            "  interface Window {",
            "    gwen: number;",
            "  }",
            "}",
            "declare namespace Gwen {",
            "  const core: number;",
            "}",
            "namespace Gwen.Core {",
            "  export const x = 1;",
            "}",
            "module Local {",
            "  export const y = 2;",
            "}",
            "",
          ].join("\n"),
        ),
      );
      expect(augmentFindings(report)).toEqual([]);
    },
  );

  it(
    "reports nothing for a module whose scope only looks like @gwenjs",
    { timeout: SLOW_TEST_MS },
    async () => {
      const report = await checkCopy((root) =>
        writeSource(
          root,
          "src/a.ts",
          [
            "export {};",
            'declare module "@gwenjs-contrib/x" {}',
            'declare module "@gwenjsx/core" {}',
            'declare module "gwenjs/core" {}',
            "",
          ].join("\n"),
        ),
      );
      expect(augmentFindings(report)).toEqual([]);
    },
  );

  it.skipIf(!CAN_LOCK_FILE)(
    "rejects when a source file cannot be read",
    { timeout: SLOW_TEST_MS },
    async () => {
      const fixture = await openFixture();
      await writeSource(fixture.root, "src/a.ts", "export const a = 1;\n");
      // The check lists `augment` while the file is readable.
      const clean = await checkPluginPackage({ root: fixture.root, profile: "plugin" });
      expect(clean.checks).toContain("augment");
      const locked = path.join(fixture.root, "src", "a.ts");
      await chmod(locked, 0o000);
      try {
        await expect(
          checkPluginPackage({ root: fixture.root, profile: "plugin" }),
        ).rejects.toMatchObject({ code: "EACCES" });
      } finally {
        await chmod(locked, 0o644);
      }
    },
  );
});
