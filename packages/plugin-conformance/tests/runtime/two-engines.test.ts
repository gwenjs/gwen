import { describe, expect, it } from "vitest";
import { ConformanceErrorCodes } from "@gwenjs/plugin-conformance";
import { runPluginConformance } from "@gwenjs/plugin-conformance/runtime";
import { withPrivateTmpdir } from "../helpers/fixture.js";
import { findingsWithCode, ranChecks, spec, writePluginPackage } from "../helpers/runtime.js";

const sharedSource = `const shared = { id: "k" };
export function Plugin() {
  return {
    name: "shared-k",
    provides: ["k"],
    setup(engine) {
      engine.provide("k", shared);
    },
  };
}
`;

const separateSource = `export function Plugin() {
  return {
    name: "separate-k",
    provides: ["k"],
    setup(engine) {
      engine.provide("k", {});
    },
  };
}
`;

// Module-level owner, reopened in setup, closed in teardown. The scoped
// `engine.hooks.hook` drops with unuse, so only the other engine's frame throws.
const closedOwnerSource = `let owner = { open: true };
export function Plugin() {
  return {
    name: "closed-owner",
    setup(engine) {
      owner = { open: true };
      engine.hooks.hook("engine:update", () => {
        if (!owner.open) throw new Error("owner closed");
      });
    },
    teardown() {
      owner.open = false;
    },
  };
}
`;

describe("runPluginConformance two engines", () => {
  it("reports a plugin that shares one module-global service between engines", async () => {
    await withPrivateTmpdir(async (dir) => {
      await writePluginPackage(dir, {
        name: "@fixture/shared-k",
        files: { "dist/index.js": sharedSource },
      });

      const report = await runPluginConformance(
        spec({ root: dir, packageName: "@fixture/shared-k" }),
      );
      const findings = findingsWithCode(report, ConformanceErrorCodes.RUNTIME_TWO_ENGINES);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain('shares service "k"');
      expect(report.checks).toEqual(ranChecks());
    });
  });

  it("accepts a plugin whose engines hold separate services and survive each other's unuse", async () => {
    await withPrivateTmpdir(async (dir) => {
      await writePluginPackage(dir, {
        name: "@fixture/separate-k",
        files: { "dist/index.js": separateSource },
      });

      const report = await runPluginConformance(
        spec({ root: dir, packageName: "@fixture/separate-k" }),
      );
      expect(report.checks).toEqual(ranChecks());
      expect(report.findings).toEqual([]);
    });
  });

  it("reports a plugin whose unuse on one engine removes it from the other", async () => {
    const source = `const live = [];
let closing = false;
export function Plugin() {
  let mine;
  return {
    name: "cross-unuse",
    setup(engine) { mine = engine; live.push(engine); },
    async teardown() {
      const at = live.indexOf(mine);
      if (at !== -1) live.splice(at, 1);
      if (closing) return;
      closing = true;
      const others = live.splice(0, live.length);
      for (const engine of others) {
        try { await engine.unuse("cross-unuse"); } catch { /* disposed */ }
      }
      closing = false;
    },
  };
}
`;
    await withPrivateTmpdir(async (dir) => {
      await writePluginPackage(dir, {
        name: "@fixture/cross-unuse",
        files: { "dist/index.js": source },
      });
      const report = await runPluginConformance(
        spec({ root: dir, packageName: "@fixture/cross-unuse" }),
      );
      const findings = findingsWithCode(report, ConformanceErrorCodes.RUNTIME_TWO_ENGINES);
      expect(findings.map((finding) => finding.message)).toEqual([
        'plugin "cross-unuse" lost "cross-unuse" on the other engine',
      ]);
    });
  });

  it("reports a frame error on the second engine after the first unuse", async () => {
    await withPrivateTmpdir(async (dir) => {
      await writePluginPackage(dir, {
        name: "@fixture/closed-owner",
        files: { "dist/index.js": closedOwnerSource },
      });
      const report = await runPluginConformance(
        spec({ root: dir, packageName: "@fixture/closed-owner" }),
      );
      expect(report.findings.map((finding) => finding.code)).toEqual([
        ConformanceErrorCodes.RUNTIME_TWO_ENGINES,
      ]);
      expect(report.findings[0]?.message).toContain("owner closed");
    });
  });
});
