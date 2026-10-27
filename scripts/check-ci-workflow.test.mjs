import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import picomatch from "picomatch";

import { evaluateCiStatus } from "./check-ci-status-needs.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// A git hook exports these. Fixture git must use `cwd`, not the parent repo.
const GIT_HOOK_VARS = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_IMPLICIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_INDEX_VERSION",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_PREFIX",
  "GIT_NAMESPACE",
  "GIT_QUARANTINE_PATH",
];

/**
 * @param {Record<string, string | undefined>} env
 */
function withoutGitHookEnv(env) {
  const next = { ...env };
  for (const key of GIT_HOOK_VARS) delete next[key];
  return next;
}

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

// Exact concurrency.group text. The test compares this string. It does not evaluate it.
const CONCURRENCY_GROUP =
  "${{ github.workflow }}-${{ github.ref }}${{ (github.event_name == 'schedule' || github.event.inputs.miri_full == 'true') && '-miri' || '' }}";

test("cancels an in-progress run for the same ref", () => {
  const yaml = readCi();
  assert.equal(concurrencyValue(yaml, "group"), CONCURRENCY_GROUP);
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
    env: withoutGitHookEnv({
      ...process.env,
      GIT_AUTHOR_NAME: "Fixture",
      GIT_AUTHOR_EMAIL: "fixture@example.com",
      GIT_COMMITTER_NAME: "Fixture",
      GIT_COMMITTER_EMAIL: "fixture@example.com",
    }),
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
  // a.test.mjs is judged on the base with the fixture, b.test.mjs stays new.
  assert.match(output, /copied test-support file tests\/fixtures\/helper\.mjs onto the base/);
  assert.doesNotMatch(output, /copied test-support file tests\/[ab]\.test\.mjs/);
  assert.doesNotMatch(output, /base load error/);
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
  // The fixture is copied, the src/ module it re-exports is not: the file
  // still does not load on the base and is run on the head.
  assert.match(
    output,
    /copied test-support file packages\/demo\/tests\/fixtures\/helper\.mjs onto the base/,
  );
  assert.doesNotMatch(output, /copied test-support file packages\/demo\/src\//);
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

test("verify-red runs an excluded bench file", () => {
  const dir = mkdtempSync(join(tmpdir(), "gwen-fake-pnpm-"));
  fakePnpmDirs.push(dir);
  const bin = join(dir, "pnpm");
  writeFileSync(
    bin,
    [
      "#!/bin/sh",
      'out=""',
      'prev=""',
      'config=""',
      'for arg in "$@"; do',
      '  if [ "$prev" = "--outputFile" ]; then',
      '    out="$arg"',
      "  fi",
      '  if [ "$prev" = "--config" ]; then',
      '    config="$arg"',
      "  fi",
      '  prev="$arg"',
      "done",
      'case "$*" in',
      "  *vitest*)",
      '    if [ -n "$config" ] && [ -n "$out" ]; then',
      '      printf \'%s\\n\' \'{"testResults":[{"assertionResults":[{"fullName":"bench gate fails on the base","status":"failed"}]}]}\' > "$out"',
      "      exit 0",
      "    fi",
      '    echo "No test files found" >&2',
      "    exit 1",
      "    ;;",
      "esac",
      "exit 0",
      "",
    ].join("\n"),
  );
  chmodSync(bin, 0o755);
  const result = runVerifyRed(
    [
      "import { test } from 'vitest';",
      "test('bench gate fails on the base', () => {",
      "  throw new Error('red');",
      "});",
      "",
    ].join("\n"),
    "base",
    {
      file: "packages/core/bench/added.test.ts",
      seed(repo) {
        mkdirSync(join(repo, "packages/core"), { recursive: true });
        writeFileSync(join(repo, "packages/core/package.json"), '{"name":"@gwenjs/core"}\n');
      },
      pathPrefix: dir,
    },
  );
  const output = `${result.stdout}\n${result.stderr}`;
  assert.equal(result.status, 0, output);
  assert.match(output, /verify-red: RED packages\/core\/bench\/added\.test\.ts/);
});

test("verify-red bench config aliases workspace packages to source", () => {
  const dir = mkdtempSync(join(tmpdir(), "gwen-fake-pnpm-"));
  fakePnpmDirs.push(dir);
  const bin = join(dir, "pnpm");
  writeFileSync(
    bin,
    [
      "#!/bin/sh",
      'out=""',
      'prev=""',
      'config=""',
      'for arg in "$@"; do',
      '  if [ "$prev" = "--outputFile" ]; then',
      '    out="$arg"',
      "  fi",
      '  if [ "$prev" = "--config" ]; then',
      '    config="$arg"',
      "  fi",
      '  prev="$arg"',
      "done",
      'case "$*" in',
      "  *vitest*)",
      '    if [ -n "$config" ] && [ -n "$out" ]; then',
      '      cat "$config" >&2',
      '      printf \'%s\\n\' \'{"testResults":[{"assertionResults":[{"fullName":"bench gate fails on the base","status":"failed"}]}]}\' > "$out"',
      "      exit 0",
      "    fi",
      '    echo "No test files found" >&2',
      "    exit 1",
      "    ;;",
      "esac",
      "exit 0",
      "",
    ].join("\n"),
  );
  chmodSync(bin, 0o755);
  const result = runVerifyRed(
    [
      "import { test } from 'vitest';",
      "test('bench gate fails on the base', () => {",
      "  throw new Error('red');",
      "});",
      "",
    ].join("\n"),
    "base",
    {
      file: "packages/core/bench/added.test.ts",
      seed(repo) {
        mkdirSync(join(repo, "packages/core"), { recursive: true });
        writeFileSync(join(repo, "packages/core/package.json"), '{"name":"@gwenjs/core"}\n');
      },
      pathPrefix: dir,
    },
  );
  const output = `${result.stdout}\n${result.stderr}`;
  assert.match(output, /gwenSourceAliases\(\)/);
  assert.match(output, /vitest\.aliases\.ts/);
  assert.equal(result.status, 0, output);
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
    // An `if:` gate is not part of the pin.
    return out.filter((line) => line !== "" && !line.startsWith("if:")).join("\n");
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

/** Deny set from issue #80. `-D warnings` makes each deny fail the job. */
const RUST_LINT_DENY = [
  "unsafe_op_in_unsafe_fn",
  "unwrap_used",
  "expect_used",
  "panic",
  "todo",
  "unimplemented",
  "unreachable",
  "undocumented_unsafe_blocks",
  "missing_safety_doc",
  "allow_attributes_without_reason",
];

test("rust-lint job runs fmt and the clippy deny set and ci-status reads it", () => {
  const yaml = readCi();
  const job = jobBlock(yaml, "rust-lint");
  assert.match(job, /cargo fmt --all --check/);
  assert.match(job, /cargo clippy --workspace --all-targets -- -D warnings/);
  assert.match(job, /cargo clippy -p gwen-core --all-targets --features physics2d -- -D warnings/);
  assert.match(job, /cargo clippy -p gwen-core --all-targets --features physics3d -- -D warnings/);
  assert.match(
    job,
    /cargo clippy -p gwen-core --all-targets --features build-tools -- -D warnings/,
  );
  assert.match(
    job,
    /cargo clippy -p gwen-core --lib --target wasm32-unknown-unknown -- -D warnings/,
  );
  assert.match(
    job,
    /cargo clippy -p gwen-core --lib --target wasm32-unknown-unknown --features physics2d -- -D warnings/,
  );
  assert.match(
    job,
    /cargo clippy -p gwen-core --lib --target wasm32-unknown-unknown --features physics3d -- -D warnings/,
  );
  const status = jobBlock(yaml, "ci-status");
  assert.match(status, /(?:needs:\s*\[[^\]]*rust-lint|^\s+- rust-lint$)/m);
  assert.match(status, /needs\['rust-lint'\]\.result/);
  // The pinned dtolnay action rejects an empty toolchain input. It does not
  // read rust-toolchain.toml unless that input is set to the same channel.
  // The bench job runs cargo for the solver presets. Without this pin, rustup
  // blocks inside execFileSync and the job hits the six-hour cancel.
  // rust-toolchain.toml also asks for rustfmt and clippy. Two parallel cargo
  // processes download those components and the rename races. The action
  // installs them once when `components` is set.
  for (const id of ["rust", "rust-lint", "storage-bench", "verify-red", "bench"]) {
    const block = jobBlock(yaml, id);
    assert.match(block, /toolchain:\s*"1\.99\.0"/, id);
    assert.match(block, /components:\s*rustfmt,\s*clippy/, id);
  }
  const cargo = readFileSync(join(root, "Cargo.toml"), "utf8");
  for (const lint of RUST_LINT_DENY) {
    assert.match(cargo, new RegExp(`^${lint}\\s*=\\s*"deny"`, "m"), lint);
  }
});

/**
 * One key of the `on:` block, from its line to the next key.
 *
 * @param {string} on
 * @param {string} key
 * @returns {string}
 */
function onKeyBlock(on, key) {
  const lines = on.split("\n");
  const start = lines.findIndex((line) => line === `  ${key}:`);
  assert.ok(start !== -1, key);
  let end = start + 1;
  while (end < lines.length && !/^ {2}[A-Za-z0-9_-]+:/.test(lines[end] ?? "")) end++;
  return lines.slice(start, end).join("\n");
}

/**
 * Env lines of the "Resolve mode" step.
 *
 * @param {string} yaml
 * @returns {string[]}
 */
function resolveModeEnv(yaml) {
  const lines = jobBlock(yaml, "changes").split("\n");
  const nameAt = lines.findIndex((line) => line === "      - name: Resolve mode");
  assert.ok(nameAt !== -1, "Resolve mode step is missing");
  const envAt = lines.findIndex((line, index) => index > nameAt && line === "        env:");
  assert.ok(envAt !== -1 && envAt > nameAt, "Resolve mode env is missing");
  /** @type {string[]} */
  const body = [];
  for (let i = envAt + 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (!line.startsWith("          ")) break;
    body.push(line);
  }
  return body;
}

/**
 * Shell of the "Resolve mode" step, YAML indent removed.
 *
 * @param {string} yaml
 * @returns {string}
 */
function resolveModeScript(yaml) {
  const lines = jobBlock(yaml, "changes").split("\n");
  const nameAt = lines.findIndex((line) => line === "      - name: Resolve mode");
  assert.ok(nameAt !== -1, "Resolve mode step is missing");
  const runAt = lines.findIndex((line, index) => index > nameAt && line === "        run: |");
  assert.ok(runAt !== -1 && runAt > nameAt, "Resolve mode run is missing");
  /** @type {string[]} */
  const body = [];
  for (let i = runAt + 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line === "") {
      body.push("");
      continue;
    }
    if (!line.startsWith("          ")) break;
    body.push(line.slice(10));
  }
  assert.ok(body.some((line) => line.includes('>> "$GITHUB_OUTPUT"')));
  return `${body.join("\n")}\n`;
}

/**
 * @param {string} script
 * @param {Record<string, string>} env
 * @returns {Record<string, string>}
 */
function runResolveMode(script, env) {
  const dir = mkdtempSync(join(tmpdir(), "gwen-resolve-mode-"));
  const output = join(dir, "github-output.txt");
  try {
    writeFileSync(join(dir, "resolve.sh"), script);
    const result = spawnSync("bash", ["resolve.sh"], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, ...env, GITHUB_OUTPUT: output },
    });
    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
    /** @type {Record<string, string>} */
    const outputs = {};
    const text = existsSync(output) ? readFileSync(output, "utf8") : "";
    for (const line of text.split("\n")) {
      if (line === "") continue;
      const eq = line.indexOf("=");
      assert.ok(eq > 0, line);
      outputs[line.slice(0, eq)] = line.slice(eq + 1);
    }
    return outputs;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * @param {string} yaml
 * @returns {string[]}
 */
function jobIds(yaml) {
  const marker = "\njobs:\n";
  const start = yaml.indexOf(marker);
  assert.ok(start !== -1);
  return [...yaml.slice(start + marker.length).matchAll(/^ {2}([A-Za-z0-9_-]+):\s*$/gm)].map(
    (match) => match[1] ?? "",
  );
}

const MIRI_FULL_COMMANDS = [
  "cargo +${{ env.MIRI_TOOLCHAIN }} miri test --no-fail-fast -p gwen-core --lib --tests",
  "cargo +${{ env.MIRI_TOOLCHAIN }} miri test -p gwen-wasm-utils",
];

test("ci.yml runs the full Miri job by schedule and manual dispatch only", () => {
  const on = onBlock(readCi());
  assert.match(on, /schedule:\n {4}- cron: "0 6 \* \* 1"/);
  const dispatch = onKeyBlock(on, "workflow_dispatch");
  assert.match(dispatch, /^ {4}inputs:\n {6}miri_full:\n/m);
  assert.match(dispatch, /description: run only the full Miri job/);
  assert.match(dispatch, /type: boolean/);
  assert.match(dispatch, /default: true/);
  assert.match(on, /push:\n {4}branches: \[main, v1-alpha, "hardening\/\*\*"\]/);
  const pull = onKeyBlock(on, "pull_request");
  assert.match(pull, /pull_request:/);
  assert.equal(pull.includes("\n    branches:"), false);
  assert.equal(pull.includes("\n    paths:"), false);
  assert.equal(on.split("\n").filter((line) => line === "  schedule:").length, 1);
  assert.equal(on.split("\n").filter((line) => line === "  workflow_dispatch:").length, 1);
});

test("Resolve mode never selects the Miri job for a pull request or a push", () => {
  const yaml = readCi();
  assert.ok(
    resolveModeEnv(yaml).includes("          MIRI_FULL: ${{ github.event.inputs.miri_full }}"),
  );
  const script = resolveModeScript(yaml);
  const pull = runResolveMode(script, {
    EVENT: "pull_request",
    CODE: "true",
    RUST: "true",
    ROOT: "true",
    STACK: "true",
    MIRI_FULL: "",
  });
  assert.equal(pull.miri_full, "false");
  assert.equal(pull.miri_only, "false");
  assert.equal(pull.full, "false");
  assert.equal(pull.code, "true");
  assert.equal(pull.rust, "true");
  assert.equal(pull.root, "true");
  assert.equal(pull.stack, "true");
  const push = runResolveMode(script, {
    EVENT: "push",
    CODE: "false",
    RUST: "false",
    ROOT: "false",
    STACK: "false",
    MIRI_FULL: "",
  });
  assert.equal(push.miri_full, "false");
  assert.equal(push.miri_only, "false");
  assert.equal(push.full, "true");
  assert.equal(push.code, "true");
  assert.equal(push.rust, "true");
  assert.equal(push.root, "true");
  assert.equal(push.stack, "true");
  const dispatched = runResolveMode(script, {
    EVENT: "workflow_dispatch",
    CODE: "false",
    RUST: "false",
    ROOT: "false",
    STACK: "false",
    MIRI_FULL: "",
  });
  assert.equal(dispatched.miri_full, "false");
  assert.equal(dispatched.full, "true");
  const unticked = runResolveMode(script, {
    EVENT: "workflow_dispatch",
    CODE: "false",
    RUST: "false",
    ROOT: "false",
    STACK: "false",
    MIRI_FULL: "false",
  });
  assert.equal(unticked.miri_full, "false");
  assert.equal(unticked.miri_only, "false");
  assert.equal(unticked.full, "true");
  assert.equal(unticked.code, "true");
  assert.equal(unticked.rust, "true");
  assert.equal(unticked.root, "true");
  assert.equal(unticked.stack, "true");
  const called = runResolveMode(script, {
    EVENT: "workflow_call",
    CODE: "false",
    RUST: "false",
    ROOT: "false",
    STACK: "false",
    MIRI_FULL: "",
  });
  assert.equal(called.miri_full, "false");
  assert.equal(called.full, "true");
});

test("Resolve mode runs only the Miri job for a schedule and a miri dispatch", () => {
  const yaml = readCi();
  assert.ok(
    resolveModeEnv(yaml).includes("          MIRI_FULL: ${{ github.event.inputs.miri_full }}"),
  );
  const script = resolveModeScript(yaml);
  for (const env of [
    { EVENT: "schedule", MIRI_FULL: "" },
    { EVENT: "workflow_dispatch", MIRI_FULL: "true" },
  ]) {
    const outputs = runResolveMode(script, {
      EVENT: env.EVENT,
      MIRI_FULL: env.MIRI_FULL,
      CODE: "true",
      RUST: "true",
      ROOT: "true",
      STACK: "true",
    });
    assert.equal(outputs.miri_full, "true", env.EVENT);
    assert.equal(outputs.miri_only, "true", env.EVENT);
    assert.equal(outputs.full, "false", env.EVENT);
    assert.equal(outputs.code, "false", env.EVENT);
    assert.equal(outputs.rust, "false", env.EVENT);
    assert.equal(outputs.root, "false", env.EVENT);
    assert.equal(outputs.stack, "false", env.EVENT);
  }
});

test("rust-miri-full is skipped unless the mode selects it and runs the lib and integration tests", () => {
  const job = jobBlock(readCi(), "rust-miri-full");
  assert.match(job, /^ {4}if: needs\.changes\.outputs\.miri_full == 'true'$/m);
  assert.match(job, /^ {4}needs: \[changes\]$/m);
  assert.deepEqual(
    [...job.matchAll(/^ {8}run: (.+)$/gm)].map((match) => match[1] ?? ""),
    MIRI_FULL_COMMANDS,
  );
  assert.doesNotMatch(job, /MIRIFLAGS|-Zmiri-/);
  const found = job.match(/2 \* ceil\((\d+)\/60\) = (\d+)\./);
  assert.ok(found, "the timeout comment is missing");
  const minutes = 2 * Math.ceil(Number(found[1]) / 60);
  assert.equal(Number(found[2]), minutes);
  const timeout = job.match(/timeout-minutes:\s*(\d+)/);
  assert.ok(timeout, "timeout-minutes is missing");
  assert.equal(Number(timeout[1]), minutes);
});

test("no other job can start in a miri-only run", () => {
  const yaml = readCi();
  const exempt = new Set(["changes", "rust-miri-full", "ci-status", "agent-hygiene"]);
  const ids = jobIds(yaml).filter((id) => !exempt.has(id));
  assert.ok(ids.includes("lint"));
  const gate = /^if: needs\.changes\.outputs\.(code|rust|root|full|stack) == 'true'$/;
  for (const id of ids) {
    const ifLine = jobBlock(yaml, id)
      .split("\n")
      .find((line) => /^ {4}if:/.test(line));
    assert.ok(ifLine, `${id} has no if`);
    assert.match(ifLine.trim(), gate, id);
  }
  const hygiene = jobBlock(yaml, "agent-hygiene")
    .split("\n")
    .find((line) => /^ {4}if:/.test(line));
  assert.equal(
    hygiene?.trim(),
    "if: needs.changes.result == 'success' && needs.changes.outputs.miri_only != 'true'",
  );
});

test("a Miri run does not share a concurrency group with a push", () => {
  const yaml = readCi();
  const group = concurrencyValue(yaml, "group");
  assert.equal(group, CONCURRENCY_GROUP);
  assert.equal(
    concurrencyValue(yaml, "cancel-in-progress"),
    "${{ github.event_name == 'pull_request' }}",
  );
  assert.match(group ?? "", /github\.event_name == 'schedule'/);
  assert.match(group ?? "", /github\.event\.inputs\.miri_full == 'true'/);
  assert.match(group ?? "", /'-miri'/);
});

test("rust-miri timeout is twice the cold wall in whole minutes", () => {
  const job = jobBlock(readCi(), "rust-miri");
  const found = job.match(/2 \* ceil\((\d+)\/60\) = (\d+)/);
  assert.ok(found, "the comment is missing");
  const seconds = Number(found[1]);
  const minutes = Number(found[2]);
  assert.equal(minutes, 2 * Math.ceil(seconds / 60));
  const timeout = job.match(/timeout-minutes:\s*(\d+)/);
  assert.ok(timeout);
  assert.equal(Number(timeout[1]), minutes);
});

const MIRI_CARGO = "cargo +${{ env.MIRI_TOOLCHAIN }} miri test -p gwen-core";

test("rust-miri-step runs the step tests on x86_64 under Stacked Borrows", () => {
  const ci = readCi();
  const job = jobBlock(ci, "rust-miri-step");
  assert.notEqual(job, "", "rust-miri-step job is missing");
  assert.match(job, /^ {4}runs-on: ubuntu-latest$/m);
  for (const line of job.split("\n")) {
    if (!/^ {4}runs-on:/.test(line)) continue;
    assert.doesNotMatch(line, /aarch64|ubuntu-24\.04-arm/);
  }
  assert.match(job, /^ {4}needs: \[changes\]$/m);
  assert.match(job, /^ {4}if: needs\.changes\.outputs\.rust == 'true'$/m);
  assert.equal(job.includes("MIRIFLAGS"), false);
  for (const command of [
    `${MIRI_CARGO} --features physics2d --test physics_step_miri`,
    `${MIRI_CARGO} --features physics3d --test physics_step_miri`,
    `${MIRI_CARGO} --features physics3d --test physics3d_overlap_bulk`,
  ]) {
    assert.ok(job.includes(`run: ${command}\n`), command);
  }
  assert.equal(ci.split("-Zmiri-tree-borrows").length - 1, 0, "no -Zmiri-tree-borrows in ci.yml");
  assert.equal(ci.includes("-Zmiri-disable"), false, "no -Zmiri-disable flag");
  assert.doesNotMatch(jobBlock(ci, "rust-miri"), /MIRIFLAGS/);
  const status = jobBlock(ci, "ci-status");
  assert.match(status, /needs: \[[^\]]*\brust-miri-step\b[^\]]*\]/);
  assert.match(status, /needs\['rust-miri-step'\]\.result/);
});

test("rust-miri-step timeout is twice the cold wall in whole minutes", () => {
  const job = jobBlock(readCi(), "rust-miri-step");
  const found = job.match(/2 \* ceil\((\d+)\/60\) = (\d+)/);
  assert.ok(found, "the comment is missing");
  const seconds = Number(found[1]);
  const minutes = Number(found[2]);
  assert.equal(minutes, 2 * Math.ceil(seconds / 60));
  const timeout = job.match(/timeout-minutes:\s*(\d+)/);
  assert.ok(timeout, "timeout-minutes is missing");
  assert.equal(Number(timeout[1]), minutes);
});

test("rust-miri runs the lib unsafe_site_ tests for no feature, physics2d and physics3d", () => {
  const job = jobBlock(readCi(), "rust-miri");
  for (const command of [
    `${MIRI_CARGO} --lib unsafe_site_`,
    `${MIRI_CARGO} --features physics2d --lib unsafe_site_`,
    `${MIRI_CARGO} --features physics3d --lib unsafe_site_`,
  ]) {
    assert.ok(job.includes(`run: ${command}\n`), command);
  }
});

test("glue-shape job runs the golden check on the core-wasm artifact", () => {
  const yaml = readCi();
  const job = jobBlock(yaml, "glue-shape");
  assert.notEqual(job, "", "glue-shape job is missing");
  assert.match(job, /needs: \[(?:changes, )?rust\]/);
  assert.match(job, /name: core-wasm\n\s+path: packages\/core\/wasm\//);
  assert.match(job, /node scripts\/wasm-factory-golden\.mjs --check/);
  assert.match(job, /timeout-minutes:/);
  const status = jobBlock(yaml, "ci-status");
  assert.match(status, /needs\['glue-shape'\]\.result/);
});

test("stack-pack runs after rust, packs and uploads stack-tarballs", () => {
  const job = jobBlock(readCi(), "stack-pack");
  assert.match(job, /needs: \[[^\]]*\bchanges\b[^\]]*\]/);
  assert.match(job, /needs: \[[^\]]*\brust\b[^\]]*\]/);
  const packAt = job.indexOf("run: node scripts/stack/pack.mjs --out stack");
  const buildAt = job.indexOf("run: pnpm build:ts");
  assert.equal(buildAt >= 0 && packAt > buildAt, true);
  for (const [name, artifactPath] of [
    ["physics3d-build-tools", "packages/physics3d/build-tools/"],
    ["physics3d-wasm-bvh", "packages/physics3d/wasm/bvh/"],
    ["physics3d-fracture-wasm", "packages/physics3d-fracture/wasm/"],
    ["core-wasm", "packages/core/wasm/"],
  ]) {
    const found = new RegExp(
      `name: ${name}\\n\\s+path: ${artifactPath.replace(/\//g, "\\/")}`,
    ).exec(job);
    assert.ok(found, name);
    assert.equal(found.index < packAt, true, name);
  }
  assert.match(job, /uses: actions\/upload-artifact@/);
  assert.match(job, /name: stack-tarballs\n\s+path: stack\/\n\s+retention-days: 7\n/);
});

