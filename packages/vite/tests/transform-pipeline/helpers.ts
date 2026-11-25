/**
 * Drive `gwen:transform-pipeline` the way Vite does: `configResolved`, then
 * `buildStart`, then `transform`. The host's `error` throws and `resolve`
 * returns null unless the caller supplies `resolveId`.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { originalPositionFor, TraceMap } from "@jridgewell/trace-mapping";
import type { AutoImport } from "@gwenjs/kit";
import { walk } from "oxc-walker";
import { expect } from "vitest";
import type { Alias, Logger, Plugin, ResolvedConfig } from "vite";
import { resolveConfig } from "vite";
import { createTransformPipeline } from "../../src/pipeline/transform-pipeline.js";
import type { GwenCallSite, GwenSourceTransform, TransformEdit } from "../../src/pipeline/types.js";

/** One resolved callee and the source text of its call, in source order. */
export interface CalleeRecord {
  readonly callee: string;
  readonly call: string;
}

/** Both reads of `ctx.calls()` from one module. */
export interface CallProbeResult {
  readonly calls: readonly GwenCallSite[];
  readonly again: readonly GwenCallSite[];
}

let calleeRecords: readonly CalleeRecord[] = [];
let callProbeResult: CallProbeResult = { calls: [], again: [] };

/** Records `{ callee, call }` for every call `resolveCallee` accepts. */
export const probeCallees: GwenSourceTransform = {
  name: "gwen:probe-callees",
  run(program, ctx) {
    const found: CalleeRecord[] = [];
    walk(program, {
      enter(node) {
        if (node.type !== "CallExpression") return;
        const callee = ctx.resolveCallee(node);
        if (callee === null) return;
        found.push({ callee, call: ctx.code.slice(node.start, node.end) });
      },
    });
    calleeRecords = found;
    return [];
  },
};

/** Reads `ctx.calls()` twice so a test can check identity and contents. */
export const probeCalls: GwenSourceTransform = {
  name: "gwen:probe-calls",
  run(program, ctx) {
    void program;
    const calls = ctx.calls();
    const again = ctx.calls();
    callProbeResult = { calls, again };
    return [];
  },
};

export function readCalleeRecords(): readonly CalleeRecord[] {
  return calleeRecords;
}

export function readCallProbe(): CallProbeResult {
  return callProbeResult;
}

/** Inserts the X marker before every call whose callee identifier is `tag`. */
export const testInsert: GwenSourceTransform = {
  name: "gwen:test-insert",
  run(program) {
    const edits: TransformEdit[] = [];
    walk(program, {
      enter(node) {
        if (node.type !== "CallExpression") return;
        if (node.callee.type !== "Identifier") return;
        if (node.callee.name !== "tag") return;
        edits.push({ kind: "insert", at: node.start, text: "/*X*/" });
      },
    });
    return edits;
  },
};

interface PipelineHost {
  error(value: string | object): never;
  resolve(source: string, importer?: string): Promise<{ id: string } | null>;
  warn(log: string | object): void;
}

interface RunOptions {
  id?: string;
  units?: GwenSourceTransform[];
  autoImports?: readonly AutoImport[];
  root?: string;
  resolveId?: (
    source: string,
    importer: string | undefined,
  ) => string | null | Promise<string | null>;
  aliases?: readonly Alias[];
  /** Receives every `this.warn` log of the transform hook. */
  onWarn?: (log: string | object) => void;
}

type BuildStartFn = Exclude<NonNullable<Plugin["buildStart"]>, { handler: unknown }>;

/** Code and map a plugin `transform` hook may return. Vite's `TransformResult` is the server shape. */
export interface PipelineCode {
  readonly code: string;
  readonly map?: unknown;
}

let serveConfig: Promise<ResolvedConfig> | undefined;
const rootedConfigs = new Map<string, Promise<ResolvedConfig>>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined;
  const field = value[key];
  return typeof field === "string" ? field : undefined;
}

function readLoc(value: unknown): { file: string; line: number; column: number } | undefined {
  if (!isRecord(value)) return undefined;
  const loc = value["loc"];
  if (!isRecord(loc)) return undefined;
  const file = loc["file"];
  const line = loc["line"];
  const column = loc["column"];
  if (typeof file !== "string" || typeof line !== "number" || typeof column !== "number") {
    return undefined;
  }
  return { file, line, column };
}

function throwPluginError(value: string | object): never {
  if (typeof value === "string") throw new Error(value);
  if (value instanceof Error) throw value;
  if (!isRecord(value)) throw new Error("plugin error");
  const message = readString(value, "message") ?? "plugin error";
  const thrown = new Error(message);
  const cause = value["cause"];
  const code = readString(value, "code") ?? readString(cause, "code");
  const loc = readLoc(value) ?? readLoc(cause);
  if (code !== undefined) Object.assign(thrown, { code });
  if (loc !== undefined) Object.assign(thrown, { loc });
  if (cause !== undefined) thrown.cause = cause;
  throw thrown;
}

