import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createViewportsPlugin } from "@gwenjs/app";
import { ConformanceErrorCodes } from "@gwenjs/plugin-conformance";
import { runPluginConformance } from "@gwenjs/plugin-conformance/runtime";
import { withPrivateTmpdir } from "../helpers/fixture.js";
import { findingsWithCode, ranChecks, spec, writePluginPackage } from "../helpers/runtime.js";

const unscopedRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/runtime/unscoped-engine",
);

const hiddenRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/runtime/installs-camera-core",
);

const againSource = `export function Plugin() {
  return {
    name: "again",
    provides: ["againKey"],
    setup(engine) {
      engine.provide("againKey", { n: 1 });
    },
  };
}
`;

const secondInstallSource = `let installed = false;
export function Plugin() {
  return {
    name: "second-install",
    setup() {
      if (installed) throw new Error("second install");
      installed = true;
    },
  };
}
`;

describe("runPluginConformance remove", () => {
  it("reports a hook registered on a captured unscoped engine that survives unuse", async () => {
    const report = await runPluginConformance(
      spec({
        root: unscopedRoot,
        packageName: "@fixture/unscoped-engine",
        factories: [{ export: "LeakHook" }],
      }),
    );
    const findings = findingsWithCode(report, ConformanceErrorCodes.RUNTIME_REMOVE_LEAK);
    expect(findings).toHaveLength(1);
    const matched = /left 1 hook listeners after unuse \(baseline (\d+), after (\d+)\)/.exec(
      findings[0]?.message ?? "",
    );
    expect(matched).not.toBeNull();
    const baselineText = matched?.[1];
    const afterText = matched?.[2];
    expect(baselineText).toBeDefined();
    expect(afterText).toBeDefined();
    if (baselineText !== undefined && afterText !== undefined) {
      expect(Number(afterText)).toBe(Number(baselineText) + 1);
    }
    expect(report.checks).toEqual(ranChecks());
  });

  it("reports a service provided on a captured unscoped engine that survives unuse", async () => {
    const report = await runPluginConformance(
      spec({
        root: unscopedRoot,
        packageName: "@fixture/unscoped-engine",
        factories: [{ export: "LeakProvide" }],
      }),
    );
    const findings = findingsWithCode(report, ConformanceErrorCodes.RUNTIME_REMOVE_LEAK);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain("leakKey");
    expect(report.checks).toEqual(ranChecks());
  });

  it("use unuse use provides the service again", async () => {
    await withPrivateTmpdir(async (dir) => {
      await writePluginPackage(dir, {
        name: "@fixture/again",
        files: { "dist/index.js": againSource },
      });

      const report = await runPluginConformance(spec({ root: dir, packageName: "@fixture/again" }));
      expect(report.checks).toEqual(ranChecks());
      expect(report.findings).toEqual([]);
    });
  });

  it("reports a plugin whose second install fails", async () => {
    await withPrivateTmpdir(async (dir) => {
      await writePluginPackage(dir, {
        name: "@fixture/second-install",
        files: { "dist/index.js": secondInstallSource },
      });

      const report = await runPluginConformance(
        spec({ root: dir, packageName: "@fixture/second-install" }),
      );
      const findings = findingsWithCode(report, ConformanceErrorCodes.RUNTIME_REENTRY);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain("second install");
      expect(report.checks).toEqual(ranChecks());
    });
  });

  it("reports a plugin that leaves another plugin installed after unuse", async () => {
    const report = await runPluginConformance(
      spec({
        root: hiddenRoot,
        packageName: "@fixture/installs-camera-core",
        factories: [{ export: "InstallsCameraCore" }],
        frameworkProviders: [createViewportsPlugin],
      }),
    );
    const plugins = findingsWithCode(report, ConformanceErrorCodes.RUNTIME_REMOVE_LEAK).filter(
      (finding) => finding.message.includes("left plugins after unuse"),
    );
    expect(plugins).toHaveLength(1);
    expect(plugins[0]?.message).toBe(
      'plugin "installs-camera-core" left plugins after unuse (baseline ["gwen:viewports"], after ["gwen:viewports","CameraSystem","camera-core"])',
    );
  });

  it("reports a warning emitted on the frame after unuse", async () => {
    // beforeEach is not counted in hookListeners (hook-dispatch.ts:301).
    const source = `export function Plugin() {
  let engine;
  return {
    name: "after-unuse",
    setup(value) { engine = value; },
    teardown() {
      let sent = false;
      engine.hooks.beforeEach(() => {
        if (sent) return;
        sent = true;
        engine.errors.emit({ level: "warning", code: "FIXTURE:AFTER", message: "after" });
      });
    },
  };
}
`;
    await withPrivateTmpdir(async (dir) => {
      await writePluginPackage(dir, {
        name: "@fixture/after-unuse",
        files: { "dist/index.js": source },
      });
      const report = await runPluginConformance(
        spec({ root: dir, packageName: "@fixture/after-unuse" }),
      );
      expect(report.findings.map((finding) => finding.code)).toEqual([
        ConformanceErrorCodes.RUNTIME_REMOVE_LEAK,
      ]);
      expect(report.findings[0]?.message).toContain("FIXTURE:AFTER");
    });
  });
});
