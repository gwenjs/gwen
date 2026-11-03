import { afterEach, describe, expect, it } from "vitest";
import { checkPluginPackage } from "@gwenjs/plugin-conformance";
import type { ConformanceFinding, ConformanceReport } from "@gwenjs/plugin-conformance";
import { runCli } from "../src/run-cli.js";
import {
  createHooksFixture,
  goodPluginRoot,
  hooksFixtureRoot,
  setHookNamespace,
  SLOW_TEST_MS,
  writeSource,
} from "./helpers/fixture.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  const pending = cleanups.splice(0);
  for (const cleanup of pending) {
    await cleanup();
  }
});

function hookFindings(report: ConformanceReport): ConformanceFinding[] {
  return report.findings.filter((finding) => finding.code.startsWith("CONFORMANCE:HOOK_"));
}

function findingsWithCode(report: ConformanceReport, code: string): ConformanceFinding[] {
  return report.findings.filter((finding) => {
    const actual: string = finding.code;
    return actual === code;
  });
}

function hookCodes(report: ConformanceReport): string[] {
  const codes: string[] = hookFindings(report).map((finding) => finding.code);
  return codes;
}

async function checkHooksFixture(name: string): Promise<ConformanceReport> {
  return checkPluginPackage({ root: hooksFixtureRoot(name), profile: "plugin" });
}

async function checkCopy(name: string, edit?: (root: string) => Promise<void>) {
  const fixture = await createHooksFixture(name);
  cleanups.push(fixture.cleanup);
  if (edit !== undefined) await edit(fixture.root);
  return {
    root: fixture.root,
    report: await checkPluginPackage({ root: fixture.root, profile: "plugin" }),
  };
}

function expectSite(
  finding: ConformanceFinding | undefined,
  expected: { code: string; pkg: string; name: string; file: string; line: number },
): void {
  expect(finding?.code).toBe(expected.code);
  expect(finding?.file).toBe(expected.file);
  expect(finding?.line).toBe(expected.line);
  expect(finding?.message).toContain(expected.pkg);
  expect(finding?.message).toContain(expected.name);
  expect(finding?.message.startsWith("[")).toBe(false);
  expect(finding?.hint.length).toBeGreaterThan(0);
}

