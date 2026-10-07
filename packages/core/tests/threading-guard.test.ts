import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/**
 * Offender ceilings for SharedArrayBuffer, Atomics, crossOriginIsolated,
 * and shared WebAssembly.Memory. Empty after #115. The list may only shrink.
 * Do not add a path.
 */
const ALLOWED_IDENTIFIER_COUNTS: Readonly<Record<string, number>> = {};

/**
 * `new Worker(` is not an offender entry. The physics3d BVH job stays.
 * The count is a ceiling: the list may only shrink.
 */
const ALLOWED_WORKERS: Readonly<Record<string, number>> = {
  "packages/physics3d/src/plugin/bvh.ts new Worker": 1,
};

/** Cross-Origin-Embedder-Policy ceilings in packages/vite/src. Empty after #115. */
const ALLOWED_COEP: Readonly<Record<string, number>> = {};

/** Cross-Origin-Embedder-Policy text. One hit fails because the allow-list is empty. */
const ISOLATION_HEADER = /Cross-Origin-Embedder-Policy/;

/** Problems when `text` sets an isolation header. An empty allow-list fails any hit. */
function isolationHeaderProblems(file: string, text: string): string[] {
  const counts = new Map<string, number>();
  for (const line of text.split("\n")) {
    if (!ISOLATION_HEADER.test(line)) continue;
    const key = `${file} Cross-Origin-(Embedder|Opener)-Policy`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return growthPast(counts, ALLOWED_COEP);
}

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

function scanText(text: string, name: string): Hit[] {
  const source = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const hits: Hit[] = [];
  const relative = name;

  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && IDENTIFIER_NAMES.has(node.text)) {
      hits.push({ file: relative, line: lineOf(source, node), kind: node.text });
    }
    if (ts.isNewExpression(node)) {
      const callee = calleeName(node.expression);
      if (callee === "Worker") {
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

function scanSource(file: string): Hit[] {
  return scanText(readFileSync(file, "utf8"), rel(file));
}

/** Problems when `actual` is not a subset of `allowed` ceilings. Shrink is fine. */
function growthPast(
  actual: ReadonlyMap<string, number>,
  allowed: Readonly<Record<string, number>>,
): string[] {
  const problems: string[] = [];
  for (const [key, count] of actual) {
    const cap = allowed[key];
    if (cap === undefined) problems.push(`new ${key} (${count})`);
    else if (count > cap) problems.push(`grew ${key}: ${count} > ${cap}`);
  }
  return problems;
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

  it("rejects SharedArrayBuffer, Atomics, crossOriginIsolated, and shared Memory in package sources", () => {
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
    expect(growthPast(counts, ALLOWED_IDENTIFIER_COUNTS)).toEqual([]);
  });

  it("allows new Worker only in the physics3d BVH job, and the list may only shrink", () => {
    const counts = new Map<string, number>();
    for (const hit of astHits) {
      if (hit.kind !== "new Worker") continue;
      const key = `${hit.file} new Worker`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    expect(growthPast(counts, ALLOWED_WORKERS)).toEqual([]);
  });

  it("rejects Cross-Origin-Embedder-Policy in vite sources", () => {
    const files: string[] = [];
    walk(path.join(REPO_ROOT, "packages", "vite", "src"), (file) => {
      if (isScript(file) || file.endsWith(".js") || file.endsWith(".mjs")) files.push(file);
    });
    const problems = files.flatMap((file) =>
      isolationHeaderProblems(rel(file), readFileSync(file, "utf8")),
    );
    expect(problems).toEqual([]);
  });

  it("rejects a header that sets Cross-Origin-Opener-Policy", () => {
    expect(
      isolationHeaderProblems(
        "packages/vite/src/index.ts",
        '"Cross-Origin-Opener-Policy": "same-origin"\n',
      ),
    ).toEqual(["new packages/vite/src/index.ts Cross-Origin-(Embedder|Opener)-Policy (1)"]);
  });

  it("finds no SharedArrayBuffer in user docs", () => {
    const docs = path.join(REPO_ROOT, "docs");
    const hits: string[] = [];
    walk(docs, (file) => {
      if (!file.endsWith(".md")) return;
      const lines = readFileSync(file, "utf8").split("\n");
      for (let index = 0; index < lines.length; index += 1) {
        if ((lines[index] ?? "").includes("SharedArrayBuffer")) {
          hits.push(`${rel(file)}:${index + 1}`);
        }
      }
    });
    expect(hits).toEqual([]);
  });

  it("flags SharedArrayBuffer, Atomics, crossOriginIsolated, shared Memory, and Worker in scanned text", () => {
    const cases: Array<{ readonly name: string; readonly text: string; readonly kind: string }> = [
      {
        name: "fixtures/sab.ts",
        text: "export const buf = new SharedArrayBuffer(8);\n",
        kind: "SharedArrayBuffer",
      },
      {
        name: "fixtures/atomics.ts",
        text: "Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);\n",
        kind: "Atomics",
      },
      {
        name: "fixtures/coi.ts",
        text: "export const iso = globalThis.crossOriginIsolated;\n",
        kind: "crossOriginIsolated",
      },
      {
        name: "fixtures/mem.ts",
        text: "export const mem = new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true });\n",
        kind: "shared WebAssembly.Memory",
      },
      {
        name: "fixtures/worker.ts",
        text: "export const worker = new Worker(new URL('./job.ts', import.meta.url));\n",
        kind: "new Worker",
      },
    ];
    for (const sample of cases) {
      const hits = scanText(sample.text, sample.name);
      expect(hits.some((hit) => hit.kind === sample.kind && hit.file === sample.name)).toBe(true);
    }
  });

  it("does not flag a non-shared WebAssembly.Memory", () => {
    const text = "export const mem = new WebAssembly.Memory({ initial: 1, maximum: 1 });\n";
    expect(scanText(text, "fixtures/mem-plain.ts")).toEqual([]);
  });

  it("treats a removed allow-list site as a shrink and a new site as a failure", () => {
    const allowed = { "packages/physics3d/src/plugin/bvh.ts new Worker": 1 };
    expect(growthPast(new Map(), allowed)).toEqual([]);
    expect(
      growthPast(new Map([["packages/physics3d/src/plugin/bvh.ts new Worker", 1]]), allowed),
    ).toEqual([]);
    expect(
      growthPast(new Map([["packages/physics3d/src/plugin/bvh.ts new Worker", 2]]), allowed)[0],
    ).toContain("grew");
    expect(growthPast(new Map([["packages/app/src/job.ts new Worker", 1]]), allowed)[0]).toContain(
      "new ",
    );
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
