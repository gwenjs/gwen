import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ENGINE_SRC = fileURLToPath(new URL("../src/engine", import.meta.url));

/**
 * Guarded sites cited for the 1.0 netcode-ready contract.
 * A new `window` / `document` / `requestAnimationFrame` line must be added here
 * only when it is one of those sites.
 */
const ALLOWED_LINES = new Set([
  'if (typeof requestAnimationFrame !== "undefined") {',
  "return requestAnimationFrame(cb);",
  'if (typeof globalThis.window !== "undefined") {',
  'if (typeof window === "undefined") return () => {};',
  "const previous = window.onerror;",
  "window.onerror = (message, source, lineno, colno, error) => {",
  "const result: unknown = previous.call(window, message, source, lineno, colno, error);",
  'window.addEventListener("unhandledrejection", onUnhandled);',
  "window.onerror = previous;",
  'window.removeEventListener("unhandledrejection", onUnhandled);',
  "declare const window: GwenWindow;",
  'if (typeof document === "undefined") {',
  'const script = document.createElement("script");',
  "document.head.appendChild(script);",
]);

const ALLOWED_FILES = new Set(["gwen-engine.ts", "error-bus.ts", "wasm-bridge.ts"]);

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
  const inBlock = { value: false };
  const lines = source.split("\n");
  for (let lineNumber = 0; lineNumber < lines.length; lineNumber += 1) {
    const code = codeOfLine(lines[lineNumber] ?? "", inBlock).trim();
    if (!TOKEN.test(code)) continue;
    if (ALLOWED_FILES.has(fileName) && ALLOWED_LINES.has(code)) continue;
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
