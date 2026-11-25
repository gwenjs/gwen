/**
 * `gwen:hoist-chunk-columns` is the opt-in unit behind `optimizer`. It reads each distinct
 * `chunk.get(Def)` of a row loop once, before the loop. Every positive case is a directory under
 * `tests/fixtures/hoist-chunk-columns/` (`input.ts`, `output.ts`, optional `auto-imports.json`);
 * `tests/transform-pipeline/fixtures.test.ts` compares each one byte for byte.
 * The unit list is read with `Reflect.get`, so these tests run on a base that has no such list.
 * Each claim that is true of an idle unit carries a positive anchor: the output holds a hoisted name.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin, PluginOption } from "vite";
import { expect, it } from "vitest";
import { gwen } from "../../src/index.js";
import { walk } from "../../src/oxc/index.js";
import { parseModule } from "../../src/pipeline/parse.js";
import * as registry from "../../src/pipeline/registry.js";
import { BUILT_IN_UNITS } from "../../src/pipeline/registry.js";
import type { GwenTransformPipelineApi } from "../../src/pipeline/transform-pipeline.js";
import type { GwenSourceTransform } from "../../src/pipeline/types.js";
import { gwenVitePlugin } from "../../src/plugins/index.js";
import { readAutoImports, resolveRelativeId, runPipeline } from "../transform-pipeline/helpers.js";

const UNIT = "gwen:hoist-chunk-columns";
const HOT_PATH = "gwen:hot-path-warn";
const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
const casesRoot = fileURLToPath(new URL("../fixtures/hoist-chunk-columns/", import.meta.url));

interface Case {
  readonly name: string;
  readonly dir: string;
  readonly input: string;
  readonly output: string;
}

function loadCases(): Case[] {
  const found: Case[] = [];
  for (const entry of readdirSync(casesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(casesRoot, entry.name);
    found.push({
      name: entry.name,
      dir,
      input: readFileSync(join(dir, "input.ts"), "utf8"),
      output: readFileSync(join(dir, "output.ts"), "utf8"),
    });
  }
  found.sort((left, right) => left.name.localeCompare(right.name));
  return found;
}

const cases = loadCases();
if (cases.length === 0) throw new Error(`No hoist-chunk-columns fixture under ${casesRoot}`);

function isUnitList(value: unknown): value is readonly GwenSourceTransform[] {
  return Array.isArray(value);
}

/** Empty on the base: `OPTIMIZER_UNITS` does not exist there. */
function optimizerUnits(): readonly GwenSourceTransform[] {
  const list: unknown = Reflect.get(registry, "OPTIMIZER_UNITS");
  return isUnitList(list) ? list : [];
}

async function run(item: Case, source: string) {
  return runPipeline(source, {
    id: join(item.dir, "input.ts"),
    root: packageRoot,
    resolveId: resolveRelativeId,
    autoImports: readAutoImports(item.dir),
    units: [...BUILT_IN_UNITS, ...optimizerUnits()],
  });
}

/** Every number literal of a module, in ascending order, duplicates kept. */
function numberLiterals(item: Case, code: string): number[] {
  const found: number[] = [];
  walk(parseModule(join(item.dir, "input.ts"), code).program, {
    enter(node) {
      if (node.type !== "Literal") return;
      if (typeof node.value === "number") found.push(node.value);
    },
  });
  return found.sort((left, right) => left - right);
}

function isApi(value: unknown): value is GwenTransformPipelineApi {
  if (typeof value !== "object" || value === null) return false;
  if (!("register" in value) || typeof value.register !== "function") return false;
  return "names" in value;
}

