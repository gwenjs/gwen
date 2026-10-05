import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/**
 * Today's offenders. The list may only shrink (#115). Do not add a path.
 * Spec sites: vite preview headers and dev middleware, wasm-bridge requireSAB,
 * both contact ring buffers, and the physics3d BVH job worker.
 */
const ALLOWED_IDENTIFIER_COUNTS: Readonly<Record<string, number>> = {
  "packages/core/src/engine/wasm-bridge.ts SharedArrayBuffer": 1,
  "packages/physics2d/src/ring-buffer.ts SharedArrayBuffer": 4,
  "packages/physics3d/src/plugin/ring-buffer.ts SharedArrayBuffer": 4,
};

const ALLOWED_WORKERS = ["packages/physics3d/src/plugin/bvh.ts:75"];

const ALLOWED_COEP = ["packages/vite/src/index.ts:978", "packages/vite/src/index.ts:1081"];

const IDENTIFIER_NAMES = new Set(["SharedArrayBuffer", "Atomics", "crossOriginIsolated"]);

interface Hit {
  readonly file: string;
  readonly line: number;
  readonly kind: string;
}

function rel(file: string): string {
  return path.relative(REPO_ROOT, file).split(path.sep).join("/");
}

function walk(dir: string, visit: (file: string) => void): void {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === "target" || entry === ".git") {
      continue;
    }
    const full = path.join(dir, entry);
    const info = statSync(full);
    if (info.isDirectory()) {
      walk(full, visit);
      continue;
    }
    if (info.isFile()) visit(full);
  }
}

function isScript(file: string): boolean {
  return (file.endsWith(".ts") || file.endsWith(".tsx")) && !file.endsWith(".d.ts");
}

function lineOf(source: ts.SourceFile, node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

function calleeName(expr: ts.LeftHandSideExpression): string | undefined {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.name)) return expr.name.text;
  return undefined;
}

function isWebAssemblyMemory(expr: ts.LeftHandSideExpression): boolean {
  return (
    ts.isPropertyAccessExpression(expr) &&
    ts.isIdentifier(expr.expression) &&
    expr.expression.text === "WebAssembly" &&
    expr.name.text === "Memory"
  );
}

function objectHasSharedTrue(expr: ts.Expression): boolean {
  if (!ts.isObjectLiteralExpression(expr)) return false;
  for (const prop of expr.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const name = ts.isIdentifier(prop.name)
      ? prop.name.text
      : ts.isStringLiteral(prop.name)
        ? prop.name.text
        : "";
    if (name === "shared" && prop.initializer.kind === ts.SyntaxKind.TrueKeyword) return true;
  }
  return false;
}

function scanSource(file: string): Hit[] {
  const text = readFileSync(file, "utf8");
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const hits: Hit[] = [];
  const relative = rel(file);

  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && IDENTIFIER_NAMES.has(node.text)) {
      hits.push({ file: relative, line: lineOf(source, node), kind: node.text });
    }
    if (ts.isNewExpression(node)) {
      const name = calleeName(node.expression);
      if (name === "Worker") {
        hits.push({ file: relative, line: lineOf(source, node), kind: "new Worker" });
      }
      if (
        isWebAssemblyMemory(node.expression) &&
        node.arguments?.some((arg) => objectHasSharedTrue(arg))
      ) {
        hits.push({
          file: relative,
          line: lineOf(source, node),
          kind: "shared WebAssembly.Memory",
        });
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(source);
  return hits;
}

function packageSources(): string[] {
  const root = path.join(REPO_ROOT, "packages");
  const files: string[] = [];
  for (const entry of readdirSync(root)) {
    const src = path.join(root, entry, "src");
    try {
      if (!statSync(src).isDirectory()) continue;
    } catch {
      continue;
    }
    walk(src, (file) => {
      if (isScript(file)) files.push(file);
    });
  }
  return files;
}

function textHits(files: readonly string[], pattern: RegExp, kind: string): string[] {
  const hits: string[] = [];
  for (const file of files) {
    const lines = readFileSync(file, "utf8").split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      if (pattern.test(lines[index] ?? "")) hits.push(`${rel(file)}:${index + 1}:${kind}`);
    }
  }
  return hits;
}

describe("threading guard", () => {
  const sources = packageSources();
  const astHits = sources.flatMap((file) => scanSource(file));

  it("allows SharedArrayBuffer, Atomics, crossOriginIsolated, and shared Memory only at today's sites", () => {
    const counts = new Map<string, number>();
    const unexpected: Hit[] = [];
    for (const hit of astHits) {
      if (hit.kind === "new Worker") continue;
      const key = `${hit.file} ${hit.kind}`;
      if (ALLOWED_IDENTIFIER_COUNTS[key] === undefined) {
        unexpected.push(hit);
        continue;
      }
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    expect(unexpected).toEqual([]);
    expect(Object.fromEntries([...counts.entries()].sort())).toEqual(ALLOWED_IDENTIFIER_COUNTS);
  });

  it("allows new Worker( only in the physics3d BVH job", () => {
    const workers = astHits
      .filter((hit) => hit.kind === "new Worker")
      .map((hit) => `${hit.file}:${hit.line}`)
      .sort();
    expect(workers).toEqual(ALLOWED_WORKERS);
  });

  it("allows Cross-Origin-Embedder-Policy only at the two vite header sites", () => {
    const files: string[] = [];
    walk(path.join(REPO_ROOT, "packages", "vite", "src"), (file) => {
      if (isScript(file) || file.endsWith(".js") || file.endsWith(".mjs")) files.push(file);
    });
    const hits = textHits(files, /Cross-Origin-Embedder-Policy/, "coep").map((hit) =>
      hit.replace(/:coep$/, ""),
    );
    expect(hits).toEqual(ALLOWED_COEP);
  });

  it("rejects rayon in crate manifests", () => {
    const files: string[] = [];
    for (const entry of readdirSync(path.join(REPO_ROOT, "crates"))) {
      const manifest = path.join(REPO_ROOT, "crates", entry, "Cargo.toml");
      try {
        if (statSync(manifest).isFile()) files.push(manifest);
      } catch {
        // not a crate directory
      }
    }
    expect(textHits(files, /rayon/, "rayon")).toEqual([]);
  });

  it("rejects atomics and build-std in wasm build scripts", () => {
    const files: string[] = [];
    const scripts = path.join(REPO_ROOT, "scripts");
    for (const entry of readdirSync(scripts)) {
      if (entry.endsWith(".sh")) files.push(path.join(scripts, entry));
    }
    walk(REPO_ROOT, (file) => {
      if (file.endsWith(`${path.sep}.cargo${path.sep}config.toml`)) files.push(file);
    });
    expect(textHits(files, /atomics|build-std/, "atomics")).toEqual([]);
  });
});
