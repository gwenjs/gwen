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

/** Per-factory rows, in check order. Options, module, hooks, and composable follow. */
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
 * One check. `messages` are `code: message` lines.
 * The expect message is those lines, so a thrown failure names them
 * (`packages/plugin-conformance/tests/runtime/vitest.test.ts:37`).
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
