/**
 * Fixture dirs under tests/fixtures/<unit>/<case>/ with an input and an output or an error.
 * Dirs that only hold expected.json, such as resolve-callee, are not cases.
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { BUILT_IN_UNITS } from "../../src/pipeline/registry.js";
import { fixtureCase, mapCheck, resolveRelativeId, runPipeline } from "./helpers.js";

const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
const fixturesRoot = fileURLToPath(new URL("../fixtures/", import.meta.url));

interface FixtureDir {
  readonly unit: string;
  readonly name: string;
  readonly dir: string;
}

function caseId(dir: string): string {
  const tsx = join(dir, "input.tsx");
  if (existsSync(tsx)) return tsx;
  return join(dir, "input.ts");
}

function isFixtureCase(dir: string): boolean {
  if (!existsSync(join(dir, "input.ts")) && !existsSync(join(dir, "input.tsx"))) return false;
  return (
    existsSync(join(dir, "output.ts")) ||
    existsSync(join(dir, "output.tsx")) ||
    existsSync(join(dir, "error.json"))
  );
}

function discoverCases(): readonly FixtureDir[] {
  const found: FixtureDir[] = [];
  for (const unit of readdirSync(fixturesRoot, { withFileTypes: true })) {
    if (!unit.isDirectory()) continue;
    const unitDir = join(fixturesRoot, unit.name);
    for (const entry of readdirSync(unitDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = join(unitDir, entry.name);
      if (!isFixtureCase(dir)) continue;
      found.push({ unit: unit.name, name: entry.name, dir });
    }
  }
  found.sort((left, right) =>
    `${left.unit}/${left.name}`.localeCompare(`${right.unit}/${right.name}`),
  );
  return found;
}

const cases = discoverCases();

// An empty discovery would register no test and let `idempotent` pass on nothing.
if (cases.length === 0) {
  throw new Error(`No transform-pipeline fixture cases under ${fixturesRoot}`);
}

function runCase(dir: string, code: string) {
  return runPipeline(code, {
    id: caseId(dir),
    root: packageRoot,
    resolveId: resolveRelativeId,
    units: BUILT_IN_UNITS,
  });
}

for (const item of cases) {
  it(`${item.unit}/${item.name}`, async () => {
    const fixture = fixtureCase(item.dir);
    const pending = runCase(item.dir, fixture.input);
    if (fixture.errorCode !== undefined) {
      const code = fixture.errorCode;
      await expect(pending).rejects.toMatchObject({ code });
      return;
    }
    const output = fixture.output;
    const settled = await pending;
    expect(settled?.code).toBe(output);
    if (typeof output !== "string") return;
    mapCheck(fixture.input, output, settled?.map);
  });
}

it("idempotent", async () => {
  for (const item of cases) {
    const fixture = fixtureCase(item.dir);
    const output = fixture.output;
    if (typeof output !== "string") continue;
    expect(await runCase(item.dir, fixture.input), `${item.unit}/${item.name}`).not.toBeNull();
    expect(await runCase(item.dir, output), `${item.unit}/${item.name}`).toBeNull();
  }
});
