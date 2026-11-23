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
  it("loads a scoped package from its ./module string export", async () => {
    const seen = loadConfig(["@scope/mod-string"], (root) => {
      installModule(
        root,
        "@scope/mod-string",
        { exports: { "./module": "./str.mjs" } },
        { "str.mjs": moduleSource("scoped-string") },
      );
    });
    await expect(seen).resolves.toEqual(["scoped-string"]);
  });

  it("loads the default condition of ./module when import is absent", async () => {
    const seen = loadConfig(["mod-default"], (root) => {
      installModule(
        root,
        "mod-default",
        { exports: { "./module": { default: "./dflt.mjs" } } },
        { "dflt.mjs": moduleSource("default-condition") },
      );
    });
    await expect(seen).resolves.toEqual(["default-condition"]);
  });

  it("rejects with the module-entry code when the package only declares main", async () => {
    const name = "mod-main-only";
    const pending = loadConfig([name], (root) => {
      installModule(
        root,
        name,
        { main: "./lib.mjs" },
        { "lib.mjs": moduleSource("main-entry"), "index.js": moduleSource("index-entry") },
      );
    });
    await expect(pending).rejects.toMatchObject({ code: "APP:MODULE_ENTRY_MISSING" });
    await expect(pending).rejects.toThrow(name);
    await expect(pending).rejects.toThrow("./module");
  });

  it("rejects with the module-entry code when package.json is a JSON primitive", async () => {
    const name = "mod-primitive-json";
    const pending = loadConfig([name], (root) => {
      installModule(root, name, {}, { "index.js": moduleSource("index-entry") });
      const manifest = path.join(root, "node_modules", name, "package.json");
      fs.writeFileSync(manifest, JSON.stringify("not an object"));
    });
    await expect(pending).rejects.toMatchObject({ code: "APP:MODULE_ENTRY_MISSING" });
    await expect(pending).rejects.toThrow(name);
  });

  it("rejects with the module-entry code and the package name when the package has no ./module export", async () => {
    const name = "mod-no-subpath";
    const pending = loadConfig([name], (root) => {
      installModule(
        root,
        name,
        { exports: { ".": "./index.js" } },
        { "index.js": moduleSource("dot-entry") },
      );
    });
    await expect(pending).rejects.toMatchObject({ code: "APP:MODULE_ENTRY_MISSING" });
    await expect(pending).rejects.toThrow(name);
    await expect(pending).rejects.toThrow("./module");
  });

  it('loads a package from its ./module entry, not from "."', async () => {
    const seen = loadConfig(["mod-split"], (root) => {
      installModule(
        root,
        "mod-split",
        { exports: { ".": "./boom.mjs", "./module": "./ok.mjs" } },
        {
          "boom.mjs": `throw new Error("dot-entry");\n`,
          "ok.mjs": moduleSource("from-module"),
        },
      );
    });
    await expect(seen).resolves.toEqual(["from-module"]);
  });

  it("picks the import condition of ./module before default", async () => {
    const seen = loadConfig(["mod-import-first"], (root) => {
      installModule(
        root,
        "mod-import-first",
        { exports: { "./module": { import: "./esm.mjs", default: "./dflt.mjs" } } },
        {
          "esm.mjs": moduleSource("import-condition"),
          "dflt.mjs": moduleSource("default-condition"),
        },
      );
    });
    await expect(seen).resolves.toEqual(["import-condition"]);
  });

  it("accepts ./module given as a plain string", async () => {
    const seen = loadConfig(["mod-plain"], (root) => {
      installModule(
        root,
        "mod-plain",
        { exports: { "./module": "./m.mjs" } },
        { "m.mjs": moduleSource("plain-string") },
      );
    });
    await expect(seen).resolves.toEqual(["plain-string"]);
  });

  it("rejects with the module-entry code when ./module has only types and require conditions", async () => {
    const name = "mod-require-only";
    const pending = loadConfig([name], (root) => {
      installModule(
        root,
        name,
        { exports: { "./module": { types: "./mod.d.ts", require: "./mod.cjs" } } },
        { "mod.cjs": "module.exports = {};\n", "mod.d.ts": "export {};\n" },
      );
    });
    await expect(pending).rejects.toMatchObject({ code: "APP:MODULE_ENTRY_MISSING" });
    await expect(pending).rejects.toThrow(name);
    await expect(pending).rejects.toThrow("./module");
  });
});
