import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const conformanceDir = join(repoRoot, "packages", "plugin-conformance");

const wasmMagic = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

function childEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("GIT_")) delete env[key];
  }
  return env;
}

/**
 * The pins of the real snapshot-known-findings.json for one package.
 * @param {string} name
 * @returns {Record<string, string[]>}
 */
function realPins(name) {
  const all = JSON.parse(
    readFileSync(join(repoRoot, "scripts", "snapshot-known-findings.json"), "utf8"),
  );
  return { [name]: all[name] };
}

/**
 * Run the real script on a fixture root that holds one package, with its own pin file.
 * @param {{ name?: string, wasmFile: boolean, factory?: boolean, glue?: boolean, values?: string[], pins?: Record<string, string[]> }} options
 */
function runScript(options) {
  const root = mkdtempSync(join(tmpdir(), "public-api-types-"));
  try {
    const pkgDir = join(root, "packages", "demo");
    mkdirSync(join(pkgDir, "dist"), { recursive: true });
    const values = options.values ?? ["a"];
    writeFileSync(
      join(pkgDir, "dist", "index.d.ts"),
      values.map((name) => `export const ${name} = 1;\n`).join(""),
    );

    /** @type {Record<string, string | { types: string, import?: string }>} */
    const exportsField = {
      ".": { types: "./dist/index.d.ts" },
    };
    /** @type {Record<string, { values: string[], types: string[] }>} */
    const snap = {
      ".": { values: [...values].sort(), types: [] },
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
      `${JSON.stringify({ name: options.name ?? "@gwenjs/demo", exports: exportsField }, null, 2)}\n`,
    );
    writeFileSync(join(pkgDir, "public-api.snap.json"), `${JSON.stringify(snap, null, 2)}\n`);

    const knownFile = join(root, "known-findings.json");
    writeFileSync(knownFile, `${JSON.stringify(options.pins ?? {}, null, 2)}\n`);

    const result = spawnSync(
      process.execPath,
      [join(repoRoot, "scripts", "public-api-types.mjs"), "--root", root, "--known", knownFile],
      { cwd: root, env: childEnv(), encoding: "utf8" },
    );
    return { status: result.status, stderr: `${result.stderr ?? ""}` };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// The script reads the built plugin-conformance. Agent hygiene runs node --test without
// pnpm install or a build (.github/workflows/ci.yml:945); the api-surface job runs this file after the build.
const skipWithoutBuild = (() => {
  if (!existsSync(join(conformanceDir, "dist", "index.js"))) {
    return "packages/plugin-conformance is not built: the api-surface job runs this test after pnpm build:ts";
  }
  try {
    createRequire(join(conformanceDir, "package.json")).resolve("typescript");
    return false;
  } catch {
    return "typescript is not installed: the Agent hygiene job runs node --test without pnpm install; the api-surface job runs this test";
  }
})();

test("the script skips a .wasm subpath whose file exists", { skip: skipWithoutBuild }, () => {
  const result = runScript({ wasmFile: true });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
});

test(
  "the script does not report a missing .wasm file as missing built types",
  { skip: skipWithoutBuild },
  () => {
    const result = runScript({ wasmFile: false });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr.includes("is not built"), false, result.stderr);
  },
);

test(
  "the script still compares a .d.ts subpath while it skips the .wasm one",
  { skip: skipWithoutBuild },
  () => {
    const result = runScript({ wasmFile: true, factory: true });
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.stderr.includes("./wasm/light/factory"), true, result.stderr);
    assert.equal(result.stderr.includes('exports type "Glue"'), true, result.stderr);
  },
);

test(
  "the script still compares the . and ./wasm/light subpaths while it skips the .wasm one",
  { skip: skipWithoutBuild },
  () => {
    const result = runScript({ wasmFile: true, glue: true });
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.stderr.includes('lists type "Ghost" for subpath "."'), true, result.stderr);
    assert.equal(
      result.stderr.includes('subpath "./wasm/light" exports type "Core"'),
      true,
      result.stderr,
    );
  },
);

test("the script fails on a finding that is not pinned", { skip: skipWithoutBuild }, () => {
  const result = runScript({
    name: "@gwenjs/kit",
    wasmFile: true,
    values: ["_engineSlot", "_setCurrentScope", "_extra"],
    pins: realPins("@gwenjs/kit"),
  });
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.stderr.includes('value "_extra"'), true, result.stderr);
});

test(
  "the script fails when a pinned finding is no longer reported",
  { skip: skipWithoutBuild },
  () => {
    const result = runScript({
      name: "@gwenjs/kit",
      wasmFile: true,
      values: ["_engineSlot"],
      pins: realPins("@gwenjs/kit"),
    });
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.stderr.includes("known finding no longer reported"), true, result.stderr);
    assert.equal(result.stderr.includes("_setCurrentScope"), true, result.stderr);
  },
);

test(
  "the script fails when known findings name a package that is not scanned",
  { skip: skipWithoutBuild },
  () => {
    const result = runScript({ wasmFile: true, pins: { "@gwenjs/kitt": ["CONFORMANCE:X y"] } });
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.stderr.includes("@gwenjs/kitt"), true, result.stderr);
    assert.equal(
      result.stderr.includes("known findings name no scanned package"),
      true,
      result.stderr,
    );
  },
);
