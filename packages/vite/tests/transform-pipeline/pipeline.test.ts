/**
 * Red tests for one parse per module and an ordered edit registry.
 * The message column is 1-based, counted from `labels[0].start`
 * (`packages/vite/node_modules/oxc-parser/src-js/index.d.ts:24-27`).
 * `loc.column` is that value minus 1: Vite reads `err.loc.column` as 0-based.
 */

import { describe, expect, it } from "vitest";
import { resolveConfig, type Plugin } from "vite";
import { ViteErrorCodes } from "../../src/error-codes.js";
import { createTransformPipeline } from "../../src/pipeline/transform-pipeline.js";
import type { GwenSourceTransform, TransformEdit } from "../../src/pipeline/types.js";
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

  it("register() after configResolved raises VITE:TRANSFORM_UNSUPPORTED", async () => {
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
        message.includes("register() was called after configResolved.")
      );
    });
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
});