function createHost(
  resolveId: RunOptions["resolveId"],
  onWarn?: RunOptions["onWarn"],
): PipelineHost {
  return {
    error(value) {
      throwPluginError(value);
    },
    async resolve(source, importer) {
      if (resolveId === undefined) return null;
      const resolved = await resolveId(source, importer);
      if (resolved === null) return null;
      return { id: resolved };
    },
    warn(log) {
      if (onWarn !== undefined) onWarn(log);
    },
  };
}

function pipelineCode(value: unknown): PipelineCode | null {
  if (typeof value === "string") return { code: value };
  if (!isRecord(value)) return null;
  const code = value["code"];
  if (typeof code !== "string") return null;
  const map = value["map"];
  if (map === undefined) return { code };
  return { code, map };
}

function cachedServeConfig(root?: string): Promise<ResolvedConfig> {
  if (root === undefined) {
    serveConfig ??= resolveConfig({ configFile: false, logLevel: "silent" }, "serve");
    return serveConfig;
  }
  const found = rootedConfigs.get(root);
  if (found !== undefined) return found;
  const created = resolveConfig({ configFile: false, logLevel: "silent", root }, "serve");
  rootedConfigs.set(root, created);
  return created;
}

function buildStartOptions(): Parameters<BuildStartFn>[0] {
  return {
    input: [],
    cwd: process.cwd(),
    platform: "browser",
    shimMissingExports: false,
    context: "undefined",
    plugins: [],
  };
}

/**
 * `configResolved` then `buildStart`, with a real resolved config.
 * `this` is `error`, `resolve`, and `warn`. Same escape as `packages/vite/tests/error-codes.test.ts:42`.
 */
export async function preparePipeline(
  plugin: Plugin,
  resolveId?: RunOptions["resolveId"],
  root?: string,
  aliases?: RunOptions["aliases"],
  logger?: Logger,
): Promise<void> {
  const host = createHost(resolveId);
  const loaded = await cachedServeConfig(root);
  const aliased =
    aliases === undefined
      ? loaded
      : { ...loaded, resolve: { ...loaded.resolve, alias: [...aliases] } };
  const config = logger === undefined ? aliased : { ...aliased, logger };
  const configResolved = plugin.configResolved;
  if (typeof configResolved === "function") {
    await configResolved.call(host as never, config);
  } else if (configResolved !== undefined && configResolved !== null) {
    await configResolved.handler.call(host as never, config);
  }
  const buildStart = plugin.buildStart;
  if (typeof buildStart === "function") {
    await buildStart.call(host as never, buildStartOptions());
  } else if (buildStart !== undefined && buildStart !== null) {
    await buildStart.handler.call(host as never, buildStartOptions());
  }
}

/** Call `transform` on an already prepared plugin. */
export async function applyTransform(
  plugin: Plugin,
  code: string,
  id: string,
  resolveId?: RunOptions["resolveId"],
  onWarn?: RunOptions["onWarn"],
): Promise<PipelineCode | null> {
  const host = createHost(resolveId, onWarn);
  const transform = plugin.transform;
  if (typeof transform === "function") {
    return pipelineCode(await transform.call(host as never, code, id));
  }
  if (transform === undefined || transform === null) return null;
  return pipelineCode(await transform.handler.call(host as never, code, id));
}

/**
 * One plugin after `configResolved` and `buildStart`.
 * Several importers share that instance, including its barrel cache.
 */
export async function openPipeline(options: RunOptions = {}): Promise<Plugin> {
  const units = options.units ?? [];
  const plugin =
    options.autoImports === undefined
      ? createTransformPipeline({ units })
      : createTransformPipeline({ units, autoImports: options.autoImports });
  await preparePipeline(plugin, options.resolveId, options.root, options.aliases);
  return plugin;
}

/** Create the pipeline, settle its lifecycle, and transform one module. */
export async function runPipeline(
  code: string,
  options: RunOptions = {},
): Promise<PipelineCode | null> {
  const plugin = await openPipeline(options);
  return applyTransform(plugin, code, options.id ?? "/src/x.ts", options.resolveId, options.onWarn);
}

/** Relative specifier to `<directory of the importer>/<specifier>.ts`. */
export function resolveRelativeId(source: string, importer: string | undefined): string | null {
  if (importer === undefined) return null;
  if (!source.startsWith(".")) return null;
  return join(dirname(importer), `${source}.ts`);
}

/** Call the plugin `watchChange` hook. */
export function watchPipeline(plugin: Plugin, id: string): void {
  const hook = plugin.watchChange;
  const host = createHost(undefined);
  const change = { event: "update" as const };
  if (typeof hook === "function") {
    void hook.call(host as never, id, change);
    return;
  }
  if (hook === undefined || hook === null) throw new Error("watchChange is missing");
  void hook.handler.call(host as never, id, change);
}

/**
 * Read `input.tsx` when that file is present, otherwise `input.ts`.
 * Read `output.tsx` when that file is present, otherwise `output.ts`.
 * An output file is required unless `error.json` is present (`{ code }`).
 */
