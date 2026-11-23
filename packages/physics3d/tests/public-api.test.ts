import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkSnapshot } from "@gwenjs/plugin-conformance";
import { describe, expect, it } from "vitest";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(path.join(pkgRoot, "package.json"), "utf8")) as {
  name: string;
};

describe(`${manifest.name} public API`, () => {
  it("value names match public-api.snap.json", async () => {
    const report = await checkSnapshot(pkgRoot);
    expect(report.findings.map((finding) => `${finding.code} ${finding.message}`)).toEqual([]);
  });

  it("the removed 3D vector and id names are not public types or values", () => {
    const snapshot = JSON.parse(
      readFileSync(path.join(pkgRoot, "public-api.snap.json"), "utf8"),
    ) as {
      ".": { types: string[]; values: string[] };
    };
    const root = snapshot["."];
    const exported = new Set([...root.types, ...root.values]);
    const removed = ["Physics3DVec3", "Physics3DQuat", "Physics3DEntityId"];
    expect(removed.filter((name) => exported.has(name))).toEqual([]);
  });
});
