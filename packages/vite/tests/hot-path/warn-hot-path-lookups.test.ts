/**
 * `gwen:hot-path-warn` warns, once per call site, when `useQuery`, `useService` or
 * `useWasmModule` sits inside the function given to a frame callback. It never edits.
 * Every case is a directory under `tests/fixtures/hot-path-warn/`: `input.ts`, optional
 * `auto-imports.json`, and `warnings.json` (`warnings`, plus `control` on a directive case).
 * `control` is the same input with the directive token renamed, so the lines do not move:
 * it proves the silence above comes from the directive and not from an idle unit.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, type Logger, type ViteDevServer } from "vite";
import { afterEach, expect, it, vi } from "vitest";
import type { AutoImport } from "@gwenjs/kit";
import { BUILT_IN_UNITS } from "../../src/pipeline/registry.js";
import { createTransformPipeline } from "../../src/pipeline/transform-pipeline.js";
import type { GwenSourceTransform } from "../../src/pipeline/types.js";
import { readAutoImports, resolveRelativeId, runPipeline } from "../transform-pipeline/helpers.js";

const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
const casesRoot = fileURLToPath(new URL("../fixtures/hot-path-warn/", import.meta.url));
const appRoot = fileURLToPath(new URL("../fixtures/pipeline-app/", import.meta.url));
const CODE = "VITE:HOT_PATH_LOOKUP";
const DIRECTIVE = "@gwen-no-optimize";
const UNIT = "gwen:hot-path-warn";
const SEE = `See https://gwenjs.github.io/gwen/api/errors#vite-hot-path-lookup (${CODE})`;

interface Site {
  readonly composable: string;
  readonly callback: string;
  readonly line: number;
}

interface Case {
  readonly name: string;
  readonly id: string;
  readonly input: string;
  readonly autoImports: readonly AutoImport[];
  readonly warnings: readonly Site[];
  readonly control: readonly Site[] | undefined;
}

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
  const { file, line, column } = loc;
  if (typeof file !== "string" || typeof line !== "number" || typeof column !== "number") {
    return undefined;
  }
  return { file, line, column };
}

function readSites(value: unknown): Site[] {
  if (!Array.isArray(value)) throw new Error("warnings and control must be arrays");
  return value.map((entry: unknown) => {
    if (!isRecord(entry)) throw new Error("a warning must be an object");
    const { composable, callback, line } = entry;
    if (typeof composable !== "string" || typeof callback !== "string") {
      throw new Error("a warning needs composable and callback");
    }
    if (typeof line !== "number") throw new Error("a warning needs a line");
    return { composable, callback, line };
  });
}

function loadCases(): Case[] {
  const found: Case[] = [];
  for (const entry of readdirSync(casesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(casesRoot, entry.name);
    const parsed: unknown = JSON.parse(readFileSync(join(dir, "warnings.json"), "utf8"));
    if (!isRecord(parsed)) throw new Error(`${dir}: warnings.json must be an object`);
    const control = parsed["control"];
    found.push({
      name: entry.name,
      id: join(dir, "input.ts"),
      input: readFileSync(join(dir, "input.ts"), "utf8"),
      autoImports: existsSync(join(dir, "auto-imports.json")) ? readAutoImports(dir) : [],
      warnings: readSites(parsed["warnings"]),
      control: control === undefined ? undefined : readSites(control),
    });
  }
  found.sort((left, right) => left.name.localeCompare(right.name));
  return found;
}

const cases = loadCases();
if (cases.length === 0) throw new Error(`No hot-path-warn fixture under ${casesRoot}`);

/** Empty on the base: the unit does not exist there. */
const hotPath: GwenSourceTransform[] = BUILT_IN_UNITS.filter((unit) => unit.name === UNIT);

function find(name: string): Case {
  const found = cases.find((item) => item.name === name);
  if (found === undefined) throw new Error(`No hot-path-warn fixture named ${name}`);
  return found;
}

async function run(item: Case, units: GwenSourceTransform[], source = item.input) {
  const logs: unknown[] = [];
  const result = await runPipeline(source, {
    id: item.id,
    root: packageRoot,
    resolveId: resolveRelativeId,
    units,
    autoImports: item.autoImports,
    onWarn: (log) => logs.push(log),
  });
  return { result, logs };
}

/** `[composable()] Called inside <callback>(); it runs every frame.` read back from a host log. */
function observed(logs: readonly unknown[]): Array<Site & { code: string | undefined }> {
  return logs.map((log) => {
    const first = (readString(log, "message") ?? "").split("\n")[0] ?? "";
    const split = first.indexOf("()] Called inside ");
    const rest = first.slice(split + "()] Called inside ".length);
    return {
      code: readString(log, "code"),
      composable: first.slice(1, split),
      callback: rest.slice(0, rest.indexOf("();")),
      line: readLoc(log)?.line ?? -1,
    };
  });
}

function expected(sites: readonly Site[]): Array<Site & { code: string }> {
  return sites.map((site) => ({ code: CODE, ...site }));
}

function placeOf(code: string, offset: number): { line: number; column: number } {
  const before = code.slice(0, offset);
  const line = before.split("\n").length;
  return { line, column: offset - (before.lastIndexOf("\n") + 1) };
}

function hintOf(log: unknown): string {
  const lines = (readString(log, "message") ?? "").split("\n");
  return lines.find((line) => line.startsWith("Fix: ")) ?? "";
}

