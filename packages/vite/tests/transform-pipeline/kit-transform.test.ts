/**
 * Kit source transforms register through `gwen()` and run on the real pipeline.
 * A config failure is caught so a missing `addSourceTransform` fails the assertion.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  build,
  createServer,
  type ConfigEnv,
  type Logger,
  type Plugin,
  type UserConfig,
  type ViteDevServer,
} from "vite";
import { describe, expect, it } from "vitest";
import { GwenError } from "@gwenjs/schema";
import { extractFences } from "../../../docs-check/src/fences.js";
import { ViteErrorCodes } from "../../src/error-codes.js";
import { gwen } from "../../src/index.js";
import { BUILT_IN_UNITS } from "../../src/pipeline/registry.js";
import { createTransformPipeline } from "../../src/pipeline/transform-pipeline.js";
import type { GwenSourceTransform } from "../../src/pipeline/types.js";
import { mapCheck } from "./helpers.js";

const serveEnv: ConfigEnv = { command: "serve", mode: "development" };
const BUILT_IN_NAMES = [
  "gwen:async-context",
  "gwen:system-name",
  "gwen:actor-name",
  "gwen:layout-name",
  "gwen:scene-router-name",
  "gwen:query-hoist",
  "gwen:hot-path-warn",
] as const;

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

function causeOf(error: unknown): unknown {
  if (!isRecord(error)) return undefined;
  return error["cause"];
}

function causeCode(error: unknown): string | undefined {
  return readString(causeOf(error), "code") ?? readString(error, "code");
}

function causeMessage(error: unknown): string {
  return readString(causeOf(error), "message") ?? readString(error, "message") ?? "";
}

function chainHas(error: unknown, probe: (value: unknown) => boolean): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (!seen.has(current)) {
    if (probe(current)) return true;
    if (typeof current !== "object" || current === null) return false;
    seen.add(current);
    if (!("cause" in current)) return false;
    current = current.cause;
  }
  return false;
}

function pipelineNames(plugin: Plugin): readonly string[] {
  if (!("api" in plugin)) return [];
  const api: unknown = plugin.api;
  if (!isRecord(api) || !Array.isArray(api["names"])) return [];
  const names: string[] = [];
  for (const name of api["names"]) {
    if (typeof name === "string") names.push(name);
  }
  return names;
}

function pipelineApi(plugin: Plugin): Record<string, unknown> | undefined {
  if (!("api" in plugin)) return undefined;
  const api: unknown = plugin.api;
  return isRecord(api) ? api : undefined;
}

function writeConfig(root: string, modules: readonly string[]): void {
  const list = modules.map((name) => JSON.stringify(name)).join(", ");
  writeFileSync(join(root, "gwen.config.ts"), `export default { modules: [${list}] };\n`);
}

function writePackage(root: string, name: string, moduleSource: string): void {
  const parts = name.startsWith("@") ? name.split("/").slice(0, 2) : [name];
  const dir = join(root, "node_modules", ...parts);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      type: "module",
      exports: { ".": "./runtime.js", "./module": "./module.js" },
    }),
  );
  writeFileSync(
    join(dir, "runtime.js"),
    `export function defineTint(color) {
  if (color === "red") return 16711680;
  if (color === "green") return 65280;
  if (color === "blue") return 255;
  return 0;
}
`,
  );
  writeFileSync(join(dir, "module.js"), moduleSource);
}

function moduleSource(name: string, transformName: string, runBody: string): string {
  return `export default {
  meta: { name: ${JSON.stringify(name)} },
  setup(_options, kit) {
    kit.addSourceTransform({
      name: ${JSON.stringify(transformName)},
      run(_program, ctx) {
        ${runBody}
      },
    });
  },
};
`;
}

function tintModule(name = "@example/tint"): string {
  return moduleSource(
    name,
    "tint:inline",
    `const tintNumber = (color) => {
          if (color === "red") return "16711680";
          if (color === "green") return "65280";
          if (color === "blue") return "255";
          return undefined;
        };
        const edits = [];
        for (const call of ctx.calls()) {
          const binding = call.binding;
          if (binding === null || binding === undefined) continue;
          if (binding.source !== "@example/tint" || binding.imported !== "defineTint") continue;
          const arg = call.arguments[0];
          if (arg === undefined || arg.kind !== "string") continue;
          const color = tintNumber(arg.value);
          if (color === undefined) {
            ctx.raise("TINT:UNKNOWN_COLOR", arg, 'Unknown tint color "' + arg.value + '".');
          }
          edits.push({ kind: "overwrite", start: call.start, end: call.end, text: color });
        }
        return edits;`,
  );
}

const tintFixtureDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "../fixtures/kit-transform/tint",
);

async function withRoot(run: (root: string) => Promise<void>): Promise<void> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "gwen-kit-transform-")));
  mkdirSync(join(root, "src"));
  try {
    await run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** Temp project under this package so jiti resolves `@gwenjs/kit`. */