function findPipeline(
  option: PluginOption,
): (Plugin & { api: GwenTransformPipelineApi }) | undefined {
  if (option === null || option === undefined || option === false || option instanceof Promise) {
    return undefined;
  }
  if (Array.isArray(option)) {
    for (const item of option) {
      const found = findPipeline(item);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (option.name !== "gwen:transform-pipeline") return undefined;
  if (!("api" in option)) return undefined;
  const api: unknown = option.api;
  if (!isApi(api)) return undefined;
  return Object.assign(option, { api });
}

/** Unit names of the pipeline a factory builds, in application order. */
function unitNames(option: PluginOption): readonly string[] {
  const pipeline = findPipeline(option);
  if (pipeline === undefined) throw new Error("the factory built no gwen:transform-pipeline");
  return pipeline.api.names;
}

/** From the last built-in unit on: what follows `gwen:hot-path-warn`. */
function afterHotPath(names: readonly string[]): readonly string[] {
  const at = names.indexOf(HOT_PATH);
  if (at < 0) throw new Error(`${HOT_PATH} is not registered`);
  return names.slice(at);
}

it("the output has no numeric literal that was not in the input", async () => {
  for (const item of cases) {
    const result = await run(item, item.input);
    const output = result?.code ?? "";
    expect(output, item.name).toContain("_gwen_c0");
    expect(numberLiterals(item, output), item.name).toEqual(numberLiterals(item, item.input));
  }
});

it("a second run produces no edit", async () => {
  for (const item of cases) {
    const first = await run(item, item.input);
    expect(first?.code ?? "", item.name).toContain("_gwen_c");
    expect(await run(item, item.output), item.name).toBeNull();
  }
});

it("optimizer: false leaves the unit unregistered", () => {
  const off = [
    unitNames(gwenVitePlugin()),
    unitNames(gwenVitePlugin({ optimizer: false })),
    unitNames(gwen()),
    unitNames(gwen({ optimizer: false })),
  ];
  for (const names of off) expect(names).not.toContain(UNIT);
  const on = [
    unitNames(gwenVitePlugin({ optimizer: true })),
    unitNames(gwenVitePlugin({ optimizer: { debug: true } })),
    unitNames(gwenVitePlugin({ optimizer: {} })),
    unitNames(gwen({ optimizer: true })),
    unitNames(gwen({ optimizer: { debug: false } })),
  ];
  for (const names of on) {
    expect(names.filter((name) => name === UNIT)).toEqual([UNIT]);
    expect(afterHotPath(names)).toEqual([HOT_PATH, UNIT]);
  }
});

it("the unit is the only addition: optimizer: true keeps every other unit and their order", () => {
  expect(unitNames(gwenVitePlugin({ optimizer: true }))).toEqual([
    ...unitNames(gwenVitePlugin()),
    UNIT,
  ]);
  expect(unitNames(gwen({ optimizer: true }))).toEqual([...unitNames(gwen()), UNIT]);
});

const DIRECTIVE = "// @gwen-no-optimize";
const HEAD = `import { defineSystem, onUpdate, useQuery } from "@gwenjs/core/system";
import { Position, Velocity } from "./components";
`;
const TAIL = `  });
});
`;
const LOOP = `      for (let i = 0; i < chunk.count; i++) {
        chunk.get(Position).x[i] += chunk.get(Velocity).vx[i] * dt;
      }
`;
const HOISTED = `      const _gwen_c0 = chunk.get(Position);
      const _gwen_c1 = chunk.get(Velocity);
      for (let i = 0; i < chunk.count; i++) {
        _gwen_c0.x[i] += _gwen_c1.vx[i] * dt;
      }
`;
const OPTED_STATEMENT = `      for (let i = 0; i < chunk.count; i++) {
        ${DIRECTIVE}
        chunk.get(Position).x[i] += chunk.get(Velocity).vx[i] * dt;
      }
`;
/** A system whose outer loop holds `loops`; `before` is a statement ahead of the query. */
function system(loops: string, before = ""): string {
  return `${HEAD}
export const Mover = defineSystem("Mover", () => {
${before}  const q = useQuery([Position, Velocity]);
  onUpdate((dt) => {
    for (const chunk of q) {
${loops}    }
${TAIL}`;
}

/** The module the pipeline writes for `system(loops)`: the query tuple is hoisted by its own unit. */
function written(loops: string, before = ""): string {
  return `${HEAD}
const _gwen_q0 = [Position, Velocity];
export const Mover = defineSystem("Mover", () => {
${before}  const q = useQuery(_gwen_q0);
  onUpdate((dt) => {
    for (const chunk of q) {
${loops}    }
${TAIL}`;
}

it("an opt-out directive on an inner loop or on a statement inside it leaves that loop untouched", async () => {
  const host = cases.find((item) => item.name === "inline-get");
  if (host === undefined) throw new Error("the inline-get fixture is missing");
  const marked = (loops: string) => run(host, system(loops));
  // (a) the directive sits before the inner `for`: that loop stays, its sibling is hoisted
  const onLoop = await marked(`      ${DIRECTIVE}\n${LOOP}${LOOP}`);
  expect(onLoop?.code).toBe(written(`      ${DIRECTIVE}\n${LOOP}${HOISTED}`));
  // (b) the directive sits before a statement inside the inner `for`
  const inside = await marked(`${OPTED_STATEMENT}${LOOP}`);
  expect(inside?.code).toBe(written(`${OPTED_STATEMENT}${HOISTED}`));
  // (c) a directive on an unrelated statement does not block the hoist
  const unrelated = await run(host, system(LOOP, `  ${DIRECTIVE}\n  const unused = 1;\n`));
  expect(unrelated?.code).toBe(written(HOISTED, `  ${DIRECTIVE}\n  const unused = 1;\n`));
});
