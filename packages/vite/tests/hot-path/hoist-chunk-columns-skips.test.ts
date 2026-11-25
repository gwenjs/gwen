/**
 * With `optimizer: { debug: true }`, `gwen:hoist-chunk-columns` logs one line per loop it inspects
 * and leaves alone, through the Vite logger: `[gwen:hot-path] skip <file>:<line> — <P#>`.
 * Every negative case is a directory under `tests/fixtures/hoist-chunk-columns-skip/`
 * (`input.ts`, `skips.json`): one construct differs from the `inline-get` fixture of
 * `tests/fixtures/hoist-chunk-columns/`, and `skips.json` names the first failing precondition and
 * the line of the loop. The directories of `tests/fixtures/hoist-chunk-columns-silent/` hold no
 * loop that fails a precondition (the unit inspects no loop, or the loop passes every
 * precondition and has no `chunk.get(Def)` to hoist), so they log nothing. In both, the code
 * equals the code of `optimizer: false`: the unit adds no edit.
 * The tests go through the real `gwenVitePlugin` pipeline and its resolved config logger.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { Logger, Plugin, PluginOption } from "vite";
import { expect, it } from "vitest";
import { gwenVitePlugin } from "../../src/plugins/index.js";
import type { GwenOptimizerUserOptions } from "../../src/types.js";
import {
  applyTransform,
  preparePipeline,
  resolveRelativeId,
} from "../transform-pipeline/helpers.js";

const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
const skipRoot = fileURLToPath(new URL("../fixtures/hoist-chunk-columns-skip/", import.meta.url));
const silentRoot = fileURLToPath(
  new URL("../fixtures/hoist-chunk-columns-silent/", import.meta.url),
);
const PREFIX = "[gwen:hot-path] skip";

interface Skip {
  readonly precondition: string;
  readonly line: number;
}

interface Case {
  readonly name: string;
  readonly id: string;
  readonly input: string;
  readonly skips: readonly Skip[];
}

/** What a module gives the next plugin, and what the pipeline logged while it ran. */
interface Outcome {
  readonly code: string;
  readonly lines: readonly string[];
}

function readSkip(item: unknown): Skip {
  if (typeof item !== "object" || item === null) throw new Error("a skip must be an object");
  const precondition: unknown = Reflect.get(item, "precondition");
  const line: unknown = Reflect.get(item, "line");
  if (typeof precondition !== "string" || typeof line !== "number") {
    throw new Error("a skip needs a string `precondition` and a number `line`");
  }
  return { precondition, line };
}

function readSkips(file: string): Skip[] {
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  const skips: unknown =
    typeof parsed === "object" && parsed !== null && Reflect.get(parsed, "skips");
  if (!Array.isArray(skips)) throw new Error(`${file} needs a \`skips\` array`);
  return skips.map((item) => readSkip(item));
}

function loadCases(root: string): Case[] {
  const found: Case[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(root, entry.name);
    found.push({
      name: entry.name,
      id: join(dir, "input.ts"),
      input: readFileSync(join(dir, "input.ts"), "utf8"),
      skips: readSkips(join(dir, "skips.json")),
    });
  }
  found.sort((left, right) => left.name.localeCompare(right.name));
  return found;
}

const skipCases = loadCases(skipRoot);
const silentCases = loadCases(silentRoot);
if (skipCases.length === 0) throw new Error(`No negative fixture under ${skipRoot}`);
if (silentCases.length === 0) throw new Error(`No silent fixture under ${silentRoot}`);

function named(cases: readonly Case[], name: string): Case {
  const found = cases.find((item) => item.name === name);
  if (found === undefined) throw new Error(`the ${name} fixture is missing`);
  return found;
}

function findPipeline(option: PluginOption): Plugin | undefined {
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
  return option.name === "gwen:transform-pipeline" ? option : undefined;
}

function recordingLogger(lines: string[]): Logger {
  return {
    hasWarned: false,
    info(message) {
      lines.push(message);
    },
    warn() {},
    warnOnce() {},
    error() {},
    clearScreen() {},
    hasErrorLogged: () => false,
  };
}