async function withFixtureRoot(run: (root: string) => Promise<void>): Promise<void> {
  const root = realpathSync(
    mkdtempSync(join(dirname(fileURLToPath(import.meta.url)), "tmp-kit-fixture-")),
  );
  mkdirSync(join(root, "src"));
  try {
    await run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function writeTintFixtures(root: string): void {
  const dir = join(root, "src", "modules", "tint");
  mkdirSync(dir, { recursive: true });
  copyFileSync(join(tintFixtureDir, "module.ts"), join(dir, "module.ts"));
  copyFileSync(join(tintFixtureDir, "tint.ts"), join(dir, "tint.ts"));
  writeFileSync(
    join(dir, "index.ts"),
    'import "./tint.js";\nexport { default } from "./module.js";\n',
  );
  const pkg = join(root, "node_modules", "@example", "tint");
  mkdirSync(pkg, { recursive: true });
  copyFileSync(join(tintFixtureDir, "tint.ts"), join(pkg, "tint.ts"));
  writeFileSync(
    join(pkg, "package.json"),
    JSON.stringify({ type: "module", exports: { ".": "./tint.ts" } }),
  );
}

const docsPage = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../docs/kit/source-transforms.md",
);

/** The example fences and the sample source of the EN source transforms page. */
function pageExample(): { tint: string; module: string; sample: string } {
  const markdown = existsSync(docsPage) ? readFileSync(docsPage, "utf8") : "";
  const fences = extractFences(markdown, docsPage);
  const checks = fences.filter((fence) => fence.tag === "check");
  const samples = fences.filter(
    (fence) => fence.tag === null && fence.code.includes('from "@example/tint"'),
  );
  expect(checks).toHaveLength(2);
  expect(samples).toHaveLength(1);
  return {
    tint: checks[0]?.code ?? "",
    module: checks[1]?.code ?? "",
    sample: samples[0]?.code ?? "",
  };
}

function writePageFixtures(root: string, example: { tint: string; module: string }): void {
  const dir = join(root, "src", "modules", "tint");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "tint.ts"), `${example.tint}\n`);
  writeFileSync(join(dir, "module.ts"), `${example.module}\n`);
  writeFileSync(
    join(dir, "index.ts"),
    'import "./tint.js";\nexport { default } from "./module.js";\n',
  );
  const pkg = join(root, "node_modules", "@example", "tint");
  mkdirSync(pkg, { recursive: true });
  writeFileSync(join(pkg, "tint.ts"), `${example.tint}\n`);
  writeFileSync(
    join(pkg, "package.json"),
    JSON.stringify({ type: "module", exports: { ".": "./tint.ts" } }),
  );
}

async function loadProject(root: string): Promise<Plugin> {
  const plugins = gwen();
  let main: Plugin | undefined;
  let pipeline: Plugin | undefined;
  for (const plugin of plugins) {
    if (plugin.name === "gwen") main = plugin;
    if (plugin.name === "gwen:transform-pipeline") pipeline = plugin;
  }
  if (main === undefined || pipeline === undefined) throw new Error("missing gwen plugins");
  const hook: unknown = main.config;
  if (typeof hook !== "function") throw new Error("config hook missing");
  await Reflect.apply(hook, undefined, [{ root } satisfies UserConfig, serveEnv]).then(
    () => undefined,
    () => undefined,
  );
  return pipeline;
}

async function openServer(
  root: string,
  plugins: Plugin[],
  logger?: Logger,
): Promise<ViteDevServer> {
  return createServer({
    configFile: false,
    root,
    logLevel: "silent",
    appType: "custom",
    plugins,
    server: { middlewareMode: true, hmr: false, fs: { strict: false } },
    ...(logger === undefined ? {} : { customLogger: logger }),
  });
}

function plainText(text: string): string {
  let out = "";
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) !== 27) {
      const char = text[index];
      if (char !== undefined) out += char;
      continue;
    }
    const end = text.indexOf("m", index);
    if (end < 0) break;
    index = end;
  }
  return out;
}

function recordingLogger(warnings: string[]): Logger {
  return {
    hasWarned: false,
    info() {},
    warn(message: string) {
      warnings.push(plainText(message));
    },
    warnOnce(message: string) {
      warnings.push(plainText(message));
    },
    error() {},
    clearScreen() {},
    hasErrorLogged() {
      return false;
    },
  };
}

