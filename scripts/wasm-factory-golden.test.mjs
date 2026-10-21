import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = join(repoRoot, "scripts/fixtures/wasm-factory-golden");
const scriptPath = join(repoRoot, "scripts/wasm-factory-golden.mjs");
const goldenRel = join("scripts", "wasm-factory.golden.json");

const FIXTURE_WASM_BINDGEN = "0.2.200";
const MUTATED_WASM_BINDGEN = "0.2.201";
const VERSION_DIFF = `[glue-shape] Cargo.lock wasm-bindgen ${MUTATED_WASM_BINDGEN} != golden ${FIXTURE_WASM_BINDGEN}: rebuild with scripts/build-wasm.sh and run --write`;

/**
 * @param {string} rootDir
 * @param {string[]} args
 * @param {string} [binDir]
 */
function runGolden(rootDir, args, binDir) {
  /** @type {NodeJS.ProcessEnv} */
  const env = { ...process.env };
  if (binDir) env.PATH = `${binDir}${delimiter}${env.PATH ?? ""}`;
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: rootDir,
    encoding: "utf8",
    env,
  });
}

/**
 * @returns {string}
 */
function copyFixture() {
  const dir = mkdtempSync(join(tmpdir(), "glue-shape-"));
  cpSync(fixtureRoot, dir, { recursive: true });
  return dir;
}

/**
 * @param {string} rustLine
 * @param {string} packLine
 * @returns {string}
 */
function writeShims(rustLine, packLine) {
  const dir = mkdtempSync(join(tmpdir(), "glue-shape-bin-"));
  writeFileSync(join(dir, "rustc"), `#!/bin/sh\nprintf '%s\\n' ${JSON.stringify(rustLine)}\n`);
  writeFileSync(join(dir, "wasm-pack"), `#!/bin/sh\nprintf '%s\\n' ${JSON.stringify(packLine)}\n`);
  chmodSync(join(dir, "rustc"), 0o755);
  chmodSync(join(dir, "wasm-pack"), 0o755);
  return dir;
}

/**
 * @returns {{ rust: string, wasmPack: string }}
 */
function fixturePins() {
  const parsed = JSON.parse(readFileSync(join(fixtureRoot, "wasm-size.json"), "utf8"));
  const toolchain = parsed.toolchain;
  return { rust: String(toolchain.rust), wasmPack: String(toolchain.wasmPack) };
}

/**
 * @param {string} source
 * @param {string} field
 * @param {string[]} values
 */
function replaceContractField(source, field, values) {
  const pattern = new RegExp(`"${field}":\\[[^\\]]*\\]`);
  const next = source.replace(pattern, `"${field}":${JSON.stringify(values)}`);
  assert.notEqual(next, source, `fixture CONTRACT has no ${field}`);
  return next;
}

