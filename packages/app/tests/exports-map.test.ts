import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(path.join(pkgRoot, "package.json"), "utf8")) as {
  name: string;
  exports: Record<string, unknown>;
};

function assertExportTarget(label: string, target: unknown): void {
  if (typeof target === "string") {
    expect(existsSync(path.join(pkgRoot, target)), label).toBe(true);
    return;
  }
  if (!target || typeof target !== "object") return;
  const record = target as Record<string, unknown>;
  const keys = Object.keys(record);
  if ("types" in record) expect(keys[0], label).toBe("types");
  for (const [key, value] of Object.entries(record)) {
    assertExportTarget(`${label} ${key}`, value);
  }
}

describe(`${manifest.name} exports map`, () => {
  it.skipIf(!existsSync(path.join(pkgRoot, "dist")))(
    "points every export at a file and lists types first",
    () => {
      for (const [subpath, target] of Object.entries(manifest.exports)) {
        assertExportTarget(subpath, target);
      }
    },
  );

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
