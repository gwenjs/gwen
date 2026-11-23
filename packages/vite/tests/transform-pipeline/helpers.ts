/**
 * Drive `gwen:transform-pipeline` the way Vite does: `configResolved`, then
 * `buildStart`, then `transform`. The host's `error` throws and `resolve`
 * returns null unless the caller supplies `resolveId`.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { originalPositionFor, TraceMap } from "@jridgewell/trace-mapping";
import { walk } from "oxc-walker";
import { expect } from "vitest";
import type { Plugin, ResolvedConfig } from "vite";
import { resolveConfig } from "vite";
import { createTransformPipeline } from "../../src/pipeline/transform-pipeline.js";
import type { GwenSourceTransform, TransformEdit } from "../../src/pipeline/types.js";

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
}

interface RunOptions {
  id?: string;
  units?: GwenSourceTransform[];
  resolveId?: (
    source: string,
    importer: string | undefined,
  ) => string | null | Promise<string | null>;
}

type BuildStartFn = Exclude<NonNullable<Plugin["buildStart"]>, { handler: unknown }>;

/** Code and map a plugin `transform` hook may return. Vite's `TransformResult` is the server shape. */
export interface PipelineCode {
  readonly code: string;
  readonly map?: unknown;
}

let serveConfig: Promise<ResolvedConfig> | undefined;

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

function createHost(resolveId: RunOptions["resolveId"]): PipelineHost {
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

function cachedServeConfig(): Promise<ResolvedConfig> {
  serveConfig ??= resolveConfig({ configFile: false, logLevel: "silent" }, "serve");
  return serveConfig;
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
 * `this` is only `error` and `resolve`. Same escape as `packages/vite/tests/error-codes.test.ts:42`.
 */
export async function preparePipeline(
  plugin: Plugin,
  resolveId?: RunOptions["resolveId"],
): Promise<void> {
  const host = createHost(resolveId);
  const configResolved = plugin.configResolved;
  if (typeof configResolved === "function") {
    await configResolved.call(host as never, await cachedServeConfig());
  } else if (configResolved !== undefined && configResolved !== null) {
    await configResolved.handler.call(host as never, await cachedServeConfig());
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
): Promise<PipelineCode | null> {
  const host = createHost(resolveId);
  const transform = plugin.transform;
  if (typeof transform === "function") {
    return pipelineCode(await transform.call(host as never, code, id));
  }
  if (transform === undefined || transform === null) return null;
  return pipelineCode(await transform.handler.call(host as never, code, id));
}

/** Create the pipeline, settle its lifecycle, and transform one module. */
export async function runPipeline(
  code: string,
  options: RunOptions = {},
): Promise<PipelineCode | null> {
  const plugin = createTransformPipeline({ units: options.units ?? [] });
  await preparePipeline(plugin, options.resolveId);
  return applyTransform(plugin, code, options.id ?? "/src/x.ts", options.resolveId);
}

/** Read `input.ts`, `output.ts`, and optional `error.json` (`{ code }`). */
export function fixtureCase(dir: string): {
  input: string;
  output: string;
  errorCode: string | undefined;
} {
  const input = readFileSync(join(dir, "input.ts"), "utf8");
  const output = readFileSync(join(dir, "output.ts"), "utf8");
  const errorPath = join(dir, "error.json");
  if (!existsSync(errorPath)) return { input, output, errorCode: undefined };
  const parsed: unknown = JSON.parse(readFileSync(errorPath, "utf8"));
  const code = isRecord(parsed) ? parsed["code"] : undefined;
  return { input, output, errorCode: typeof code === "string" ? code : undefined };
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
