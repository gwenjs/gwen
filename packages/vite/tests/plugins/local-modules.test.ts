import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import {
  inferModuleName,
  scanLocalModuleFiles,
  generateLocalModulesModule,
} from "../../src/plugins/local-modules.js";

function makeTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "gwen-local-modules-test-"));
}

describe("inferModuleName()", () => {
  it("infers name from a flat .ts file", () => {
    expect(inferModuleName("/project/src/modules/score.ts", "/project/src/modules")).toBe(
      "local:score",
    );
  });

  it("infers name from a flat .tsx file", () => {
    expect(inferModuleName("/project/src/modules/hud.tsx", "/project/src/modules")).toBe(
      "local:hud",
    );
  });

  it("infers name from an index.ts inside a subdirectory", () => {
    expect(inferModuleName("/project/src/modules/score/index.ts", "/project/src/modules")).toBe(
      "local:score",
    );
  });

  it("infers name from an index.tsx inside a subdirectory", () => {
    expect(inferModuleName("/project/src/modules/hud/index.tsx", "/project/src/modules")).toBe(
      "local:hud",
    );
  });
});

describe("scanLocalModuleFiles()", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTmp();
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true });
  });

  it("returns empty array when directory does not exist", () => {
    expect(scanLocalModuleFiles(path.join(tmp, "nonexistent"))).toEqual([]);
  });

  it("returns empty array for an empty directory", () => {
    fs.mkdirSync(path.join(tmp, "modules"));
    expect(scanLocalModuleFiles(path.join(tmp, "modules"))).toEqual([]);
  });

  it("returns flat .ts files", () => {
    const dir = path.join(tmp, "modules");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "score.ts"), "");
    const result = scanLocalModuleFiles(dir);
    expect(result).toEqual([path.join(dir, "score.ts")]);
  });

  it("returns index.ts inside subdirectories", () => {
    const dir = path.join(tmp, "modules");
    fs.mkdirSync(dir);
    fs.mkdirSync(path.join(dir, "score"));
    fs.writeFileSync(path.join(dir, "score", "index.ts"), "");
    const result = scanLocalModuleFiles(dir);
    expect(result).toEqual([path.join(dir, "score", "index.ts")]);
  });

  it("excludes non-index .ts files inside subdirectories", () => {
    const dir = path.join(tmp, "modules");
    fs.mkdirSync(dir);
    fs.mkdirSync(path.join(dir, "score"));
    fs.writeFileSync(path.join(dir, "score", "helpers.ts"), "");
    const result = scanLocalModuleFiles(dir);
    expect(result).toEqual([]);
  });

  it("excludes test files", () => {
    const dir = path.join(tmp, "modules");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "score.ts"), "");
    fs.writeFileSync(path.join(dir, "score.test.ts"), "");
    const result = scanLocalModuleFiles(dir);
    expect(result).toEqual([path.join(dir, "score.ts")]);
  });

  it("excludes .d.ts declaration files", () => {
    const dir = path.join(tmp, "modules");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "score.ts"), "");
    fs.writeFileSync(path.join(dir, "score.d.ts"), "");
    const result = scanLocalModuleFiles(dir);
    expect(result).toEqual([path.join(dir, "score.ts")]);
  });

  it("returns files in alphabetical order", () => {
    const dir = path.join(tmp, "modules");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "zebra.ts"), "");
    fs.writeFileSync(path.join(dir, "alpha.ts"), "");
    const result = scanLocalModuleFiles(dir);
    expect(result).toEqual([path.join(dir, "alpha.ts"), path.join(dir, "zebra.ts")]);
  });

  it("mixes flat files and index.ts subdirectories alphabetically", () => {
    const dir = path.join(tmp, "modules");
    fs.mkdirSync(dir);
    fs.mkdirSync(path.join(dir, "audio"));
    fs.writeFileSync(path.join(dir, "audio", "index.ts"), "");
    fs.writeFileSync(path.join(dir, "score.ts"), "");
    const result = scanLocalModuleFiles(dir);
    expect(result).toEqual([path.join(dir, "audio", "index.ts"), path.join(dir, "score.ts")]);
  });
});

describe("generateLocalModulesModule()", () => {
  it("returns empty export when no files", () => {
    expect(generateLocalModulesModule([], "/project/src/modules")).toBe(
      "export const modules = [];\n",
    );
  });

  it("generates an import with inferred name injection for a flat file", () => {
    const src = generateLocalModulesModule(
      ["/project/src/modules/score.ts"],
      "/project/src/modules",
    );
    expect(src).toContain("import _m0 from '/project/src/modules/score.ts'");
    expect(src).toContain("{ ..._m0, meta: { name: 'local:score', ..._m0.meta } }");
    expect(src).toContain("export const modules =");
  });

  it("generates imports for multiple files", () => {
    const src = generateLocalModulesModule(
      ["/project/src/modules/score.ts", "/project/src/modules/hud.ts"],
      "/project/src/modules",
    );
    expect(src).toContain("import _m0 from '/project/src/modules/score.ts'");
    expect(src).toContain("import _m1 from '/project/src/modules/hud.ts'");
    expect(src).toContain("{ ..._m0, meta: { name: 'local:score', ..._m0.meta } }");
    expect(src).toContain("{ ..._m1, meta: { name: 'local:hud', ..._m1.meta } }");
  });

  it("generated source allows declared meta.name to override inferred name", () => {
    const src = generateLocalModulesModule(
      ["/project/src/modules/score.ts"],
      "/project/src/modules",
    );
    const nameIdx = src.indexOf("name: 'local:score'");
    const spreadIdx = src.indexOf("..._m0.meta");
    expect(nameIdx).toBeGreaterThan(-1);
    expect(spreadIdx).toBeGreaterThan(nameIdx);
  });
});