describe("kit source transforms", () => {
  it('a kit transform inlines defineTint("red")', async () => {
    await withFixtureRoot(async (root) => {
      const source =
        'import { defineTint } from "@example/tint";\nexport const c = defineTint("red");\nconst /*@map*/kept = 1;\n';
      writeTintFixtures(root);
      writeConfig(root, []);
      writeFileSync(join(root, "src", "game.ts"), source);
      const pipeline = await loadProject(root);
      let server: ViteDevServer | undefined;
      try {
        server = await openServer(root, [pipeline]);
        const result = await server.transformRequest("/src/game.ts");
        expect(result?.code).toContain("16711680");
        expect(result?.code).not.toContain("defineTint(");
        if (result?.code === undefined) return;
        mapCheck(source, result.code, result.map);
      } finally {
        await server?.close();
      }
    });
  });

  it("an aliased, namespaced and barrel import resolve", async () => {
    await withRoot(async (root) => {
      const source = [
        'import { defineTint as paint } from "@example/tint";',
        'import * as tint from "@example/tint";',
        'import { defineTint } from "./barrel.js";',
        'export const aliased = paint("red");',
        'export const namespaced = tint.defineTint("green");',
        'export const barreled = defineTint("blue");',
        "",
      ].join("\n");
      writePackage(root, "@example/tint", tintModule());
      writeFileSync(
        join(root, "src", "barrel.js"),
        'export { defineTint } from "@example/tint";\n',
      );
      writeConfig(root, ["@example/tint"]);
      writeFileSync(join(root, "src", "game.ts"), source);
      const pipeline = await loadProject(root);
      let server: ViteDevServer | undefined;
      try {
        server = await openServer(root, [pipeline]);
        const result = await server.transformRequest("/src/game.ts");
        expect(result?.code).toContain("16711680");
        expect(result?.code).toContain("65280");
        expect(result?.code).toContain("255");
        expect(result?.code).not.toContain("paint(");
        expect(result?.code).not.toContain("tint.defineTint(");
        expect(result?.code).not.toContain('defineTint("blue")');
      } finally {
        await server?.close();
      }
    });
  });

  it("a shadowed local is not resolved", async () => {
    await withRoot(async (root) => {
      const source = [
        'import { defineTint } from "@example/tint";',
        "export function paint(defineTint) {",
        '  return defineTint("red");',
        "}",
        'export const outer = defineTint("red");',
        "",
      ].join("\n");
      writePackage(root, "@example/tint", tintModule());
      writeConfig(root, ["@example/tint"]);
      writeFileSync(join(root, "src", "game.ts"), source);
      const pipeline = await loadProject(root);
      let server: ViteDevServer | undefined;
      try {
        server = await openServer(root, [pipeline]);
        const result = await server.transformRequest("/src/game.ts");
        expect(result?.code).toContain('defineTint("red")');
        expect(result?.code).toContain("16711680");
      } finally {
        await server?.close();
      }
    });
  });

  it("a dynamic argument keeps the runtime call", async () => {
    await withRoot(async (root) => {
      const source = [
        'import { defineTint } from "@example/tint";',
        "export function paint(color) {",
        "  return defineTint(color);",
        "}",
        'export const outer = defineTint("red");',
        "",
      ].join("\n");
      writePackage(root, "@example/tint", tintModule());
      writeConfig(root, ["@example/tint"]);
      writeFileSync(join(root, "src", "game.ts"), source);
      const pipeline = await loadProject(root);
      let server: ViteDevServer | undefined;
      try {
        server = await openServer(root, [pipeline]);
        const result = await server.transformRequest("/src/game.ts");
        expect(result?.code).toContain("defineTint(color)");
        expect(result?.code).toContain("16711680");
      } finally {
        await server?.close();
      }
    });
  });

  it("an unknown color raises TINT:UNKNOWN_COLOR with file, line and column", async () => {
    await withFixtureRoot(async (root) => {
      const source =
        'import { defineTint } from "@example/tint";\nexport const c = defineTint("nope");\n';
      const argAt = source.indexOf('"nope"');
      const lineStart = source.lastIndexOf("\n", argAt) + 1;
      const column = argAt - lineStart;
      const line = source.slice(0, argAt).split("\n").length;
      writeTintFixtures(root);
      writeConfig(root, []);
      writeFileSync(join(root, "src", "game.ts"), source);
      const pipeline = await loadProject(root);
      let server: ViteDevServer | undefined;
      try {
        server = await openServer(root, [pipeline]);
        const caught: unknown = await server.transformRequest("/src/game.ts").then(
          () => undefined,
          (error: unknown) => error,
        );
        expect(causeCode(caught)).toBe("TINT:UNKNOWN_COLOR");
        const loc = readLoc(caught) ?? readLoc(causeOf(caught));
        expect(loc?.file).toContain("game.ts");
        expect(loc?.line).toBe(line);
        expect(loc?.column).toBe(column);
        expect(causeMessage(caught)).toContain('Unknown tint color "nope".');
      } finally {
        await server?.close();
      }
    });
  });

  it("raising a VITE: code from a kit transform throws VITE:TRANSFORM_UNSUPPORTED", async () => {
    const what = 'Transform "tint:inline" raised "VITE:X", which is not one of its own codes.';
    const coreWhat = 'Transform "tint:inline" raised "CORE:X", which is not one of its own codes.';

    async function reject(runBody: string, packageName = "@example/tint"): Promise<unknown> {
      const root = realpathSync(mkdtempSync(join(tmpdir(), "gwen-kit-transform-")));
      mkdirSync(join(root, "src"));
      let server: ViteDevServer | undefined;
      try {
        writePackage(root, packageName, moduleSource(packageName, "tint:inline", runBody));
        writeConfig(root, [packageName]);
        writeFileSync(join(root, "src", "game.ts"), "export const c = 1;\n");
        const pipeline = await loadProject(root);
        server = await openServer(root, [pipeline]);
        return await server.transformRequest("/src/game.ts").then(
          () => undefined,
          (error: unknown) => error,
        );
      } finally {
        await server?.close();
        rmSync(root, { recursive: true, force: true });
      }
    }

    const raised = await reject('ctx.raise("VITE:X", { start: 0, end: 1 }, "nope");');
    expect(causeCode(raised)).toBe(ViteErrorCodes.TRANSFORM_UNSUPPORTED);
    expect(causeMessage(raised)).toContain(what);

    const warned = await reject('ctx.warn("VITE:X", { start: 0, end: 1 }, "nope"); return [];');
    expect(causeCode(warned)).toBe(ViteErrorCodes.TRANSFORM_UNSUPPORTED);
    expect(causeMessage(warned)).toContain(what);

    Reflect.set(globalThis, "__gwenSourceTransformError", GwenError);
    try {
      const thrown = await reject(
        'const Ctor = globalThis.__gwenSourceTransformError; throw new Ctor("CORE:X", "bypass");',
      );
      expect(causeCode(thrown)).toBe(ViteErrorCodes.TRANSFORM_UNSUPPORTED);
      expect(causeMessage(thrown)).toContain(coreWhat);
    } finally {
      Reflect.deleteProperty(globalThis, "__gwenSourceTransformError");
    }
  });

  it("a forged VITE:TRANSFORM_UNSUPPORTED from a kit transform names the unit and the code", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "gwen-kit-transform-")));
    mkdirSync(join(root, "src"));
    let server: ViteDevServer | undefined;
    Reflect.set(globalThis, "__gwenSourceTransformError", GwenError);
    try {
      writePackage(
        root,
        "@example/tint",
        moduleSource(
          "@example/tint",
          "tint:inline",
          'const Ctor = globalThis.__gwenSourceTransformError; throw new Ctor("VITE:TRANSFORM_UNSUPPORTED", "anything");',
        ),
      );
      writeConfig(root, ["@example/tint"]);
      writeFileSync(join(root, "src", "game.ts"), "export const c = 1;\n");
      const pipeline = await loadProject(root);
      server = await openServer(root, [pipeline]);
      const caught: unknown = await server.transformRequest("/src/game.ts").then(
        () => undefined,
        (error: unknown) => error,
      );
      expect(causeCode(caught)).toBe(ViteErrorCodes.TRANSFORM_UNSUPPORTED);
      expect(causeMessage(caught)).toContain(
        'Transform "tint:inline" raised "VITE:TRANSFORM_UNSUPPORTED", which is not one of its own codes.',
      );
    } finally {
      Reflect.deleteProperty(globalThis, "__gwenSourceTransformError");
      await server?.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a framework prefix list matches the reserved set and RENDERER_THREE is accepted", async () => {
    const runBody = `const codes = ["RENDERER:X", "RENDERER_THREE:X", "TINT2:COLOR_2", "tint:x", "lowercase", "NOCOLON"];
        const outcomes = [];
        for (const code of codes) {
          try {
            ctx.raise(code, { start: 0, end: 1 }, "probe");
            outcomes.push(code + ":returned");
          } catch (error) {
            const found = error && error.code ? error.code : "thrown";
            outcomes.push(code + ":" + found);
          }
        }
        return [{ kind: "insert", at: 0, text: "/*" + outcomes.join(",") + "*/" }];`;
    await withRoot(async (root) => {
      writePackage(root, "@example/tint", moduleSource("@example/tint", "tint:inline", runBody));
      writeConfig(root, ["@example/tint"]);
      writeFileSync(join(root, "src", "game.ts"), "export const c = 1;\n");
      const pipeline = await loadProject(root);
      let server: ViteDevServer | undefined;
      try {
        server = await openServer(root, [pipeline]);
        const result = await server.transformRequest("/src/game.ts");
        expect(result?.code).toContain("RENDERER:X:VITE:TRANSFORM_UNSUPPORTED");
        expect(result?.code).toContain("RENDERER_THREE:X:RENDERER_THREE:X");
        expect(result?.code).toContain("TINT2:COLOR_2:TINT2:COLOR_2");
        expect(result?.code).toContain("tint:x:VITE:TRANSFORM_UNSUPPORTED");
        expect(result?.code).toContain("lowercase:VITE:TRANSFORM_UNSUPPORTED");
        expect(result?.code).toContain("NOCOLON:VITE:TRANSFORM_UNSUPPORTED");
      } finally {
        await server?.close();
      }
    });
  });

  it("a unit throwing a plain value fails with VITE:TRANSFORM_UNIT_FAILED and keeps the cause", async () => {
    async function boom(runBody: string): Promise<unknown> {
      const root = realpathSync(mkdtempSync(join(tmpdir(), "gwen-kit-transform-")));
      mkdirSync(join(root, "src"));
      let server: ViteDevServer | undefined;
      try {
        writePackage(root, "@example/tint", moduleSource("@example/tint", "tint:inline", runBody));
        writeConfig(root, ["@example/tint"]);
        writeFileSync(join(root, "src", "game.ts"), "export const c = 1;\n");
        const pipeline = await loadProject(root);
        server = await openServer(root, [pipeline]);
        return await server.transformRequest("/src/game.ts").then(
          () => undefined,
          (error: unknown) => error,
        );
      } finally {
        await server?.close();
        rmSync(root, { recursive: true, force: true });
      }
    }

    const asString = await boom('throw "plain-boom";');
    const stringMessage = causeMessage(asString);
    expect(causeCode(asString)).toBe(ViteErrorCodes.TRANSFORM_UNIT_FAILED);
    expect(stringMessage).toContain('Transform "tint:inline" failed on');
    expect(stringMessage).toContain("game.ts");
    expect(chainHas(asString, (value) => value === "plain-boom")).toBe(true);

    const asError = await boom('throw new Error("plain-error");');
    const errorMessage = causeMessage(asError);
    expect(causeCode(asError)).toBe(ViteErrorCodes.TRANSFORM_UNIT_FAILED);
    expect(errorMessage).toContain('Transform "tint:inline" failed on');
    expect(errorMessage).toContain("game.ts");
    expect(
      chainHas(asError, (value) => value instanceof Error && value.message === "plain-error"),
    ).toBe(true);
  });

  it("a kit edit outside the source fails with VITE:TRANSFORM_UNIT_FAILED naming the unit", async () => {
    async function badEdit(runBody: string): Promise<unknown> {
      const root = realpathSync(mkdtempSync(join(tmpdir(), "gwen-kit-transform-")));
      mkdirSync(join(root, "src"));
      let server: ViteDevServer | undefined;
      try {
        writePackage(root, "@example/tint", moduleSource("@example/tint", "tint:bad", runBody));
        writeConfig(root, ["@example/tint"]);
        writeFileSync(join(root, "src", "game.ts"), "export const c = 1;\n");
        const pipeline = await loadProject(root);
        server = await openServer(root, [pipeline]);
        return await server.transformRequest("/src/game.ts").then(
          () => undefined,
          (error: unknown) => error,
        );
      } finally {
        await server?.close();
        rmSync(root, { recursive: true, force: true });
      }
    }

    function reasonIncludes(error: unknown, text: string): boolean {
      return chainHas(error, (value) => {
        const message = readString(value, "message");
        return message !== undefined && message.includes(text);
      });
    }

    const outOfRange = await badEdit(
      'return [{ kind: "overwrite", start: 0, end: 9999, text: "x" }];',
    );
    expect(causeCode(outOfRange)).toBe(ViteErrorCodes.TRANSFORM_UNIT_FAILED);
    expect(causeMessage(outOfRange)).toContain('Transform "tint:bad" failed on');
    expect(causeMessage(outOfRange)).toContain("game.ts");
    expect(reasonIncludes(outOfRange, "out of range")).toBe(true);

    const empty = await badEdit('return [{ kind: "overwrite", start: 0, end: 0, text: "x" }];');
    expect(causeCode(empty)).toBe(ViteErrorCodes.TRANSFORM_UNIT_FAILED);
    expect(causeMessage(empty)).toContain('Transform "tint:bad" failed on');
    expect(reasonIncludes(empty, "empty")).toBe(true);

    const unknown = await badEdit('return [{ kind: "nope", start: 0, end: 1 }];');
    expect(causeCode(unknown)).toBe(ViteErrorCodes.TRANSFORM_UNIT_FAILED);
    expect(causeMessage(unknown)).toContain('Transform "tint:bad" failed on');
    expect(reasonIncludes(unknown, "kind")).toBe(true);
  });

  it("zero kit transforms leave the output byte-identical", async () => {
    await withRoot(async (root) => {
      const source = "export const value = 1;\n";
      writePackage(
        root,
        "@example/tint",
        moduleSource("@example/tint", "tint:inline", "return [];"),
      );
      writeConfig(root, ["@example/tint"]);
      writeFileSync(join(root, "src", "game.ts"), source);
      const pipeline = await loadProject(root);
      const plain = createTransformPipeline({ units: [...BUILT_IN_UNITS] });
      let server: ViteDevServer | undefined;
      let plainServer: ViteDevServer | undefined;
      try {
        server = await openServer(root, [pipeline]);
        plainServer = await openServer(root, [plain]);
        const withKit = await server.transformRequest("/src/game.ts");
        const without = await plainServer.transformRequest("/src/game.ts");
        expect(withKit?.code).toBe(without?.code);
        expect(pipelineNames(pipeline)).toContain("tint:inline");
      } finally {
        await server?.close();
        await plainServer?.close();
      }
    });
  });

  it("two kit transforms from two modules run in module order", async () => {
    await withRoot(async (root) => {
      const first = moduleSource(
        "@example/a",
        "aaa:first",
        `const chained = ctx.code.includes("/*A*/");
        return [{ kind: "insert", at: 0, text: chained ? "/*CHAINED*/" : "/*A*/" }];`,
      );
      const second = moduleSource(
        "@example/b",
        "bbb:second",
        `const chained = ctx.code.includes("/*A*/");
        return [{ kind: "insert", at: 0, text: chained ? "/*CHAINED*/" : "/*B*/" }];`,
      );
      writePackage(root, "@example/a", first);
      writePackage(root, "@example/b", second);
      writeConfig(root, ["@example/a", "@example/b"]);
      writeFileSync(join(root, "src", "game.ts"), "export const value = 1;\n");
      const pipeline = await loadProject(root);
      let server: ViteDevServer | undefined;
      try {
        server = await openServer(root, [pipeline]);
        const result = await server.transformRequest("/src/game.ts");
        expect(result?.code).toContain("/*A*/");
        expect(result?.code).toContain("/*B*/");
        expect(result?.code).not.toContain("/*CHAINED*/");
        const code = result?.code ?? "";
        expect(code.indexOf("/*A*/")).toBeLessThan(code.indexOf("/*B*/"));
      } finally {
        await server?.close();
      }
    });
  });

  it("kit transforms run after built-ins and before a unit registered in configResolved", async () => {
    await withRoot(async (root) => {
      writePackage(
        root,
        "@example/tint",
        moduleSource("@example/tint", "tint:inline", "return [];"),
      );
      writeConfig(root, ["@example/tint"]);
      writeFileSync(join(root, "src", "game.ts"), "export const value = 1;\n");
      const pipeline = await loadProject(root);
      const api = pipelineApi(pipeline);
      const late: Plugin = {
        name: "test:late-unit",
        configResolved() {
          const register = api?.["register"];
          if (typeof register !== "function" || api === undefined) return;
          const unit: GwenSourceTransform = { name: "gwen:late", run: () => [] };
          Reflect.apply(register, api, [unit]);
        },
      };
      let server: ViteDevServer | undefined;
      try {
        server = await openServer(root, [pipeline, late]);
        expect(pipelineNames(pipeline)).toEqual([
          ...BUILT_IN_NAMES,
          "tint:inline",
          "gwen:variant-guard",
          "gwen:late",
        ]);
        let lateError: unknown;
        try {
          const register = api?.["register"];
          if (typeof register !== "function" || api === undefined) {
            lateError = new Error("missing register");
          } else {
            const unit: GwenSourceTransform = { name: "gwen:after", run: () => [] };
            Reflect.apply(register, api, [unit]);
            lateError = undefined;
          }
        } catch (error) {
          lateError = error;
        }
        expect(readString(lateError, "code")).toBe(ViteErrorCodes.TRANSFORM_UNSUPPORTED);
        expect(lateError instanceof Error ? lateError.message : "").toContain("buildStart");
      } finally {
        await server?.close();
      }
    });
  });

  it("registerKit after buildStart throws VITE:TRANSFORM_UNSUPPORTED", async () => {
    await withRoot(async (root) => {
      writeConfig(root, []);
      writeFileSync(join(root, "src", "game.ts"), "export const value = 1;\n");
      const pipeline = await loadProject(root);
      const api = pipelineApi(pipeline);
      let server: ViteDevServer | undefined;
      try {
        server = await openServer(root, [pipeline]);
        let lateError: unknown;
        try {
          const registerKit = api?.["registerKit"];
          if (typeof registerKit !== "function" || api === undefined) {
            lateError = new Error("missing registerKit");
          } else {
            Reflect.apply(registerKit, api, [{ name: "tint:late", run: () => [] }]);
            lateError = undefined;
          }
        } catch (error) {
          lateError = error;
        }
        expect(readString(lateError, "code")).toBe(ViteErrorCodes.TRANSFORM_UNSUPPORTED);
        expect(lateError instanceof Error ? lateError.message : "").toContain(
          "register() was called after buildStart.",
        );
      } finally {
        await server?.close();
      }
    });
  });

  it("registerKit rejects a second unit with the same name", async () => {
    await withRoot(async (root) => {
      writeConfig(root, []);
      writeFileSync(join(root, "src", "game.ts"), "export const value = 1;\n");
      const pipeline = await loadProject(root);
      const api = pipelineApi(pipeline);
      const registerKit = api?.["registerKit"];
      expect(typeof registerKit).toBe("function");
      if (typeof registerKit !== "function" || api === undefined) return;
      Reflect.apply(registerKit, api, [{ name: "tint:inline", run: () => [] }]);
      let duplicate: unknown;
      try {
        Reflect.apply(registerKit, api, [{ name: "tint:inline", run: () => [] }]);
        duplicate = undefined;
      } catch (error) {
        duplicate = error;
      }
      expect(readString(duplicate, "code")).toBe(ViteErrorCodes.TRANSFORM_UNSUPPORTED);
      expect(duplicate instanceof Error ? duplicate.message : "").toContain(
        "register() was called with a different unit named tint:inline.",
      );
    });
  });

  it("serve and build give the same output", async () => {
    await withRoot(async (root) => {
      const source =
        'import { defineTint } from "@example/tint";\nexport const c = defineTint("red");\n';
      writePackage(root, "@example/tint", tintModule());
      writeConfig(root, ["@example/tint"]);
      writeFileSync(join(root, "src", "game.ts"), source);
      const pipeline = await loadProject(root);
      const captured: { code: string } = { code: "" };
      const tap: Plugin = {
        name: "test:tap-output",
        transform(code, id) {
          if (id.includes("game.ts")) captured.code = code;
          return null;
        },
      };
      let server: ViteDevServer | undefined;
      try {
        server = await openServer(root, [pipeline, tap]);
        const served = await server.transformRequest("/src/game.ts");
        expect(served?.code).toContain("16711680");
        await build({
          configFile: false,
          root,
          logLevel: "silent",
          plugins: [pipeline, tap],
          build: {
            write: false,
            minify: false,
            rollupOptions: { input: join(root, "src", "game.ts") },
          },
        });
        expect(captured.code).toContain("16711680");
        expect(served?.code).toBe(captured.code);
      } finally {
        await server?.close();
      }
    });
  });

  it("warn from a kit transform reaches the host with the code, file and line", async () => {
    await withRoot(async (root) => {
      const source = "export const c = 1;\n";
      writePackage(
        root,
        "@example/tint",
        moduleSource(
          "@example/tint",
          "tint:inline",
          'ctx.warn("TINT:NOTE", { start: 0, end: 1 }, "a note"); return [];',
        ),
      );
      writeConfig(root, ["@example/tint"]);
      writeFileSync(join(root, "src", "game.ts"), source);
      const pipeline = await loadProject(root);
      const warnings: string[] = [];
      let server: ViteDevServer | undefined;
      try {
        server = await openServer(root, [pipeline], recordingLogger(warnings));
        const result = await server.transformRequest("/src/game.ts");
        expect(result?.code).toContain("export const c = 1;");
        const log = warnings.join("\n");
        expect(log).toContain("TINT:NOTE");
        expect(log).toContain("[GWEN]");
        expect(log).toContain("a note");
        expect(log).toContain("game.ts:1:0");
      } finally {
        await server?.close();
      }
    });
  });

  it("walk visits program nodes with their parent and skip prunes a subtree", async () => {
    const runBody = `const rows = [];
        let sawHidden = false;
        ctx.walk((node, parent) => {
          const parentType = parent === null || parent === undefined ? "null" : parent.type;
          rows.push(node.type + ":" + parentType);
          if (node.type === "Identifier" && node.name === "hidden") sawHidden = true;
          if (node.type === "FunctionDeclaration") return "skip";
        });
        return [{ kind: "insert", at: 0, text: "/*" + (sawHidden ? "hidden" : "pruned") + " " + rows.join(",") + "*/" }];`;
    await withRoot(async (root) => {
      const source = "function skipped() { const hidden = 1; }\nconst kept = 2;\n";
      writePackage(root, "@example/tint", moduleSource("@example/tint", "tint:inline", runBody));
      writeConfig(root, ["@example/tint"]);
      writeFileSync(join(root, "src", "game.ts"), source);
      const pipeline = await loadProject(root);
      let server: ViteDevServer | undefined;
      try {
        server = await openServer(root, [pipeline]);
        const result = await server.transformRequest("/src/game.ts");
        expect(result?.code).toContain("/*pruned ");
        expect(result?.code).toContain("FunctionDeclaration:Program");
        expect(result?.code).toContain("VariableDeclaration:Program");
        expect(result?.code).not.toContain("/*hidden");
      } finally {
        await server?.close();
      }
    });
  });

  it("resolveImport takes a call-site node and a callee identifier", async () => {
    const runBody = `const parts = [];
        for (const call of ctx.calls()) {
          const onCall = ctx.resolveImport(call.node);
          const callee = call.node.callee;
          const onCallee = callee === undefined || callee === null ? null : ctx.resolveImport(callee);
          const callText = onCall === null || onCall === undefined ? "null" : onCall.imported;
          const calleeText = onCallee === null || onCallee === undefined ? "null" : onCallee.imported;
          parts.push(callText + "/" + calleeText);
        }
        return [{ kind: "insert", at: 0, text: "/*" + parts.join(";") + "*/" }];`;
    await withRoot(async (root) => {
      const source = [
        'import { defineTint } from "@example/tint";',
        "export function paint(defineTint) {",
        '  return defineTint("red");',
        "}",
        'export const outer = defineTint("blue");',
        "",
      ].join("\n");
      writePackage(root, "@example/tint", tintModule());
      writePackage(
        root,
        "@example/probe",
        moduleSource("@example/probe", "probe:resolve", runBody),
      );
      // Tint stays a package so the import resolves, and stays out of `modules`.
      // Inlining the outer call would drop the import, and Vite's reprint drops the marker.
      writeConfig(root, ["@example/probe"]);
      writeFileSync(join(root, "src", "game.ts"), source);
      const pipeline = await loadProject(root);
      let server: ViteDevServer | undefined;
      try {
        server = await openServer(root, [pipeline]);
        const result = await server.transformRequest("/src/game.ts");
        expect(result?.code).toContain("/*null/null;defineTint/defineTint*/");
      } finally {
        await server?.close();
      }
    });
  });

  it("emitAsset emits the file in a build and raises VITE:TRANSFORM_UNSUPPORTED in serve", async () => {
    const runBody = 'ctx.emitAsset("tint.bin", new Uint8Array([9, 8, 7])); return [];';
    await withRoot(async (root) => {
      writePackage(root, "@example/tint", moduleSource("@example/tint", "tint:inline", runBody));
      writeConfig(root, ["@example/tint"]);
      writeFileSync(join(root, "src", "game.ts"), "export const c = 1;\n");
      const pipeline = await loadProject(root);
      let server: ViteDevServer | undefined;
      try {
        const built = await build({
          configFile: false,
          root,
          logLevel: "silent",
          plugins: [pipeline],
          build: {
            write: false,
            minify: false,
            rollupOptions: { input: join(root, "src", "game.ts") },
          },
        });
        const outputs = Array.isArray(built) ? built : [built];
        let bytes: Uint8Array | string | undefined;
        for (const output of outputs) {
          if (!isRecord(output) || !Array.isArray(output["output"])) continue;
          for (const file of output["output"]) {
            if (!isRecord(file) || file["fileName"] !== "tint.bin") continue;
            const source = file["source"];
            if (typeof source === "string" || source instanceof Uint8Array) bytes = source;
          }
        }
        const actual = typeof bytes === "string" ? Buffer.from(bytes) : bytes;
        expect(actual?.[0]).toBe(9);
        expect(actual?.[1]).toBe(8);
        expect(actual?.[2]).toBe(7);
        server = await openServer(root, [pipeline]);
        const caught: unknown = await server.transformRequest("/src/game.ts").then(
          () => undefined,
          (error: unknown) => error,
        );
        expect(causeCode(caught)).toBe(ViteErrorCodes.TRANSFORM_UNSUPPORTED);
        expect(causeMessage(caught)).toContain("emitAsset is only available in a build");
      } finally {
        await server?.close();
      }
    });
  });

  it("the documented example inlines aliased, namespaced and barrel imports and keeps shadowed and dynamic calls", async () => {
    const example = pageExample();
    await withFixtureRoot(async (root) => {
      writePageFixtures(root, example);
      writeFileSync(
        join(root, "src", "barrel.js"),
        'export { defineTint } from "@example/tint";\n',
      );
      writeConfig(root, []);
      writeFileSync(join(root, "src", "game.ts"), `${example.sample}\n`);
      const pipeline = await loadProject(root);
      let server: ViteDevServer | undefined;
      try {
        server = await openServer(root, [pipeline]);
        const result = await server.transformRequest("/src/game.ts");
        expect(result?.code).toContain("aliased = 16711680");
        expect(result?.code).toContain("namespaced = 65280");
        expect(result?.code).toContain("barreled = 255");
        expect(result?.code).not.toContain("paint(");
        expect(result?.code).not.toContain("tint.defineTint(");
        expect(result?.code).not.toContain('defineTint("blue")');
        expect(result?.code).toContain('return defineTint("red")');
        expect(result?.code).toContain("return defineTint(color)");
      } finally {
        await server?.close();
      }
    });
  });
});
