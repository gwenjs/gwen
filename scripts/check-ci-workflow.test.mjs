import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function readCi() {
  return readFileSync(join(root, ".github/workflows/ci.yml"), "utf8");
}

function onBlock(yaml) {
  const start = yaml.indexOf("\non:\n");
  const end = yaml.indexOf("\njobs:\n");
  assert.ok(start !== -1 && end > start);
  return yaml.slice(start, end);
}

test("pull request runs for every base", () => {
  const on = onBlock(readCi());
  assert.match(on, /push:\n {4}branches: \[main, v1-alpha, "hardening\/\*\*"\]/);
  assert.match(on, /pull_request:\n/);
  assert.doesNotMatch(on, /pull_request:\n {4}branches:/);
});

/**
 * @param {string} yaml
 * @param {string} key
 * @returns {string | null}
 */
function concurrencyValue(yaml, key) {
  const lines = yaml.split(/\r?\n/);
  let inBlock = false;
  for (const line of lines) {
    if (line === "concurrency:") {
      inBlock = true;
      continue;
    }
    if (inBlock && line !== "" && !/^ /.test(line)) break;
    if (!inBlock) continue;
    const prefix = `  ${key}:`;
    if (line.startsWith(prefix)) return line.slice(prefix.length).trim();
  }
  return null;
}

/**
 * @param {string} yaml
 * @param {string} eventName
 * @returns {boolean}
 */
function cancelsInProgress(yaml, eventName) {
  const raw = concurrencyValue(yaml, "cancel-in-progress");
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "${{ github.event_name == 'pull_request' }}") return eventName === "pull_request";
  if (raw === '${{ github.event_name == "pull_request" }}') return eventName === "pull_request";
  return false;
}

test("cancels an in-progress run for the same ref", () => {
  const yaml = readCi();
  assert.equal(concurrencyValue(yaml, "group"), "${{ github.workflow }}-${{ github.ref }}");
  assert.equal(cancelsInProgress(yaml, "pull_request"), true);
  assert.equal(cancelsInProgress(yaml, "push"), false);
});

test("runs verify-red against the pull request base", () => {
  const yaml = readCi();
  assert.match(yaml, /scripts\/verify-red\.sh/);
  assert.match(yaml, /HYGIENE_BASE:\s*origin\/\$\{\{\s*github\.base_ref\s*\}\}/);
  const script = readFileSync(join(root, "scripts/verify-red.sh"), "utf8");
  assert.match(script, /grep -qx 'no-red-check'/);
});

/**
 * The lines of one job in ci.yml.
 *
 * @param {string} yaml
 * @param {string} id
 * @returns {string}
 */
function jobBlock(yaml, id) {
  const lines = yaml.split(/\r?\n/);
  const start = lines.indexOf(`  ${id}:`);
  if (start === -1) return "";
  let end = start + 1;
  while (
    end < lines.length &&
    !/^ {2}[A-Za-z0-9_-]+:\s*$/.test(lines[end] ?? "") &&
    !/^\S/.test(lines[end] ?? "")
  )
    end++;
  return lines.slice(start, end).join("\n");
}

test("verify-red runs after the rust job with the WASM artifacts", () => {
  const yaml = readCi();
  const ids = [...yaml.matchAll(/^ {2}([A-Za-z0-9_-]+):\s*$/gm)].map((m) => m[1] ?? "");
  const owners = ids.filter((id) => jobBlock(yaml, id).includes("scripts/verify-red.sh"));
  assert.equal(owners.length, 1, `jobs running verify-red: ${owners.join(", ")}`);
  const job = jobBlock(yaml, owners[0] ?? "");
  assert.match(job, /needs: \[[^\]]*\brust\b[^\]]*\]/);
  assert.match(job, /fetch-depth: 0/);
  for (const [name, path] of [
    ["core-wasm", "packages/core/wasm/"],
    ["physics3d-build-tools", "packages/physics3d/build-tools/"],
    ["physics3d-wasm-bvh", "packages/physics3d/wasm/bvh/"],
    ["physics3d-fracture-wasm", "packages/physics3d-fracture/wasm/"],
  ]) {
    assert.match(job, new RegExp(`name: ${name}\\n\\s+path: ${path.replace(/\//g, "\\/")}`));
    assert.match(jobBlock(yaml, "rust"), new RegExp(`name: ${name}\\n`));
  }
  const status = spawnSync("node", [join(root, "scripts/check-ci-status-needs.mjs")], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(status.status, 0, `${status.stdout}${status.stderr}`);
});

/**
 * @param {string} dir
 * @param {string[]} args
 */
function git(dir, args) {
  const result = spawnSync("git", args, {
    cwd: dir,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Fixture",
      GIT_AUTHOR_EMAIL: "fixture@example.com",
      GIT_COMMITTER_NAME: "Fixture",
      GIT_COMMITTER_EMAIL: "fixture@example.com",
    },
  });
  assert.equal(result.status, 0, result.stderr);
}

/**
 * @param {string} source
 * @param {string} base
 * @param {{ file?: string, seed?: (dir: string) => void, headSeed?: (dir: string) => void, pathPrefix?: string, env?: Record<string, string> }} [options]
 */
