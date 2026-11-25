import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isRecord } from "./json.js";
import { runtimeRoot } from "./runtime/load-package.js";
import { runRuntimeChecks } from "./runtime/run-checks.js";
import type { PluginConformanceSpec, PluginFactorySpec, RuntimeCheckId } from "./runtime/types.js";

/** The two vitest functions the rows are registered with. */
interface RowApi {
  describe(name: string, body: () => void): void;
  it(name: string, body: () => void): void;
}

interface FactoryRow {
  readonly id: RuntimeCheckId;
  readonly title: string;
}

/** Per-factory rows, in check order. Options, module, manifest contract, extension, requirement-form, base-surface, hooks, and composable follow. */
const FACTORY_ROWS: readonly FactoryRow[] = [
  { id: "shape", title: "R1 shape" },
  { id: "requires", title: "R2 installs alone" },
  { id: "provides", title: "R3 provides" },
  { id: "frames", title: "R4 quiet frames" },
  { id: "remove", title: "R5 remove" },
  { id: "reentry", title: "R6 re-entry" },
  { id: "two-engines", title: "R7 two engines" },
  { id: "stop", title: "R8 stop" },
];

const OPTIONS_ROW: FactoryRow = { id: "options", title: "R9 options" };
const EXTENSION_ROW: FactoryRow = { id: "extension", title: "RX1-RX5 extension" };
const REQUIREMENT_FORM_ROW: FactoryRow = { id: "requirement-form", title: "RX6 requirement form" };
const BASE_SURFACE_ROW: FactoryRow = { id: "base-surface", title: "RB1 base surface" };
const MANIFEST_CONTRACT_ROW: FactoryRow = {
  id: "manifest-contract",
  title: "RD1 manifest contract",
};
const HOOKS_ROW: FactoryRow = { id: "hooks", title: "R11 hooks" };

/** Factories the rows walk. One place, so a registration change hits every row. */
function listedFactories(spec: PluginConformanceSpec): readonly PluginFactorySpec[] {
  return spec.factories;
}

/**
 * True when `package.json` at `spec.root` (or the process working directory)
 * has an `exports["./module"]` key (`packages/plugin-conformance/src/runtime/package-manifest.ts:105`).
 */
function moduleSubpathPresent(spec: PluginConformanceSpec): boolean {
  try {
    const text = readFileSync(path.join(runtimeRoot(spec), "package.json"), "utf8");
    const parsed: unknown = JSON.parse(text);
    if (!isRecord(parsed)) return false;
    const exportsValue: unknown = parsed.exports;
    if (!isRecord(exportsValue)) return false;
    return Object.hasOwn(exportsValue, "./module");
  } catch {
    return false;
  }
}

/**
 * True when `package.json` at `spec.root` (or the process working directory)
 * has an `exports["./extension"]` key (`packages/plugin-conformance/src/runtime/package-manifest.ts:138`).
 */
function extensionSubpathPresent(spec: PluginConformanceSpec): boolean {
  try {
    const text = readFileSync(path.join(runtimeRoot(spec), "package.json"), "utf8");
    const parsed: unknown = JSON.parse(text);
    if (!isRecord(parsed)) return false;
    const exportsValue: unknown = parsed.exports;
    if (!isRecord(exportsValue)) return false;
    return Object.hasOwn(exportsValue, "./extension");
  } catch {
    return false;
  }
}

/**
 * True when `package.json` at `spec.root` (or the process working directory)
 * has `gwen.type` equal to `"plugin"` (`packages/plugin-conformance/src/runtime/check-manifest-contract.ts`).
 */
function gwenTypeIsPlugin(spec: PluginConformanceSpec): boolean {
  try {
    const text = readFileSync(path.join(runtimeRoot(spec), "package.json"), "utf8");
    const parsed: unknown = JSON.parse(text);
    if (!isRecord(parsed)) return false;
    const gwen: unknown = parsed.gwen;
    return isRecord(gwen) && gwen.type === "plugin";
  } catch {
    return false;
  }
}

/** `extension` and `requirement-form` run only when `spec.bases` is non-empty. */
function basesListed(spec: PluginConformanceSpec): boolean {
  const bases = spec.bases;
  return bases !== undefined && bases.length > 0;
}

/**
 * One check. `messages` are `code: message` lines.
 * The expect message is those lines, so a thrown failure names them
 * (`packages/plugin-conformance/tests/runtime/vitest.test.ts:38`).
 */
async function assertCheck(
  spec: PluginConformanceSpec,
  id: RuntimeCheckId,
  factory?: PluginFactorySpec,
): Promise<void> {
  const findings = await runRuntimeChecks(spec, [id], factory);
  const messages = findings.map((finding) => `${finding.code}: ${finding.message}`);
  expect(messages, messages.join("\n")).toEqual([]);
}

function registerFactoryRow(
  api: RowApi,
  spec: PluginConformanceSpec,
  row: FactoryRow,
  factory: PluginFactorySpec,
): void {
  api.it(`${row.title} (${factory.export})`, () => assertCheck(spec, row.id, factory));
}

/**
 * Registers the rows of `spec` through `api`.
 * Split from {@link describePluginConformance} so a test can record them.
 * Not part of the public snapshot.
 */
export function registerPluginConformance(spec: PluginConformanceSpec, api: RowApi): void {
  api.describe(`plugin conformance: ${spec.packageName}`, () => {
    for (const row of FACTORY_ROWS) {
      for (const factory of listedFactories(spec)) {
        registerFactoryRow(api, spec, row, factory);
      }
    }
    for (const factory of listedFactories(spec)) {
      if (factory.invalidOptions !== undefined) {
        registerFactoryRow(api, spec, OPTIONS_ROW, factory);
      }
    }
    if (moduleSubpathPresent(spec)) {
      api.it("R10 module", () => assertCheck(spec, "module"));
    }
    if (gwenTypeIsPlugin(spec)) {
      api.it(MANIFEST_CONTRACT_ROW.title, () => assertCheck(spec, MANIFEST_CONTRACT_ROW.id));
    }
    // RX1-RX5, then RX6, per factory. RB1 is one unscoped row for the package.
    if (basesListed(spec)) {
      for (const factory of listedFactories(spec)) {
        registerFactoryRow(api, spec, EXTENSION_ROW, factory);
      }
      for (const factory of listedFactories(spec)) {
        registerFactoryRow(api, spec, REQUIREMENT_FORM_ROW, factory);
      }
    }
    if (extensionSubpathPresent(spec)) {
      api.it(BASE_SURFACE_ROW.title, () => assertCheck(spec, BASE_SURFACE_ROW.id));
    }
    for (const factory of listedFactories(spec)) {
      registerFactoryRow(api, spec, HOOKS_ROW, factory);
    }
    api.it("R12 composable surface", () => assertCheck(spec, "composable"));
  });
}

/** Registers the runtime conformance rows of `spec` in the current vitest suite. */
export function describePluginConformance(spec: PluginConformanceSpec): void {
  registerPluginConformance(spec, { describe, it });
}