export function fixtureCase(dir: string): {
  input: string;
  output: string | undefined;
  errorCode: string | undefined;
} {
  const tsxPath = join(dir, "input.tsx");
  const inputPath = existsSync(tsxPath) ? tsxPath : join(dir, "input.ts");
  const input = readFileSync(inputPath, "utf8");
  const outputTsxPath = join(dir, "output.tsx");
  const outputPath = existsSync(outputTsxPath) ? outputTsxPath : join(dir, "output.ts");
  const errorPath = join(dir, "error.json");
  const output = existsSync(outputPath) ? readFileSync(outputPath, "utf8") : undefined;
  if (output === undefined && !existsSync(errorPath)) {
    throw new Error(`${dir}: output.tsx or output.ts required unless error.json`);
  }
  if (!existsSync(errorPath)) return { input, output, errorCode: undefined };
  const parsed: unknown = JSON.parse(readFileSync(errorPath, "utf8"));
  const code = isRecord(parsed) ? parsed["code"] : undefined;
  return { input, output, errorCode: typeof code === "string" ? code : undefined };
}

function readCalleeExpected(value: unknown): CalleeRecord[] {
  if (!Array.isArray(value)) throw new Error("expected.json must be an array");
  const hits: CalleeRecord[] = [];
  for (const item of value) {
    if (!isRecord(item)) throw new Error("expected.json entry must be an object");
    const callee = item["callee"];
    const call = item["call"];
    if (typeof callee !== "string" || typeof call !== "string") {
      throw new Error("expected.json entry must be { callee, call }");
    }
    hits.push({ callee, call });
  }
  return hits;
}

function readAutoImportEntry(item: unknown): AutoImport {
  if (!isRecord(item)) throw new Error("auto-imports.json entry must be an object");
  const name = item["name"];
  const from = item["from"];
  const alias = item["as"];
  if (typeof name !== "string" || typeof from !== "string") {
    throw new Error("auto-imports.json entry needs name and from");
  }
  if (alias === undefined) return { name, from };
  if (typeof alias !== "string") throw new Error("auto-imports.json as must be a string");
  return { name, from, as: alias };
}

export function readAutoImports(dir: string): readonly AutoImport[] {
  const autoPath = join(dir, "auto-imports.json");
  if (!existsSync(autoPath)) return [];
  const parsed: unknown = JSON.parse(readFileSync(autoPath, "utf8"));
  if (!Array.isArray(parsed)) throw new Error("auto-imports.json must be an array");
  return parsed.map((item) => readAutoImportEntry(item));
}

/** Read `input.ts`, `expected.json`, and optional `auto-imports.json`. */
export function calleeFixture(dir: string): {
  input: string;
  expected: readonly CalleeRecord[];
  autoImports: readonly AutoImport[];
} {
  const input = readFileSync(join(dir, "input.ts"), "utf8");
  const parsed: unknown = JSON.parse(readFileSync(join(dir, "expected.json"), "utf8"));
  return { input, expected: readCalleeExpected(parsed), autoImports: readAutoImports(dir) };
}

/**
 * 1-based line, 0-based column, which is what a source map stores.
 * A map marker names the identifier that follows it.
 */
function sourceMapPosition(code: string, offset: number): { line: number; column: number } {
  let line = 1;
  let column = 0;
  for (let index = 0; index < offset; index += 1) {
    if (code.charCodeAt(index) === 10) {
      line += 1;
      column = 0;
    } else {
      column += 1;
    }
  }
  return { line, column };
}

function isTraceMapInput(value: unknown): value is ConstructorParameters<typeof TraceMap>[0] {
  if (typeof value === "string") return true;
  if (!isRecord(value)) return false;
  if (value["version"] !== 3) return false;
  if (typeof value["mappings"] !== "string") return false;
  return Array.isArray(value["sources"]) && Array.isArray(value["names"]);
}

/**
 * For every map marker, the following identifier is found in `output`
 * and the map sends that output position back to the identifier's original position.
 */
export function mapCheck(input: string, output: string, map: unknown): void {
  expect(isTraceMapInput(map)).toBe(true);
  if (!isTraceMapInput(map)) return;
  const tracer = new TraceMap(map);
  const marker = "/*@map*/";
  let inputFrom = 0;
  let outputFrom = 0;
  while (inputFrom < input.length) {
    const at = input.indexOf(marker, inputFrom);
    if (at < 0) break;
    const after = at + marker.length;
    const match = /^(\s*)([A-Za-z_$][\w$]*)/.exec(input.slice(after));
    expect(match).not.toBeNull();
    if (match === null) return;
    const spaces = match[1] ?? "";
    const token = match[2] ?? "";
    const tokenOffset = after + spaces.length;
    const original = sourceMapPosition(input, tokenOffset);
    const outAt = output.indexOf(token, outputFrom);
    expect(outAt).toBeGreaterThanOrEqual(0);
    const generated = sourceMapPosition(output, outAt);
    const mapped = originalPositionFor(tracer, generated);
    expect(mapped.line).toBe(original.line);
    expect(mapped.column).toBe(original.column);
    inputFrom = tokenOffset + token.length;
    outputFrom = outAt + token.length;
  }
}
