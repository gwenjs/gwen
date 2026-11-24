/**
 * Red tests for one parse per module and an ordered edit registry.
 * The message column is 1-based, counted from `labels[0].start`
 * (`packages/vite/node_modules/oxc-parser/src-js/index.d.ts:24-27`).
 * `loc.column` is that value minus 1: Vite reads `err.loc.column` as 0-based.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { build, createServer, resolveConfig, type Plugin, type ViteDevServer } from "vite";
import { ViteErrorCodes } from "../../src/error-codes.js";
import { BUILT_IN_UNITS } from "../../src/pipeline/registry.js";
import { createTransformPipeline } from "../../src/pipeline/transform-pipeline.js";
import type {
  GwenSourceTransform,
  TransformEdit,
  ViteErrorCode,
} from "../../src/pipeline/types.js";
import { applyTransform, mapCheck, preparePipeline, runPipeline, testInsert } from "./helpers.js";

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

function tagSource(count: number): string {
  const lines: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const marked = index === 0 || index === count - 1;
    const call = marked ? "tag(/*@map*/kept)" : "tag()";
    lines.push(`export const v${index} = ${call};`);
  }
  return `${lines.join("\n")}\n`;
}

function markerCount(code: string): number {
  let count = 0;
  let from = 0;
  const marker = "/*X*/";
  while (from < code.length) {
    const at = code.indexOf(marker, from);
    if (at < 0) break;
    count += 1;
    from = at + marker.length;
  }
  return count;
}