afterEach(() => {
  vi.unstubAllEnvs();
});

for (const item of cases) {
  it(`hot-path-warn/${item.name}`, async () => {
    expect(observed((await run(item, hotPath)).logs)).toEqual(expected(item.warnings));
    if (item.control === undefined) return;
    const renamed = item.input.split(DIRECTIVE).join("@gwen-noted");
    expect(observed((await run(item, hotPath, renamed)).logs)).toEqual(expected(item.control));
  });
}

it("hot-path-warn messages carry the grammar, the resolved composable and the call position", async () => {
  vi.stubEnv("NODE_ENV", "development");
  const item = find("use-service-in-update");
  const { logs } = await run(item, hotPath);
  expect(logs).toHaveLength(1);
  const log = logs[0];
  expect((readString(log, "message") ?? "").split("\n")).toEqual([
    "[useService()] Called inside onUpdate(); it runs every frame.",
    "Fix: Call useService(…) once in the defineSystem/defineActor setup and use the captured value " +
      "inside onUpdate. For a service that may be absent or swapped, keep optionalService(engine, key) " +
      "from the setup and read .current inside onUpdate.",
    SEE,
  ]);
  expect(readString(log, "code")).toBe(CODE);
  const place = placeOf(item.input, item.input.indexOf('useService("audio")'));
  expect(readLoc(log)).toEqual({ file: item.id, line: place.line, column: place.column });
});

it("hot-path-warn drops the Fix line when NODE_ENV is production", async () => {
  vi.stubEnv("NODE_ENV", "production");
  const { logs } = await run(find("use-service-in-update"), hotPath);
  expect(logs).toHaveLength(1);
  const message = readString(logs[0], "message") ?? "";
  expect(message).toContain("[useService()] Called inside onUpdate(); it runs every frame.");
  expect(message).not.toContain("Fix:");
});

it("hot-path-warn names optionalService and .current for useService only", async () => {
  vi.stubEnv("NODE_ENV", "development");
  const hints = new Map<string, string[]>();
  for (const name of ["use-service-in-update", "three-callbacks"]) {
    for (const log of (await run(find(name), hotPath)).logs) {
      const composable = observed([log])[0]?.composable ?? "";
      hints.set(composable, [...(hints.get(composable) ?? []), hintOf(log)]);
    }
  }
  expect([...hints.keys()].sort()).toEqual(["useQuery", "useService", "useWasmModule"]);
  for (const hint of hints.get("useService") ?? []) {
    expect(hint).toContain("optionalService(engine, key)");
    expect(hint).toContain(".current");
  }
  for (const name of ["useQuery", "useWasmModule"]) {
    for (const hint of hints.get(name) ?? []) {
      expect(hint).toContain(`Call ${name}(…) once in the defineSystem/defineActor setup`);
      expect(hint).not.toContain("optionalService");
      expect(hint).not.toContain(".current");
    }
  }
});

it("hot-path-warn leaves the source unchanged and never changes it for any fixture that warns", async () => {
  const rows: Array<{ name: string; unchanged: boolean; warned: number }> = [];
  for (const item of cases) {
    const { result, logs } = await run(item, hotPath);
    rows.push({ name: item.name, unchanged: result === null, warned: logs.length });
  }
  expect(rows).toEqual(
    cases.map((item) => ({ name: item.name, unchanged: true, warned: item.warnings.length })),
  );
});

it("hot-path-warn the full unit list emits the same warnings as the unit alone", async () => {
  const seen: Record<string, unknown> = {};
  for (const item of cases) {
    seen[item.name] = observed((await run(item, BUILT_IN_UNITS)).logs);
  }
  const want: Record<string, unknown> = {};
  for (const item of cases) want[item.name] = expected(item.warnings);
  expect(seen).toEqual(want);
});

function plainText(text: string): string {
  let out = "";
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) !== 27) {
      out += text.charAt(index);
      continue;
    }
    const end = text.indexOf("m", index);
    if (end < 0) break;
    index = end;
  }
  return out;
}

function recordingLogger(warnings: string[]): Logger {
  const record = (message: string): void => {
    warnings.push(plainText(message));
  };
  return {
    hasWarned: false,
    info() {},
    warn: record,
    warnOnce: record,
    error() {},
    clearScreen() {},
    hasErrorLogged: () => false,
  };
}

it("hot-path-warn reaches the Vite logger in serve with the code, the file and the line", async () => {
  const file = join(appRoot, "src", "systems", "frame.ts");
  const place = placeOf(
    readFileSync(file, "utf8"),
    readFileSync(file, "utf8").indexOf("useService("),
  );
  const warnings: string[] = [];
  let server: ViteDevServer | undefined;
  try {
    server = await createServer({
      configFile: false,
      root: appRoot,
      appType: "custom",
      customLogger: recordingLogger(warnings),
      plugins: [createTransformPipeline({ units: BUILT_IN_UNITS })],
      server: { middlewareMode: true, hmr: false, fs: { strict: false } },
    });
    const served = await server.transformRequest("/src/systems/frame.ts");
    expect(served?.code).toContain("defineSystem");
    const log = warnings.join("\n");
    expect(log).toContain(CODE);
    expect(log).toContain(`frame.ts:${place.line}:${place.column}`);
  } finally {
    await server?.close();
  }
});
