/**
 * Node16 resolves type imports only when the specifier has a .js extension.
 * vite-plugin-dts keeps the extensionless specifiers from the source.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function walk(dir, files) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, files);
    else if (name.endsWith(".d.ts") || name.endsWith(".d.cts")) files.push(full);
  }
}

const specifier = /((?:from|import)\s*\(?\s*["'])(\.\.?\/[^"']+)(["'])/g;

function rewriteDist(dist) {
  const files = [];
  walk(dist, files);
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const next = source.replace(specifier, (match, lead, spec, tail) => {
      if (/\.(js|mjs|cjs|json|css|wasm)$/.test(spec)) return match;
      const abs = path.resolve(path.dirname(file), spec);
      if (existsSync(`${abs}.d.ts`) || existsSync(`${abs}.d.cts`)) {
        return `${lead}${spec}.js${tail}`;
      }
      if (existsSync(path.join(abs, "index.d.ts")) || existsSync(path.join(abs, "index.d.cts"))) {
        return `${lead}${spec}/index.js${tail}`;
      }
      return match;
    });
    if (next !== source) writeFileSync(file, next);
  }
}

// An optional directory limits the rewrite to that package.
// Parallel postbuild steps must not rewrite the same files.
const only = process.argv[2];
const dists = only
  ? [path.join(path.resolve(only), "dist")]
  : readdirSync(path.join(root, "packages")).map((dir) => path.join(root, "packages", dir, "dist"));

for (const dist of dists) {
  try {
    if (!statSync(dist).isDirectory()) continue;
  } catch {
    continue;
  }
  rewriteDist(dist);
}