describe("gwen:transform-pipeline", () => {
  it("parses a module once and runs the registry in order", async () => {
    const seen: object[] = [];
    const order: string[] = [];
    const counts = { a: 0, b: 0 };
    const unit = (label: "a" | "b"): GwenSourceTransform => ({
      name: `gwen:${label}`,
      run(program) {
        counts[label] += 1;
        order.push(label);
        seen.push(program);
        return [];
      },
    });

    await runPipeline("export const value = 1;\n", { units: [unit("a"), unit("b")] });

    expect(order).toEqual(["a", "b"]);
    expect(counts).toEqual({ a: 1, b: 1 });
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(seen[1]);
  });

  it("returns null when no unit edits", async () => {
    const none = await runPipeline("export const value = 1;\n", { units: [] });
    expect(none).toBeNull();

    let pass = 0;
    const units: GwenSourceTransform[] = [
      { name: "gwen:empty", run: () => [] },
      {
        name: "gwen:mark",
        run() {
          pass += 1;
          if (pass === 1) return [];
          const edit: TransformEdit = { kind: "insert", at: 0, text: "/*marked*/" };
          return [edit];
        },
      },
    ];
    const plugin = createTransformPipeline({ units });
    await preparePipeline(plugin);
    const first = await applyTransform(plugin, "export const first = 1;\n", "/src/first.ts");
    const second = await applyTransform(plugin, "export const second = 2;\n", "/src/second.ts");

    expect(first).toBeNull();
    expect(second).toEqual(
      expect.objectContaining({ code: expect.stringContaining("/*marked*/") }),
    );
  });

  it("applies one, two and max edits with a hires map", async () => {
    for (const count of [1, 2, 1000]) {
      const input = tagSource(count);
      const result = await runPipeline(input, { units: [testInsert] });
      expect(result).toEqual(expect.objectContaining({ code: expect.any(String) }));
      if (result === null || result === undefined || typeof result === "string") return;
      const code = result.code;
      expect(typeof code).toBe("string");
      if (typeof code !== "string") return;
      expect(markerCount(code)).toBe(count);
      mapCheck(input, code, result.map);
    }
  });

  it("two inserts at one offset apply in registry order", async () => {
    const units: GwenSourceTransform[] = [
      { name: "gwen:a", run: () => [{ kind: "insert", at: 0, text: "/*A*/" }] },
      { name: "gwen:b", run: () => [{ kind: "insert", at: 0, text: "/*B*/" }] },
    ];
    const result = await runPipeline("export const value = 1;\n", { units });
    expect(result).toEqual(
      expect.objectContaining({ code: expect.stringContaining("/*A*//*B*/") }),
    );
  });

  it("overlapping edits from two units raise VITE:TRANSFORM_EDIT_CONFLICT naming both units", async () => {
    // The pipeline parses before it applies edits, so this source has to be a module.
    const source = "export const value = 1234567890;\n";
    const overlap: GwenSourceTransform[] = [
      {
        name: "gwen:a",
        run: () => [{ kind: "overwrite", start: 10, end: 20, text: "A" }],
      },
      {
        name: "gwen:b",
        run: () => [{ kind: "overwrite", start: 15, end: 25, text: "B" }],
      },
    ];
    await expect(runPipeline(source, { units: overlap })).rejects.toSatisfy((error: unknown) => {
      const message = readString(error, "message");
      return (
        readString(error, "code") === "VITE:TRANSFORM_EDIT_CONFLICT" &&
        message !== undefined &&
        message.includes("gwen:a [10-20]") &&
        message.includes("gwen:b [15-25]")
      );
    });

    const boundary: GwenSourceTransform[] = [
      {
        name: "gwen:a",
        run: () => [{ kind: "overwrite", start: 10, end: 20, text: "A" }],
      },
      {
        name: "gwen:b",
        run: () => [{ kind: "insert", at: 20, text: "/*EDGE*/" }],
      },
    ];
    await expect(runPipeline(source, { units: boundary })).resolves.toEqual(
      expect.objectContaining({ code: expect.stringContaining("/*EDGE*/") }),
    );
  });

  it("a syntax error raises VITE:TRANSFORM_PARSE_FAILED with file, line and column", async () => {
    // Probe: labels[0].start 32 → line 3, message column 7 (1-based). loc.column is 6.
    const source = "const a = 1;\nconst b = 2;\nconst =\n";
    await expect(runPipeline(source, { id: "/src/x.ts" })).rejects.toSatisfy((error: unknown) => {
      const message = readString(error, "message");
      const loc = readLoc(error);
      return (
        readString(error, "code") === "VITE:TRANSFORM_PARSE_FAILED" &&
        message !== undefined &&
        message.startsWith("[gwen()] /src/x.ts:3:7 ") &&
        loc !== undefined &&
        loc.file === "/src/x.ts" &&
        loc.line === 3 &&
        loc.column === 6
      );
    });
  });

  it("ids outside the filter are skipped", async () => {
    const seen: string[] = [];
    const counter: GwenSourceTransform = {
      name: "gwen:count",
      run(_program, ctx) {
        seen.push(ctx.id);
        return [];
      },
    };
    const ids = [
      "\0virtual:x",
      "\0virtual:x.ts",
      "/node_modules/a/b.js",
      "/src/a.d.ts",
      "/src/a.css",
      "/src/a.ts?raw",
    ];
    for (const id of ids) {
      await runPipeline("export const value = 1;\n", { id, units: [counter] });
    }
    expect(seen).toEqual(["/src/a.ts?raw"]);
  });

  it("tsx and decorators parse with the real id", async () => {
    const source = `function dec(value: unknown) {
  return value;
}
@dec
export class Box {}
export const view = <div />;
export const marked = tag();
`;
    const result = await runPipeline(source, { id: "/src/a.tsx", units: [testInsert] });
    expect(result).toEqual(expect.objectContaining({ code: expect.stringContaining("/*X*/") }));
  });

  it("ctx.raise reaches the host error with code, file, line and column", async () => {
    // `const a = 1;\nconst ` is 19 chars. Offset 19 is `b` on line 2, message column 7.
    // loc.column is 6 (Vite reads the loc object as 0-based).
    const source = "const a = 1;\nconst b = 2;\nconst c = 3;\n";
    const node = { start: 19, end: 20 };
    const hinted: GwenSourceTransform = {
      name: "gwen:raise",
      run(_program, ctx) {
        return ctx.raise(ViteErrorCodes.TRANSFORM_UNSUPPORTED, node, "what text", "a hint");
      },
    };
    const plain: GwenSourceTransform = {
      name: "gwen:raise",
      run(_program, ctx) {
        return ctx.raise(ViteErrorCodes.TRANSFORM_UNSUPPORTED, node, "what text");
      },
    };
    const matchesHost = (error: unknown, fix: string | undefined): boolean => {
      const message = readString(error, "message");
      const loc = readLoc(error);
      if (message === undefined || loc === undefined) return false;
      const fixLine = message.split("\n").some((line) => line.startsWith("Fix:"));
      return (
        readString(error, "code") === ViteErrorCodes.TRANSFORM_UNSUPPORTED &&
        message.startsWith("[gwen()] ") &&
        message.includes("what text") &&
        (fix === undefined ? fixLine === false : message.includes(fix)) &&
        loc.file === "/src/x.ts" &&
        loc.line === 2 &&
        loc.column === 6
      );
    };

    const previous = process.env["NODE_ENV"];
    process.env["NODE_ENV"] = "development";
    try {
      await expect(runPipeline(source, { id: "/src/x.ts", units: [hinted] })).rejects.toSatisfy(
        (error: unknown) => matchesHost(error, "Fix: a hint"),
      );
    } finally {
      if (previous === undefined) delete process.env["NODE_ENV"];
      else process.env["NODE_ENV"] = previous;
    }

    await expect(runPipeline(source, { id: "/src/x.ts", units: [plain] })).rejects.toSatisfy(
      (error: unknown) => matchesHost(error, undefined),
    );
  });

  it("a query on the id does not change the parse dialect", async () => {
    const worker = "const a: number = 1;\nexport const marked = tag();\n";
    const jsx = "export const view = <div />;\nexport const marked = tag();\n";
    await expect(
      runPipeline(worker, {
        id: "/src/w.ts?worker_file&type=module",
        units: [testInsert],
      }),
    ).resolves.toEqual(expect.objectContaining({ code: expect.stringContaining("/*X*/") }));
    await expect(runPipeline(jsx, { id: "/src/a.tsx?x", units: [testInsert] })).resolves.toEqual(
      expect.objectContaining({ code: expect.stringContaining("/*X*/") }),
    );
  });

  it("NODE_ENV production removes the Fix line for parse errors and ctx.raise", async () => {
    const broken = "const a = 1;\nconst b = 2;\nconst =\n";
    const valid = "const a = 1;\nconst b = 2;\nconst c = 3;\n";
    const node = { start: 19, end: 20 };
    const hinted: GwenSourceTransform = {
      name: "gwen:raise",
      run(_program, ctx) {
        return ctx.raise(ViteErrorCodes.TRANSFORM_UNSUPPORTED, node, "what", "a hint");
      },
    };
    const hasFix = (error: unknown): boolean => {
      const message = readString(error, "message");
      if (message === undefined) return false;
      return message.split("\n").some((line) => line.startsWith("Fix:"));
    };
    const withNodeEnv = async (nodeEnv: string, run: () => Promise<void>): Promise<void> => {
      const previous = process.env["NODE_ENV"];
      process.env["NODE_ENV"] = nodeEnv;
      try {
        await run();
      } finally {
        if (previous === undefined) delete process.env["NODE_ENV"];
        else process.env["NODE_ENV"] = previous;
      }
    };

    await withNodeEnv("production", async () => {
      await expect(runPipeline(broken, { id: "/src/x.ts" })).rejects.toSatisfy(
        (error: unknown) => hasFix(error) === false,
      );
      await expect(runPipeline(valid, { id: "/src/x.ts", units: [hinted] })).rejects.toSatisfy(
        (error: unknown) => hasFix(error) === false,
      );
    });
    await withNodeEnv("development", async () => {
      await expect(runPipeline(broken, { id: "/src/x.ts" })).rejects.toSatisfy((error: unknown) => {
        const message = readString(error, "message");
        return message !== undefined && message.includes("Fix: Fix the syntax error");
      });
      await expect(runPipeline(valid, { id: "/src/x.ts", units: [hinted] })).rejects.toSatisfy(
        (error: unknown) => {
          const message = readString(error, "message");
          return message !== undefined && message.includes("Fix: a hint");
        },
      );
    });
  });

  it("registered units run after built-ins and api.names follows the frozen order", async () => {
    const order: string[] = [];
    const unit = (label: "a" | "b"): GwenSourceTransform => ({
      name: `gwen:${label}`,
      run() {
        order.push(label);
        return [];
      },
    });
    const plugin = createTransformPipeline({ units: [unit("a")] });
    plugin.api.register(unit("b"));
    expect(plugin.api.names).toEqual(["gwen:a", "gwen:b"]);
    await preparePipeline(plugin);
    expect(plugin.api.names).toEqual(["gwen:a", "gwen:b"]);
    await applyTransform(plugin, "export const value = 1;\n", "/src/x.ts");
    expect(order).toEqual(["a", "b"]);

    const other = createTransformPipeline({ units: [unit("a")] });
    expect(other.api.names).toEqual(["gwen:a"]);
  });

  it("register() during a later plugin's configResolved is accepted and its unit runs", async () => {
    const pipeline = createTransformPipeline({ units: [] });
    const later: Plugin = {
      name: "test:register-during-config-resolved",
      configResolved() {
        pipeline.api.register(testInsert);
      },
    };
    await expect(
      resolveConfig({ configFile: false, logLevel: "silent", plugins: [pipeline, later] }, "serve"),
    ).resolves.toBeDefined();
    await preparePipeline(pipeline);
    const result = await applyTransform(pipeline, "export const value = tag();\n", "/src/x.ts");
    expect(result?.code).toContain("/*X*/");
  });

  it("register() after buildStart raises VITE:TRANSFORM_UNSUPPORTED naming buildStart", async () => {
    const plugin = createTransformPipeline({ units: [] });
    await preparePipeline(plugin);
    const late: GwenSourceTransform = { name: "gwen:late", run: () => [] };
    await expect(async () => {
      plugin.api.register(late);
    }).rejects.toSatisfy((error: unknown) => {
      const message = readString(error, "message");
      return (
        readString(error, "code") === "VITE:TRANSFORM_UNSUPPORTED" &&
        message !== undefined &&
        message.includes("register() was called after buildStart.")
      );
    });
  });

  it("registering the same unit twice runs it once", async () => {
    const plugin = createTransformPipeline({ units: [] });
    plugin.api.register(testInsert);
    plugin.api.register(testInsert);
    await preparePipeline(plugin);
    const result = await applyTransform(plugin, "export const value = tag();\n", "/src/x.ts");
    expect(markerCount(result?.code ?? "")).toBe(1);
  });

  it("registering a different unit under a taken name raises VITE:TRANSFORM_UNSUPPORTED", async () => {
    const plugin = createTransformPipeline({ units: [] });
    const first: GwenSourceTransform = { name: "gwen:taken", run: () => [] };
    const second: GwenSourceTransform = {
      name: "gwen:taken",
      run: () => [{ kind: "insert", at: 0, text: "/*other*/" }],
    };
    plugin.api.register(first);
    await expect(async () => {
      plugin.api.register(second);
    }).rejects.toSatisfy(
      (error: unknown) => readString(error, "code") === "VITE:TRANSFORM_UNSUPPORTED",
    );
  });

  it("registering a different unit under a built-in name raises VITE:TRANSFORM_UNSUPPORTED", async () => {
    const plugin = createTransformPipeline({ units: [...BUILT_IN_UNITS] });
    const builtInNames = BUILT_IN_UNITS.map((unit) => unit.name);
    for (const builtIn of BUILT_IN_UNITS) {
      const impostor: GwenSourceTransform = {
        name: builtIn.name,
        run: () => [],
      };
      await expect(async () => {
        plugin.api.register(impostor);
      }).rejects.toSatisfy((error: unknown) => {
        const message = readString(error, "message");
        return (
          readString(error, "code") === "VITE:TRANSFORM_UNSUPPORTED" &&
          message !== undefined &&
          message.includes(builtIn.name)
        );
      });
    }
    expect(plugin.api.names).toEqual(builtInNames);
  });
});

