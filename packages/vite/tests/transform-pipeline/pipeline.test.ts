/**
 * Red tests for one parse per module and an ordered edit registry.
 * Column of a parse error is 1-based, counted from `labels[0].start`
 * (`packages/vite/node_modules/oxc-parser/src-js/index.d.ts:24-27`).
 */

import { describe, expect, it } from "vitest";
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
    const source = "0123456789abcdefghijklmnop";
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
    // Probe: labels[0].start 32 → line 3, column 7 (1-based line and column).
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
        loc.column === 7
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
});
