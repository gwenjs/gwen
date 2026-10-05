import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(path.join(pkgRoot, "package.json"), "utf8")) as {
  name: string;
  exports: Record<string, string | Record<string, string>>;
};

describe(`${manifest.name} exports map`, () => {
  it("points every export at a file and lists types first", () => {
    for (const [subpath, target] of Object.entries(manifest.exports)) {
      if (typeof target === "string") {
        expect(existsSync(path.join(pkgRoot, target)), subpath).toBe(true);
        continue;
      }
      const keys = Object.keys(target);
      if ("types" in target) expect(keys[0], subpath).toBe("types");
      for (const file of Object.values(target)) {
        expect(existsSync(path.join(pkgRoot, file)), `${subpath} -> ${file}`).toBe(true);
      }
    }
  });

  it("resolves ./package.json", async () => {
    expect(manifest.exports["./package.json"]).toBe("./package.json");
    const imported = (await import(`${manifest.name}/package.json`)) as {
      default?: { name?: string };
      name?: string;
    };
    const name = imported.default?.name ?? imported.name;
    expect(name).toBe(manifest.name);
  });
});
