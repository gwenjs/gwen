import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ConformanceErrorCodes } from "@gwenjs/plugin-conformance";
import { runPluginConformance } from "@gwenjs/plugin-conformance/runtime";
import type { RuntimeConformanceReport } from "@gwenjs/plugin-conformance/runtime";
import { findingsWithCode, ranChecks, spec } from "../helpers/runtime.js";

const aliasRoot = fixtureRoot("hooks-alias-secret");
const declaredRoot = fixtureRoot("hooks-declared");
const setupRoot = fixtureRoot("hooks-setup-emit");
const listensRoot = fixtureRoot("hooks-listens");
const lateRoot = fixtureRoot("hooks-late");

function fixtureRoot(name: string): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/runtime", name);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Call `emitLate` on the same module the loader imported. */
async function firedLate(root: string): Promise<boolean> {
  try {
    const href = pathToFileURL(path.join(root, "dist/index.js")).href;
    const loaded: unknown = await import(href);
    if (!isRecord(loaded)) return false;
    const emitLate = loaded.emitLate;
    if (typeof emitLate !== "function") return false;
    emitLate();
    return true;
  } catch {
    return false;
  }
}

function mentions(report: RuntimeConformanceReport, name: string): boolean {
  return report.findings.some((finding) => finding.message.includes(name));
}

describe("runPluginConformance hooks", () => {
  it("reports myplug:secret emitted through an alias of the real engine as CONFORMANCE:HOOK_UNDECLARED", async () => {
    const report = await runPluginConformance(
      spec({
        root: aliasRoot,
        packageName: "@fixture/hooks-alias-secret",
        factories: [{ export: "Leak" }],
      }),
    );
    const findings = findingsWithCode(report, ConformanceErrorCodes.HOOK_UNDECLARED);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message ?? "").toContain("myplug:secret");
    expect(findings[0]?.message ?? "").toContain("@fixture/hooks-alias-secret");
    expect(findings[0]?.message ?? "").toContain("Leak");
    expect(report.checks).toEqual(ranChecks());
  });

  it("accepts a hook declared with defineHooks and emitted through emit()", async () => {
    const report = await runPluginConformance(
      spec({
        root: declaredRoot,
        packageName: "@fixture/hooks-declared",
        factories: [{ export: "Plugin" }],
      }),
    );
    expect(report.findings).toEqual([]);
    expect(report.checks).toEqual(ranChecks());
  });

  it("ignores the engine and framework names fired during the frames", async () => {
    const report = await runPluginConformance(
      spec({
        root: declaredRoot,
        packageName: "@fixture/hooks-declared",
        factories: [{ export: "Plugin" }],
      }),
    );
    expect(report.findings).toEqual([]);
    expect(mentions(report, "engine:update")).toBe(false);
    expect(report.checks).toEqual(ranChecks());
  });

  it("reports an emit made during setup", async () => {
    const report = await runPluginConformance(
      spec({
        root: setupRoot,
        packageName: "@fixture/hooks-setup-emit",
        factories: [{ export: "Plugin" }],
      }),
    );
    const findings = findingsWithCode(report, ConformanceErrorCodes.HOOK_UNDECLARED);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message ?? "").toContain("myplug:setup");
    expect(findings[0]?.message ?? "").toContain("@fixture/hooks-setup-emit");
    expect(findings[0]?.message ?? "").toContain("Plugin");
    expect(report.checks).toEqual(ranChecks());
  });

  it("a plugin that only listens records no emit", async () => {
    const report = await runPluginConformance(
      spec({
        root: listensRoot,
        packageName: "@fixture/hooks-listens",
        factories: [{ export: "Plugin" }],
      }),
    );
    expect(report.findings).toEqual([]);
    expect(report.checks).toEqual(ranChecks());
  });

  it("two engines record separately", async () => {
    const leak = await runPluginConformance(
      spec({
        root: aliasRoot,
        packageName: "@fixture/hooks-alias-secret",
        factories: [{ export: "Leak" }],
      }),
    );
    const clean = await runPluginConformance(
      spec({
        root: declaredRoot,
        packageName: "@fixture/hooks-declared",
        factories: [{ export: "Plugin" }],
      }),
    );
    const leaked = findingsWithCode(leak, ConformanceErrorCodes.HOOK_UNDECLARED);
    expect(leaked).toHaveLength(1);
    expect(leaked[0]?.message ?? "").toContain("myplug:secret");
    expect(findingsWithCode(clean, ConformanceErrorCodes.HOOK_UNDECLARED)).toEqual([]);
    expect(leak.checks).toEqual(ranChecks());
    expect(clean.checks).toEqual(ranChecks());
  });

  it("stops recording when the run ends", async () => {
    const first = await runPluginConformance(
      spec({
        root: lateRoot,
        packageName: "@fixture/hooks-late",
        factories: [{ export: "Plugin" }],
      }),
    );
    const fired = await firedLate(lateRoot);
    const second = await runPluginConformance(
      spec({
        root: lateRoot,
        packageName: "@fixture/hooks-late",
        factories: [{ export: "Plugin" }],
      }),
    );
    expect(fired).toBe(true);
    expect(mentions(first, "myplug:late")).toBe(false);
    expect(mentions(second, "myplug:late")).toBe(false);
    expect(first.checks).toEqual(ranChecks());
    expect(second.checks).toEqual(ranChecks());
  });
});