test("a changed wasm-bindgen version fails", () => {
  const dir = copyFixture();
  try {
    const lockPath = join(dir, "Cargo.lock");
    const lock = readFileSync(lockPath, "utf8");
    const needle = `name = "wasm-bindgen"\nversion = "${FIXTURE_WASM_BINDGEN}"`;
    assert.equal(lock.includes(needle), true);
    assert.equal(lock.indexOf('name = "wasm-bindgen-macro"') < lock.indexOf(needle), true);
    writeFileSync(
      lockPath,
      lock.replace(needle, `name = "wasm-bindgen"\nversion = "${MUTATED_WASM_BINDGEN}"`),
    );
    const result = runGolden(dir, ["--check", "--root", dir]);
    assert.equal(result.status, 1);
    assert.equal(result.stderr.includes(VERSION_DIFF), true, result.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a renamed export fails and names it", () => {
  const dir = copyFixture();
  try {
    const factoryPath = join(dir, "packages/core/wasm/light/gwen_core_factory.js");
    writeFileSync(
      factoryPath,
      replaceContractField(readFileSync(factoryPath, "utf8"), "names", ["NewName"]),
    );
    const goldenPath = join(dir, goldenRel);
    const golden = JSON.parse(readFileSync(goldenPath, "utf8"));
    golden.variants.light.names = ["OldName"];
    writeFileSync(goldenPath, `${JSON.stringify(golden, null, 2)}\n`);
    const result = runGolden(dir, ["--check", "--root", dir]);
    assert.equal(result.status, 1);
    assert.equal(
      result.stderr.includes("light.names differs: +[NewName] -[OldName]"),
      true,
      result.stderr,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a changed rawExports or imports entry fails and names the field", () => {
  const dir = copyFixture();
  try {
    const factoryPath = join(dir, "packages/core/wasm/light/gwen_core_factory.js");
    let source = readFileSync(factoryPath, "utf8");
    source = replaceContractField(source, "rawExports", ["engine_renamed"]);
    source = replaceContractField(source, "imports", ["__wbindgen_other"]);
    writeFileSync(factoryPath, source);
    const result = runGolden(dir, ["--check", "--root", dir]);
    assert.equal(result.status, 1);
    assert.equal(
      result.stderr.includes("light.rawExports differs: +[engine_renamed] -[engine_new]"),
      true,
      result.stderr,
    );
    assert.equal(
      result.stderr.includes("light.imports differs: +[__wbindgen_other] -[__wbindgen_throw]"),
      true,
      result.stderr,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a matching contract passes", () => {
  const dir = copyFixture();
  try {
    const result = runGolden(dir, ["--check", "--root", dir]);
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    assert.equal(result.stdout.includes("[glue-shape] ok"), true, result.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a missing factory file fails naming the path", () => {
  const dir = copyFixture();
  try {
    const rel = "packages/core/wasm/physics2d/gwen_core_factory.js";
    rmSync(join(dir, rel));
    const result = runGolden(dir, ["--check", "--root", dir]);
    assert.equal(result.status, 1);
    assert.equal(
      result.stderr.includes(`[glue-shape] ${rel} missing: run scripts/build-wasm.sh`),
      true,
      result.stderr,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--write refuses another toolchain and writes nothing", () => {
  const dir = copyFixture();
  const pins = fixturePins();
  const bin = writeShims("rustc 1.98.0 (x 2026-01-01)", `wasm-pack ${pins.wasmPack}`);
  try {
    const goldenPath = join(dir, goldenRel);
    const stamped = '{"wasmBindgen":"do-not-touch"}\n';
    writeFileSync(goldenPath, stamped);
    const result = runGolden(dir, ["--write", "--root", dir], bin);
    const message = `[glue-shape] --write needs rustc ${pins.rust} and wasm-pack ${pins.wasmPack} (found rustc 1.98.0, wasm-pack ${pins.wasmPack}): the golden is generated with the pinned toolchain, never by hand`;
    assert.equal(result.status, 1);
    assert.equal(result.stderr.includes(message), true, result.stderr);
    assert.equal(readFileSync(goldenPath, "utf8"), stamped);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(bin, { recursive: true, force: true });
  }
});

test("--write refuses a wasm-pack that differs from the pin", () => {
  const dir = copyFixture();
  const pins = fixturePins();
  const foundPack = "9.9.9";
  const bin = writeShims(`rustc ${pins.rust} (x 2026-01-01)`, `wasm-pack ${foundPack}`);
  try {
    const goldenPath = join(dir, goldenRel);
    const stamped = '{"wasmBindgen":"do-not-touch"}\n';
    writeFileSync(goldenPath, stamped);
    const result = runGolden(dir, ["--write", "--root", dir], bin);
    const message = `[glue-shape] --write needs rustc ${pins.rust} and wasm-pack ${pins.wasmPack} (found rustc ${pins.rust}, wasm-pack ${foundPack}): the golden is generated with the pinned toolchain, never by hand`;
    assert.equal(result.status, 1);
    assert.equal(result.stderr, `${message}\n`);
    assert.equal(readFileSync(goldenPath, "utf8"), stamped);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(bin, { recursive: true, force: true });
  }
});

test("--write on the pinned toolchain writes a golden that --check accepts", () => {
  const dir = copyFixture();
  const pins = fixturePins();
  const bin = writeShims(`rustc ${pins.rust} (x 2026-01-01)`, `wasm-pack ${pins.wasmPack}`);
  try {
    const expected = readFileSync(join(fixtureRoot, goldenRel), "utf8");
    const goldenPath = join(dir, goldenRel);
    writeFileSync(goldenPath, "{}\n");
    const wrote = runGolden(dir, ["--write", "--root", dir], bin);
    assert.equal(wrote.status, 0, `${wrote.stdout}${wrote.stderr}`);
    const written = readFileSync(goldenPath, "utf8");
    assert.equal(JSON.parse(written).wasmBindgen, FIXTURE_WASM_BINDGEN);
    assert.equal(written, expected);
    const checked = runGolden(dir, ["--check", "--root", dir], bin);
    assert.equal(checked.status, 0, `${checked.stdout}${checked.stderr}`);
    assert.equal(checked.stdout.includes("[glue-shape] ok"), true, checked.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(bin, { recursive: true, force: true });
  }
});
