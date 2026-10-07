import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function readCi() {
  return readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8');
}

function onBlock(yaml) {
  const start = yaml.indexOf('\non:\n');
  const end = yaml.indexOf('\njobs:\n');
  assert.ok(start !== -1 && end > start);
  return yaml.slice(start, end);
}

test('pull request runs for every base', () => {
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
    if (line === 'concurrency:') {
      inBlock = true;
      continue;
    }
    if (inBlock && line !== '' && !/^ /.test(line)) break;
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
  const raw = concurrencyValue(yaml, 'cancel-in-progress');
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === "${{ github.event_name == 'pull_request' }}") return eventName === 'pull_request';
  if (raw === '${{ github.event_name == "pull_request" }}') return eventName === 'pull_request';
  return false;
}

test('cancels an in-progress run for the same ref', () => {
  const yaml = readCi();
  assert.equal(concurrencyValue(yaml, 'group'), '${{ github.workflow }}-${{ github.ref }}');
  assert.equal(cancelsInProgress(yaml, 'pull_request'), true);
  assert.equal(cancelsInProgress(yaml, 'push'), false);
});

test('runs verify-red against the pull request base', () => {
  const yaml = readCi();
  assert.match(yaml, /scripts\/verify-red\.sh/);
  assert.match(yaml, /HYGIENE_BASE:\s*origin\/\$\{\{\s*github\.base_ref\s*\}\}/);
  const script = readFileSync(join(root, 'scripts/verify-red.sh'), 'utf8');
  assert.match(script, /grep -qx 'no-red-check'/);
});

/**
 * @param {string} dir
 * @param {string[]} args
 */
function git(dir, args) {
  const result = spawnSync('git', args, {
    cwd: dir,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Fixture',
      GIT_AUTHOR_EMAIL: 'fixture@example.com',
      GIT_COMMITTER_NAME: 'Fixture',
      GIT_COMMITTER_EMAIL: 'fixture@example.com',
    },
  });
  assert.equal(result.status, 0, result.stderr);
}

/**
 * @param {string} source
 * @param {string} base
 * @param {{ file?: string, seed?: (dir: string) => void, pathPrefix?: string }} [options]
 */
