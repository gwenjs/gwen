import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateCiStatus } from './check-ci-status-needs.mjs';

const yaml = [
  'jobs:',
  '  lint:',
  '    runs-on: ubuntu-latest',
  '  rust:',
  '    runs-on: ubuntu-latest',
  '  ci-status:',
  '    needs: [lint]',
  '    steps:',
  '      - run: |',
  '          echo "${{ needs.lint.result }}"',
  '',
].join('\n');

test('reports a job left out of ci-status.needs', () => {
  const report = evaluateCiStatus(yaml);
  assert.deepEqual(report.missing, ['rust']);
  assert.deepEqual(report.unread, []);
});

test('reports a needs entry the status step does not read', () => {
  const report = evaluateCiStatus(yaml.replace('needs: [lint]', 'needs: [lint, rust]'));
  assert.deepEqual(report.missing, []);
  assert.deepEqual(report.unread, ['rust']);
});

test('accepts a list-style needs block', () => {
  const listed = [
    'jobs:',
    '  lint:',
    '    runs-on: ubuntu-latest',
    '  ci-status:',
    '    needs:',
    '      - lint',
    '    steps:',
    '      - run: echo "${{ needs.lint.result }}"',
    '',
  ].join('\n');
  const report = evaluateCiStatus(listed);
  assert.equal(report.error, null);
  assert.deepEqual(report.missing, []);
  assert.deepEqual(report.unread, []);
});

test('the workflow lists every job', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const real = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8');
  const report = evaluateCiStatus(real);
  assert.equal(report.error, null);
  assert.deepEqual(report.missing, []);
  assert.deepEqual(report.unread, []);
});