test("stack-pack runs only when the change can impact the packed output", () => {
  const yaml = readCi();
  const job = jobBlock(yaml, "stack-pack");
  assert.match(job, /if: needs\.changes\.outputs\.stack == 'true'/);
  assert.doesNotMatch(job, /needs\.changes\.outputs\.code/);

  const changes = jobBlock(yaml, "changes");
  assert.match(changes, /^ {6}stack: \$\{\{ steps\.mode\.outputs\.stack \}\}$/m);
  const modeAt = changes.indexOf("name: Resolve mode");
  assert.equal(modeAt >= 0, true);
  const mode = changes.slice(modeAt);
  assert.match(mode, /STACK: \$\{\{ steps\.filter_every\.outputs\.stack \}\}/);
  const nonPr = mode.indexOf('if [ "$EVENT" != "pull_request" ]; then');
  const stackTrue = mode.indexOf('echo "stack=true" >> "$GITHUB_OUTPUT"');
  const elseAt = mode.indexOf("\n          else\n");
  const stackFromFilter = mode.indexOf('echo "stack=$STACK" >> "$GITHUB_OUTPUT"');
  assert.equal(
    nonPr >= 0 && stackTrue > nonPr && elseAt > stackTrue && stackFromFilter > elseAt,
    true,
  );

  const lines = changes.split("\n");
  const header = lines.indexOf("            stack:");
  assert.notEqual(header, -1);
  /** @type {string[]} */
  const patterns = [];
  for (let index = header + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (!line.startsWith("              - '")) break;
    assert.equal(line.endsWith("'"), true);
    patterns.push(line.slice("              - '".length, -1));
  }
  const positive = patterns.filter((pattern) => !pattern.startsWith("!"));
  assert.equal(positive.length, 1);
  assert.equal(patterns[0], positive[0]);
  const pattern = positive[0] ?? "";
  assert.equal(pattern.includes("packages/**"), true);
  assert.equal(pattern.includes("crates/**"), true);
  assert.equal(pattern.includes("scripts/stack/**"), true);
  assert.equal(pattern.includes(".github/workflows/ci.yml"), true);
  assert.equal(patterns[1], "!**/*.md");
});