function runVerifyRed(source, base, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'gwen-verify-red-fixture-'));
  const file = options.file ?? 'added.test.mjs';
  try {
    git(dir, ['init', '-b', 'base']);
    writeFileSync(join(dir, 'README.md'), 'base\n');
    if (options.seed) options.seed(dir);
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-m', 'base']);
    git(dir, ['checkout', '-b', 'change']);
    const dest = join(dir, file);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, source);
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-m', 'add test']);
    const env = {
      ...process.env,
      HYGIENE_BASE: base,
      GH_TOKEN: '',
      GITHUB_TOKEN: '',
      PR_NUMBER: '',
      PR_REPO: '',
    };
    if (options.pathPrefix) env.PATH = `${options.pathPrefix}:${env.PATH ?? ''}`;
    for (const key of Object.keys(env)) {
      if (key.startsWith('NODE_TEST') || key === 'NODE_CHANNEL_FD') delete env[key];
    }
    return spawnSync('bash', [join(root, 'scripts/verify-red.sh')], {
      cwd: dir,
      encoding: 'utf8',
      env,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('verify-red fails a test that passes on the base', () => {
  assert.match(readCi(), /scripts\/verify-red\.sh/);
  const result = runVerifyRed(
    [
      "import assert from 'node:assert/strict';",
      "import test from 'node:test';",
      "test('passes on the base', () => {",
      '  assert.equal(1, 1);',
      '});',
      '',
    ].join('\n'),
    'base',
  );
  const output = `${result.stdout}\n${result.stderr}`;
  assert.doesNotMatch(output, /skipping running files/);
  // node 22 prints "# pass 1" (tap). node 24 prints "ℹ pass 1" (spec).
  assert.match(output, /(?:ℹ|#) pass 1/);
  assert.notEqual(result.status, 0);
  assert.match(output, /NOT RED added\.test\.mjs/);
});

test('verify-red asks gh for the pull request number', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gwen-verify-red-gh-'));
  const argsFile = join(dir, 'gh-args.txt');
  try {
    git(dir, ['init', '-b', 'base']);
    writeFileSync(join(dir, 'README.md'), 'base\n');
    git(dir, ['add', 'README.md']);
    git(dir, ['commit', '-m', 'base']);
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    writeFileSync(
      join(bin, 'gh'),
      ['#!/bin/sh', 'printf "%s\\n" "$@" > "$GH_ARGS_FILE"', 'exit 1', ''].join('\n'),
    );
    chmodSync(join(bin, 'gh'), 0o755);
    git(dir, ['checkout', '-b', 'change']);
    writeFileSync(
      join(dir, 'added.test.mjs'),
      ["import test from 'node:test';", "test('unused', () => {});", ''].join('\n'),
    );
    git(dir, ['add', 'added.test.mjs']);
    git(dir, ['commit', '-m', 'add test']);
    const env = {
      ...process.env,
      HYGIENE_BASE: 'base',
      GH_TOKEN: 'fixture',
      GITHUB_TOKEN: '',
      PR_NUMBER: '4242',
      PR_REPO: 'gwenjs/gwen',
      GH_ARGS_FILE: argsFile,
      PATH: `${bin}:${process.env.PATH ?? ''}`,
    };
    for (const key of Object.keys(env)) {
      if (key.startsWith('NODE_TEST') || key === 'NODE_CHANNEL_FD') delete env[key];
    }
    spawnSync('bash', [join(root, 'scripts/verify-red.sh')], {
      cwd: dir,
      encoding: 'utf8',
      env,
    });
    const args = readFileSync(argsFile, 'utf8');
    assert.match(args, /4242/);
    assert.match(args, /gwenjs\/gwen/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verify-red accepts a test that fails on the base', () => {
  assert.match(readCi(), /HYGIENE_BASE:\s*origin\/\$\{\{\s*github\.base_ref\s*\}\}/);
  const result = runVerifyRed(
    [
      "import assert from 'node:assert/strict';",
      "import test from 'node:test';",
      "test('fails on the base', () => {",
      '  assert.equal(1, 2);',
      '});',
      '',
    ].join('\n'),
    'base',
  );
  const output = `${result.stdout}\n${result.stderr}`;
  assert.doesNotMatch(output, /skipping running files/);
  assert.match(output, /1 !== 2/);
  assert.equal(result.status, 0, output);
  assert.match(output, /RED added\.test\.mjs/);
});

test('verify-red does not treat one passing test as red when another fails', () => {
  const result = runVerifyRed(
    [
      "import assert from 'node:assert/strict';",
      "import test from 'node:test';",
      "test('stays green', () => {",
      '  assert.equal(1, 1);',
      '});',
      "test('fails on the base', () => {",
      '  assert.equal(1, 2);',
      '});',
      '',
    ].join('\n'),
    'base',
  );
  const output = `${result.stdout}\n${result.stderr}`;
  assert.match(output, /stays green/);
  assert.notEqual(result.status, 0, output);
  assert.match(output, /NOT RED added\.test\.mjs :: stays green/);
});

test('verify-red runs a node:test file that quotes a vitest import with node', () => {
  const result = runVerifyRed(
    [
      "import assert from 'node:assert/strict';",
      "import test from 'node:test';",
      "const fixture = [\"import { it } from 'vitest';\", \"it('x', () => {});\"];",
      "test('fails on the base', () => {",
      '  assert.equal(fixture.length, 3);',
      '});',
      '',
    ].join('\n'),
    'base',
  );
  const output = `${result.stdout}\n${result.stderr}`;
  assert.doesNotMatch(output, /pnpm install/);
  assert.equal(result.status, 0, output);
  assert.match(output, /verify-red: RED added\.test\.mjs/);
});

test('verify-red counts a new test red when its new module is missing on the base', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gwen-verify-red-load-'));
  try {
    git(dir, ['init', '-b', 'base']);
    writeFileSync(join(dir, 'README.md'), 'base\n');
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-m', 'base']);
    git(dir, ['checkout', '-b', 'change']);
    mkdirSync(join(dir, 'lib'));
    writeFileSync(join(dir, 'lib/answer.mjs'), 'export const answer = 42;\n');
    writeFileSync(
      join(dir, 'lib/answer.test.mjs'),
      [
        "import assert from 'node:assert/strict';",
        "import test from 'node:test';",
        "import { answer } from './answer.mjs';",
        "test('answers 42', () => {",
        '  assert.equal(answer, 42);',
        '});',
        '',
      ].join('\n'),
    );
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-m', 'add module and test']);
    const env = { ...process.env, HYGIENE_BASE: 'base', GH_TOKEN: '', GITHUB_TOKEN: '', PR_NUMBER: '', PR_REPO: '' };
    for (const key of Object.keys(env)) {
      if (key.startsWith('NODE_TEST') || key === 'NODE_CHANNEL_FD') delete env[key];
    }
    const result = spawnSync('bash', [join(root, 'scripts/verify-red.sh')], { cwd: dir, encoding: 'utf8', env });
    const output = `${result.stdout}\n${result.stderr}`;
    assert.equal(result.status, 0, output);
    assert.match(output, /FAIL answers 42 \(base load error/);
    assert.match(output, /verify-red: RED lib\/answer\.test\.mjs/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verify-red does not count a wasm file as red when it cannot run', () => {
  const result = runVerifyRed(
    ["import { it } from 'vitest';", "it('passes on the base', () => {});", ''].join('\n'),
    'base',
    { file: 'packages/core/tests/integration-wasm/added.test.ts' },
  );
  const output = `${result.stdout}\n${result.stderr}`;
  assert.equal(result.status, 2, output);
  assert.match(output, /not verifiable/);
  assert.doesNotMatch(output, /verify-red: RED /);
});

test('verify-red does not count a passing wasm test as red', () => {
  const wasmFile = 'packages/core/tests/integration-wasm/added.test.ts';
  const result = runVerifyRed(
    ["import { it } from 'vitest';", "it('passes on the base', () => {});", ''].join('\n'),
    'base',
    {
      file: wasmFile,
      seed(dir) {
        mkdirSync(join(dir, 'packages/core/wasm/light'), { recursive: true });
        writeFileSync(join(dir, 'packages/core/package.json'), '{}\n');
        writeFileSync(join(dir, 'packages/core/vitest.wasm.config.ts'), 'export default {};\n');
        writeFileSync(join(dir, 'packages/core/wasm/light/gwen_core_bg.wasm'), 'wasm\n');
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
  const dir = mkdtempSync(join(tmpdir(), 'gwen-fake-pnpm-'));
  fakePnpmDirs.push(dir);
  const bin = join(dir, 'pnpm');
  writeFileSync(
    bin,
    [
      '#!/bin/sh',
      'out=""',
      'prev=""',
      'for arg in "$@"; do',
      '  if [ "$prev" = "--outputFile" ]; then',
      '    out="$arg"',
      '  fi',
      '  prev="$arg"',
      'done',
      'case "$*" in',
      '  *vitest.wasm.config.ts*)',
      '    if [ -n "$out" ]; then',
      '      printf \'%s\\n\' \'{"testResults":[{"assertionResults":[{"fullName":"passes on the base","status":"passed"}]}]}\' > "$out"',
      '    fi',
      '    exit 0',
      '    ;;',
      '  *vitest*)',
      '    echo "No test files found" >&2',
      '    exit 1',
      '    ;;',
      'esac',
      'exit 0',
      '',
    ].join('\n'),
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
  const dir = mkdtempSync(join(tmpdir(), 'gwen-verify-red-repo-'));
  rmSync(dir, { recursive: true, force: true });
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
  assert.equal(head.status, 0, head.stderr);
  const base = head.stdout.trim();
  git(root, ['worktree', 'add', '--detach', dir, base]);
  try {
    for (const [file, content] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, file)), { recursive: true });
      writeFileSync(join(dir, file), content);
    }
    git(dir, ['add', '-A']);
    git(dir, ['commit', '--no-verify', '-m', 'fixture']);
    const env = {
      ...process.env,
      HYGIENE_BASE: base,
      GH_TOKEN: '',
      GITHUB_TOKEN: '',
      PR_NUMBER: '',
      PR_REPO: '',
    };
    for (const key of Object.keys(env)) {
      if (key.startsWith('NODE_TEST') || key.startsWith('VITEST') || key === 'NODE_CHANNEL_FD') {
        delete env[key];
      }
    }
    const result = spawnSync('bash', [join(root, 'scripts/verify-red.sh')], {
      cwd: dir,
      encoding: 'utf8',
      env,
      maxBuffer: 64 * 1024 * 1024,
    });
    return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
  } finally {
    spawnSync('git', ['worktree', 'remove', '--force', dir], { cwd: root });
    rmSync(dir, { recursive: true, force: true });
  }
}

test('verify-red runs a real Vitest file without WASM or a build', () => {
  const file = 'packages/core/tests/verify-red-fixture.test.ts';
  const { status, output } = runVerifyRedOnRepo({
    [file]: [
      "import { describe, expect, it } from 'vitest';",
      "import { defineComponent, Types } from '@gwenjs/core';",
      '',
      "describe('verify-red fixture', () => {",
      "  it('fails on the base', () => {",
      "    const Probe = defineComponent({ name: 'VerifyRedProbe', schema: { x: Types.f32 } });",
      "    expect(Probe.name).toBe('not the base');",
      '  });',
      '});',
      '',
    ].join('\n'),
  });
  assert.doesNotMatch(output, /build:ts/);
  assert.equal(status, 0, output);
  assert.match(output, /verify-red: RED packages\/core\/tests\/verify-red-fixture\.test\.ts/);
});

test('verify-red counts a real Vitest file red when it imports a module the PR adds', () => {
  const { status, output } = runVerifyRedOnRepo({
    'packages/core/tests/verify-red-fixture-lib.ts': 'export const answer = 42;\n',
    'packages/core/tests/verify-red-fixture.test.ts': [
      "import { expect, it } from 'vitest';",
      "import { answer } from './verify-red-fixture-lib';",
      '',
      "it('answers 42', () => {",
      '  expect(answer).toBe(42);',
      '});',
      '',
    ].join('\n'),
  });
  assert.equal(status, 0, output);
  assert.match(output, /FAIL answers 42 \(base load error/);
  assert.match(output, /verify-red: RED packages\/core\/tests\/verify-red-fixture\.test\.ts/);
});

test('verify-red reports not verifiable when a test needs a WASM build', () => {
  const file = 'packages/physics3d-fracture/tests/voronoi-fracture.test.ts';
  const current = readFileSync(join(root, file), 'utf8');
  const { status, output } = runVerifyRedOnRepo({
    [file]: `${current}\nit('verify-red fixture needs the fracture wasm', () => {\n  expect(1).toBe(1);\n});\n`,
  });
  assert.equal(status, 2, output);
  assert.match(output, /does not load on the head either/);
  assert.doesNotMatch(output, /verify-red: RED /);
});

test('pnpm typecheck includes the core and renderer test projects', () => {
  const rootPackage = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const typecheck = rootPackage.scripts.typecheck;
  assert.match(typecheck, /tsconfig\.test\.json/);
  const core = JSON.parse(readFileSync(join(root, 'packages/core/tsconfig.test.json'), 'utf8'));
  const renderer = JSON.parse(
    readFileSync(join(root, 'packages/renderer-core/tsconfig.test.json'), 'utf8'),
  );
  assert.ok(core.include.includes('tests'));
  assert.ok(renderer.include.includes('tests'));
  assert.ok(Array.isArray(core.exclude));
  assert.ok(core.exclude.every((item) => item.endsWith('.ts')));
  assert.ok(Array.isArray(renderer.exclude));
  assert.ok(renderer.exclude.every((item) => item.endsWith('.ts')));
});
