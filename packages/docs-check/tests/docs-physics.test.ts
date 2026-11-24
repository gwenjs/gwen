import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extractFences } from "../src/fences.js";
import { checkFences } from "../src/snippets.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function pageText(file: string): string {
  return readFileSync(path.join(repoRoot, file), "utf8");
}

function readJson(file: string): unknown {
  const value: unknown = JSON.parse(readFileSync(file, "utf8"));
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const names: string[] = [];
  for (const item of value) {
    if (typeof item === "string") names.push(item);
  }
  return names;
}

/** Every value and type name in every subpath of one package snapshot. */
function snapshotNames(dir: string): Set<string> {
  const raw = readJson(path.join(repoRoot, "packages", dir, "public-api.snap.json"));
  const names = new Set<string>();
  if (!isRecord(raw)) return names;
  for (const entry of Object.values(raw)) {
    if (!isRecord(entry)) continue;
    for (const name of stringList(entry["values"])) names.add(name);
    for (const name of stringList(entry["types"])) names.add(name);
  }
  return names;
}

function packageName(dir: string): string {
  const raw = readJson(path.join(repoRoot, "packages", dir, "package.json"));
  if (!isRecord(raw) || typeof raw["name"] !== "string") return "";
  return raw["name"];
}

const SNAP_DIRS: readonly string[] = ["physics2d", "physics3d", "physics-core", "math", "schema"];

function snapshotsByPackage(): Map<string, Set<string>> {
  const byPackage = new Map<string, Set<string>>();
  for (const dir of SNAP_DIRS) {
    byPackage.set(packageName(dir), snapshotNames(dir));
  }
  return byPackage;
}

const API_2D = ["docs/api/physics2d.md", "docs/fr/api/physics2d.md"];
const API_3D = ["docs/api/physics3d.md", "docs/fr/api/physics3d.md"];
const COMPOSABLE_PAGES = [
  "docs/physics/physics2d-composables.md",
  "docs/fr/physics/physics2d-composables.md",
  "docs/physics/physics3d-composables.md",
  "docs/fr/physics/physics3d-composables.md",
];
const PAGE_PAIRS: readonly (readonly [string, string])[] = [
  ["docs/api/physics2d.md", "docs/fr/api/physics2d.md"],
  ["docs/api/physics3d.md", "docs/fr/api/physics3d.md"],
  ["docs/api/physics-core.md", "docs/fr/api/physics-core.md"],
  ["docs/physics/physics2d-composables.md", "docs/fr/physics/physics2d-composables.md"],
  ["docs/physics/physics3d-composables.md", "docs/fr/physics/physics3d-composables.md"],
];

const STALE_2D = [
  'interface KinematicBodyOptions<"2d">',
  "  width: number;",
  "function useDynamicBody(options?: DynamicBodyOptions): void",
  "function useStaticBody(): void",
  "function useBoxCollider(options: BoxColliderOptions): void",
];

const STALE_3D = ["extents", "onSensorEnter(handler", "Physics3DBodyOptions", "halfHeight: 0.9"];

/** Old-column code spans of the migration table. Same set in English and French. */
const MIGRATION_OLD = [
  "RigidBodyType",
  "BODY_TYPE",
  "Physics3DBodyKind",
  "PhysicsQualityPreset",
  "Physics3DQualityPreset",
  "QUALITY_PRESETS",
  "Physics3DVec3",
  "Physics3DQuat",
  "Physics3DEntityId",
  "Physics3DCollisionContact",
  "Physics3DSensorState",
  "ContactEvent",
  "ContactEvent3D",
  "membershipLayers",
  "filterLayers",
  "layers",
  "materialPreset",
  "initialAngle",
  "initialVelocity",
  "gravityX",
  "BoxColliderOptions.d",
  "physics3d:collision",
  "physics3d:sensor:changed",
  "physics3d:step",
  "physics3d:collisionStart",
  "physics3d:collisionEnd",
  "physics",
  "addBoxCollider",
  "addBallCollider",
  "createPhysicsKinematicSyncSystem",
].sort();

const ROW_KINDS = new Set(["export", "option", "hook", "key", "signature"]);

const NOT_RENAMED = ["BoxColliderOptions3D", "DynamicBodyOptions3D", "CircleColliderHandle"];