test("stack-pack has a timeout-minutes", () => {
  const job = jobBlock(readCi(), "stack-pack");
  const found = job.match(/timeout-minutes:\s*(\d+)/);
  assert.ok(found);
  const minutes = Number(found[1]);
  assert.equal(Number.isInteger(minutes) && minutes > 0, true);
});

test("ci-status needs and reads stack-pack", () => {
  const report = evaluateCiStatus(readCi());
  assert.deepEqual(report.missing, []);
  assert.deepEqual(report.unread, []);
  assert.equal(report.jobs.includes("stack-pack"), true);
});

// The script name is split so this file does not contain it.
const deletedPublishScript = "verdaccio-publish" + ".sh";

test(`${deletedPublishScript} is deleted and verdaccio:publish runs the stack scripts`, () => {
  const scriptPath = join(root, "scripts", deletedPublishScript);
  assert.equal(existsSync(scriptPath), false);
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const command = pkg.scripts?.["verdaccio:publish"];
  assert.equal(
    command,
    "pnpm build:ts && node scripts/stack/pack.mjs --out stack && node scripts/stack/registry.mjs publish --out stack",
  );
  const grep = spawnSync("git", ["grep", "-n", "-F", "--", deletedPublishScript], {
    cwd: root,
    encoding: "utf8",
    env: withoutGitHookEnv({ ...process.env }),
  });
  assert.equal(grep.status, 1, grep.stdout);
  assert.equal(grep.stdout, "");
  const control = spawnSync("git", ["grep", "-l", "-F", "--", "verdaccio:publish"], {
    cwd: root,
    encoding: "utf8",
    env: withoutGitHookEnv({ ...process.env }),
  });
  assert.equal(control.status, 0, control.stderr);
  assert.match(control.stdout, /package\.json/);
});