function runVerifyRed(source, base, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), "gwen-verify-red-fixture-"));
  const file = options.file ?? "added.test.mjs";
  try {
    git(dir, ["init", "-b", "base"]);
    writeFileSync(join(dir, "README.md"), "base\n");
    if (options.seed) options.seed(dir);
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-m", "base"]);
    git(dir, ["checkout", "-b", "change"]);
    if (options.headSeed) options.headSeed(dir);
    const dest = join(dir, file);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, source);
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-m", "add test"]);
    const env = {
      ...process.env,
      HYGIENE_BASE: base,
      GH_TOKEN: "",
      GITHUB_TOKEN: "",
      PR_NUMBER: "",
      PR_REPO: "",
    };
    if (options.pathPrefix) env.PATH = `${options.pathPrefix}:${env.PATH ?? ""}`;
    if (options.env) Object.assign(env, options.env);
    for (const key of Object.keys(env)) {
      if (key.startsWith("NODE_TEST") || key === "NODE_CHANNEL_FD") delete env[key];
    }
    return spawnSync("bash", [join(root, "scripts/verify-red.sh")], {
      cwd: dir,
      encoding: "utf8",
      env,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("verify-red fails a test that passes on the base", () => {
  assert.match(readCi(), /scripts\/verify-red\.sh/);
  const result = runVerifyRed(
    [
      "import assert from 'node:assert/strict';",
      "import test from 'node:test';",
      "test('passes on the base', () => {",
      "  assert.equal(1, 1);",
      "});",
      "",
    ].join("\n"),
    "base",
  );
  const output = `${result.stdout}\n${result.stderr}`;
  assert.doesNotMatch(output, /skipping running files/);
  // node 22 prints "# pass 1" (tap). node 24 prints "ℹ pass 1" (spec).
  assert.match(output, /(?:ℹ|#) pass 1/);
  assert.notEqual(result.status, 0);
  assert.match(output, /NOT RED added\.test\.mjs/);
});

test("verify-red asks gh for the pull request number", () => {
  const dir = mkdtempSync(join(tmpdir(), "gwen-verify-red-gh-"));
  const argsFile = join(dir, "gh-args.txt");
  try {
    git(dir, ["init", "-b", "base"]);
    writeFileSync(join(dir, "README.md"), "base\n");
    git(dir, ["add", "README.md"]);
    git(dir, ["commit", "-m", "base"]);
    const bin = join(dir, "bin");
    mkdirSync(bin);
    writeFileSync(
      join(bin, "gh"),
      ["#!/bin/sh", 'printf "%s\\n" "$@" > "$GH_ARGS_FILE"', "exit 1", ""].join("\n"),
    );
    chmodSync(join(bin, "gh"), 0o755);
    git(dir, ["checkout", "-b", "change"]);
    writeFileSync(
      join(dir, "added.test.mjs"),
      ["import test from 'node:test';", "test('unused', () => {});", ""].join("\n"),
    );
    git(dir, ["add", "added.test.mjs"]);
    git(dir, ["commit", "-m", "add test"]);
    const env = {
      ...process.env,
      HYGIENE_BASE: "base",
      GH_TOKEN: "fixture",
      GITHUB_TOKEN: "",
      PR_NUMBER: "4242",
      PR_REPO: "gwenjs/gwen",
      GH_ARGS_FILE: argsFile,
      PATH: `${bin}:${process.env.PATH ?? ""}`,
    };
    for (const key of Object.keys(env)) {
      if (key.startsWith("NODE_TEST") || key === "NODE_CHANNEL_FD") delete env[key];
    }
    spawnSync("bash", [join(root, "scripts/verify-red.sh")], {
      cwd: dir,
      encoding: "utf8",
      env,
    });
    const args = readFileSync(argsFile, "utf8");
    assert.match(args, /4242/);
    assert.match(args, /gwenjs\/gwen/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("verify-red accepts a test that fails on the base", () => {
  assert.match(readCi(), /HYGIENE_BASE:\s*origin\/\$\{\{\s*github\.base_ref\s*\}\}/);
  const result = runVerifyRed(
    [
      "import assert from 'node:assert/strict';",
      "import test from 'node:test';",
      "test('fails on the base', () => {",
      "  assert.equal(1, 2);",
      "});",
      "",
    ].join("\n"),
    "base",
  );
  const output = `${result.stdout}\n${result.stderr}`;
  assert.doesNotMatch(output, /skipping running files/);
  assert.match(output, /1 !== 2/);
  assert.equal(result.status, 0, output);
  assert.match(output, /RED added\.test\.mjs/);
});

test("verify-red does not treat one passing test as red when another fails", () => {
  const result = runVerifyRed(
    [
      "import assert from 'node:assert/strict';",
      "import test from 'node:test';",
      "test('stays green', () => {",
      "  assert.equal(1, 1);",
      "});",
      "test('fails on the base', () => {",
      "  assert.equal(1, 2);",
      "});",
      "",
    ].join("\n"),
    "base",
  );
  const output = `${result.stdout}\n${result.stderr}`;
  assert.match(output, /stays green/);
  assert.notEqual(result.status, 0, output);
  assert.match(output, /NOT RED added\.test\.mjs :: stays green/);
});

test("verify-red runs a node:test file that quotes a vitest import with node", () => {
  const result = runVerifyRed(
    [
      "import assert from 'node:assert/strict';",
      "import test from 'node:test';",
      "const fixture = [\"import { it } from 'vitest';\", \"it('x', () => {});\"];",
      "test('fails on the base', () => {",
      "  assert.equal(fixture.length, 3);",
      "});",
      "",
    ].join("\n"),
    "base",
  );
  const output = `${result.stdout}\n${result.stderr}`;
  assert.doesNotMatch(output, /pnpm install/);
  assert.equal(result.status, 0, output);
  assert.match(output, /verify-red: RED added\.test\.mjs/);
});

test("verify-red counts a new test red when its new module is missing on the base", () => {
  const dir = mkdtempSync(join(tmpdir(), "gwen-verify-red-load-"));
  try {
    git(dir, ["init", "-b", "base"]);
    writeFileSync(join(dir, "README.md"), "base\n");
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-m", "base"]);
    git(dir, ["checkout", "-b", "change"]);
    mkdirSync(join(dir, "lib"));
    writeFileSync(join(dir, "lib/answer.mjs"), "export const answer = 42;\n");
    writeFileSync(
      join(dir, "lib/answer.test.mjs"),
      [
        "import assert from 'node:assert/strict';",
        "import test from 'node:test';",
        "import { answer } from './answer.mjs';",
        "test('answers 42', () => {",
        "  assert.equal(answer, 42);",
        "});",
        "",
      ].join("\n"),
    );
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-m", "add module and test"]);
    const env = {
      ...process.env,
      HYGIENE_BASE: "base",
      GH_TOKEN: "",
      GITHUB_TOKEN: "",
      PR_NUMBER: "",
      PR_REPO: "",
    };
    for (const key of Object.keys(env)) {
      if (key.startsWith("NODE_TEST") || key === "NODE_CHANNEL_FD") delete env[key];
    }
    const result = spawnSync("bash", [join(root, "scripts/verify-red.sh")], {
      cwd: dir,
      encoding: "utf8",
      env,
    });
    const output = `${result.stdout}\n${result.stderr}`;
    assert.equal(result.status, 0, output);
    assert.match(output, /FAIL answers 42 \(base load error/);
    assert.match(output, /verify-red: RED lib\/answer\.test\.mjs/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Base: README only. Head adds every file in `files` (paths relative to the
 * repo root). Runs verify-red.sh with the base as HYGIENE_BASE.
 *
 * @param {Record<string, string>} files
 */
function runVerifyRedWithAdded(files) {
  const dir = mkdtempSync(join(tmpdir(), "gwen-verify-red-added-"));
  try {
    git(dir, ["init", "-b", "base"]);
    writeFileSync(join(dir, "README.md"), "base\n");
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-m", "base"]);
    git(dir, ["checkout", "-b", "change"]);
    for (const [file, content] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, file)), { recursive: true });
      writeFileSync(join(dir, file), content);
    }
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-m", "add files"]);
    const env = {
      ...process.env,
      HYGIENE_BASE: "base",
      GH_TOKEN: "",
      GITHUB_TOKEN: "",
      PR_NUMBER: "",
      PR_REPO: "",
    };
    for (const key of Object.keys(env)) {
      if (key.startsWith("NODE_TEST") || key === "NODE_CHANNEL_FD") delete env[key];
    }
    const result = spawnSync("bash", [join(root, "scripts/verify-red.sh")], {
      cwd: dir,
      encoding: "utf8",
      env,
    });
    return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("verify-red judges a test on the base with the test fixture the PR adds", () => {
  const { status, output } = runVerifyRedWithAdded({
    "tests/fixtures/helper.mjs": "export const value = 1;\n",
    "tests/added.test.mjs": [
      "import assert from 'node:assert/strict';",
      "import test from 'node:test';",
      "import { value } from './fixtures/helper.mjs';",
      "test('passes with the fixture', () => {",
      "  assert.equal(value, 1);",
      "});",
      "",
    ].join("\n"),
  });
  assert.match(output, /NOT RED tests\/added\.test\.mjs :: passes with the fixture/);
  assert.notEqual(status, 0, output);
});

test("verify-red counts red a test that fails on the base with the fixture the PR adds", () => {
  const { status, output } = runVerifyRedWithAdded({
    "tests/helpers/helper.mjs": "export const value = 1;\n",
    "tests/added.test.mjs": [
      "import assert from 'node:assert/strict';",
      "import { existsSync } from 'node:fs';",
      "import test from 'node:test';",
      "import { value } from './helpers/helper.mjs';",
      "test('needs the head', () => {",
      "  assert.equal(existsSync(new URL('../lib/answer.mjs', import.meta.url)), true);",
      "  assert.equal(value, 1);",
      "});",
      "",
    ].join("\n"),
    "lib/answer.mjs": "export const answer = 42;\n",
  });
  assert.doesNotMatch(output, /base load error/);
  assert.match(output, /verify-red: RED tests\/added\.test\.mjs/);
  assert.equal(status, 0, output);
});

test("verify-red does not copy a later test file onto the base with the fixtures", () => {
  const { status, output } = runVerifyRedWithAdded({
    "tests/fixtures/helper.mjs": "export const value = 1;\n",
    "tests/a.test.mjs": [
      "import assert from 'node:assert/strict';",
      "import test from 'node:test';",
      "import { value } from './fixtures/helper.mjs';",
      "test('fails on the base', () => {",
      "  assert.equal(value, 2);",
      "});",
      "",
    ].join("\n"),
    "tests/b.test.mjs": [
      "import test from 'node:test';",
      "test('passes on the base', () => {});",
      "",
    ].join("\n"),
  });
  assert.match(output, /verify-red: RED tests\/a\.test\.mjs/);
  assert.match(output, /NOT RED tests\/b\.test\.mjs :: passes on the base/);
  assert.notEqual(status, 0, output);
});

test("verify-red does not copy a production module the PR adds onto the base", () => {
  const { status, output } = runVerifyRedWithAdded({
    "packages/demo/src/helpers/answer.mjs": "export const answer = 42;\n",
    "packages/demo/tests/fixtures/helper.mjs":
      "export { answer } from '../../src/helpers/answer.mjs';\n",
    "packages/demo/tests/answer.test.mjs": [
      "import assert from 'node:assert/strict';",
      "import test from 'node:test';",
      "import { answer } from './fixtures/helper.mjs';",
      "test('answers 42', () => {",
      "  assert.equal(answer, 42);",
      "});",
      "",
    ].join("\n"),
  });
  assert.match(output, /FAIL answers 42 \(base load error/);
  assert.match(output, /verify-red: RED packages\/demo\/tests\/answer\.test\.mjs/);
  assert.equal(status, 0, output);
});

test("verify-red does not count a wasm file as red when it cannot run", () => {
  const result = runVerifyRed(
    ["import { it } from 'vitest';", "it('passes on the base', () => {});", ""].join("\n"),
    "base",
    { file: "packages/core/tests/integration-wasm/added.test.ts" },
  );
  const output = `${result.stdout}\n${result.stderr}`;
  assert.equal(result.status, 2, output);
  assert.match(output, /not verifiable/);
  assert.doesNotMatch(output, /verify-red: RED /);
});

test("verify-red does not count a passing wasm test as red", () => {
  const wasmFile = "packages/core/tests/integration-wasm/added.test.ts";
  const result = runVerifyRed(
    ["import { it } from 'vitest';", "it('passes on the base', () => {});", ""].join("\n"),
    "base",
    {
      file: wasmFile,
      seed(dir) {
        mkdirSync(join(dir, "packages/core/wasm/light"), { recursive: true });
        writeFileSync(join(dir, "packages/core/package.json"), "{}\n");
        writeFileSync(join(dir, "packages/core/vitest.wasm.config.ts"), "export default {};\n");
        writeFileSync(join(dir, "packages/core/wasm/light/gwen_core_bg.wasm"), "wasm\n");
      },
      pathPrefix: writeFakePnpm(),
    },
  );
  const output = `${result.stdout}\n${result.stderr}`;
  assert.match(output, /passes on the base/);
  assert.notEqual(result.status, 0, output);
  assert.match(output, /NOT RED packages\/core\/tests\/integration-wasm\/added\.test\.ts/);
});

const fakePnpmDirs = [];

function writeFakePnpm() {
  const dir = mkdtempSync(join(tmpdir(), "gwen-fake-pnpm-"));
  fakePnpmDirs.push(dir);
  const bin = join(dir, "pnpm");
  writeFileSync(
    bin,
    [
      "#!/bin/sh",
      'out=""',
      'prev=""',
      'for arg in "$@"; do',
      '  if [ "$prev" = "--outputFile" ]; then',
      '    out="$arg"',
      "  fi",
      '  prev="$arg"',
      "done",
      'case "$*" in',
      "  *vitest.wasm.config.ts*)",
      '    if [ -n "$out" ]; then',
      '      printf \'%s\\n\' \'{"testResults":[{"assertionResults":[{"fullName":"passes on the base","status":"passed"}]}]}\' > "$out"',
      "    fi",
      "    exit 0",
      "    ;;",
      "  *vitest*)",
      '    echo "No test files found" >&2',
      "    exit 1",
      "    ;;",
      "esac",
      "exit 0",
      "",
    ].join("\n"),
  );
  chmodSync(bin, 0o755);
  return dir;
}

/**
 * Run verify-red.sh in a clean checkout of this repository's HEAD, as the CI
 * job does: real pnpm, no node_modules, no WASM artifacts.
 *
 * @param {Record<string, string>} files paths relative to the repo root
 * @returns {{ status: number | null, output: string }}
 */
function runVerifyRedOnRepo(files) {
  const dir = mkdtempSync(join(tmpdir(), "gwen-verify-red-repo-"));
  rmSync(dir, { recursive: true, force: true });
  const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
  assert.equal(head.status, 0, head.stderr);
  const base = head.stdout.trim();
  git(root, ["worktree", "add", "--detach", dir, base]);
  try {
    for (const [file, content] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, file)), { recursive: true });
      writeFileSync(join(dir, file), content);
    }
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "--no-verify", "-m", "fixture"]);
    const env = {
      ...process.env,
      HYGIENE_BASE: base,
      GH_TOKEN: "",
      GITHUB_TOKEN: "",
      PR_NUMBER: "",
      PR_REPO: "",
    };
    for (const key of Object.keys(env)) {
      if (key.startsWith("NODE_TEST") || key.startsWith("VITEST") || key === "NODE_CHANNEL_FD") {
        delete env[key];
      }
    }
    const result = spawnSync("bash", [join(root, "scripts/verify-red.sh")], {
      cwd: dir,
      encoding: "utf8",
      env,
      maxBuffer: 64 * 1024 * 1024,
    });
    return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
  } finally {
    spawnSync("git", ["worktree", "remove", "--force", dir], { cwd: root });
    rmSync(dir, { recursive: true, force: true });
  }
}

test("verify-red runs a real Vitest file without WASM or a build", () => {
  const file = "packages/core/tests/verify-red-fixture.test.ts";
  const { status, output } = runVerifyRedOnRepo({
    [file]: [
      "import { describe, expect, it } from 'vitest';",
      "import { defineComponent, Types } from '@gwenjs/core';",
      "",
      "describe('verify-red fixture', () => {",
      "  it('fails on the base', () => {",
      "    const Probe = defineComponent({ name: 'VerifyRedProbe', schema: { x: Types.f32 } });",
      "    expect(Probe.name).toBe('not the base');",
      "  });",
      "});",
      "",
    ].join("\n"),
  });
  assert.doesNotMatch(output, /build:ts/);
  assert.equal(status, 0, output);
  assert.match(output, /verify-red: RED packages\/core\/tests\/verify-red-fixture\.test\.ts/);
});

test("verify-red counts a real Vitest file red when it imports a module the PR adds", () => {
  // A production module (under src/): never copied onto the base.
  const { status, output } = runVerifyRedOnRepo({
    "packages/core/src/verify-red-fixture-lib.ts": "export const answer = 42;\n",
    "packages/core/tests/verify-red-fixture.test.ts": [
      "import { expect, it } from 'vitest';",
      "import { answer } from '../src/verify-red-fixture-lib';",
      "",
      "it('answers 42', () => {",
      "  expect(answer).toBe(42);",
      "});",
      "",
    ].join("\n"),
  });
  assert.equal(status, 0, output);
  assert.match(output, /FAIL answers 42 \(base load error/);
  assert.match(output, /verify-red: RED packages\/core\/tests\/verify-red-fixture\.test\.ts/);
});

test("verify-red runs a real Vitest file on the base with the fixture the PR adds", () => {
  const { status, output } = runVerifyRedOnRepo({
    "packages/core/tests/fixtures/verify-red-fixture-lib.ts": "export const answer = 42;\n",
    "packages/core/tests/verify-red-fixture.test.ts": [
      "import { expect, it } from 'vitest';",
      "import { answer } from './fixtures/verify-red-fixture-lib.js';",
      "",
      "it('answers 42', () => {",
      "  expect(answer).toBe(42);",
      "});",
      "",
    ].join("\n"),
  });
  assert.match(output, /NOT RED packages\/core\/tests\/verify-red-fixture\.test\.ts :: answers 42/);
  assert.notEqual(status, 0, output);
});

test("verify-red reports not verifiable when a test needs a WASM build", () => {
  const file = "packages/physics3d-fracture/tests/voronoi-fracture.test.ts";
  const current = readFileSync(join(root, file), "utf8");
  const { status, output } = runVerifyRedOnRepo({
    [file]: `${current}\nit('verify-red fixture needs the fracture wasm', () => {\n  expect(1).toBe(1);\n});\n`,
  });
  assert.equal(status, 2, output);
  assert.match(output, /does not load on the head either/);
  assert.doesNotMatch(output, /verify-red: RED /);
});

/**
 * Parses a tsconfig file, which is JSONC: `//` and `/* *\/` comments outside
 * strings are dropped before JSON.parse.
 *
 * @param {string} file
 * @returns {any}
 */
function readJsonc(file) {
  const text = readFileSync(file, "utf8");
  let out = "";
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j;
    } else if (char === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i += 1;
      out += "\n";
    } else if (char === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? text.length : end + 1;
    } else {
      out += char;
    }
  }
  return JSON.parse(out);
}

test("pnpm typecheck includes the core and renderer test projects", () => {
  const rootPackage = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const typecheck = rootPackage.scripts.typecheck;
  assert.match(typecheck, /tsconfig\.test\.json/);
  const core = readJsonc(join(root, "packages/core/tsconfig.test.json"));
  const renderer = readJsonc(join(root, "packages/renderer-core/tsconfig.test.json"));
  assert.ok(core.include.includes("tests"));
  assert.ok(renderer.include.includes("tests"));
  assert.ok(Array.isArray(core.exclude));
  assert.ok(core.exclude.every((item) => item.endsWith(".ts")));
  for (const file of [
    "tests/integration-wasm/p1-error-policy.test.ts",
    "tests/integration-wasm/p54-stale-physics-handles.test.ts",
    "tests/integration-wasm/wasm-errors.test.ts",
  ]) {
    assert.ok(!core.exclude.includes(file), `${file} is excluded from the test typecheck`);
  }
  assert.ok(Array.isArray(renderer.exclude));
  assert.ok(renderer.exclude.every((item) => item.endsWith(".ts")));
});

test("verify-red prints KEEP-ONLY for a changed file with no new test name", () => {
  const kept = ["import test from 'node:test';", "test('kept', () => {});", ""].join("\n");
  const result = runVerifyRed(`${kept}// a comment changes the file\n`, "base", {
    seed(dir) {
      writeFileSync(join(dir, "added.test.mjs"), kept);
    },
  });
  const output = `${result.stdout}\n${result.stderr}`;
  assert.equal(result.status, 0, output);
  assert.match(output, /verify-red: KEEP-ONLY added\.test\.mjs/);
  assert.doesNotMatch(output, /verify-red: RED /);
  assert.doesNotMatch(output, /every checked test group failed on the base/);
});

/**
 * The env map of one step of one job, read from the YAML lines.
 *
 * @param {string} yaml
 * @param {string} job
 * @param {string} step
 * @returns {Record<string, string>}
 */
function stepEnv(yaml, job, step) {
  const lines = jobBlock(yaml, job).split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `- name: ${step}`);
  assert.notEqual(start, -1, `${job} has no step ${step}`);
  const indent = (lines[start] ?? "").indexOf("-");
  /** @type {Record<string, string>} */
  const env = {};
  let inEnv = false;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.trim() === "") continue;
    const depth = line.length - line.trimStart().length;
    if (depth <= indent) break;
    if (depth === indent + 2) {
      inEnv = line.trim() === "env:";
      continue;
    }
    if (!inEnv) continue;
    const match = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (match) env[match[1] ?? ""] = match[2] ?? "";
  }
  return env;
}

/**
 * Resolve the HYGIENE_BASE value of a step for one event, as Actions would.
 *
 * @param {string} value
 * @param {'pull_request' | 'push'} event
 * @returns {string}
 */
function resolveBase(value, event) {
  const baseRef = event === "pull_request" ? "main" : "";
  const conditional = value.match(
    /^\$\{\{\s*github\.event_name\s*==\s*'pull_request'\s*&&\s*format\('origin\/\{0\}',\s*github\.base_ref\)\s*\|\|\s*'([^']*)'\s*\}\}$/,
  );
  if (conditional) return event === "pull_request" ? `origin/${baseRef}` : (conditional[1] ?? "");
  return value.replace(/\$\{\{\s*github\.base_ref\s*\}\}/g, baseRef);
}

test("the diff hygiene step diffs against the pull request base", () => {
  const yaml = readCi();
  const hygiene = stepEnv(yaml, "agent-hygiene", "Diff hygiene");
  assert.ok("HYGIENE_BASE" in hygiene, JSON.stringify(hygiene));
  assert.equal(resolveBase(hygiene.HYGIENE_BASE ?? "", "pull_request"), "origin/main");
  assert.equal(resolveBase(hygiene.HYGIENE_BASE ?? "", "push"), "origin/v1-alpha");
  const contractStep = stepEnv(yaml, "agent-hygiene", "PR contract");
  assert.equal(resolveBase(contractStep.HYGIENE_BASE ?? "", "pull_request"), "origin/main");
  const red = stepEnv(yaml, "verify-red", "Verify red");
  assert.equal(resolveBase(red.HYGIENE_BASE ?? "", "pull_request"), "origin/main");
});

test("verify-red warns instead of blocking a helper test name that passes in the base run", () => {
  const helper = [
    "import test from 'node:test';",
    "export function conformance() {",
    "  test('shared case', () => {});",
    "}",
    "",
  ].join("\n");
  const base = [
    "import test from 'node:test';",
    "import { conformance } from './helper.mjs';",
    "conformance();",
    "test('old', () => {});",
    "",
  ].join("\n");
  const result = runVerifyRed(`${base}test('new', () => { throw new Error('red'); });\n`, "base", {
    seed(dir) {
      writeFileSync(join(dir, "helper.mjs"), helper);
      writeFileSync(join(dir, "added.test.mjs"), base);
    },
  });
  const output = `${result.stdout}\n${result.stderr}`;
  assert.equal(result.status, 0, output);
  assert.match(output, /passes in the base run: shared case/);
  assert.match(output, /verify-red: RED added\.test\.mjs/);
});

const crateToml = [
  "[package]",
  'name = "verify-red-demo"',
  'version = "0.1.0"',
  'edition = "2021"',
  "",
  "[workspace]",
  "",
].join("\n");

/**
 * @param {string} dir
 * @param {string} lib
 */
function writeCrate(dir, lib) {
  mkdirSync(join(dir, "crates/demo/src"), { recursive: true });
  writeFileSync(join(dir, "crates/demo/Cargo.toml"), crateToml);
  writeFileSync(join(dir, "crates/demo/src/lib.rs"), lib);
}

test("verify-red blocks a new Cargo integration test that passes on the base", () => {
  const result = runVerifyRed(
    ["#[test]", "fn one_is_one() {", "    assert_eq!(verify_red_demo::one(), 1);", "}", ""].join(
      "\n",
    ),
    "base",
    {
      file: "crates/demo/tests/added.rs",
      seed(dir) {
        writeCrate(dir, "pub fn one() -> i32 {\n    1\n}\n");
      },
    },
  );
  const output = `${result.stdout}\n${result.stderr}`;
  assert.equal(result.status, 1, output);
  assert.match(output, /verify-red: NOT RED crates\/demo\/tests\/added\.rs :: one_is_one/);
});

test("verify-red counts a Cargo integration test red when it does not compile on the base", () => {
  const result = runVerifyRed(
    ["#[test]", "fn two_is_two() {", "    assert_eq!(verify_red_demo::two(), 2);", "}", ""].join(
      "\n",
    ),
    "base",
    {
      file: "crates/demo/tests/added.rs",
      seed(dir) {
        writeCrate(dir, "pub fn one() -> i32 {\n    1\n}\n");
      },
      headSeed(dir) {
        writeCrate(dir, "pub fn one() -> i32 {\n    1\n}\n\npub fn two() -> i32 {\n    2\n}\n");
      },
    },
  );
  const output = `${result.stdout}\n${result.stderr}`;
  assert.equal(result.status, 0, output);
  assert.match(output, /FAIL two_is_two \(base load error/);
  assert.match(output, /verify-red: RED crates\/demo\/tests\/added\.rs/);
});

test("verify-red prints KEEP-ONLY for a new inline Rust test it cannot judge by name", () => {
  const lib = "pub fn one() -> i32 {\n    1\n}\n";
  const result = runVerifyRed(
    `${lib}\n#[cfg(test)]\nmod tests {\n    #[test]\n    fn inline_one() {\n        assert_eq!(super::one(), 1);\n    }\n}\n`,
    "base",
    {
      file: "crates/demo/src/lib.rs",
      seed(dir) {
        writeCrate(dir, lib);
      },
    },
  );
  const output = `${result.stdout}\n${result.stderr}`;
  assert.equal(result.status, 0, output);
  assert.match(
    output,
    /verify-red: KEEP-ONLY crates\/demo\/src\/lib\.rs \(inline Rust tests: not verifiable by test name\)/,
  );
  assert.doesNotMatch(output, /verify-red: RED /);
});

test("verify-red runs the base and the head Cargo builds in separate target dirs", () => {
  const target = mkdtempSync(join(tmpdir(), "gwen-verify-red-target-"));
  try {
    const result = runVerifyRed(
      ["#[test]", "fn two_is_two() {", "    assert_eq!(verify_red_demo::two(), 2);", "}", ""].join(
        "\n",
      ),
      "base",
      {
        file: "crates/demo/tests/added.rs",
        seed(dir) {
          writeCrate(dir, "pub fn one() -> i32 {\n    1\n}\n");
        },
        headSeed(dir) {
          writeCrate(dir, "pub fn one() -> i32 {\n    1\n}\n\npub fn two() -> i32 {\n    2\n}\n");
        },
        env: { CARGO_TARGET_DIR: target },
      },
    );
    const output = `${result.stdout}\n${result.stderr}`;
    assert.equal(result.status, 0, output);
    assert.match(output, /verify-red: RED crates\/demo\/tests\/added\.rs/);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("verify-red keeps a Cargo test file with only wasm tests as KEEP-ONLY", () => {
  for (const source of [
    [
      "use wasm_bindgen_test::*;",
      "",
      "#[wasm_bindgen_test]",
      "fn wasm_only() {",
      "    assert_eq!(1, 1);",
      "}",
      "",
    ],
    [
      '#[cfg(target_arch = "wasm32")]',
      "#[test]",
      "fn wasm_gated() {",
      "    assert_eq!(1, 1);",
      "}",
      "",
    ],
  ]) {
    const result = runVerifyRed(source.join("\n"), "base", {
      file: "crates/demo/tests/wasm.rs",
      seed(dir) {
        writeCrate(dir, "pub fn one() -> i32 {\n    1\n}\n");
      },
    });
    const output = `${result.stdout}\n${result.stderr}`;
    assert.equal(result.status, 0, `${source.join("\n")}\n${output}`);
    assert.match(
      output,
      /verify-red: KEEP-ONLY crates\/demo\/tests\/wasm\.rs \(wasm-only Rust tests: not verifiable natively\)/,
    );
  }
});

test("verify-red still fails another passing test when a Cargo file runs no test", () => {
  const result = runVerifyRed(
    ["#[cfg(any())]", "#[test]", "fn never_built() {", "    assert_eq!(1, 1);", "}", ""].join("\n"),
    "base",
    {
      file: "crates/demo/tests/gated.rs",
      seed(dir) {
        writeCrate(dir, "pub fn one() -> i32 {\n    1\n}\n");
      },
      headSeed(dir) {
        writeFileSync(
          join(dir, "added.test.mjs"),
          [
            "import assert from 'node:assert/strict';",
            "import test from 'node:test';",
            "test('passes on the base', () => {",
            "  assert.equal(1, 1);",
            "});",
            "",
          ].join("\n"),
        );
      },
    },
  );
  const output = `${result.stdout}\n${result.stderr}`;
  assert.equal(result.status, 1, output);
  assert.match(
    output,
    /verify-red: KEEP-ONLY crates\/demo\/tests\/gated\.rs \(no test runs natively on the base or the head\)/,
  );
  assert.match(output, /verify-red: NOT RED added\.test\.mjs/);
});

test("verify-red installs the same pinned Rust toolchain as the rust job", () => {
  const yaml = readCi();
  const toolchain = (id) => {
    const lines = jobBlock(yaml, id).split(/\r?\n/);
    const start = lines.findIndex((line) => /^\s*- uses: dtolnay\/rust-toolchain@/.test(line));
    if (start === -1) return null;
    const out = [(lines[start] ?? "").trim()];
    for (let i = start + 1; i < lines.length && !/^\s*- /.test(lines[i] ?? ""); i++)
      out.push((lines[i] ?? "").trim());
    return out.filter((line) => line !== "").join("\n");
  };
  const rust = toolchain("rust");
  assert.ok(rust, "rust job has no toolchain step");
  assert.equal(toolchain("verify-red"), rust);
});

const oldNative = [
  "#[test]",
  "fn old_native() {",
  "    assert_eq!(verify_red_demo::one(), 1);",
  "}",
  "",
].join("\n");

test("verify-red keeps a wasm-only test added to an existing Cargo test file", () => {
  const result = runVerifyRed(
    `${oldNative}\n#[cfg(target_arch = "wasm32")]\n#[test]\nfn new_wasm() {}\n`,
    "base",
    {
      file: "crates/demo/tests/existing.rs",
      seed(dir) {
        writeCrate(dir, "pub fn one() -> i32 {\n    1\n}\n");
        mkdirSync(join(dir, "crates/demo/tests"), { recursive: true });
        writeFileSync(join(dir, "crates/demo/tests/existing.rs"), oldNative);
      },
    },
  );
  const output = `${result.stdout}\n${result.stderr}`;
  assert.equal(result.status, 0, output);
  assert.match(
    output,
    /verify-red: KEEP-ONLY crates\/demo\/tests\/existing\.rs \(wasm-only Rust tests: not verifiable natively\)/,
  );
  assert.doesNotMatch(output, /NOT RED/);
});

test("verify-red counts a failing test added to an existing Cargo test file red", () => {
  const result = runVerifyRed(
    `${oldNative}\n#[test]\nfn new_red() {\n    assert_eq!(verify_red_demo::one(), 2);\n}\n`,
    "base",
    {
      file: "crates/demo/tests/existing.rs",
      seed(dir) {
        writeCrate(dir, "pub fn one() -> i32 {\n    1\n}\n");
        mkdirSync(join(dir, "crates/demo/tests"), { recursive: true });
        writeFileSync(join(dir, "crates/demo/tests/existing.rs"), oldNative);
      },
    },
  );
  const output = `${result.stdout}\n${result.stderr}`;
  assert.equal(result.status, 0, output);
  assert.match(output, /KEEP old_native/);
  assert.match(output, /FAIL new_red/);
  assert.match(output, /verify-red: RED crates\/demo\/tests\/existing\.rs/);
});

// The verify-red job's dtolnay/rust-toolchain step writes CARGO_TERM_COLOR=always
// to GITHUB_ENV (CI run 37808189647, PR #146): the script must read Cargo
// output with that variable set.
const coloredCargo = { CARGO_TERM_COLOR: "always", CLICOLOR_FORCE: "1" };

test("verify-red counts a Cargo test red when it does not compile on the base with CARGO_TERM_COLOR=always", () => {
  const result = runVerifyRed(
    ["#[test]", "fn two_is_two() {", "    assert_eq!(verify_red_demo::two(), 2);", "}", ""].join(
      "\n",
    ),
    "base",
    {
      file: "crates/demo/tests/added.rs",
      env: coloredCargo,
      seed(dir) {
        writeCrate(dir, "pub fn one() -> i32 {\n    1\n}\n");
      },
      headSeed(dir) {
        writeCrate(dir, "pub fn one() -> i32 {\n    1\n}\n\npub fn two() -> i32 {\n    2\n}\n");
      },
    },
  );
  const output = `${result.stdout}\n${result.stderr}`;
  assert.equal(result.status, 0, output);
  assert.match(output, /FAIL two_is_two \(base load error: error\[E0425\]/);
  assert.match(output, /verify-red: RED crates\/demo\/tests\/added\.rs/);
});

test("the verify-red job gets CARGO_TERM_COLOR from its toolchain step and the script turns it off", () => {
  const lines = readCi().split("\n");
  const start = lines.findIndex((line) => /^ {2}verify-red:\s*$/.test(line));
  assert.ok(start >= 0);
  let end = start + 1;
  while (end < lines.length && !/^ {2}[A-Za-z0-9_-]+:\s*$/.test(lines[end] ?? "")) end++;
  assert.match(lines.slice(start, end).join("\n"), /dtolnay\/rust-toolchain@/);
  const script = readFileSync(join(root, "scripts/verify-red.sh"), "utf8");
  const cargoRuns = script
    .split("\n")
    .filter((line) => /\bcargo test\b/.test(line) && !/^\s*#/.test(line));
  assert.ok(cargoRuns.length > 0);
  for (const line of cargoRuns) assert.match(line, /CARGO_TERM_COLOR=never/, line);
});
