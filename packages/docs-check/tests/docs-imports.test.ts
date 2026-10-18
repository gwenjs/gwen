import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

interface SnapEntry {
  values: string[];
  types: string[];
}

const snaps = new Map<string, Record<string, SnapEntry>>();

for (const dir of readdirSync(path.join(repoRoot, "packages"))) {
  const snapPath = path.join(repoRoot, "packages", dir, "public-api.snap.json");
  try {
    const raw = JSON.parse(readFileSync(snapPath, "utf8")) as Record<string, SnapEntry>;
    const manifest = JSON.parse(
      readFileSync(path.join(repoRoot, "packages", dir, "package.json"), "utf8"),
    ) as { name: string };
    snaps.set(manifest.name, raw);
  } catch {
    // Packages without a snapshot are outside this check.
  }
}

function markdownFiles(): string[] {
  const files: string[] = [path.join(repoRoot, "CLAUDE.md")];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === "superpowers") continue;
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith(".md")) files.push(full);
    }
  };
  walk(path.join(repoRoot, "docs"));
  for (const dir of readdirSync(path.join(repoRoot, "packages"))) {
    const readme = path.join(repoRoot, "packages", dir, "README.md");
    try {
      if (statSync(readme).isFile()) files.push(readme);
    } catch {
      // No package README.
    }
  }
  return files;
}

function exportedNames(specifier: string): Set<string> | null {
  const names = [...snaps.keys()].sort((a, b) => b.length - a.length);
  const pkg = names.find((name) => specifier === name || specifier.startsWith(`${name}/`));
  if (!pkg) return null;
  const snap = snaps.get(pkg);
  if (!snap) return null;
  const subpath = specifier === pkg ? "." : `.${specifier.slice(pkg.length)}`;
  const entry = snap[subpath];
  if (!entry) return new Set();
  return new Set([...(entry.values ?? []), ...(entry.types ?? [])]);
}

describe("docs imports match public snapshots", () => {
  it("every named @gwenjs import is in the matching snapshot", () => {
    const missing: string[] = [];
    const pattern = /import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+['"](@gwenjs\/[^'"]+)['"]/g;
    for (const file of markdownFiles()) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(pattern)) {
        const specifier = match[2] ?? "";
        const known = exportedNames(specifier);
        if (!known) continue;
        const block = match[1] ?? "";
        const start = text.slice(0, match.index).split("\n").length;
        for (const part of block.split(",")) {
          const cleaned = part.trim().replace(/^type\s+/, "");
          if (!cleaned) continue;
          const exported = cleaned.split(/\s+as\s+/)[0]?.trim();
          if (!exported || exported.startsWith("//")) continue;
          if (!known.has(exported)) {
            missing.push(`${path.relative(repoRoot, file)}:${start} ${exported} from ${specifier}`);
          }
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
