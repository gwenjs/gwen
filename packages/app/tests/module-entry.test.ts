/**
 * @file Default loader and `@gwenjs/app/resolve` entry for `<pkg>/module`.
 *
 * Real packages live under a temp `node_modules`. The directory is removed
 * in `finally`. No loader is passed, so `GwenApp.setupModules` uses its default.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GwenError } from "@gwenjs/schema";
import { GwenApp } from "../src/app";
import { resolveLoadedConfig } from "../src/config";
import * as resolveEntry from "../src/resolve";

const SEEN_KEY = "__gwenAppModuleEntrySeen";

function moduleSource(label: string): string {
  return [
    "export default {",
    `  meta: { name: ${JSON.stringify(label)} },`,
    `  setup() { globalThis[${JSON.stringify(SEEN_KEY)}].push(${JSON.stringify(label)}); },`,
    "};",
    "",
  ].join("\n");
}

function installPackage(
  root: string,
  name: string,
  manifest: Record<string, unknown>,
  files: Record<string, string>,
): void {
  const dir = join(root, "node_modules", ...name.split("/"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name, version: "1.0.0", type: "module", ...manifest }),
  );
  for (const [file, source] of Object.entries(files)) {
    writeFileSync(join(dir, file), source);
  }
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, SEEN_KEY);
});

describe("@gwenjs/app/resolve entry", () => {
  it("exports resolveModuleEntry as a function", () => {
    expect(typeof Reflect.get(resolveEntry, "resolveModuleEntry")).toBe("function");
  });
});

describe("GwenApp default module loader", () => {
  it('loads a package from its ./module entry, not from "."', async () => {
    const root = mkdtempSync(join(tmpdir(), "gwen-app-entry-"));
    const seen: string[] = [];
    Reflect.set(globalThis, SEEN_KEY, seen);
    try {
      installPackage(
        root,
        "mod-split",
        { exports: { ".": "./index.js", "./module": "./mod.js" } },
        {
          "index.js": `throw new Error("dot-entry");\n`,
          "mod.js": moduleSource("from-module"),
        },
      );
      const config = resolveLoadedConfig({ modules: ["mod-split"], localModulesDir: false });
      await expect(
        new GwenApp().setupModules(config, undefined, { root }),
      ).resolves.toBeUndefined();
      expect(seen).toEqual(["from-module"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects with the module-entry code and the package name when the package has no ./module export", async () => {
    const root = mkdtempSync(join(tmpdir(), "gwen-app-entry-"));
    const name = "mod-dot-only";
    try {
      installPackage(
        root,
        name,
        { exports: { ".": "./index.js" } },
        { "index.js": moduleSource("dot-only") },
      );
      const config = resolveLoadedConfig({ modules: [name], localModulesDir: false });
      const pending = new GwenApp().setupModules(config, undefined, { root });
      await expect(pending).rejects.toMatchObject({ code: "APP:MODULE_ENTRY_MISSING" });
      await expect(pending).rejects.toThrow(name);
      await expect(pending).rejects.toThrow("./module");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a malformed package.json loads with the load code and no install hint", async () => {
    const root = mkdtempSync(join(tmpdir(), "gwen-app-entry-"));
    const name = "mod-bad-json";
    try {
      const dir = join(root, "node_modules", name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "package.json"), "{");
      const config = resolveLoadedConfig({ modules: [name], localModulesDir: false });
      const caught: unknown = await new GwenApp()
        .setupModules(config, undefined, { root })
        .catch((error: unknown) => error);
      expect(caught).toBeInstanceOf(GwenError);
      if (!(caught instanceof GwenError)) return;
      expect(caught.code).toBe("APP:MODULE_LOAD_FAILED");
      expect(caught.message).toContain("JSON");
      expect(caught.hint).toBeUndefined();
      expect(caught.message.includes("gwen add")).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
