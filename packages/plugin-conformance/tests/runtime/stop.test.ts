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
    expect(findings).toHaveLength(1);
    expect(report.checks).toEqual(ranChecks());
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
