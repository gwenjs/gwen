/**
 * Fixture dirs under tests/fixtures/<unit>/<case>/ with an input and an output or an error.
 * Dirs that only hold expected.json, such as resolve-callee, are not cases.
 */

import { existsSync, readdirSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { BUILT_IN_UNITS } from "../../src/pipeline/registry.js";
import type { GwenSourceTransform } from "../../src/pipeline/types.js";
import * as layerUtils from "../../src/shared/layer-utils.js";
import {
  createVariantGuard,
  type VariantGuardOptions,
} from "../../src/transforms/variant-guard.js";
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

interface BvhPrebakeDeps {
  bake(glb: Uint8Array, mesh: string | undefined): Promise<Uint8Array>;
  assets: Map<string, Uint8Array>;
}

function isBvhFactory(value: unknown): value is (deps: BvhPrebakeDeps) => GwenSourceTransform {
  return typeof value === "function";
}

/** Bytes the fixture baker returns for one glb, mesh name and call count. */
function bakeBody(glb: Uint8Array, mesh: string | undefined, count: number): Uint8Array {
  const meshBytes = new TextEncoder().encode(mesh ?? "");
  const body = new Uint8Array(5 + meshBytes.length + glb.length);
  body[0] = 0x62;
  body[1] = 0x76;
  body[2] = 0x68;
  body[3] = count;
  body[4] = meshBytes.length;
  body.set(meshBytes, 5);
  body.set(glb, 5 + meshBytes.length);
  return body;
}

/**
 * `createBvhPrebakeTransform` is absent on the base
 * (`packages/vite/src/shared/layer-utils.ts:8`). No unit is registered then.
 */
function bvhPrebakeUnit(): GwenSourceTransform | undefined {
  const factory: unknown = Reflect.get(layerUtils, "createBvhPrebakeTransform");
  if (!isBvhFactory(factory)) return undefined;
  const counts = new Map<string, number>();
  const assets = new Map<string, Uint8Array>();
  const bake = (glb: Uint8Array, mesh: string | undefined): Promise<Uint8Array> => {
    const key = `${mesh ?? ""}\0${Buffer.from(glb).toString("hex")}`;
    const count = counts.get(key) ?? 0;
    counts.set(key, count + 1);
    return Promise.resolve(bakeBody(glb, mesh, count));
  };
  return factory({ bake, assets });
}

/** Default 2D project. Two cases carry their own config. */
function guardConfig(name: string): Pick<VariantGuardOptions, "variant" | "declaredModules"> {
  if (name === "undeclared-2d-in-2d") return { variant: "physics2d", declaredModules: [] };
  if (name === "light-imports-2d") return { variant: "light", declaredModules: [] };
  return { variant: "physics2d", declaredModules: ["@gwenjs/physics2d"] };
}

function extraUnits(unit: string, name: string): readonly GwenSourceTransform[] {
  if (unit === "layer-inline" || unit === "async-context") return [layerUtils.layerInlineTransform];
  if (unit === "variant-guard") {
    return [createVariantGuard({ root: packageRoot, ...guardConfig(name) })];
  }
  if (unit !== "bvh-prebake") return [];
  const unitTransform = bvhPrebakeUnit();
  if (unitTransform === undefined) return [];
  return [unitTransform];
}

function runCase(dir: string, code: string, unit: string) {
  return runPipeline(code, {
    id: caseId(dir),
    root: packageRoot,
    resolveId: resolveRelativeId,
    units: [...BUILT_IN_UNITS, ...extraUnits(unit, basename(dir))],
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

function indentWidth(line: string): number {
  let index = 0;
  while (index < line.length) {
    const char = line.charCodeAt(index);
    if (char !== 32 && char !== 9) break;
    index += 1;
  }
  return index;
}

function objectAssignLines(code: string): string[] {
  const lines: string[] = [];
  for (const line of code.split("\n")) {
    if (line.includes("Object.assign(")) lines.push(line);
  }
  return lines;
}

const NAME_CALLEES = [
  "defineLayout",
  "defineSceneRouter",
  "make",
  "real",
  "G.defineLayout",
  "G.defineSceneRouter",
];

function followedByCallee(line: string): boolean {
  const at = line.indexOf("Object.assign(");
  if (at < 0) return false;
  const after = line.slice(at + "Object.assign(".length);
  for (const callee of NAME_CALLEES) {
    if (after.startsWith(callee)) return true;
  }
  return false;
}

it("layout-name and scene-router-name append one guarded statement per name and never wrap the call", async () => {
  const units = ["layout-name", "scene-router-name"];
  let checked = 0;
  for (const unit of units) {
    const root = join(fixturesRoot, unit);
    const dirs = readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory());
    for (const entry of dirs) {
      const dir = join(root, entry.name);
      if (!isFixtureCase(dir)) continue;
      const fixture = fixtureCase(dir);
      const output = fixture.output;
      if (typeof output !== "string") continue;
      checked += 1;
      const settled = await runCase(dir, fixture.input, unit);
      const label = `${unit}/${entry.name}`;
      expect(settled?.code, label).toBe(output);
      const code = settled?.code ?? "";
      const lines = objectAssignLines(code);
      for (const line of lines) {
        const body = line.slice(indentWidth(line));
        expect(body.startsWith("__GWEN_DEV__ && Object.assign("), label).toBe(true);
        expect(body.endsWith("});"), label).toBe(true);
        expect(followedByCallee(line), label).toBe(false);
      }
      expect(lines.length, label).toBe(objectAssignLines(output).length);
    }
  }
  expect(checked).toBe(28);
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

function countOf(code: string, needle: string): number {
  let count = 0;
  let from = 0;
  while (from < code.length) {
    const at = code.indexOf(needle, from);
    if (at < 0) break;
    count += 1;
    from = at + needle.length;
  }
  return count;
}

/** Names in `(_gwen_qN)` calls, in source order. A comma excludes the call. */
function hoistNames(code: string): string[] {
  const names: string[] = [];
  const pattern = /\((_gwen_q\d+)\)/g;
  for (const match of code.matchAll(pattern)) {
    const name = match[1];
    if (name !== undefined) names.push(name);
  }
  return names;
}

it("query-hoist/hoisted calls carry one argument and each name is declared once before its use", async () => {
  const root = join(fixturesRoot, "query-hoist");
  const dirs = readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  expect(dirs.length).toBe(33);
  let checked = 0;
  for (const entry of dirs) {
    const dir = join(root, entry.name);
    const fixture = fixtureCase(dir);
    const output = fixture.output;
    if (typeof output !== "string" || !output.includes("_gwen_q")) continue;
    checked += 1;
    const settled = await runCase(dir, fixture.input, "query-hoist");
    const code = settled?.code ?? "";
    const expectedNames = hoistNames(output);
    const actualNames = hoistNames(code);
    expect(actualNames, entry.name).toEqual(expectedNames);
    for (const name of expectedNames) {
      const declaration = `const ${name} =`;
      expect(countOf(code, declaration), name).toBe(1);
      const declaredAt = code.indexOf(declaration);
      const usedAt = code.indexOf(`(${name})`);
      expect(declaredAt, name).toBeGreaterThanOrEqual(0);
      expect(usedAt, name).toBeGreaterThanOrEqual(0);
      expect(declaredAt, name).toBeLessThan(usedAt);
      expect(code.includes(`(${name},`), name).toBe(false);
    }
  }
  expect(checked).toBeGreaterThan(0);
});

/** Importer path as the guard prints it: relative to the project root, with `/`. */
function importerPath(dir: string): string {
  return relative(packageRoot, caseId(dir)).split(sep).join("/");
}

async function expectGuardError(name: string, source: string, what: string, fix: string) {
  const dir = join(fixturesRoot, "variant-guard", name);
  const fixture = fixtureCase(dir);
  const offset = fixture.input.indexOf(`"${source}"`);
  expect(offset).toBeGreaterThanOrEqual(0);
  const place = callPlace(fixture.input, offset);
  const see =
    "See https://gwenjs.github.io/gwen/api/errors#vite-variant-required (VITE:VARIANT_REQUIRED)";
  // Same condition as devHint (`packages/vite/src/pipeline/dev-hint.ts:7`).
  const message =
    process.env["NODE_ENV"] !== "production" ? `${what}\n${fix}\n${see}` : `${what}\n${see}`;
  await expect(runCase(dir, fixture.input, "variant-guard")).rejects.toMatchObject({
    message,
    loc: { file: caseId(dir), line: place.line, column: place.column },
  });
}

it("variant-guard/value-import-3d-in-2d raises with the exact message, hint and position", async () => {
  const name = "value-import-3d-in-2d";
  const what = `[gwen()] ${importerPath(join(fixturesRoot, "variant-guard", name))} imports @gwenjs/physics3d, which needs the "physics3d" variant; the build is "physics2d".`;
  const fix =
    'Fix: Add "@gwenjs/physics3d" to modules in gwen.config.ts (the variant follows), or remove the import.';
  await expectGuardError(name, "@gwenjs/physics3d", what, fix);
});

it("variant-guard/undeclared-2d-in-2d raises with the exact message, hint and position", async () => {
  const name = "undeclared-2d-in-2d";
  const what = `[gwen()] ${importerPath(join(fixturesRoot, "variant-guard", name))} imports @gwenjs/physics2d, but "@gwenjs/physics2d" is not in modules (the build is "physics2d").`;
  const fix = 'Fix: Add "@gwenjs/physics2d" to modules in gwen.config.ts, or remove the import.';
  await expectGuardError(name, "@gwenjs/physics2d", what, fix);
});

it("variant-guard/light-imports-2d raises with the exact message, hint and position", async () => {
  const name = "light-imports-2d";
  const what = `[gwen()] ${importerPath(join(fixturesRoot, "variant-guard", name))} imports @gwenjs/physics2d, which needs the "physics2d" variant; the build is "light".`;
  const fix =
    'Fix: Add "@gwenjs/physics2d" to modules in gwen.config.ts (the variant follows), or remove the import.';
  await expectGuardError(name, "@gwenjs/physics2d", what, fix);
});
