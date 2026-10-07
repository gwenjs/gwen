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
 * @param {string[]} [changedTestFiles]
 */
function review(body, title = 'ci: add checks', changedTestFiles = [testFile]) {
  return reviewPrContract({
    title,
    body,
    exists: (file) => file === testFile,
    changedTestFiles,
  });
}

const goodBody = [
  '## Acceptance -> test',
  '',
  '| Acceptance | Test |',
  '| --- | --- |',
  `| Contract accepts a complete body | ${testFile}::accepts a complete body |`,
  '',
  '## Red proof',
  '',
  '| Test file | Command | Failing line |',
  '| --- | --- | --- |',
  `| ${testFile} | git diff | AssertionError |`,
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

test('rejects a body with no red proof section', () => {
  const body = goodBody.replace(/## Red proof[\s\S]*?## Breaking changes/, '## Breaking changes');
  const errors = review(body);
  assert.ok(errors.some((error) => error.includes('Red proof')));
});

test('accepts the docs-only red proof line', () => {
  const body = goodBody
    .replace(/## Red proof[\s\S]*?## Breaking changes/, '## Breaking changes')
    .replace('## Breaking changes', 'Red proof: n/a (no code change)\n\n## Breaking changes');
  const missing = review(
    goodBody.replace(/## Red proof[\s\S]*?## Breaking changes/, '## Breaking changes'),
    'docs: clarify the contract',
    [],
  );
  assert.ok(missing.some((error) => error.includes('Red proof')));
  assert.deepEqual(review(body, 'docs: clarify the contract', []), []);
});

test('rejects a docs-only line when a test file changed', () => {
  const body = `${goodBody}\nRed proof: n/a (no code change)\n`;
  const errors = review(body, 'docs: clarify the contract', [testFile]);
  assert.ok(errors.some((error) => error.includes('no code change')));
});

test('requires one red proof row per changed test file', () => {
  const other = 'scripts/check-diff-hygiene.test.mjs';
  const errors = review(goodBody, 'ci: add checks', [testFile, other]);
  assert.ok(errors.some((error) => error.includes(other)));
});

test('rejects a self-written verdict section', () => {
  const body = `${goodBody}\n## Reviewer verdict\n\nShip it.\n`;
  const errors = review(body);
  assert.ok(errors.some((error) => error.includes('verdict')));
});

test('rejects a reviewed-by approve section', () => {
  const body = `${goodBody}\n## Reviewed by Ada\n\napprove\n`;
  const errors = review(body);
  assert.ok(errors.some((error) => error.includes('reviewed-by')));
});

test('rejects NO TEST when the body closes an issue', () => {
  const body = goodBody.replace(
    `| Contract accepts a complete body | ${testFile}::accepts a complete body |`,
    `| Contract accepts a complete body | ${testFile}::accepts a complete body |\n| Gap | NO TEST |`,
  );
  const errors = review(`${body}\nCloses #12\n`);
  assert.ok(errors.some((error) => error.includes('NO TEST')));
});

test('allows NO TEST when the body does not close an issue', () => {
  const body = goodBody.replace(
    `| Contract accepts a complete body | ${testFile}::accepts a complete body |`,
    `| Contract accepts a complete body | ${testFile}::accepts a complete body |\n| Gap | NO TEST |`,
  );
  const closed = review(`${body}\nCloses #12\n`);
  assert.ok(closed.some((error) => error.includes('NO TEST')));
  assert.deepEqual(review(body), []);
});
