import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkSnapshot } from "@gwenjs/plugin-conformance";
import { describe, expect, it } from "vitest";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(path.join(pkgRoot, "package.json"), "utf8")) as {
  name: string;
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

// Findings the repository accepts for now, shared with scripts/public-api-types.mjs.
const known = JSON.parse(
  readFileSync(path.join(pkgRoot, "../../scripts/snapshot-known-findings.json"), "utf8"),
) as Record<string, string[]>;

describe(`${manifest.name} public API`, () => {
  it("value names match public-api.snap.json", async () => {
    const report = await checkSnapshot(pkgRoot);
    const actual = report.findings.map((finding) => `${finding.code} ${finding.message}`);
    expect(actual.sort()).toEqual([...(known[manifest.name] ?? [])].sort());
  });

  it("exports GwenEngineStateMethod", () => {
    const snap = loadSnap();
    expect(snap["."]?.types ?? []).toContain("GwenEngineStateMethod");
    const index = readFileSync(path.join(pkgRoot, "src/index.ts"), "utf8");
    expect(index).toContain("GwenEngineStateMethod");
  });
});