function codeSpans(cell: string): string[] {
  const names: string[] = [];
  for (const match of cell.matchAll(/`([^`]+)`/g)) {
    const name = match[1] ?? "";
    if (name.length > 0) names.push(name);
  }
  return names;
}

function migrationSection(text: string): string {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line === "## Migration");
  if (start < 0) return "";
  const body: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.startsWith("## ")) break;
    body.push(line);
  }
  return body.join("\n");
}

function tableRows(section: string): string[][] {
  const rows: string[][] = [];
  for (const line of section.split("\n")) {
    if (!line.startsWith("|")) continue;
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    const kind = cells[0] ?? "";
    if (!ROW_KINDS.has(kind)) continue;
    rows.push(cells);
  }
  return rows;
}

function oldNames(section: string): string[] {
  const names = new Set<string>();
  for (const row of tableRows(section)) {
    for (const name of codeSpans(row[1] ?? "")) names.add(name);
  }
  return [...names].sort();
}

interface ExportBinding {
  oldName: string;
  newName: string;
  pkg: string;
}

/** Pair each new code span with the next `@gwenjs/…` span in the cell. */
function newBindings(cell: string): { name: string; pkg: string }[] {
  const tokens = codeSpans(cell);
  const bindings: { name: string; pkg: string }[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const name = tokens[index] ?? "";
    if (name.startsWith("@gwenjs/")) continue;
    let pkg = "";
    for (let next = index + 1; next < tokens.length; next += 1) {
      const candidate = tokens[next] ?? "";
      if (candidate.startsWith("@gwenjs/")) {
        pkg = candidate;
        break;
      }
    }
    bindings.push({ name, pkg });
  }
  return bindings;
}

function exportBindings(section: string): ExportBinding[] {
  const bindings: ExportBinding[] = [];
  for (const row of tableRows(section)) {
    if (row[0] !== "export") continue;
    const olds = codeSpans(row[1] ?? "").filter((name) => !name.startsWith("@gwenjs/"));
    for (const bound of newBindings(row[2] ?? "")) {
      for (const oldName of olds) {
        bindings.push({ oldName, newName: bound.name, pkg: bound.pkg });
      }
    }
  }
  return bindings;
}

function headingCount(text: string): number {
  return text.split("\n").filter((line) => /^#{1,4} /.test(line)).length;
}

describe("physics pages", () => {
  it("the physics API pages state the real option and return types", () => {
    for (const file of API_2D) {
      const text = pageText(file);
      for (const stale of STALE_2D) {
        expect(text, `${file} ${stale}`).not.toContain(stale);
      }
      expect(text, file).toContain('BoxColliderOptions<"2d">');
    }
    for (const file of API_3D) {
      const text = pageText(file);
      for (const stale of STALE_3D) {
        expect(text, `${file} ${stale}`).not.toContain(stale);
      }
      expect(text, file).toContain("DynamicBodyHandle3D");
      expect(text, file).toContain(
        "onSensorEnter(sensorId: number, callback: (entityId: bigint) => void): () => void",
      );
    }
  });

  it("the physics composable pages use the real collider option names", () => {
    for (const file of COMPOSABLE_PAGES) {
      const text = pageText(file);
      expect(text, file).not.toContain("length: 1.8");
      expect(text, file).not.toMatch(/\blength:/);
    }
    expect(pageText("docs/physics/physics3d-composables.md")).not.toContain("{ type: capsule'");
    expect(pageText("docs/fr/physics/physics3d-composables.md")).not.toContain("{ type: capsule'");
    for (const file of [...API_2D, ...API_3D]) {
      const text = pageText(file);
      expect(text, file).not.toContain("restitution: 0.6");
      expect(text, file).not.toContain("restitution: 0.8");
    }
  });

  it("the physics-core page carries a migration table that matches the snapshots", () => {
    const english = pageText("docs/api/physics-core.md");
    const french = pageText("docs/fr/api/physics-core.md");
    expect(english).toMatch(/^## Migration$/m);
    expect(french).toMatch(/^## Migration$/m);

    const englishSection = migrationSection(english);
    const frenchSection = migrationSection(french);
    expect(oldNames(englishSection)).toEqual(MIGRATION_OLD);
    expect(oldNames(frenchSection)).toEqual(MIGRATION_OLD);

    const snaps = snapshotsByPackage();
    const physicsNames = new Set<string>();
    for (const dir of ["physics2d", "physics3d", "physics-core"]) {
      for (const name of snapshotNames(dir)) physicsNames.add(name);
    }
    const bindings = exportBindings(englishSection);
    expect(bindings.length).toBeGreaterThan(0);
    for (const binding of bindings) {
      expect(physicsNames.has(binding.oldName), binding.oldName).toBe(false);
      const exported = snaps.get(binding.pkg);
      expect(exported, binding.pkg).toBeDefined();
      expect(exported?.has(binding.newName), `${binding.newName} in ${binding.pkg}`).toBe(true);
    }
    expect(exportBindings(frenchSection)).toEqual(bindings);

    for (const section of [englishSection, frenchSection]) {
      const exportOld = tableRows(section)
        .filter((row) => row[0] === "export")
        .flatMap((row) => codeSpans(row[1] ?? ""));
      for (const name of NOT_RENAMED) {
        expect(exportOld, name).not.toContain(name);
      }
    }
    expect(englishSection).toMatch(/Not renamed/);
    expect(frenchSection).toMatch(/Pas renomm/);
    expect(snapshotNames("physics3d").has("BoxColliderOptions3D")).toBe(true);
    expect(snapshotNames("physics3d").has("DynamicBodyOptions3D")).toBe(true);
    expect(snapshotNames("physics2d").has("CircleColliderHandle")).toBe(true);
  });

  it("the physics pages carry type-checked examples", () => {
    for (const [english, french] of PAGE_PAIRS) {
      const englishFences = extractFences(pageText(english), english).filter(
        (fence) => fence.tag === "check",
      );
      const frenchFences = extractFences(pageText(french), french).filter(
        (fence) => fence.tag === "check",
      );
      expect(englishFences.length, english).toBeGreaterThan(0);
      expect(frenchFences.length, french).toBeGreaterThan(0);
      expect(englishFences.map((fence) => fence.code).join("\n---\n"), english).toBe(
        frenchFences.map((fence) => fence.code).join("\n---\n"),
      );
      expect(checkFences([...englishFences, ...frenchFences])).toEqual([]);
    }
  });

  it("the French physics pages keep the heading structure of the English pages", () => {
    for (const [english, french] of PAGE_PAIRS) {
      const label = english.replace(/^docs\//, "").replace(/\.md$/, "");
      expect(headingCount(pageText(french)), label).toBe(headingCount(pageText(english)));
    }
  });

  it("CLAUDE.md qualifies the math allocation-free claim", () => {
    const text = pageText("CLAUDE.md");
    expect(text).toContain("allocation-free on the `*Mut` path");
    const stale = text.split("\n").filter((line) => /math\/.*pure, allocation-free$/.test(line));
    expect(stale).toEqual([]);
  });
});
