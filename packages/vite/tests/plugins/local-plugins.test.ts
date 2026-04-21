import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import {
  scanLocalPluginFiles,
  generateLocalPluginsModule,
} from "../../src/plugins/local-plugins.js";

function makeTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "gwen-local-plugins-test-"));
}

describe("scanLocalPluginFiles()", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTmp();
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true });
  });

  it("returns empty array when directory does not exist", () => {
    expect(scanLocalPluginFiles(path.join(tmp, "nonexistent"))).toEqual([]);
  });

  it("returns empty array for an empty directory", () => {
    fs.mkdirSync(path.join(tmp, "plugins"));
    expect(scanLocalPluginFiles(path.join(tmp, "plugins"))).toEqual([]);
  });

  it("returns .ts files in the directory", () => {
    const dir = path.join(tmp, "plugins");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "audio.ts"), "");
    fs.writeFileSync(path.join(dir, "input.ts"), "");
    const result = scanLocalPluginFiles(dir);
    expect(result).toHaveLength(2);
    expect(result).toContain(path.join(dir, "audio.ts"));
    expect(result).toContain(path.join(dir, "input.ts"));
  });

  it("excludes test files", () => {
    const dir = path.join(tmp, "plugins");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "audio.ts"), "");
    fs.writeFileSync(path.join(dir, "audio.test.ts"), "");
    const result = scanLocalPluginFiles(dir);
    expect(result).toEqual([path.join(dir, "audio.ts")]);
  });

  it("excludes .d.ts declaration files", () => {
    const dir = path.join(tmp, "plugins");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "audio.ts"), "");
    fs.writeFileSync(path.join(dir, "audio.d.ts"), "");
    const result = scanLocalPluginFiles(dir);
    expect(result).toEqual([path.join(dir, "audio.ts")]);
  });

  it("does NOT recurse into subdirectories (flat scan only)", () => {
    const dir = path.join(tmp, "plugins");
    fs.mkdirSync(dir);
    fs.mkdirSync(path.join(dir, "nested"));
    fs.writeFileSync(path.join(dir, "audio.ts"), "");
    fs.writeFileSync(path.join(dir, "nested", "deep.ts"), "");
    const result = scanLocalPluginFiles(dir);
    expect(result).toEqual([path.join(dir, "audio.ts")]);
  });

  it("returns files in alphabetical order", () => {
    const dir = path.join(tmp, "plugins");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "zebra.ts"), "");
    fs.writeFileSync(path.join(dir, "audio.ts"), "");
    const result = scanLocalPluginFiles(dir);
    expect(result).toEqual([path.join(dir, "audio.ts"), path.join(dir, "zebra.ts")]);
  });
});

describe("generateLocalPluginsModule()", () => {
  it("returns empty export when no files", () => {
    expect(generateLocalPluginsModule([])).toBe("export const plugins = [];\n");
  });

  it("generates an import and entry for each file", () => {
    const src = generateLocalPluginsModule(["/project/src/plugins/audio.ts"]);
    expect(src).toContain("import _p0 from '/project/src/plugins/audio.ts'");
    expect(src).toContain("export const plugins = [_p0]");
  });

  it("generates imports and entries for multiple files", () => {
    const src = generateLocalPluginsModule([
      "/project/src/plugins/audio.ts",
      "/project/src/plugins/input.ts",
    ]);
    expect(src).toContain("import _p0 from '/project/src/plugins/audio.ts'");
    expect(src).toContain("import _p1 from '/project/src/plugins/input.ts'");
    expect(src).toContain("export const plugins = [_p0, _p1]");
  });
});
