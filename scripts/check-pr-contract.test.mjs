import assert from 'node:assert/strict';
import test from 'node:test';
import { reviewPrContract } from './check-pr-contract.mjs';

const placeholder = ['MISS', 'ING'].join('');
const unfinished = ['not', 'done'].join(' ');
const footer = ['BREAKING CHANGE', ':'].join('');
const testFile = 'scripts/check-pr-contract.test.mjs';

/**
 * @param {string} body
 * @param {string} [title]
 */
function review(body, title = 'ci: add checks') {
  return reviewPrContract({
    title,
    body,
    exists: (file) => file === testFile,
  });
}

const goodBody = [
  '## Acceptance -> test',
  '',
  '| Acceptance | Test |',
  '| --- | --- |',
  `| Contract accepts a complete body | ${testFile}::accepts a complete body |`,
  '',
  '## Breaking changes',
  '',
  'None.',
  '',
].join('\n');

test('accepts a complete body', () => {
  assert.deepEqual(review(goodBody), []);
});

test('rejects a body with no acceptance table', () => {
  const body = goodBody.replace('| Acceptance | Test |', '| Item | Note |');
  const errors = review(body);
  assert.ok(errors.some((error) => error.includes('Acceptance')));
});

test('rejects a test path that is not in the head', () => {
  const body = goodBody.replace(testFile, 'scripts/missing-file.test.mjs');
  const errors = review(body);
  assert.ok(errors.some((error) => error.includes('not in the PR head')));
});

test('rejects an unfinished marker', () => {
  assert.ok(review(`${goodBody}\n${placeholder}\n`).length > 0);
  assert.ok(review(`${goodBody}\n${unfinished}\n`).length > 0);
});

test('requires a breaking footer when the title has a bang', () => {
  const errors = review(goodBody, 'ci!: add checks');
  assert.ok(errors.some((error) => error.includes('BREAKING CHANGE:')));
  assert.deepEqual(review(`${goodBody}\n${footer} the contract\n`, 'ci!: add checks'), []);
});

test('rejects an empty breaking section', () => {
  const body = goodBody.replace('None.\n', '');
  assert.ok(review(body).some((error) => error.includes('empty')));
});