test("verdaccio:start creates the htpasswd directory before starting Verdaccio", () => {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const command = pkg.scripts?.["verdaccio:start"];
  const yaml = readFileSync(join(root, "verdaccio.yaml"), "utf8");
  const found = yaml.match(/^auth:\n {2}htpasswd:\n {4}file:\s*(\S+)\s*$/m);
  assert.ok(found);
  const directory = dirname(found[1]);
  const authDir = directory.startsWith("./") ? directory.slice(2) : directory;
  assert.equal(authDir, ".verdaccio");
  assert.equal(command, `mkdir -p ${authDir} && verdaccio --config ./verdaccio.yaml`);
});

test("verdaccio.yaml does not claim the registry is never used in CI", () => {
  const text = readFileSync(join(root, "verdaccio.yaml"), "utf8");
  assert.equal(text.includes("jamais utilisé en CI"), false);
  assert.equal(text.includes("scripts/stack/"), true);
});

/**
 * Name and run of each step in one job. A folded run block is joined with " && ".
 *
 * @param {string} jobText
 * @returns {{ name: string, run: string }[]}
 */
function namedSteps(jobText) {
  /** @type {{ name: string, run: string }[]} */
  const steps = [];
  /** @type {{ name: string, run: string } | null} */
  let step = null;
  let runBlock = false;
  for (const line of jobText.split("\n")) {
    if (/^ {6}- /.test(line)) {
      if (step) steps.push(step);
      step = { name: "", run: "" };
      runBlock = false;
      const inlineName = /^ {6}- name: (.*)$/.exec(line);
      if (inlineName) step.name = inlineName[1] ?? "";
      continue;
    }
    if (!step) continue;
    const name = /^ {8}name: (.*)$/.exec(line);
    const run = /^ {8}run: ?(.*)$/.exec(line);
    if (name) step.name = name[1] ?? "";
    if (run) {
      if (run[1] === "|" || run[1] === ">") runBlock = true;
      else step.run = run[1] ?? "";
      continue;
    }
    if (runBlock && /^ {10}\S/.test(line)) {
      step.run = step.run ? `${step.run} && ${line.trim()}` : line.trim();
    } else if (runBlock && line.trim() !== "") {
      runBlock = false;
    }
  }
  if (step) steps.push(step);
  return steps;
}

