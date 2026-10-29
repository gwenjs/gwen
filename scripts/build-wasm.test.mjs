import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(root, "scripts/build-wasm.sh");
const wasmRoot = join(root, "packages/core/wasm");
const VARIANTS = ["light", "physics2d", "physics3d"];
const FEATURES =
  "bulk-memory multivalue mutable-globals nontrapping-float-to-int reference-types sign-ext";
const ENABLES = FEATURES.split(" ").map((name) => `--enable-${name}`);
const devEnv = "OPT_LEVEL=1 DEBUG_ASSERTIONS=true OVERFLOW_CHECKS=true target/dev-checked".split(
  " ",
);
function collectWasm(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { encoding: "utf8", recursive: true })
    .flatMap((name) => (name.endsWith(".wasm") ? [join(dir, name)] : []));
}
function dryRun(args, env = {}) {
  assert.match(fs.readFileSync(script, "utf8"), /GWEN_DRY_RUN/);
  const tmp = fs.mkdtempSync(join(tmpdir(), "gwen-wasm-dry-"));
  const bin = join(tmp, "bin");
  const marker = join(tmp, "invoked");
  const cargoHome = join(tmp, "cargo-home");
  const stamp = join(wasmRoot, "toolchain.json");
  const text = (path) => (fs.existsSync(path) ? fs.readFileSync(path).toString() : "");
  const snap = () => collectWasm(wasmRoot).sort().join("\n") + text(stamp);
  const before = snap();
  fs.mkdirSync(bin);
  const childEnv = {
    PATH: `${bin}:/usr/bin:/bin`,
    HOME: tmp,
    CARGO_HOME: cargoHome,
    GWEN_DRY_RUN: "1",
    TMPDIR: tmp,
    ...env,
  };
  try {
    for (const name of ["wasm-pack", "wasm-opt", "rustup", "rustc", "node"]) {
      fs.writeFileSync(join(bin, name), `#!/bin/sh\necho "$0" >> "${marker}"\nexit 97\n`, {
        mode: 0o755,
      });
    }
    const spawnOpts = { cwd: tmp, encoding: "utf8", timeout: 30_000, env: childEnv };
    const result = spawnSync(script, args, spawnOpts);
    assert.equal(fs.existsSync(marker), false);
    assert.equal(snap(), before);
    return { ...result, cargoHome };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
function runsOf(stdout) {
  const lines = String(stdout ?? "").split("\n");
  return lines.flatMap((line, i) => {
    if (!line.startsWith("run argv:")) return [];
    const env = (lines[i + 1] ?? "").replace(/^run env:\s*/, "").replace(/\\ /g, " ");
    return [{ argv: line.slice(9).trim(), env }];
  });
}
const isPack = (run) => /^wasm-pack(\s|$)/.test(run.argv);
const isOpt = (run) => /^wasm-opt(\s|$)/.test(run.argv);
const outOf = (argv, variant, dev) =>
  new RegExp(`/wasm/${variant}${dev ? "-dev" : ""}(?![-\\w])`).test(argv);
const devOut = (argv) => VARIANTS.some((variant) => outOf(argv, variant, true));
function skip(t, missing, message) {
  if (!missing) return false;
  process.stdout.write(`skip: ${message}\n`);
  t.skip(message);
  return true;
}
function assertDevArtefacts(variant) {
  const dir = join(wasmRoot, `${variant}-dev`);
  assert.equal(fs.existsSync(dir), true, "run pnpm build:wasm");
  for (const name of ["gwen_core_bg.wasm", "gwen_core.js", "gwen_core_factory.js"]) {
    assert.equal(fs.existsSync(join(dir, name)), true, "run pnpm build:wasm");
  }
}
test("the dry run issues one wasm-pack build per browser variant plus one dev-checked build each, with CARGO_PROFILE_RELEASE_OPT_LEVEL=1 and debug-assertions on the dev ones", () => {
  const result = dryRun([]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const runs = runsOf(result.stdout);
  const browser = runs.filter((run) => isPack(run) && run.argv.includes("packages/core/wasm/"));
  const dev = browser.filter((run) => VARIANTS.some((v) => outOf(run.argv, v, true)));
  const release = browser.filter((run) => VARIANTS.some((v) => outOf(run.argv, v, false)));
  assert.deepEqual([browser.length, dev.length, release.length], [6, 3, 3]);
  for (const variant of VARIANTS) {
    const hit = release.some((run) => outOf(run.argv, variant, false));
    assert.equal(hit, true, variant);
    const row = dev.find((run) => outOf(run.argv, variant, true));
    assert.equal(row !== undefined, true, variant);
    for (const needle of devEnv) assert.equal(row?.env.includes(needle), true, row?.env);
  }
  const factories = runs.filter((run) => run.argv.includes("scripts/wasm-factory.mjs"));
  assert.equal(factories.length, 6);
  assert.equal(factories.filter((run) => VARIANTS.some((v) => outOf(run.argv, v, true))).length, 3);
});
test("--cell P2:S1 --only physics2d issues exactly one wasm-pack build with -C target-feature=+simd128 and one wasm-opt -O3", () => {
  const cell = (token) => runsOf(dryRun(["--cell", token, "--only", "physics2d"]).stdout);
  const once = cell("P2:S1");
  const packs = once.filter(isPack);
  const opts = once.filter(isOpt);
  assert.deepEqual([packs.length, opts.length], [1, 1]);
  assert.equal(packs[0]?.env.includes("-C target-feature=+simd128"), true, packs[0]?.env);
  assert.match(opts[0]?.argv ?? "", /(^|\s)-O3(\s|$)/);
  const simd = cell("P2:S1R").filter(isPack);
  assert.equal(simd.length, 1);
  assert.equal(simd[0]?.argv.includes("physics2d-simd"), true, simd[0]?.argv);
  const cargo = fs.readFileSync(join(root, "crates/gwen-core/Cargo.toml"), "utf8");
  assert.match(cargo, /physics2d-simd = \["rapier2d\/simd8"\]/);
  assert.match(cargo, /physics3d-simd = \["rapier3d\/simd8"\]/);
  assert.match(cargo, /^default = \[\]$/m);
});
test("every wasm-pack build carries both --remap-path-prefix flags in RUSTFLAGS", () => {
  const result = dryRun([]);
  const packs = runsOf(result.stdout).filter(isPack);
  assert.equal(packs.length, 9);
  for (const run of packs) {
    assert.equal(run.env.includes(`--remap-path-prefix=${root}=/gwen`), true, run.env);
    assert.equal(run.env.includes(`--remap-path-prefix=${result.cargoHome}=/cargo`), true, run.env);
  }
});
test("the dev-checked wasm-opt runs -O1 with the --enable-* feature list", () => {
  const devOpts = runsOf(dryRun([]).stdout).filter((run) => isOpt(run) && devOut(run.argv));
  assert.equal(devOpts.length, 3);
  for (const run of devOpts) {
    assert.match(run.argv, /(^|\s)-O1(\s|$)/);
    for (const flag of ENABLES) assert.equal(run.argv.includes(flag), true, flag);
  }
});
test("--only with an unknown variant exits 1 naming it", () => {
  const result = dryRun(["--only", "not-a-variant"]);
  assert.equal(result.status, 1);
  assert.equal((result.stderr ?? "").includes("not-a-variant"), true, result.stderr);
});
test("--cell with an unknown or missing value exits 1 naming it", () => {
  const bogus = dryRun(["--cell", "bogus"]);
  assert.equal(bogus.status, 1);
  assert.equal((bogus.stderr ?? "").includes("bogus"), true, bogus.stderr);
  const bare = dryRun(["--cell"]);
  assert.equal(bare.status, 1);
  assert.equal((bare.stderr ?? "").includes("--cell"), true, bare.stderr);
});
test("the dev binaries differ from the release binaries by sha256 and contain the panic-hook string, which release lacks", (t) => {
  const present = fs.existsSync(join(wasmRoot, "light", "gwen_core_bg.wasm"));
  if (skip(t, !present, "release artefacts absent")) return;
  const marker = Buffer.from("[GWEN] panic:");
  for (const variant of VARIANTS) {
    assertDevArtefacts(variant);
    const release = fs.readFileSync(join(wasmRoot, variant, "gwen_core_bg.wasm"));
    const devPath = join(wasmRoot, `${variant}-dev`, "gwen_core_bg.wasm");
    assert.equal(fs.existsSync(devPath), true, "run pnpm build:wasm");
    const dev = fs.readFileSync(devPath);
    const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
    assert.notEqual(hash(release), hash(dev));
    assert.deepEqual([dev.includes(marker), release.includes(marker)], [true, false], variant);
  }
});
test("no binary contains the absolute repo path", (t) => {
  const rels =
    "packages/core/wasm packages/physics3d/wasm/bvh packages/physics3d/build-tools packages/physics3d-fracture/wasm";
  const files = rels.split(" ").flatMap((rel) => collectWasm(join(root, rel)));
  if (skip(t, files.length === 0, "no wasm artefacts")) return;
  const repo = Buffer.from(root);
  const cargo = Buffer.from(process.env.CARGO_HOME ?? join(homedir(), ".cargo"));
  for (const file of files) {
    const bytes = fs.readFileSync(file);
    assert.deepEqual([bytes.includes(repo), bytes.includes(cargo)], [false, false], file);
  }
});
