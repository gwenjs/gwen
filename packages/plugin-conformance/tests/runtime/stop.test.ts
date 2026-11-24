import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ConformanceErrorCodes } from "@gwenjs/plugin-conformance";
import { runPluginConformance } from "@gwenjs/plugin-conformance/runtime";
import { withPrivateTmpdir } from "../helpers/fixture.js";
import { findingsWithCode, ranChecks, spec, writePluginPackage } from "../helpers/runtime.js";

const unscopedRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/runtime/unscoped-engine",
);

const scopedHookSource = `export function Plugin() {
  return {
    name: "scoped-hook",
    setup(engine) {
      engine.hooks.hook("engine:update", () => {});
    },
  };
}
`;

describe("runPluginConformance stop", () => {
  it("reports a plugin whose hooks survive stop", async () => {
    const report = await runPluginConformance(
      spec({
        root: unscopedRoot,
        packageName: "@fixture/unscoped-engine",
        factories: [{ export: "LeakHook" }],
      }),
    );
    const findings = findingsWithCode(report, ConformanceErrorCodes.RUNTIME_TEARDOWN);
    const message = findings[0]?.message ?? "";
    const matched =
      /^plugin "unscoped-hook" left 1 hook listeners after stop \(baseline (\d+), after (\d+)\)$/.exec(
        message,
      );
    const baseline = matched?.[1];
    const after = matched?.[2];
    expect(baseline).toBeDefined();
    expect(after).toBeDefined();
    expect(Number(after)).toBe(Number(baseline) + 1);
    expect(message).toBe(
      `plugin "unscoped-hook" left 1 hook listeners after stop (baseline ${baseline}, after ${after})`,
    );
    expect(report.checks).toEqual(ranChecks());
  });

  it("reports a service provided on a captured unscoped engine that survives stop", async () => {
    const report = await runPluginConformance(
      spec({
        root: unscopedRoot,
        packageName: "@fixture/unscoped-engine",
        factories: [{ export: "LeakProvide" }],
      }),
    );
    const findings = findingsWithCode(report, ConformanceErrorCodes.RUNTIME_TEARDOWN);
    expect(findings.map((finding) => finding.message)).toEqual([
      'plugin "unscoped-provide" left service "leakKey" injectable after stop',
    ]);
  });

  it("accepts a plugin that releases its hooks on stop", async () => {
    await withPrivateTmpdir(async (dir) => {
      await writePluginPackage(dir, {
        name: "@fixture/scoped-hook",
        files: { "dist/index.js": scopedHookSource },
      });

      const report = await runPluginConformance(
        spec({ root: dir, packageName: "@fixture/scoped-hook" }),
      );
      expect(report.checks).toEqual(ranChecks());
      expect(report.findings).toEqual([]);
    });
  });
});