test("browser-wasm installs system deps through the retry guard", () => {
  const steps = namedSteps(jobBlock(readCi(), "browser-wasm"));
  assert.equal(
    steps.some((step) => step.run.includes("--with-deps")),
    false,
  );
  const deps = steps.findIndex((step) => step.name === "Install Playwright system dependencies");
  const browsers = steps.findIndex((step) => step.name === "Install Playwright browsers");
  const browserTests = steps.findIndex((step) => step.name === "Browser tests");
  assert.notEqual(deps, -1);
  const depsRun = steps[deps]?.run ?? "";
  assert.equal(depsRun.includes("sudo"), true, depsRun);
  assert.equal(
    depsRun.includes("scripts/retry-with-timeout.mjs --attempts 3 --timeout 120 --"),
    true,
    depsRun,
  );
  assert.equal(depsRun.includes("dpkg --configure -a"), true, depsRun);
  assert.equal(depsRun.includes("install-deps chromium firefox webkit"), true, depsRun);
  assert.equal(depsRun.includes("pnpm"), false, depsRun);
  assert.ok(browsers > deps);
  assert.equal(
    steps[browsers]?.run,
    "pnpm --filter @gwenjs/core exec playwright install chromium firefox webkit",
  );
  assert.ok(browserTests > browsers);
});

