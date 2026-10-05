import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

export interface GwenAlias {
  find: RegExp;
  replacement: string;
}

function sourceForDist(pkgDir: string, distFile: string): string {
  const rel = distFile.replace(/^\.\/dist\//, "").replace(/\.js$/, "");
  const candidates = [
    path.join(pkgDir, "src", `${rel}.ts`),
    path.join(pkgDir, "src", rel, "index.ts"),
    path.join(pkgDir, "src", `${rel}.tsx`),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(`No source file for ${distFile} in ${pkgDir}`);
  }
  return found;
}

/** Exact `@gwenjs/<pkg>[/<sub>]` aliases generated from each package.json#exports. */
export function gwenSourceAliases(): GwenAlias[] {
  const aliases: GwenAlias[] = [];
  for (const dir of readdirSync(path.join(root, "packages"))) {
    const pkgDir = path.join(root, "packages", dir);
    const manifestPath = path.join(pkgDir, "package.json");
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      name?: string;
      exports?: Record<string, string | { import?: string }>;
    };
    if (!manifest.name || !manifest.exports) continue;
    for (const [subpath, target] of Object.entries(manifest.exports)) {
      const spec = subpath === "." ? manifest.name : `${manifest.name}${subpath.slice(1)}`;
      let file: string;
      if (typeof target === "string") {
        file = path.join(pkgDir, target);
      } else if (target.import?.includes("/wasm/") || target.import?.startsWith("./wasm/")) {
        file = path.join(pkgDir, target.import);
      } else if (target.import?.startsWith("./dist/")) {
        file = sourceForDist(pkgDir, target.import);
      } else if (target.import) {
        file = path.join(pkgDir, target.import);
      } else {
        continue;
      }
      aliases.push({
        find: new RegExp(`^${spec.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
        replacement: file,
      });
    }
  }
  aliases.sort((a, b) => b.find.source.length - a.find.source.length);
  return aliases;
}
