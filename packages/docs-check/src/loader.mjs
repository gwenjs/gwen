import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function sourceForDist(pkgDir, distFile) {
  const rel = distFile.replace(/^\.\/dist\//, "").replace(/\.js$/, "");
  const candidates = [
    path.join(pkgDir, "src", `${rel}.ts`),
    path.join(pkgDir, "src", rel, "index.ts"),
    path.join(pkgDir, "src", `${rel}.tsx`),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function aliasFile(specifier) {
  const packages = path.join(repoRoot, "packages");
  const hits = [];
  for (const dir of readdirSync(packages)) {
    const pkgDir = path.join(packages, dir);
    const manifestPath = path.join(pkgDir, "package.json");
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (!manifest.name || !manifest.exports) continue;
    for (const [subpath, target] of Object.entries(manifest.exports)) {
      const spec = subpath === "." ? manifest.name : `${manifest.name}${subpath.slice(1)}`;
      if (spec !== specifier) continue;
      const imported = typeof target === "string" ? target : target.import;
      if (!imported) continue;
      if (imported.startsWith("./dist/")) {
        const file = sourceForDist(pkgDir, imported);
        if (file) hits.push(file);
      } else {
        hits.push(path.join(pkgDir, imported));
      }
    }
  }
  hits.sort((a, b) => b.length - a.length);
  return hits[0] ?? null;
}

function tsSibling(parentUrl, specifier) {
  if (!parentUrl.startsWith("file:") || !specifier.startsWith(".")) return null;
  const parent = fileURLToPath(parentUrl);
  if (!parent.endsWith(".ts") && !parent.endsWith(".tsx") && !parent.endsWith(".mjs")) return null;
  const abs = path.resolve(path.dirname(parent), specifier);
  const stem = abs.replace(/\.js$/, "");
  const candidates = [`${stem}.ts`, `${stem}.tsx`, path.join(stem, "index.ts"), abs];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

export async function resolve(specifier, context, nextResolve) {
  const aliased = specifier.startsWith("@gwenjs/") ? aliasFile(specifier) : null;
  if (aliased) {
    return { url: pathToFileURL(aliased).href, shortCircuit: true };
  }
  const sibling = tsSibling(context.parentURL ?? "", specifier);
  if (sibling) {
    return { url: pathToFileURL(sibling).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (!url.startsWith("file:") || (!url.endsWith(".ts") && !url.endsWith(".tsx"))) {
    return nextLoad(url, context);
  }
  const filename = fileURLToPath(url);
  const source = readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true,
    },
    fileName: filename,
  });
  return { format: "module", source: compiled.outputText, shortCircuit: true };
}