test("browser-wasm guard fits inside the job timeout", () => {
  const job = jobBlock(readCi(), "browser-wasm");
  const minutes = /^ {4}timeout-minutes: (\d+)$/m.exec(job);
  assert.ok(minutes, "browser-wasm has no timeout-minutes");
  const timeoutMinutes = Number(minutes[1]);
  const deps = namedSteps(job).find(
    (step) => step.name === "Install Playwright system dependencies",
  );
  assert.ok(deps, "missing system dependencies step");
  const attempts = /--attempts (\d+)/.exec(deps.run);
  const timeout = /--timeout (\d+)/.exec(deps.run);
  assert.ok(attempts && timeout, deps.run);
  const attemptsN = Number(attempts[1]);
  const timeoutS = Number(timeout[1]);
  // 2 x the default 5 s grace (SIGTERM wait, then SIGKILL wait).
  const graceAllowanceS = 10;
  assert.equal(timeoutMinutes, 10);
  assert.ok(
    attemptsN * (timeoutS + graceAllowanceS) <= timeoutMinutes * 60 - 120,
    `${attemptsN}*(${timeoutS}+${graceAllowanceS})s exceeds ${timeoutMinutes} min minus 120s`,
  );
});

const PATHS_FILTER_USES = "dorny/paths-filter@0e4a8c6effa4802afeda77dc8d303f8176d7dfad";

