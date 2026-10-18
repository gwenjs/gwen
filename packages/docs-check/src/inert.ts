import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const PHRASES = [
  "not yet " + "supported",
  "not yet " + "implemented",
  "has no " + "effect",
] as const;

const SOURCE = new Set([".ts", ".tsx", ".js", ".mjs", ".cts", ".mts"]);

/** Lines in `dir` whose text contains a banned inert-option phrase. */
export function findInertPhrases(dir: string): string[] {
  const hits: string[] = [];
  const walk = (current: string) => {
    for (const name of readdirSync(current)) {
      if (name === "node_modules" || name === "dist") continue;
      const full = path.join(current, name);
      const info = statSync(full);
      if (info.isDirectory()) {
        walk(full);
        continue;
      }
      if (!SOURCE.has(path.extname(name))) continue;
      const text = readFileSync(full, "utf8");
      const lines = text.split(/\r?\n/);
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? "";
        for (const phrase of PHRASES) {
          if (line.includes(phrase)) {
            hits.push(`${full}:${index + 1} ${phrase}`);
          }
        }
      }
    }
  };
  walk(dir);
  return hits;
}
