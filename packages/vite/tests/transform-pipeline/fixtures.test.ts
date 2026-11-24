/**
 * Fixture dirs under tests/fixtures/<unit>/<case>/ with an input and an output or an error.
 * Dirs that only hold expected.json, such as resolve-callee, are not cases.
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { BUILT_IN_UNITS } from "../../src/pipeline/registry.js";
import type { GwenSourceTransform } from "../../src/pipeline/types.js";
import { layerInlineTransform } from "../../src/shared/layer-utils.js";
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

function extraUnits(unit: string): readonly GwenSourceTransform[] {
  if (unit !== "layer-inline" && unit !== "async-context") return [];
  return [layerInlineTransform];
}

function runCase(dir: string, code: string, unit: string) {
  return runPipeline(code, {
    id: caseId(dir),
    root: packageRoot,
    resolveId: resolveRelativeId,
    units: [...BUILT_IN_UNITS, ...extraUnits(unit)],
  });
}

for (const item of cases) {
  it(`${item.unit}/${item.name}`, async () => {
    const fixture = fixtureCase(item.dir);
    const pending = runCase(item.dir, fixture.input, item.unit);
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
    expect(
      await runCase(item.dir, fixture.input, item.unit),
      `${item.unit}/${item.name}`,
    ).not.toBeNull();
    expect(await runCase(item.dir, output, item.unit), `${item.unit}/${item.name}`).toBeNull();
  }
});

/**
 * 1-based line, 0-based column. `lineColumn` is 1-based
 * (`packages/vite/src/pipeline/parse.ts:29-42`); `loc.column` subtracts 1
 * (`packages/vite/src/pipeline/transform-pipeline.ts:91`).
 */
function callPlace(code: string, offset: number): { line: number; column: number } {
  let line = 1;
  let column = 0;
  const end = offset > 0 ? offset : 0;
  for (let index = 0; index < end; index += 1) {
    if (code.charCodeAt(index) === 10) {
      line += 1;
      column = 0;
    } else {
      column += 1;
    }
  }
  return { line, column };
}

it("actor-name/deps-local-binding raises with the exact message, hint and position", async () => {
  const dir = join(fixturesRoot, "actor-name", "deps-local-binding");
  const fixture = fixtureCase(dir);
  const offset = fixture.input.indexOf("useActor(Dep)");
  expect(offset).toBeGreaterThanOrEqual(0);
  const place = callPlace(fixture.input, offset);
  const what = "[gwen()] useActor(Dep) inside Boss: Dep is not a module-scope binding.";
  const fix = "Fix: Declare the actor at module scope or pass it through the factory arguments.";
  const see =
    "See https://gwenjs.github.io/gwen/api/errors#vite-transform-unsupported (VITE:TRANSFORM_UNSUPPORTED)";
  // Same condition as devHint (`packages/vite/src/pipeline/dev-hint.ts:7`).
  const message =
    process.env["NODE_ENV"] !== "production" ? `${what}\n${fix}\n${see}` : `${what}\n${see}`;
  await expect(runCase(dir, fixture.input, "actor-name")).rejects.toMatchObject({
    message,
    loc: { file: caseId(dir), line: place.line, column: place.column },
  });
});

it("actor-name/deps-declared-after raises with the exact message, hint and position", async () => {
  const dir = join(fixturesRoot, "actor-name", "deps-declared-after");
  const fixture = fixtureCase(dir);
  const offset = fixture.input.indexOf("useActor(Y)");
  expect(offset).toBeGreaterThanOrEqual(0);
  const place = callPlace(fixture.input, offset);
  const what = "[gwen()] useActor(Y) inside Boss: Y is declared after Boss.";
  const fix = "Fix: Declare the actor at module scope or pass it through the factory arguments.";
  const see =
    "See https://gwenjs.github.io/gwen/api/errors#vite-transform-unsupported (VITE:TRANSFORM_UNSUPPORTED)";
  // Same condition as devHint (`packages/vite/src/pipeline/dev-hint.ts:7`).
  const message =
    process.env["NODE_ENV"] !== "production" ? `${what}\n${fix}\n${see}` : `${what}\n${see}`;
  await expect(runCase(dir, fixture.input, "actor-name")).rejects.toMatchObject({
    message,
    loc: { file: caseId(dir), line: place.line, column: place.column },
  });
});

it("async-context/nested-await raises with the exact message, hint and position", async () => {
  const dir = join(fixturesRoot, "async-context", "nested-await");
  const fixture = fixtureCase(dir);
  const offset = fixture.input.indexOf("await read()");
  expect(offset).toBeGreaterThanOrEqual(0);
  const place = callPlace(fixture.input, offset);
  const what = "[gwen()] Nested await inside an await argument.";
  const fix = "Fix: Assign the inner await to a const first.";
  const see =
    "See https://gwenjs.github.io/gwen/api/errors#vite-transform-unsupported (VITE:TRANSFORM_UNSUPPORTED)";
  // Same condition as devHint (`packages/vite/src/pipeline/dev-hint.ts:7`).
  const message =
    process.env["NODE_ENV"] !== "production" ? `${what}\n${fix}\n${see}` : `${what}\n${see}`;
  await expect(runCase(dir, fixture.input, "async-context")).rejects.toMatchObject({
    message,
    loc: { file: caseId(dir), line: place.line, column: place.column },
  });
});