interface FileNameEmit {
  (asset: { type: "asset"; fileName: string; source: Uint8Array }): string;
}

interface CauseRaise {
  (
    code: ViteErrorCode,
    node: { start: number; end: number },
    what: string,
    hint: string | undefined,
    cause: Error,
  ): never;
}

interface BundleAsset {
  readonly fileName: string;
  readonly source: Uint8Array | string;
}

function isFileNameEmit(value: unknown): value is FileNameEmit {
  return typeof value === "function";
}

function isCauseRaise(value: unknown): value is CauseRaise {
  return typeof value === "function";
}

function writeProbeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "gwen-bvh-probe-"));
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src", "mod.ts"), "export const value = 1;\n");
  return root;
}

function bundleAssets(result: unknown): BundleAsset[] {
  const outputs = Array.isArray(result) ? result : [result];
  const assets: BundleAsset[] = [];
  for (const output of outputs) {
    if (!isRecord(output)) continue;
    const files = output["output"];
    if (!Array.isArray(files)) continue;
    for (const file of files) {
      if (!isRecord(file) || file["type"] !== "asset") continue;
      const fileName = file["fileName"];
      const source = file["source"];
      if (typeof fileName !== "string") continue;
      if (typeof source !== "string" && !(source instanceof Uint8Array)) continue;
      assets.push({ fileName, source });
    }
  }
  return assets;
}

