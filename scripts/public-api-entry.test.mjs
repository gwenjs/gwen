import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const mod = await import("./public-api-entry.mjs").catch(() => ({}));

const wasmMagic = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

function childEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("GIT_")) delete env[key];
  }
  return env;
}

/**
 * The script's root is the parent of its own directory.
 * @param {{ wasmFile: boolean, factory?: boolean, writeSource?: boolean, glue?: boolean }} options
 */
function runTypes(options) {
  const root = mkdtempSync(join(tmpdir(), "public-api-types-"));
  try {
    const scriptsDir = join(root, "scripts");
    const pkgDir = join(root, "packages", "demo");
    mkdirSync(scriptsDir, { recursive: true });
    mkdirSync(join(pkgDir, "dist"), { recursive: true });
    copyFileSync(
      join(repoRoot, "scripts", "public-api-types.mjs"),
      join(scriptsDir, "public-api-types.mjs"),
    );
    const entrySrc = join(repoRoot, "scripts", "public-api-entry.mjs");
    if (existsSync(entrySrc)) copyFileSync(entrySrc, join(scriptsDir, "public-api-entry.mjs"));
    symlinkSync(join(repoRoot, "node_modules"), join(root, "node_modules"), "junction");
    writeFileSync(
      join(root, "tsconfig.base.json"),
      `${JSON.stringify(
        {
          compilerOptions: {
            module: "esnext",
            target: "es2022",
            moduleResolution: "bundler",
          },
        },
        null,
        2,
      )}\n`,
    );
    writeFileSync(join(pkgDir, "dist", "index.d.ts"), "export const a = 1;\n");
    if (options.writeSource) {
      mkdirSync(join(pkgDir, "src"), { recursive: true });
      writeFileSync(join(pkgDir, "src", "index.ts"), "export const a = 1;\n");
    }

    /** @type {Record<string, string | { types: string, import?: string }>} */
    const exportsField = {
      ".": { types: "./dist/index.d.ts" },
    };
    /** @type {Record<string, { values: string[], types: string[] }>} */
    const snap = {
      ".": { values: ["a"], types: options.writeSource ? ["Stale"] : [] },
    };
    if (options.glue) {
      mkdirSync(join(pkgDir, "wasm", "light"), { recursive: true });
      writeFileSync(
        join(pkgDir, "wasm", "light", "gwen_core.d.ts"),
        "export type Core = { ok: boolean };\n",
      );
      exportsField["./wasm/light"] = { types: "./wasm/light/gwen_core.d.ts" };
      snap["./wasm/light"] = { values: [], types: [] };
      snap["."] = { values: ["a"], types: ["Ghost"] };
    }
    if (options.factory) {
      mkdirSync(join(pkgDir, "wasm", "light"), { recursive: true });
      writeFileSync(
        join(pkgDir, "wasm", "light", "gwen_core_factory.d.ts"),
        "export type Glue = { ok: boolean };\n",
      );
      exportsField["./wasm/light/factory"] = {
        types: "./wasm/light/gwen_core_factory.d.ts",
        import: "./wasm/light/gwen_core_factory.js",
      };
      snap["./wasm/light/factory"] = { values: [], types: [] };
    }
    exportsField["./wasm/light.wasm"] = "./wasm/light/gwen_core_bg.wasm";
    if (options.wasmFile) {
      mkdirSync(join(pkgDir, "wasm", "light"), { recursive: true });
      writeFileSync(join(pkgDir, "wasm", "light", "gwen_core_bg.wasm"), wasmMagic);
    }
    writeFileSync(
      join(pkgDir, "package.json"),
      `${JSON.stringify({ name: "@gwenjs/demo", exports: exportsField }, null, 2)}\n`,
    );
    writeFileSync(join(pkgDir, "public-api.snap.json"), `${JSON.stringify(snap, null, 2)}\n`);

    const args = [join(scriptsDir, "public-api-types.mjs")];
    if (options.writeSource) args.push("--write-source");
    const result = spawnSync(process.execPath, args, {
      cwd: root,
      env: childEnv(),
      encoding: "utf8",
    });
    const snapshot = readFileSync(join(pkgDir, "public-api.snap.json"), "utf8");
    return { status: result.status, stderr: `${result.stderr ?? ""}`, snapshot };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("a .wasm export target is not a module entry", () => {
  assert.equal(typeof mod.isModuleEntry, "function");
  assert.equal(mod.isModuleEntry("./wasm/light/gwen_core_bg.wasm"), false);
  assert.equal(mod.isModuleEntry("./wasm/physics2d/gwen_core_bg.wasm"), false);
  assert.equal(mod.isModuleEntry("./wasm/physics3d/gwen_core_bg.wasm"), false);
  assert.equal(mod.isModuleEntry(""), false);
  assert.equal(mod.isModuleEntry("./wasm/light/gwen_core_bg"), false);
});

test("d.ts, ts and js targets are module entries", () => {
  assert.equal(typeof mod.isModuleEntry, "function");
  assert.equal(mod.isModuleEntry("./dist/index.d.ts"), true);
  assert.equal(mod.isModuleEntry("./wasm/light/gwen_core_factory.d.ts"), true);
  assert.equal(mod.isModuleEntry("./dist/index.d.mts"), true);
  assert.equal(mod.isModuleEntry("./src/node.ts"), true);
  assert.equal(mod.isModuleEntry("./src/view.tsx"), true);
  assert.equal(mod.isModuleEntry("./dist/index.js"), true);
  assert.equal(mod.isModuleEntry("./dist/index.mjs"), true);
});

test("a json target is not a module entry", () => {
  assert.equal(typeof mod.isModuleEntry, "function");
  assert.equal(mod.isModuleEntry("./package.json"), false);
  assert.equal(mod.isModuleEntry("./styles.css"), false);
  assert.equal(mod.isModuleEntry("./dist/index.cjs"), false);
  assert.equal(mod.isModuleEntry("./dist/index.d.ts.map"), false);
});

test("the script skips a .wasm subpath whose file exists", () => {
  const result = runTypes({ wasmFile: true });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr.includes("Missing source file"), false, result.stderr);
});

test("the script does not report a missing .wasm file as missing built types", () => {
  const result = runTypes({ wasmFile: false });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr.includes("missing built types"), false, result.stderr);
});

test("the script still compares a .d.ts subpath while it skips the .wasm one", () => {
  const result = runTypes({ wasmFile: true, factory: true });
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.stderr.includes("types differ"), true, result.stderr);
  assert.equal(result.stderr.includes("./wasm/light/factory"), true, result.stderr);
  assert.equal(result.stderr.includes("Missing source file"), false, result.stderr);
});

test("the script still compares the . and ./wasm/light subpaths while it skips the .wasm one", () => {
  const result = runTypes({ wasmFile: true, glue: true });
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.stderr.includes("@gwenjs/demo . types differ"), true, result.stderr);
  assert.equal(result.stderr.includes("./wasm/light types differ"), true, result.stderr);
  assert.equal(result.stderr.includes("Missing source file"), false, result.stderr);
});

test("the script skips a .wasm subpath in --write-source mode and writes no snapshot key for it", () => {
  const result = runTypes({ wasmFile: true, writeSource: true });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr.includes("Missing source file"), false, result.stderr);
  assert.equal(result.stderr.includes("No source for"), false, result.stderr);
  const written = JSON.parse(result.snapshot);
  assert.equal(Object.hasOwn(written, "./wasm/light.wasm"), false);
  assert.equal(Object.hasOwn(written, "."), true);
  assert.deepEqual(written["."].types, []);
});
