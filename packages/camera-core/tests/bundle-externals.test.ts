import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packagesRoot = path.resolve(pkgRoot, "..");
const markers = ["engine/context", "engine-context", "../core/dist/"];

function walkJs(dir: string, files: string[]): void {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      walkJs(full, files);
      continue;
    }
    if (name.endsWith(".js") || name.endsWith(".mjs") || name.endsWith(".cjs")) files.push(full);
  }
}

describe("published bundles", () => {
  it.skipIf(!existsSync(path.join(pkgRoot, "dist")))(
    "do not inline core outside @gwenjs/core",
    () => {
      const hits: string[] = [];
      for (const name of readdirSync(packagesRoot)) {
        if (name === "core") continue;
        const dist = path.join(packagesRoot, name, "dist");
        if (!existsSync(dist)) continue;
        const files: string[] = [];
        walkJs(dist, files);
        for (const file of files) {
          const text = readFileSync(file, "utf8");
          for (const marker of markers) {
            if (text.includes(marker)) {
              hits.push(`${path.relative(packagesRoot, file)} contains ${marker}`);
              break;
            }
          }
        }
      }
      expect(hits).toEqual([]);
    },
  );
});
