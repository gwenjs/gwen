import assert from 'node:assert/strict';
import test from 'node:test';
import * as contract from './check-pr-contract.mjs';

const { reviewPrContract } = contract;

const placeholder = ['MISS', 'ING'].join('');
const unfinished = ['not', 'done'].join(' ');
const footer = ['BREAKING CHANGE', ':'].join('');
const testFile = 'scripts/check-pr-contract.test.mjs';

/**
 * @param {string} body
 * @param {string} [title]
 * @param {string[]} [changedTestFiles]
 * @param {string[]} [changedFiles]
 */
function review(body, title = 'ci: add checks', changedTestFiles = [testFile], changedFiles) {
  return reviewPrContract({
    title,
    body,
    exists: (file) => file === testFile,
    changedTestFiles,
    changedFiles,
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
  assert.deepEqual(review(body, 'docs: clarify the contract', [], ['docs/guide.md']), []);
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

/**
 * @param {string} closing
 * @param {string} [gap]
 */
function withGap(closing, gap = 'NO TEST') {
  const body = goodBody.replace(
    `| Contract accepts a complete body | ${testFile}::accepts a complete body |`,
    `| Contract accepts a complete body | ${testFile}::accepts a complete body |\n| Gap | ${gap} |`,
  );
  return `${body}\n${closing}\n`;
}

test('allows n/a only for docs, markdown, and github', () => {
  const body = goodBody
    .replace(/## Red proof[\s\S]*?## Breaking changes/, '## Breaking changes')
    .replace('## Breaking changes', 'Red proof: n/a (no code change)\n\n## Breaking changes');
  const docs = review(body, 'docs: clarify the contract', [], ['docs/guide.md']);
  const markdown = review(body, 'docs: clarify the contract', [], ['CLAUDE.md']);
  const template = review(body, 'docs: issue template', [], ['.github/ISSUE_TEMPLATE/bug.md']);
  const code = review(body, 'ci: change a script', [], ['scripts/check-pr-contract.mjs']);
  assert.deepEqual(docs, []);
  assert.deepEqual(markdown, []);
  assert.deepEqual(template, []);
  assert.ok(code.some((error) => /n\/a|docs\/|changed test file/i.test(error)));
});

test('rejects an n/a line hidden in a code block', () => {
  const body = [
    goodBody.replace(/## Red proof[\s\S]*?## Breaking changes/, '## Breaking changes'),
    '```',
    'Red proof: n/a (no code change)',
    '```',
    '',
  ].join('\n');
  const errors = review(body, 'docs: clarify the contract', [], ['docs/guide.md']);
  assert.ok(errors.some((error) => error.includes('Red proof')));
});

test('rejects an n/a red proof row for a source change', () => {
  const body = goodBody.replace(
    `| ${testFile} | git diff | AssertionError |`,
    '| n/a | n/a |',
  );
  const errors = review(body, 'ci: change a script', [], ['scripts/check-pr-contract.mjs']);
  assert.ok(errors.some((error) => /n\/a|changed test file/i.test(error)));
});

test('requires a changed test file when a source file changes', () => {
  const errors = review(goodBody, 'ci: add checks', [], ['scripts/check-pr-contract.mjs']);
  assert.ok(errors.some((error) => error.includes('changed test file')));
});

test('rejects a Verdict heading and APPROVE', () => {
  const errors = review(`${goodBody}\n## Verdict\n\nAPPROVE\n`);
  assert.ok(errors.some((error) => /verdict|approve/i.test(error)));
});

test('rejects a Self-review heading with Verdict: APPROVE', () => {
  const errors = review(`${goodBody}\n## Self-review\n\nVerdict: APPROVE\n`);
  assert.ok(errors.some((error) => /self-review|verdict|approve/i.test(error)));
});

test('rejects a bare APPROVE line', () => {
  const errors = review(`${goodBody}\nAPPROVE\n`);
  assert.ok(errors.some((error) => /approve/i.test(error)));
});

test('rejects an Approve heading', () => {
  const errors = review(`${goodBody}\n## Approve\n\nShip.\n`);
  assert.ok(errors.some((error) => /approve/i.test(error)));
});

test('allows the maintainer sentence that says approve', () => {
  const sentence = review(`${goodBody}\nreviewed by the maintainer, who will approve or not\n`);
  const verdict = review(`${goodBody}\n## Verdict\n\nAPPROVE\n`);
  assert.deepEqual(sentence, []);
  assert.ok(verdict.some((error) => /verdict|approve/i.test(error)));
});

test('rejects Fixes #12 next to a NO TEST cell', () => {
  const errors = review(withGap('Fixes #12'));
  assert.ok(errors.some((error) => error.includes('NO TEST')));
});

test('rejects Resolves #12 next to a NO TEST cell', () => {
  const errors = review(withGap('Resolves #12'));
  assert.ok(errors.some((error) => error.includes('NO TEST')));
});

test('rejects Closes owner/repo#12 next to a NO TEST cell', () => {
  const errors = review(withGap('Closes gwenjs/gwen#12'));
  assert.ok(errors.some((error) => error.includes('NO TEST')));
});

test('rejects a lowercase no test cell when the body closes an issue', () => {
  const errors = review(withGap('Closes #12', 'no test'));
  assert.ok(errors.some((error) => error.includes('NO TEST')));
});

test('rejects every GitHub closing keyword next to a NO TEST cell', () => {
  const lines = [
    'close #4',
    'closed #4',
    'fix #4',
    'fixed #4',
    'resolve #4',
    'resolved #4',
    'FIXES #4',
    'https://github.com/gwenjs/gwen/issues/4',
  ];
  for (const line of lines) {
    const keyword = line.startsWith('http') ? `Resolves ${line}` : line;
    const errors = review(withGap(keyword));
    assert.ok(errors.some((error) => error.includes('NO TEST')), keyword);
  }
});

test('rejects review outcome words in any markdown shape', () => {
  const shapes = [
    '**Verdict**: APPROVE',
    '**Verdict:** approve',
    'Verdict: APPROVED',
    'Reviewer verdict: APPROVE',
    'APPROVE WITH NOTES',
    '> APPROVE',
    '- APPROVE',
    'APPROVE.',
    '`APPROVE`',
    '## Review\n\nApproved by the author after a self check.',
    "## Reviewer's decision\n\nAPPROVE WITH NOTES",
    '    ```\n## Verdict\n\nAPPROVE',
    '```note```\n## Verdict\n\nAPPROVE',
    'AP\u200BPROVE',
    'AP\u00ADPROVE',
    '| Verdict | LGTM |',
    '| Reviewer verdict | Ship it |',
    'Final verdict \u2014 ship it',
    'My verdict is: ship it',
  ];
  for (const shape of shapes) {
    const errors = review(`${goodBody}\n${shape}\n`);
    assert.ok(
      errors.some((error) => error.startsWith('self-written verdict or approve:')),
      `${shape}\n${errors.join('\n')}`,
    );
  }
  const sentence = review(`${goodBody}\nThis was reviewed by the maintainer, who will approve or not.\n`);
  assert.deepEqual(sentence, []);
});

test('rejects a Reviewed-by line', () => {
  const errors = review(`${goodBody}\nReviewed-by: claude, approve\n`);
  assert.ok(errors.some((error) => error.includes('reviewed-by')));
});

test('treats a fence indented by three spaces as a fence and by four as text', () => {
  const three = review(`${goodBody}\n   \`\`\`\nAPPROVE\n   \`\`\`\n`);
  const four = review(`${goodBody}\n    \`\`\`\nAPPROVE\n`);
  const infoTick = review(`${goodBody}\n   \`\`\`a\`b\nAPPROVE\n`);
  assert.deepEqual(three, []);
  assert.deepEqual(four, ['self-written verdict or approve: APPROVE']);
  assert.deepEqual(infoTick, ['self-written verdict or approve: APPROVE']);
});

test('rejects every spelling of no test next to a closing keyword', () => {
  for (const gap of ['No tests', 'NO-TEST', 'no-tests', 'untested']) {
    const errors = review(withGap('Closes #12', gap));
    assert.ok(errors.some((error) => error.includes('NO TEST')), gap);
  }
});

test('reads no test only in the Acceptance tables', () => {
  const acceptance = review(withGap('This closes #12.', 'no test needed for docs'));
  assert.ok(acceptance.some((error) => error.includes('NO TEST')));
  const other = `${goodBody}\nThis closes #12.\n\n| File | Note |\n| --- | --- |\n| docs/a.md | no test needed for docs |\n`;
  assert.deepEqual(review(other), []);
});

test('treats workflows and docs scripts as code for the n/a rule', () => {
  const body = goodBody
    .replace(/## Red proof[\s\S]*?## Breaking changes/, '## Breaking changes')
    .replace('## Breaking changes', 'Red proof: n/a (no code change)\n\n## Breaking changes');
  for (const file of [
    '.github/workflows/ci.yml',
    '.github/actions/setup-node-pnpm/action.yml',
    'docs/.vitepress/config.ts',
    'docs/.vitepress/theme/index.js',
    'docs/scripts/build.mjs',
  ]) {
    const errors = review(body, 'ci: change', [], [file]);
    assert.ok(errors.length > 0, file);
  }
  assert.deepEqual(review(body, 'docs: logo', [], ['docs/public/logo.svg']), []);
});

test('allows the word verdict in prose and inline code', () => {
  const prose = review(`${goodBody}\n\`pnpm test:alloc\`: 4 passed, verdict \`pass\`, \`failures\` empty.\n`);
  const code = review(`${goodBody}\n\`frame-alloc.gate.ts\` asserts \`verdict === "pass"\`.\n`);
  const field = review(`${goodBody}\nThe alloc gate prints \`verdict: "pass"\` per row.\n`);
  assert.deepEqual(field, []);
  const heading = review(`${goodBody}\n## Reviewer verdict\n\nShip it.\n`);
  const start = review(`${goodBody}\nVerdict: ship it\n`);
  assert.deepEqual(prose, []);
  assert.deepEqual(code, []);
  assert.ok(heading.some((error) => error.startsWith('self-written verdict or approve:')));
  assert.ok(start.some((error) => error.startsWith('self-written verdict or approve:')));
});

test('rejects NO_TEST, not tested, and no automated test next to a closing keyword', () => {
  for (const gap of ['NO_TEST', 'not tested', 'no automated test']) {
    const errors = review(withGap('Closes #12', gap));
    assert.ok(errors.includes('NO TEST cannot use a closing keyword'), gap);
  }
});

test('treats github scripts and docs package.json as code for the n/a rule', () => {
  const body = goodBody
    .replace(/## Red proof[\s\S]*?## Breaking changes/, '## Breaking changes')
    .replace('## Breaking changes', 'Red proof: n/a (no code change)\n\n## Breaking changes');
  for (const file of ['.github/scripts/check.mjs', 'docs/package.json']) {
    const errors = review(body, 'ci: change', [], [file]);
    assert.ok(
      errors.some((error) => error.startsWith('Red proof n/a is only allowed')),
      `${file}\n${errors.join('\n')}`,
    );
  }
  assert.deepEqual(review(body, 'docs: template', [], ['.github/ISSUE_TEMPLATE/bug.md']), []);
});

test('rejects not unit-tested, not automatically tested and no coverage next to a closing keyword', () => {
  for (const gap of ['Not unit-tested', 'not automatically tested', 'no coverage']) {
    const errors = review(withGap('Closes #12', gap));
    assert.ok(errors.includes('NO TEST cannot use a closing keyword'), gap);
  }
});

const rustFile = 'crates/gwen-core/src/physics3d/pathfinding.rs';
const rustTestDiff = [
  `diff --git a/${rustFile} b/${rustFile}`,
  `--- a/${rustFile}`,
  `+++ b/${rustFile}`,
  '@@ -1,2 +1,6 @@',
  ' mod tests {',
  '+    #[test]',
  '+    fn test_state_is_not_shared_between_threads() {',
  '+        assert_eq!(1, 1);',
  '+    }',
  ' }',
].join('\n');

test('counts a Rust integration test file and an added inline #[test] as changed test files', () => {
  assert.equal(typeof contract.isChangedTestFile, 'function');
  const isTest = contract.isChangedTestFile;
  assert.equal(isTest('crates/gwen-core/tests/core_errors.rs', ''), true);
  assert.equal(isTest('crates/gwen-physics3d-fracture/tests/voronoi.rs', ''), true);
  assert.equal(isTest(rustFile, rustTestDiff), true);
  assert.equal(isTest(rustFile, rustTestDiff.replace('+    #[test]', '+    // no test attribute')), false);
  assert.equal(isTest('crates/gwen-core/src/lib.rs', ''), false);
  assert.equal(isTest('crates/gwen-core/tests/common/mod.rs', ''), false);
});

test('accepts a Rust-only fix shaped like PR #157 when its Red proof has the row', () => {
  assert.equal(typeof contract.isChangedTestFile, 'function');
  const changedFiles = [rustFile];
  const changedTestFiles = changedFiles.filter((file) => contract.isChangedTestFile(file, rustTestDiff));
  const body = [
    '## Acceptance -> test',
    '',
    '| Acceptance | Test |',
    '|---|---|',
    `| Two callers on two threads each search their own grid | \`${rustFile}::tests::test_state_is_not_shared_between_threads\` |`,
    '',
    '## Red proof',
    '',
    '| Test file | Command | Failing line |',
    '|---|---|---|',
    `| \`${rustFile}\` | \`cargo test -q -p gwen-core --lib --features physics3d test_state_is_not_shared_between_threads\` | \`assertion left == right failed: thread A must search its own blocked grid\` |`,
    '',
    '## Breaking changes',
    '',
    'None.',
    '',
  ].join('\n');
  const check = (text) =>
    reviewPrContract({
      title: 'fix(core): give the 3D pathfinding state an owner so tests stop racing',
      body: text,
      exists: (file) => file === rustFile,
      changedTestFiles,
      changedFiles,
    });
  assert.deepEqual(check(body), []);
  const codeBlockOnly = body.replace(/\| Test file[\s\S]*?\|\n\n## Breaking/, '```\n$ cargo test\n```\n\n## Breaking');
  assert.ok(
    check(codeBlockOnly).includes(`Red proof table is missing a row for ${rustFile}`),
    check(codeBlockOnly).join('\n'),
  );
});

test('accepts prose that names the field and rejects a review outcome after it', () => {
  for (const line of [
    'The alloc gate verdict is unchanged by this PR.',
    '| verdict | string |',
    '| alloc | per-row verdict |',
    'A run prints a verdict — pass or fail — per file.',
  ]) {
    assert.deepEqual(review(`${goodBody}\n${line}\n`), [], line);
  }
  for (const line of [
    '| Verdict | LGTM |',
    '| Reviewer verdict | Ship it |',
    'Final verdict — ship it',
    'My verdict is: ship it',
    'The verdict is ready to merge',
    '| Verdict | Pass |',
  ]) {
    const errors = review(`${goodBody}\n${line}\n`);
    assert.ok(errors.some((error) => error.startsWith('self-written verdict or approve:')), `${line}\n${errors.join('\n')}`);
  }
});

test('counts rstest, test_case and a one-line test module as added Rust tests', () => {
  const file = 'crates/gwen-core/src/ecs/storage.rs';
  for (const added of [
    '+    #[rstest]',
    '+    #[test_case(1 ; "one")]',
    '+mod tests { #[test] fn one() { assert_eq!(1, 1); } }',
  ]) {
    const diff = [`--- a/${file}`, `+++ b/${file}`, '@@ -1 +1,2 @@', ' fn a() {}', added].join('\n');
    assert.equal(contract.isChangedTestFile(file, diff), true, added);
  }
});

test('accepts a conclusion word followed by a condition or an alternative', () => {
  for (const line of [
    'The verdict is ok only when every row passes.',
    "Each row's verdict is green or red.",
    'The verdict is rejected when the file does not load.',
    'The per-file verdict — accepted or blocked — is printed.',
  ]) {
    assert.deepEqual(review(`${goodBody}\n${line}\n`), [], line);
  }
  for (const line of ['Final verdict — ship it if CI passes', 'My verdict is: ready', '| Verdict | LGTM |']) {
    const errors = review(`${goodBody}\n${line}\n`);
    assert.ok(errors.some((error) => error.startsWith('self-written verdict or approve:')), line);
  }
});