function sameBytes(source: Uint8Array | string | undefined, expected: Uint8Array): boolean {
  if (source === undefined) return false;
  const actual = typeof source === "string" ? Buffer.from(source) : source;
  if (actual.byteLength !== expected.byteLength) return false;
  for (let index = 0; index < expected.byteLength; index += 1) {
    if (actual[index] !== expected[index]) return false;
  }
  return true;
}

function causeReaches(error: unknown, target: Error): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (typeof current === "object" && current !== null && !seen.has(current)) {
    if (current === target) return true;
    seen.add(current);
    if (!("cause" in current)) return false;
    current = current.cause;
  }
  return false;
}

it("a unit sees ctx.emitFile in a build and not in serve", async () => {
  const seen: string[] = [];
  const unit = (): GwenSourceTransform => ({
    name: "gwen:emit-probe",
    run(_program, ctx) {
      seen.push(typeof ctx.emitFile);
      return [];
    },
  });
  const root = writeProbeRoot();
  let server: ViteDevServer | undefined;
  try {
    await build({
      configFile: false,
      root,
      logLevel: "silent",
      plugins: [createTransformPipeline({ units: [unit()] })],
      build: {
        write: false,
        minify: false,
        rollupOptions: { input: join(root, "src", "mod.ts") },
      },
    });
    server = await createServer({
      configFile: false,
      root,
      logLevel: "silent",
      appType: "custom",
      plugins: [createTransformPipeline({ units: [unit()] })],
      server: { middlewareMode: true, hmr: false, fs: { strict: false } },
    });
    await server.transformRequest("/src/mod.ts");
    expect(seen).toEqual(["function", "undefined"]);
  } finally {
    await server?.close();
    rmSync(root, { recursive: true, force: true });
  }
});

