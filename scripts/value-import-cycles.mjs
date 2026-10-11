#!/usr/bin/env node
/**
 * Value-import cycles under packages/core/src.
 * A type-only import or `export type` is not an edge.
 * Usage: node /tmp/w4-value-cycles.mjs <src dir>
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] ?? ".");
const files = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === "wasm") continue;
    const full = path.join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full);
    else if (name.endsWith(".ts") && !name.endsWith(".d.ts")) files.push(full);
  }
}
walk(root);

const byId = new Map();
function idOf(file) {
  return path.relative(root, file).split(path.sep).join("/");
}

function resolveSpec(fromFile, spec) {
  if (!spec.startsWith(".")) return null;
  const base = path.resolve(path.dirname(fromFile), spec);
  const stem = base.replace(/\.js$/, "");
  const candidates = [`${stem}.ts`, `${stem}.tsx`, path.join(stem, "index.ts"), path.join(stem, "index.tsx")];
  for (const candidate of candidates) {
    if (files.includes(candidate)) return candidate;
  }
  return null;
}

function valueSpecs(text) {
  const specs = [];
  const lines = text.split("\n");
  let block = false;
  for (const line of lines) {
    let code = "";
    let index = 0;
    while (index < line.length) {
      if (block) {
        const end = line.indexOf("*/", index);
        if (end === -1) {
          code = "";
          break;
        }
        block = false;
        index = end + 2;
        continue;
      }
      if (line.startsWith("//", index)) break;
      if (line.startsWith("/*", index)) {
        block = true;
        index += 2;
        continue;
      }
      code += line[index];
      index += 1;
    }
    const trimmed = code.trim();
    if (!trimmed) continue;
    const from = trimmed.match(/from\s+["']([^"']+)["']/);
    if (from) {
      if (/^export\s+type\b/.test(trimmed) || /^import\s+type\b/.test(trimmed)) continue;
      const clause = trimmed.match(/\{([^}]*)\}/);
      if (clause) {
        const names = clause[1]
          .split(",")
          .map((part) => part.trim())
          .filter(Boolean);
        const values = names.filter((name) => !name.startsWith("type "));
        if (values.length === 0) continue;
      }
      specs.push(from[1]);
      continue;
    }
    const dynamic = trimmed.match(/import\(\s*["']([^"']+)["']\s*\)/);
    if (dynamic) specs.push(dynamic[1]);
    const side = trimmed.match(/^import\s+["']([^"']+)["']/);
    if (side) specs.push(side[1]);
  }
  return specs;
}

const graph = new Map();
for (const file of files) {
  const text = readFileSync(file, "utf8");
  const edges = [];
  for (const spec of valueSpecs(text)) {
    const target = resolveSpec(file, spec);
    if (target) edges.push(target);
  }
  graph.set(file, edges);
}

const cycles = [];
const stack = [];
const onStack = new Set();
const seen = new Set();

function dfs(file) {
  seen.add(file);
  onStack.add(file);
  stack.push(file);
  for (const next of graph.get(file) ?? []) {
    if (onStack.has(next)) {
      const start = stack.indexOf(next);
      cycles.push(stack.slice(start).concat(next).map(idOf));
      continue;
    }
    if (!seen.has(next)) dfs(next);
  }
  stack.pop();
  onStack.delete(file);
}

for (const file of files) {
  if (!seen.has(file)) dfs(file);
}

const unique = [];
const keys = new Set();
for (const cycle of cycles) {
  const key = cycle.slice(0, -1).sort().join(" > ");
  if (keys.has(key)) continue;
  keys.add(key);
  unique.push(cycle.join(" -> "));
}
console.log(`files ${files.length}`);
console.log(`value cycles ${unique.length}`);
for (const cycle of unique) console.log(cycle);
process.exit(unique.length === 0 ? 0 : 1);
