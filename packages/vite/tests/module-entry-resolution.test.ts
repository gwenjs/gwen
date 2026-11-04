/**
 * Tests @gwenjs/vite
 * Verifies how the `config` hook resolves the entry file of a module listed in
 * `gwen.config.ts → modules` from the project's `node_modules`.
 */

import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import type { ConfigEnv, UserConfig } from "vite";
import { gwen } from "../src/index";

type ConfigHook = (config: UserConfig, env: ConfigEnv) => Promise<UserConfig | null | void>;

const SEEN_KEY = "__gwenViteModuleEntrySeen";

function moduleSource(label: string): string {
  return [
    `export default {`,
    `  meta: { name: ${JSON.stringify(label)} },`,
    `  setup() { globalThis[${JSON.stringify(SEEN_KEY)}].push(${JSON.stringify(label)}); },`,
    `};`,
    ``,
  ].join("\n");
}

/** Install `name` in `<root>/node_modules` with the given package.json fields and files. */
function installModule(
  root: string,
  name: string,
  manifest: Record<string, unknown>,
  files: Record<string, string>,
): void {
  const dir = path.join(root, "node_modules", ...name.split("/"));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name, version: "1.0.0", type: "module", ...manifest }),
  );
  for (const [file, source] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, file), source);
  }
}

async function loadConfig(modules: string[], setup: (root: string) => void): Promise<string[]> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gwen-vite-entry-"));
  const seen: string[] = [];
  Reflect.set(globalThis, SEEN_KEY, seen);
  try {
    fs.writeFileSync(
      path.join(root, "gwen.config.ts"),
      `export default { modules: ${JSON.stringify(modules)} };\n`,
    );
    setup(root);
    const plugin = gwen({ watch: false })[0];
    if (!plugin) throw new Error("gwen() returned no plugin");
    const hook = plugin.config;
    if (typeof hook !== "function") throw new Error("config hook missing");
    await (hook as ConfigHook)({ root }, { command: "serve", mode: "development" });
    return seen;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, SEEN_KEY);
});

describe("gwen() config hook — module entry resolution", () => {
  it("falls back to main when the exports conditions of '.' are nested objects", async () => {
    const seen = loadConfig(["mod-nested"], (root) => {
      installModule(
        root,
        "mod-nested",
        { exports: { ".": { import: { default: "x.js" } } }, main: "./lib.mjs" },
        { "lib.mjs": moduleSource("main-entry") },
      );
    });
    await expect(seen).resolves.toEqual(["main-entry"]);
  });

  it("falls back to index.js when main is not a string", async () => {
    const seen = loadConfig(["mod-numeric-main"], (root) => {
      installModule(
        root,
        "mod-numeric-main",
        { main: 5 },
        { "index.js": moduleSource("index-entry") },
      );
    });
    await expect(seen).resolves.toEqual(["index-entry"]);
  });

  it("falls back to index.js when exports has no string entry and there is no main", async () => {
    const seen = loadConfig(["mod-nested-no-main"], (root) => {
      installModule(
        root,
        "mod-nested-no-main",
        { exports: { ".": { import: { default: "x.js" } } } },
        { "index.js": moduleSource("index-entry") },
      );
    });
    await expect(seen).resolves.toEqual(["index-entry"]);
  });

  it("resolves the entry of every documented package.json shape", async () => {
    const seen = await loadConfig(
      [
        "mod-import",
        "mod-default",
        "@scope/mod-string",
        "mod-dot-string",
        "mod-main",
        "mod-index",
        "mod-subpath-only",
      ],
      (root) => {
        installModule(
          root,
          "mod-import",
          {
            exports: { ".": { import: "./esm.mjs", default: "./dflt.mjs", require: "./cjs.cjs" } },
          },
          { "esm.mjs": moduleSource("import-before-default"), "dflt.mjs": moduleSource("wrong") },
        );
        installModule(
          root,
          "mod-default",
          { exports: { ".": { default: "./dflt.mjs" } } },
          { "dflt.mjs": moduleSource("default-without-import") },
        );
        installModule(
          root,
          "@scope/mod-string",
          { exports: "./str.mjs" },
          { "str.mjs": moduleSource("string-exports-scoped") },
        );
        installModule(
          root,
          "mod-dot-string",
          { exports: { ".": "./dot.mjs" } },
          { "dot.mjs": moduleSource("dot-string") },
        );
        installModule(
          root,
          "mod-main",
          { main: "./lib.mjs" },
          { "lib.mjs": moduleSource("main-without-exports") },
        );
        installModule(root, "mod-index", {}, { "index.js": moduleSource("index-by-default") });
        installModule(
          root,
          "mod-subpath-only",
          { exports: { "./extra": "./extra.mjs" }, main: "./lib.mjs" },
          { "lib.mjs": moduleSource("main-without-dot"), "extra.mjs": moduleSource("wrong") },
        );
      },
    );
    expect([...seen].sort()).toEqual(
      [
        "import-before-default",
        "default-without-import",
        "string-exports-scoped",
        "dot-string",
        "main-without-exports",
        "index-by-default",
        "main-without-dot",
      ].sort(),
    );
  });

  it("falls back to index.js when package.json holds a JSON primitive", async () => {
    const seen = loadConfig(["mod-primitive-json"], (root) => {
      installModule(root, "mod-primitive-json", {}, { "index.js": moduleSource("index-entry") });
      const manifest = path.join(root, "node_modules", "mod-primitive-json", "package.json");
      fs.writeFileSync(manifest, JSON.stringify("not an object"));
    });
    await expect(seen).resolves.toEqual(["index-entry"]);
  });
});