it("ctx.emitFile with a fileName emits that exact file name in the bundle", async () => {
  const fileName = "probe-asset.bin";
  const bytes = new Uint8Array([4, 5, 6, 7]);
  const probe: GwenSourceTransform = {
    name: "gwen:emit-name",
    run(_program, ctx) {
      const emit: unknown = ctx.emitFile;
      if (!isFileNameEmit(emit)) return [];
      emit({ type: "asset", fileName, source: bytes });
      return [];
    },
  };
  const root = writeProbeRoot();
  try {
    const result = await build({
      configFile: false,
      root,
      logLevel: "silent",
      plugins: [createTransformPipeline({ units: [probe] })],
      build: {
        write: false,
        minify: false,
        rollupOptions: { input: join(root, "src", "mod.ts") },
      },
    });
    const asset = bundleAssets(result).find((item) => item.fileName === fileName);
    expect(asset?.fileName).toBe(fileName);
    expect(sameBytes(asset?.source, bytes)).toBe(true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("raise keeps the cause on the thrown error", async () => {
  const origin = new Error("bake origin");
  const probe: GwenSourceTransform = {
    name: "gwen:raise-cause",
    run(_program, ctx) {
      const raise: unknown = ctx.raise;
      if (!isCauseRaise(raise)) return [];
      return raise(
        ViteErrorCodes.TRANSFORM_UNSUPPORTED,
        { start: 0, end: 1 },
        "bake origin",
        "a hint",
        origin,
      );
    },
  };
  const root = writeProbeRoot();
  let server: ViteDevServer | undefined;
  try {
    server = await createServer({
      configFile: false,
      root,
      logLevel: "silent",
      appType: "custom",
      plugins: [createTransformPipeline({ units: [probe] })],
      server: { middlewareMode: true, hmr: false, fs: { strict: false } },
    });
    await expect(server.transformRequest("/src/mod.ts")).rejects.toSatisfy((error: unknown) => {
      const loc = readLoc(error);
      return causeReaches(error, origin) && loc?.line === 1 && loc.column === 0;
    });
  } finally {
    await server?.close();
    rmSync(root, { recursive: true, force: true });
  }
});