describe("hooks check", () => {
  it("passes a package that declares a hook with defineHooks and emits it", async () => {
    const report = await checkHooksFixture("declared-and-emitted");
    expect(report.checks).toContain("hooks");
    expect(hookCodes(report)).toEqual([]);
  });

  it("reports each emit form whose name is not declared", async () => {
    const report = await checkHooksFixture("emits-undeclared");
    const pkg = "@fixture/hooks-emits-undeclared";
    const found = hookFindings(report);
    expect(found).toHaveLength(4);
    const sites = [
      { line: 10, name: "myplug:ready" },
      { line: 11, name: "myplug:started" },
      { line: 12, name: "myplug:tick" },
      { line: 13, name: "myplug:stopped" },
    ];
    sites.forEach((site, index) => {
      expectSite(found[index], {
        code: "CONFORMANCE:HOOK_UNDECLARED",
        pkg,
        name: site.name,
        file: "src/index.ts",
        line: site.line,
      });
    });
  });

  it("reports a declared hook outside the plugin namespace", async () => {
    const report = await checkHooksFixture("declares-foreign");
    const found = hookFindings(report);
    expect(found).toHaveLength(1);
    expectSite(found[0], {
      code: "CONFORMANCE:HOOK_FOREIGN_NAMESPACE",
      pkg: "@fixture/hooks-declares-foreign",
      name: "viewport:add",
      file: "src/index.ts",
      line: 4,
    });
  });

  it("reports an emit in a core-reserved namespace", async () => {
    const report = await checkHooksFixture("emits-reserved");
    const found = hookFindings(report);
    expect(found).toHaveLength(1);
    expectSite(found[0], {
      code: "CONFORMANCE:HOOK_RESERVED",
      pkg: "@fixture/hooks-emits-reserved",
      name: "scene:enter",
      file: "src/index.ts",
      line: 4,
    });
  });

  it("reports an emit in a framework-owned namespace", async () => {
    const report = await checkHooksFixture("emits-framework");
    const found = hookFindings(report);
    expect(found).toHaveLength(1);
    expectSite(found[0], {
      code: "CONFORMANCE:HOOK_RESERVED",
      pkg: "@fixture/hooks-emits-framework",
      name: "camera:activate",
      file: "src/index.ts",
      line: 4,
    });
  });

  it("reports an emit whose name is computed", async () => {
    const report = await checkHooksFixture("computed-name");
    const found = hookFindings(report);
    expect(found.map((finding) => finding.code)).toEqual([
      "CONFORMANCE:HOOK_DYNAMIC_NAME",
      "CONFORMANCE:HOOK_DYNAMIC_NAME",
    ]);
    expect(found.map((finding) => finding.file)).toEqual(["src/index.ts", "src/index.ts"]);
    expect(found.map((finding) => finding.line)).toEqual([4, 5]);
    for (const finding of found) {
      expect(finding.message).toContain("@fixture/hooks-computed-name");
      expect(finding.message.startsWith("[")).toBe(false);
      expect(finding.hint.length).toBeGreaterThan(0);
    }
  });

  it("resolves a const string used as a defineHooks key and as an emit name", async () => {
    const report = await checkHooksFixture("defineHooks-key-emit");
    expect(report.checks).toContain("hooks");
    expect(hookCodes(report)).toEqual([]);
  });

  it("resolves a const string written with as const, satisfies or parentheses", async () => {
    const report = await checkHooksFixture("const-as-const");
    expect(report.checks).toContain("hooks");
    expect(hookCodes(report)).toEqual([]);
  });

  it("declares identifier keys and flags them as foreign", async () => {
    const report = await checkHooksFixture("identifier-key");
    const found = hookFindings(report);
    expect(found).toHaveLength(2);
    expectSite(found[0], {
      code: "CONFORMANCE:HOOK_FOREIGN_NAMESPACE",
      pkg: "@fixture/hooks-identifier-key",
      name: "ready",
      file: "src/index.ts",
      line: 4,
    });
    expectSite(found[1], {
      code: "CONFORMANCE:HOOK_FOREIGN_NAMESPACE",
      pkg: "@fixture/hooks-identifier-key",
      name: "started",
      file: "src/index.ts",
      line: 9,
    });
  });

  it("counts an identifier key as a declared hook when the hookNamespace is missing", async () => {
    const { report } = await checkCopy("identifier-key", (root) =>
      setHookNamespace(root, undefined),
    );
    expect(hookCodes(report)).toEqual(["CONFORMANCE:HOOK_NAMESPACE_INVALID"]);
  });

  it("reads defineHooks written with as const or satisfies", async () => {
    const report = await checkHooksFixture("define-hooks-as-const");
    expect(report.checks).toContain("hooks");
    expect(hookCodes(report)).toEqual([]);
  });

  it("does not resolve a const shadowed by a parameter", async () => {
    const report = await checkHooksFixture("shadowed-const");
    const found = hookFindings(report);
    expect(found.map((finding) => finding.code)).toEqual(["CONFORMANCE:HOOK_DYNAMIC_NAME"]);
    expect(found[0]?.file).toBe("src/index.ts");
    expect(found[0]?.line).toBe(6);
    expect(found[0]?.message).toContain("@fixture/hooks-shadowed-const");
  });

  it("reports a missing hookNamespace once when the package declares a hook", async () => {
    const report = await checkHooksFixture("namespace-missing-with-hooks");
    const found = hookFindings(report);
    expect(hookCodes(report)).toEqual(["CONFORMANCE:HOOK_NAMESPACE_INVALID"]);
    expect(found[0]?.file).toBe("package.json");
    expect(found[0]?.line).toBe(1);
    expect(found[0]?.message).toContain("@fixture/hooks-namespace-missing-with-hooks");
    expect(found[0]?.hint.length).toBeGreaterThan(0);
  });

  it("reports a core-reserved hookNamespace", async () => {
    const report = await checkHooksFixture("namespace-reserved");
    const found = hookFindings(report);
    expect(hookCodes(report)).toEqual(["CONFORMANCE:HOOK_NAMESPACE_INVALID"]);
    expect(found[0]?.file).toBe("package.json");
    expect(found[0]?.line).toBe(1);
    expect(found[0]?.message).toContain("@fixture/hooks-namespace-reserved");
    expect(found[0]?.message).toContain("scene");
  });

  it("does not flag a package that only listens to hooks", async () => {
    const report = await checkHooksFixture("listens-only");
    expect(report.checks).toContain("hooks");
    expect(hookCodes(report)).toEqual([]);
  });

  it("does not follow an alias of an emit method", async () => {
    const report = await checkHooksFixture("real-engine-bypass");
    expect(report.checks).toContain("hooks");
    expect(hookCodes(report)).toEqual([]);
  });

  it("reads a hook declared by a GwenRuntimeHooks augmentation", async () => {
    const report = await checkHooksFixture("declared-by-augmentation");
    expect(report.checks).toContain("hooks");
    expect(hookCodes(report)).toEqual([]);
  });

  it("reports a framework-owned hookNamespace", async () => {
    const { report } = await checkCopy("declared-and-emitted", (root) =>
      setHookNamespace(root, "camera"),
    );
    const invalid = findingsWithCode(report, "CONFORMANCE:HOOK_NAMESPACE_INVALID");
    expect(invalid).toHaveLength(1);
    expect(invalid[0]?.file).toBe("package.json");
    expect(invalid[0]?.line).toBe(1);
    expect(invalid[0]?.message).toContain("camera");
  });

  it("reports a hookNamespace with an underscore or a leading digit", async () => {
    for (const value of ["my_plug", "1plug"]) {
      const { report } = await checkCopy("declared-and-emitted", (root) =>
        setHookNamespace(root, value),
      );
      const invalid = findingsWithCode(report, "CONFORMANCE:HOOK_NAMESPACE_INVALID");
      expect(invalid).toHaveLength(1);
    }
  });

  it("reports a hookNamespace that is not a string", async () => {
    const { report } = await checkCopy("declared-and-emitted", (root) =>
      setHookNamespace(root, 42),
    );
    const invalid = findingsWithCode(report, "CONFORMANCE:HOOK_NAMESPACE_INVALID");
    expect(invalid).toHaveLength(1);
    expect(invalid[0]?.file).toBe("package.json");
    expect(invalid[0]?.line).toBe(1);
  });

  it("accepts a one-letter and a hyphenated hookNamespace", async () => {
    for (const namespace of ["a", "my-plug"]) {
      const { report } = await checkCopy("declared-and-emitted", async (root) => {
        await setHookNamespace(root, namespace);
        await writeSource(
          root,
          "src/index.ts",
          [
            'import { defineHooks, emit } from "@gwenjs/core";',
            "",
            "export const hooks = defineHooks({",
            `  "${namespace}:ready": () => {},`,
            "});",
            "",
            "export function announce(): void {",
            `  emit("${namespace}:ready");`,
            "}",
            "",
          ].join("\n"),
        );
      });
      expect(report.checks).toContain("hooks");
      expect(hookCodes(report)).toEqual([]);
    }
  });

  it(
    "a package with no hook and no hookNamespace reports nothing",
    { timeout: SLOW_TEST_MS },
    async () => {
      const report = await checkPluginPackage({ root: goodPluginRoot(), profile: "plugin" });
      expect(report.checks).toContain("hooks");
      expect(hookCodes(report)).toEqual([]);
    },
  );

  it("reports all 200 undeclared emits of one file", async () => {
    const lines = Array.from({ length: 200 }, (_, index) => {
      return `emit("myplug:n${String(index + 1).padStart(3, "0")}");`;
    });
    const { report } = await checkCopy("declared-and-emitted", (root) =>
      writeSource(root, "src/index.ts", `${lines.join("\n")}\n`),
    );
    const found = hookFindings(report);
    expect(found).toHaveLength(200);
    expect(hookCodes(report)).toEqual(Array(200).fill("CONFORMANCE:HOOK_UNDECLARED"));
    expect(found.map((finding) => finding.line)).toEqual(
      Array.from({ length: 200 }, (_, index) => index + 1),
    );
  });

  it("the CLI prints HOOK_UNDECLARED with file and line and exits 1", async () => {
    const fixture = await createHooksFixture("emits-undeclared");
    cleanups.push(fixture.cleanup);
    let out = "";
    const code = await runCli(["check"], {
      cwd: fixture.root,
      stdout: {
        write(chunk: string) {
          out += chunk;
        },
      },
      stderr: { write() {} },
    });
    for (const line of [10, 11, 12, 13]) {
      expect(out).toMatch(new RegExp(`^CONFORMANCE:HOOK_UNDECLARED src/index\\.ts:${line} `, "m"));
    }
    expect(code).toBe(1);
  });
});
