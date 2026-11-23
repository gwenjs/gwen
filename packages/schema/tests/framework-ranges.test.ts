/**
 * FRAMEWORK_RANGES (#281). One range per package of the release-please manifest.
 * The linked group maps to CORE_RANGE. Every other package maps to "^" plus its
 * manifest version. `ranges()` asserts the export is an object before any read:
 * `Object.isFrozen(undefined)` is true.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import * as schema from "@gwenjs/schema";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");

interface ReleasePackage {
  "package-name"?: string;
}

interface ReleaseConfig {
  packages: Record<string, ReleasePackage>;
  "linked-versions"?: readonly { components?: readonly string[] }[];
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

function manifestAndConfig(): {
  manifest: Record<string, string>;
  config: ReleaseConfig;
} {
  return {
    manifest: readJson<Record<string, string>>(
      path.join(repoRoot, ".release-please-manifest.json"),
    ),
    config: readJson<ReleaseConfig>(path.join(repoRoot, "release-please-config.json")),
  };
}

function packageName(config: ReleaseConfig, manifestPath: string): string {
  const name = config.packages[manifestPath]?.["package-name"];
  if (typeof name !== "string") {
    throw new Error(`missing package-name for ${manifestPath}`);
  }
  return name;
}

/** Asserts the export exists, then returns it. Call this before any other read. */
function ranges(): Readonly<Record<string, string>> {
  expect(typeof schema.FRAMEWORK_RANGES).toBe("object");
  return schema.FRAMEWORK_RANGES;
}

describe("FRAMEWORK_RANGES", () => {
  it("FRAMEWORK_RANGES has one entry per package of the release-please manifest", () => {
    const record = ranges();
    const { manifest, config } = manifestAndConfig();
    const names = Object.keys(manifest)
      .map((manifestPath) => packageName(config, manifestPath))
      .sort(compareText);
    expect(names).toContain("@gwenjs/core");
    expect(names).toContain("@gwenjs/math");
    expect(Object.keys(record).sort(compareText)).toEqual(names);
  });

  it("every package of the linked group has CORE_RANGE", () => {
    const record = ranges();
    const { config } = manifestAndConfig();
    const components = config["linked-versions"]?.[0]?.components ?? [];
    const names = components.map((component) => packageName(config, component));
    expect(names).toContain("@gwenjs/core");
    expect(names).toContain("@gwenjs/kit");
    expect(names).toContain("@gwenjs/physics-core");
    for (const name of names) {
      expect(record[name]).toBe(schema.CORE_RANGE);
    }
  });

  it("every package outside the linked group has the caret of its manifest version", () => {
    const record = ranges();
    const { manifest, config } = manifestAndConfig();
    const linked = new Set(config["linked-versions"]?.[0]?.components ?? []);
    const outside = Object.keys(manifest)
      .filter((manifestPath) => !linked.has(manifestPath))
      .map((manifestPath) => ({
        name: packageName(config, manifestPath),
        version: manifest[manifestPath],
      }));
    const names = outside.map((item) => item.name);
    expect(names).toContain("@gwenjs/math");
    expect(names).toContain("@gwenjs/schema");
    for (const item of outside) {
      expect(record[item.name]).toBe(`^${item.version}`);
    }
  });

  it("FRAMEWORK_RANGES is frozen", () => {
    const record = ranges();
    expect(Object.isFrozen(record)).toBe(true);
  });
});
