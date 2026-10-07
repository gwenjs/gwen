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

test('cancels an in-progress run for the same ref', () => {
  const yaml = readCi();
  assert.match(yaml, /^concurrency:/m);
  assert.match(yaml, /group:.*github\.workflow.*github\.ref/s);
  assert.match(yaml, /cancel-in-progress:\s*true/);
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
 */
function runVerifyRed(source, base) {
  const dir = mkdtempSync(join(tmpdir(), 'gwen-verify-red-fixture-'));
  try {
    git(dir, ['init', '-b', 'base']);
    writeFileSync(join(dir, 'README.md'), 'base\n');
    git(dir, ['add', 'README.md']);
    git(dir, ['commit', '-m', 'base']);
    git(dir, ['checkout', '-b', 'change']);
    writeFileSync(join(dir, 'added.test.mjs'), source);
    git(dir, ['add', 'added.test.mjs']);
    git(dir, ['commit', '-m', 'add test']);
    const env = {
      ...process.env,
      HYGIENE_BASE: base,
      GH_TOKEN: '',
      GITHUB_TOKEN: '',
      PR_NUMBER: '',
      PR_REPO: '',
    };
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
  assert.match(output, /ℹ pass 1/);
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