/** `source` through the pipeline of `gwenVitePlugin({ optimizer })`; no edit leaves it as is. */
async function through(
  id: string,
  source: string,
  optimizer: boolean | GwenOptimizerUserOptions,
): Promise<Outcome> {
  const lines: string[] = [];
  const pipeline = findPipeline(gwenVitePlugin({ optimizer }));
  if (pipeline === undefined) throw new Error("the factory built no gwen:transform-pipeline");
  await preparePipeline(
    pipeline,
    resolveRelativeId,
    packageRoot,
    undefined,
    recordingLogger(lines),
  );
  const result = await applyTransform(pipeline, source, id, resolveRelativeId);
  return { code: result === null ? source : result.code, lines };
}

function transform(item: Case, optimizer: boolean | GwenOptimizerUserOptions): Promise<Outcome> {
  return through(item.id, item.input, optimizer);
}

/** The line of one skip, with the module path relative to the Vite root (the package root here). */
function skipLine(id: string, skip: Skip): string {
  const file = relative(packageRoot, id).replaceAll("\\", "/");
  return `${PREFIX} ${file}:${skip.line} — ${skip.precondition}`;
}

for (const item of skipCases) {
  it(`hoist-chunk-columns-skip/${item.name}`, async () => {
    const off = await transform(item, false);
    const on = await transform(item, { debug: true });
    expect(on.code).toBe(off.code);
    expect(on.lines).toEqual(item.skips.map((skip) => skipLine(item.id, skip)));
  });
}

it("optimizer: true without debug logs no skip line", async () => {
  const item = named(skipCases, "p5-any-call");
  const debug = await transform(item, { debug: true });
  expect(debug.lines).toHaveLength(1);
  expect((await transform(item, true)).lines).toEqual([]);
  expect((await transform(item, { debug: false })).lines).toEqual([]);
});

it("a module with no loop to inspect logs no skip line and stays untouched", async () => {
  const anchor = named(skipCases, "p5-any-call");
  expect((await transform(anchor, { debug: true })).lines).toEqual([
    skipLine(anchor.id, { precondition: "P5", line: 9 }),
  ]);
  for (const item of silentCases) {
    const off = await transform(item, false);
    const on = await transform(item, { debug: true });
    expect(on.code, item.name).toBe(off.code);
    expect(on.lines, item.name).toEqual([]);
  }
});

it("a second transform of the same module on one pipeline logs its line again, once", async () => {
  const item = named(skipCases, "p5-any-call");
  const lines: string[] = [];
  const pipeline = findPipeline(gwenVitePlugin({ optimizer: { debug: true } }));
  if (pipeline === undefined) throw new Error("the factory built no gwen:transform-pipeline");
  await preparePipeline(
    pipeline,
    resolveRelativeId,
    packageRoot,
    undefined,
    recordingLogger(lines),
  );
  await applyTransform(pipeline, item.input, item.id, resolveRelativeId);
  await applyTransform(pipeline, item.input, item.id, resolveRelativeId);
  const line = skipLine(item.id, { precondition: "P5", line: 9 });
  expect(lines).toEqual([line, line]);
});

/** One outer loop, three inner loops: one hoisted, then a P5 skip (line 14), then a P6 skip (18). */
const MIXED = `import { defineSystem, onUpdate, useQuery } from "@gwenjs/core/system";
import { Position, Velocity } from "./components";

declare function track(value: number): void;
declare function destroyEntity(id: number): void;

export const Mover = defineSystem("Mover", () => {
  const q = useQuery([Position, Velocity]);
  onUpdate((dt) => {
    for (const chunk of q) {
      for (let i = 0; i < chunk.count; i++) {
        chunk.get(Position).x[i] += chunk.get(Velocity).vx[i] * dt;
      }
      for (let i = 0; i < chunk.count; i++) {
        track(i);
        chunk.get(Position).y[i] += 1;
      }
      for (let i = 0; i < chunk.count; i++) {
        destroyEntity(i);
        chunk.get(Position).y[i] += 2;
      }
    }
  });
});
`;

it("optimizer.debug logs one skip line per skipped loop and none for a hoisted loop", async () => {
  const id = join(skipRoot, "mixed-loops.ts");
  const off = await through(id, MIXED, false);
  const on = await through(id, MIXED, { debug: true });
  expect(off.code).not.toContain("_gwen_c0");
  expect(on.code).toContain("const _gwen_c0 = chunk.get(Position);");
  expect(on.code).toContain("chunk.get(Position).y[i] += 1;");
  expect(on.code).toContain("chunk.get(Position).y[i] += 2;");
  expect(on.lines).toEqual([
    skipLine(id, { precondition: "P5", line: 14 }),
    skipLine(id, { precondition: "P6", line: 18 }),
  ]);
});
