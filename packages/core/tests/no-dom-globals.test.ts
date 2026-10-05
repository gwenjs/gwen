import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ENGINE_SRC = fileURLToPath(new URL("../src/engine", import.meta.url));

/**
 * Ceiling per file and source line. A removed site stays green.
 * A second copy of an allowed line, or a new line, fails.
 */
const ALLOWED_LINE_CEILING: Record<string, Record<string, number>> = {
  "gwen-engine.ts": {
    'if (typeof requestAnimationFrame !== "undefined") {': 1,
    "return requestAnimationFrame(cb);": 1,
    'if (typeof globalThis.window !== "undefined") {': 1,
  },
  "error-bus.ts": {
    'if (typeof window === "undefined") return () => {};': 1,
    "const previous = window.onerror;": 1,
    "window.onerror = (message, source, lineno, colno, error) => {": 1,
    "const result: unknown = previous.call(window, message, source, lineno, colno, error);": 1,
    'window.addEventListener("unhandledrejection", onUnhandled);': 1,
    "window.onerror = previous;": 1,
    'window.removeEventListener("unhandledrejection", onUnhandled);': 1,
  },
  "wasm-bridge.ts": {
    "declare const window: GwenWindow;": 1,
    'if (typeof document === "undefined") {': 1,
    'const script = document.createElement("script");': 1,
    "document.head.appendChild(script);": 1,
  },
};

const TOKEN = /\b(?:window|document|requestAnimationFrame)\b/;

function codeOfLine(line: string, inBlock: { value: boolean }): string {
  let code = "";
  let index = 0;
  while (index < line.length) {
    if (inBlock.value) {
      const end = line.indexOf("*/", index);
      if (end === -1) return code;
      inBlock.value = false;
      index = end + 2;
      continue;
    }
    if (line.startsWith("//", index)) break;
    if (line.startsWith("/*", index)) {
      inBlock.value = true;
      index += 2;
      continue;
    }
    code += line[index];
    index += 1;
  }
  return code;
}

function hitsIn(source: string, fileName: string): string[] {
  const hits: string[] = [];
  const seen = new Map<string, number>();
  const ceilings = ALLOWED_LINE_CEILING[fileName] ?? {};
  const inBlock = { value: false };
  const lines = source.split("\n");
  for (let lineNumber = 0; lineNumber < lines.length; lineNumber += 1) {
    const code = codeOfLine(lines[lineNumber] ?? "", inBlock).trim();
    if (!TOKEN.test(code)) continue;
    const count = (seen.get(code) ?? 0) + 1;
    seen.set(code, count);
    const ceiling = ceilings[code] ?? 0;
    if (count <= ceiling) continue;
    hits.push(`${fileName}:${lineNumber + 1} ${code}`);
  }
  return hits;
}

describe("engine DOM global scan", () => {
  it("flags a new window use and keeps the guarded sites", () => {
    expect(hitsIn("window.addEventListener('x', fn);", "gwen-engine.ts")).toEqual([
      "gwen-engine.ts:1 window.addEventListener('x', fn);",
    ]);
    expect(hitsIn('if (typeof globalThis.window !== "undefined") {', "gwen-engine.ts")).toEqual([]);
    expect(hitsIn("/* window */\nconst n = 1;", "gwen-engine.ts")).toEqual([]);
    const allowed = "return requestAnimationFrame(cb);";
    expect(hitsIn(`${allowed}\n${allowed}`, "gwen-engine.ts")).toEqual([
      `gwen-engine.ts:2 ${allowed}`,
    ]);
    expect(hitsIn("", "gwen-engine.ts")).toEqual([]);
  });

  it("finds no unguarded window, document, or requestAnimationFrame in engine src", () => {
    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        if (entry === "__tests__" || entry === "node_modules") continue;
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) {
          walk(path);
          continue;
        }
        if (!entry.endsWith(".ts") || entry.endsWith(".test.ts") || entry.endsWith(".d.ts")) {
          continue;
        }
        const source = readFileSync(path, "utf8");
        const fileName = relative(ENGINE_SRC, path).split(sep).join("/");
        hits.push(...hitsIn(source, fileName));
      }
    };
    walk(ENGINE_SRC);
    expect(hits).toEqual([]);
  });
});