const CODE_PATTERNS = ["**", "!**/*.md", "!docs/**", "!notes/**", "!internals-docs/**"];
const STACK_PATTERNS =
  "{packages/**,crates/**,scripts/stack/**,scripts/fix-dts-extensions.mjs,scripts/build-wasm.sh,pnpm-lock.yaml,pnpm-workspace.yaml,package.json,.github/workflows/ci.yml,.github/actions/**}|!**/*.md|!docs/**".split(
    "|",
  );
const RUST_PATTERNS =
  "crates/**|Cargo.toml|Cargo.lock|deny.toml|wasm-size.json|scripts/**|.github/workflows/ci.yml".split(
    "|",
  );
const ROOT_PATTERNS =
  "pnpm-lock.yaml|pnpm-workspace.yaml|package.json|tsconfig*.json|oxlint.json|.oxfmtrc.json|scripts/**|.github/**".split(
    "|",
  );

/**
 * @typedef {{ id: string, quantifier: string, uses: string, filters: Record<string, string[]> }} FilterStep
 */

/** @param {string} changes @returns {FilterStep[]} */
function changesFilterSteps(changes) {
  const lines = changes.split("\n");
  /** @type {FilterStep[]} */
  const steps = [];
  for (let start = 0; start < lines.length; start++) {
    if (!(lines[start] ?? "").startsWith("      - ")) continue;
    let end = start + 1;
    while (end < lines.length && !(lines[end] ?? "").startsWith("      - ")) end++;
    const block = lines.slice(start, end);
    const usesLine = block.find((line) => /^\s*(?:-\s+)?uses:/.test(line));
    if (!usesLine || !usesLine.includes("dorny/paths-filter@")) continue;
    const idLine = block.find((line) => /^\s+id:/.test(line));
    const quantLine = block.find((line) => /^\s+predicate-quantifier:/.test(line));
    /** @type {Record<string, string[]>} */
    const filters = {};
    const filtersAt = block.findIndex((line) => line.trim() === "filters: |");
    let name = "";
    for (let i = filtersAt + 1; filtersAt !== -1 && i < block.length; i++) {
      const line = block[i] ?? "";
      const named = /^ {12}([A-Za-z0-9_-]+):\s*$/.exec(line);
      if (named) {
        name = named[1] ?? "";
        filters[name] = [];
        continue;
      }
      if (name && line.startsWith("              - '") && line.endsWith("'")) {
        filters[name].push(line.slice("              - '".length, -1));
        continue;
      }
      if (line.trim() === "") continue;
      break;
    }
    steps.push({
      id: idLine ? idLine.trim().replace(/^id:\s*/, "") : "",
      quantifier: quantLine ? quantLine.trim().replace(/^predicate-quantifier:\s*/, "") : "",
      uses: usesLine
        .trim()
        .replace(/^(?:-\s+)?uses:\s*/, "")
        .replace(/\s+#.*$/, ""),
      filters,
    });
    start = end - 1;
  }
  return steps;
}

/** @param {string} changes @param {string} filterName @returns {FilterStep} */
function filterOwner(changes, filterName) {
  const owners = changesFilterSteps(changes).filter((step) =>
    Object.hasOwn(step.filters, filterName),
  );
  assert.equal(owners.length, 1, filterName);
  const step = owners[0];
  assert.ok(step, filterName);
  return step;
}

/** One picomatch per pattern (`{dot: true}`), then the quantifier. Empty files match nothing.
 * @param {readonly string[]} patterns
 * @param {readonly string[]} files
 * @param {string} quantifier
 * @returns {boolean}
 */
function filesMatch(patterns, files, quantifier) {
  return files.some((file) => {
    const hit = (pattern) => picomatch(pattern, { dot: true })(file);
    if (quantifier === "every") return patterns.every(hit);
    if (quantifier === "some") return patterns.some(hit);
    assert.fail(quantifier);
  });
}

/** @param {string} filterName @param {readonly string[]} files @returns {boolean} */
function matches(filterName, files) {
  const step = filterOwner(jobBlock(readCi(), "changes"), filterName);
  const patterns = step.filters[filterName] ?? [];
  return filesMatch(patterns, files, step.quantifier);
}

test("changes job evaluates the code and stack filters with every", () => {
  const steps = changesFilterSteps(jobBlock(readCi(), "changes"));
  const owners = steps.filter((step) => step.filters.code && step.filters.stack);
  assert.equal(owners.length, 1);
  const step = owners[0];
  assert.ok(step);
  assert.equal(step.quantifier, "every");
  assert.equal(step.uses, PATHS_FILTER_USES);
  assert.deepEqual(Object.keys(step.filters), ["code", "stack"]);
  assert.deepEqual(step.filters.code, CODE_PATTERNS);
  assert.deepEqual(step.filters.stack, STACK_PATTERNS);
  assert.equal(matches("code", ["README.md"]), false);
  assert.equal(matches("code", ["crates/gwen-core/src/lib.rs"]), true);
  assert.equal(matches("code", ["packages/core/src/index.ts"]), true);
  assert.equal(matches("code", ["docs/index.md"]), false);
  assert.equal(matches("stack", ["packages/core/src/index.ts"]), true);
  assert.equal(matches("stack", ["packages/core/README.md"]), false);
  assert.equal(matches("stack", ["docs/index.md"]), false);
});

test("changes job evaluates the rust and root filters with some", () => {
  const steps = changesFilterSteps(jobBlock(readCi(), "changes"));
  const owners = steps.filter((step) => step.filters.rust && step.filters.root);
  assert.equal(owners.length, 1);
  const step = owners[0];
  assert.ok(step);
  assert.equal(step.quantifier, "some");
  assert.equal(step.uses, PATHS_FILTER_USES);
  assert.deepEqual(Object.keys(step.filters), ["rust", "root"]);
  assert.deepEqual(step.filters.rust, RUST_PATTERNS);
  assert.deepEqual(step.filters.root, ROOT_PATTERNS);
});

test("Resolve mode reads each filter output from the step that owns it", () => {
  const yaml = readCi();
  const changes = jobBlock(yaml, "changes");
  const codeId = filterOwner(changes, "code").id;
  const stackId = filterOwner(changes, "stack").id;
  const rustId = filterOwner(changes, "rust").id;
  const rootId = filterOwner(changes, "root").id;
  assert.equal(codeId, stackId);
  assert.equal(rustId, rootId);
  assert.notEqual(codeId, rustId);
  const env = resolveModeEnv(yaml);
  assert.ok(env.includes(`          CODE: \${{ steps.${codeId}.outputs.code }}`));
  assert.ok(env.includes(`          STACK: \${{ steps.${stackId}.outputs.stack }}`));
  assert.ok(env.includes(`          RUST: \${{ steps.${rustId}.outputs.rust }}`));
  assert.ok(env.includes(`          ROOT: \${{ steps.${rootId}.outputs.root }}`));
});

test("rust and root filters match a Rust or workflow file alone and not a doc, with the ci.yml quantifier", () => {
  assert.equal(matches("rust", ["crates/gwen-core/src/lib.rs"]), true);
  assert.equal(matches("rust", ["docs/index.md"]), false);
  assert.equal(matches("root", ["docs/index.md"]), false);
  assert.equal(matches("rust", [".github/workflows/ci.yml"]), true);
  assert.equal(matches("root", [".github/workflows/ci.yml"]), true);
  assert.equal(matches("rust", []), false);
  assert.equal(matches("root", []), false);
  assert.equal(matches("rust", ["docs/index.md", "crates/gwen-core/src/lib.rs"]), true);
  assert.equal(matches("root", ["pnpm-lock.yaml"]), true);
  assert.equal(matches("rust", ["pnpm-lock.yaml"]), false);
  const rust = filterOwner(jobBlock(readCi(), "changes"), "rust").filters.rust ?? [];
  const file = "crates/gwen-core/src/lib.rs";
  assert.equal(filesMatch(rust, [file], "every"), false);
  assert.equal(filesMatch(rust, [file], "some"), true);
});
