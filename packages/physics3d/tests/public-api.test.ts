import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkSnapshot } from "@gwenjs/plugin-conformance";
import { describe, expect, it } from "vitest";
import * as entry from "../src/index.js";

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

  it("entry exports the shared codes", () => {
    expect(entry.BODY_KIND_CODE).toEqual({ fixed: 0, dynamic: 1, kinematic: 2 });
    expect(entry.QUALITY_PRESET_CODE).toEqual({ low: 0, medium: 1, high: 2, esport: 3 });
    expect("QUALITY_PRESETS" in entry).toBe(false);
  });
  it("the removed 3D config names are not public types or values", () => {
    const snap = JSON.parse(readFileSync(path.join(pkgRoot, "public-api.snap.json"), "utf8"));
    const names = [...snap["."].types, ...snap["."].values, ...snap["./internal"].values];
    const removed = ["Physics3DBodyKind", "Physics3DQualityPreset", "QUALITY_PRESETS"];
    expect(removed.filter((name) => names.includes(name))).toEqual([]);
  });

  it("the removed 3D contact, sensor and event names are not public types or values", () => {
    const snapshot = JSON.parse(
      readFileSync(path.join(pkgRoot, "public-api.snap.json"), "utf8"),
    ) as {
      ".": { types: string[]; values: string[] };
    };
    const root = snapshot["."];
    const exported = new Set([...root.types, ...root.values]);
    const removed = ["Physics3DCollisionContact", "Physics3DSensorState", "ContactEvent3D"];
    expect(removed.filter((name) => exported.has(name))).toEqual([]);
  });

  it("the shared contact types are public", () => {
    const snapshot = JSON.parse(
      readFileSync(path.join(pkgRoot, "public-api.snap.json"), "utf8"),
    ) as {
      ".": { types: string[]; values: string[] };
    };
    const types = snapshot["."].types;
    expect(types).toEqual(expect.arrayContaining(["CollisionContact", "SensorState"]));
  });
});
