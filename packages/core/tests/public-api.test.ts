import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(path.join(pkgRoot, "package.json"), "utf8")) as {
  name: string;
  exports: Record<string, string | { types?: string; import?: string }>;
};

interface SnapEntry {
  values: string[];
  types: string[];
}

function loadSnap(): Record<string, SnapEntry> {
  return JSON.parse(readFileSync(path.join(pkgRoot, "public-api.snap.json"), "utf8")) as Record<
    string,
    SnapEntry
  >;
}

function specifier(subpath: string): string {
  return subpath === "." ? manifest.name : `${manifest.name}${subpath.slice(1)}`;
}

function runtimeSubpaths(): string[] {
  return Object.keys(manifest.exports).filter(
    (subpath) => subpath !== "./package.json" && !subpath.includes("wasm"),
  );
}

describe(`${manifest.name} public API`, () => {
  it("value names match public-api.snap.json", async () => {
    const actual: Record<string, string[]> = {};
    for (const subpath of runtimeSubpaths()) {
      const mod = (await import(specifier(subpath))) as Record<string, unknown>;
      actual[subpath] = Object.keys(mod).sort();
    }
    if (process.env.WRITE_PUBLIC_API_SNAP === "1") {
      const snap = loadSnap();
      for (const [subpath, values] of Object.entries(actual)) {
        snap[subpath] = { values, types: snap[subpath]?.types ?? [] };
      }
      writeFileSync(
        path.join(pkgRoot, "public-api.snap.json"),
        `${JSON.stringify(snap, null, 2)}\n`,
      );
    }
    const snap = loadSnap();
    for (const [subpath, values] of Object.entries(actual)) {
      expect(values, subpath).toEqual(snap[subpath]?.values ?? []);
    }
  });

  it("exports GwenEngineStateMethod", () => {
    const snap = loadSnap();
    expect(snap["."]?.types ?? []).toContain("GwenEngineStateMethod");
    const index = readFileSync(path.join(pkgRoot, "src/index.ts"), "utf8");
    expect(index).toContain("GwenEngineStateMethod");
  });
});
