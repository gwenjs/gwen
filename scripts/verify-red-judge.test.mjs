import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const judgePath = join(dirname(fileURLToPath(import.meta.url)), 'verify-red-judge.mjs');

/**
 * Run the judge on a head source, an optional base source and a runner report.
 *
 * @param {{ source: string, base?: string, format: string, report: string, extra?: string[] }} input
 * @returns {{ status: number | null, output: string }}
 */
function judge({ source, base, format, report, extra = [] }) {
  const dir = mkdtempSync(join(tmpdir(), 'gwen-judge-'));
  try {
    writeFileSync(join(dir, 'head.test.mjs'), source);
    writeFileSync(join(dir, 'report.txt'), report);
    const args = [judgePath, 'judge', '--source', join(dir, 'head.test.mjs')];
    if (base !== undefined) {
      writeFileSync(join(dir, 'base.test.mjs'), base);
      args.push('--base', join(dir, 'base.test.mjs'));
    }
    args.push('--format', format, '--report', join(dir, 'report.txt'), ...extra);
    const result = spawnSync('node', args, { encoding: 'utf8' });
    return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('judge reads TAP names with an escaped # and backslash', () => {
  const { status, output } = judge({
    source: "import test from 'node:test';\ntest('rejects Fixes #12 and a \\\\ slash', () => {});\n",
    format: 'tap',
    report: 'TAP version 13\nnot ok 1 - rejects Fixes \\#12 and a \\\\ slash\n1..1\n',
  });
  assert.equal(status, 0, output);
  assert.match(output, /FAIL rejects Fixes #12 and a \\ slash/);
});

test('judge still reads a TAP SKIP directive after an escaped #', () => {
  const { status, output } = judge({
    source: "import test from 'node:test';\ntest('issue #3', () => {});\n",
    format: 'tap',
    report: 'TAP version 13\nok 1 - issue \\#3 # SKIP\n1..1\n',
  });
  assert.equal(status, 1, output);
  assert.match(output, /PASS issue #3/);
});

test('judge rejects a new name that the runner never reported', () => {
  const kept = "import test from 'node:test';\ntest('kept', () => {});\n";
  const { status, output } = judge({
    source: `${kept}if (process.env.NEVER) test('new one', () => {});\n`,
    base: kept,
    format: 'tap',
    report: 'TAP version 13\nnot ok 1 - kept\n1..1\n',
  });
  assert.equal(status, 1, output);
  assert.match(output, /ABSENT new one/);
});
