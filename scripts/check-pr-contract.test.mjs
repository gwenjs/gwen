import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import * as contract from './check-pr-contract.mjs';
import * as wasmSize from './check-wasm-size.mjs';

const CONTRACT_SCRIPT = fileURLToPath(new URL('./check-pr-contract.mjs', import.meta.url));

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

const WASM_COMMAND = 'node scripts/check-wasm-size.mjs';
const WASM_COMMAND_ERROR =
  'wasm-size.json-only diff: the Acceptance table must cite the command node scripts/check-wasm-size.mjs';
const SOURCE_TEST_ERROR = 'a source file change needs a changed test file';

function wasmCatalog() {
  return {
    version: 1,
    toolchain: { rust: '1.99.0', wasmPack: '0.13.1', wasmOpt: '133' },
    binaryen: { 'macos-arm64': { sha256: 'abc', url: 'https://example.test/a' } },
    tolerance: 0.05,
    toleranceMinBytes: 2048,
    variants: {
      light: {
        path: 'packages/core/wasm/light/gwen_core_bg.wasm',
        raw: 10,
        gzip: { baseline: 5, budget: 6 },
        brotli: { baseline: 4, budget: 5 },
      },
    },
  };
}

function shiftedCatalog() {
  const head = wasmCatalog();
  head.variants.light.gzip.baseline = 8;
  return head;
}

/**
 * @param {{ command?: boolean, section?: 'filled' | 'empty' | 'fenced' | 'none', proof?: 'row' | 'test-file' | 'other' | 'none' }} [options]
 */
function wasmBudgetBody(options = {}) {
  const command = options.command !== false;
  const section = options.section ?? 'filled';
  const proof = options.proof ?? 'row';
  const acceptance = command
    ? `| Record the wasm baseline | \`${WASM_COMMAND}\` |`
    : '| Record the wasm baseline | record the baseline |';
  /** @type {string[]} */
  const proofLines = [];
  if (proof === 'row') {
    proofLines.push(
      '## Red proof',
      '',
      '| Test file | Command | Failing line |',
      '| --- | --- | --- |',
      '| scripts/check-wasm-size.test.mjs | git diff | baseline |',
      '',
    );
  } else if (proof === 'test-file') {
    proofLines.push(
      '## Red proof',
      '',
      '| Test file | Command | Failing line |',
      '| --- | --- | --- |',
      `| ${testFile} | git diff | AssertionError |`,
      '',
    );
  } else if (proof === 'other') {
    proofLines.push(
      '## Red proof',
      '',
      '| Test file | Command | Failing line |',
      '| --- | --- | --- |',
      '| scripts/other.test.mjs | git diff | AssertionError |',
      '',
    );
  }
  /** @type {string[]} */
  const sectionLines = [];
  if (section === 'filled') sectionLines.push('## WASM size budget', '', 'light gzip baseline re-recorded.', '');
  else if (section === 'empty') sectionLines.push('## WASM size budget', '');
  else if (section === 'fenced') {
    sectionLines.push('```', '## WASM size budget', '', 'light gzip baseline re-recorded.', '```', '');
  }
  return [
    '## Acceptance -> test',
    '',
    '| Acceptance | Test |',
    '| --- | --- |',
    acceptance,
    '',
    ...proofLines,
    ...sectionLines,
    '## Breaking changes',
    '',
    'None.',
    '',
  ].join('\n');
}

/**
 * @param {{
 *   body?: string,
 *   changedFiles?: string[],
 *   changedTestFiles?: string[],
 *   baseWasmSize?: string | null,
 *   headWasmSize?: string | null,
 *   exists?: (file: string) => boolean,
 * }} [options]
 */
function reviewWasm(options = {}) {
  const base = wasmCatalog();
  const head = shiftedCatalog();
  return reviewPrContract({
    title: 'ci: record wasm baselines',
    body: options.body ?? wasmBudgetBody(),
    exists: options.exists ?? ((file) => file === testFile),
    changedTestFiles: options.changedTestFiles ?? [],
    changedFiles: options.changedFiles ?? ['wasm-size.json'],
    baseWasmSize: options.baseWasmSize === undefined ? JSON.stringify(base) : options.baseWasmSize,
    headWasmSize: options.headWasmSize === undefined ? JSON.stringify(head) : options.headWasmSize,
  });
}

test('accepts a wasm-size.json-only diff with a non-empty WASM size budget section', () => {
  assert.deepEqual(
    reviewWasm({
      body: wasmBudgetBody({ proof: 'none' }),
      changedFiles: ['wasm-size.json'],
      changedTestFiles: [],
    }),
    [],
  );
});

test('accepts wasm-size.json plus docs with a non-empty WASM size budget section', () => {
  assert.deepEqual(
    reviewWasm({
      body: wasmBudgetBody({ proof: 'row' }),
      changedFiles: ['wasm-size.json', 'internals-docs/adr/x.md'],
      changedTestFiles: [],
    }),
    [],
  );
});

test('rejects a wasm-size.json diff with no WASM size budget section or an empty one', () => {
  const bodies = [
    wasmBudgetBody({ section: 'none' }),
    wasmBudgetBody({ section: 'empty' }),
    wasmBudgetBody({ section: 'fenced' }),
  ];
  for (const body of bodies) {
    const errors = reviewWasm({ body });
    assert.ok(errors.some((error) => error.includes('WASM size budget')), body);
  }
});

test('keeps the test file requirement when another non-docs file changes with wasm-size.json', () => {
  const errors = reviewWasm({ changedFiles: ['wasm-size.json', 'scripts/foo.mjs'], changedTestFiles: [] });
  assert.ok(errors.includes(SOURCE_TEST_ERROR));
  assert.equal(
    errors.some((error) => error.includes('wasm-size.json')),
    false,
  );
});

test('rejects a wasm-size.json diff that changes a key outside variants values', () => {
  const change = (dotted) =>
    `wasm-size.json changes ${dotted}: only values under variants.<name> may change without a test`;
  /** @type {{ key: string, expect: string, once?: boolean, touch: (base: ReturnType<typeof wasmCatalog>, head: ReturnType<typeof wasmCatalog>) => void }[]} */
  const cases = [
    {
      key: 'tolerance',
      expect: change('tolerance'),
      touch: (_base, head) => {
        head.tolerance = 0.9;
      },
    },
    {
      key: 'toleranceMinBytes',
      expect: change('toleranceMinBytes'),
      touch: (_base, head) => {
        head.toleranceMinBytes = 1;
      },
    },
    {
      key: 'toolchain.rust',
      expect: change('toolchain.rust'),
      touch: (_base, head) => {
        head.toolchain.rust = '0.0.0';
      },
    },
    {
      key: 'binaryen.macos-arm64.sha256',
      expect: change('binaryen.macos-arm64.sha256'),
      touch: (_base, head) => {
        head.binaryen['macos-arm64'].sha256 = 'fff';
      },
    },
    {
      key: 'version',
      expect: change('version'),
      touch: (_base, head) => {
        head.version = 2;
      },
    },
    {
      key: 'variants.newname added',
      expect: change('variants.newname'),
      touch: (_base, head) => {
        head.variants.newname = {
          path: 'n',
          raw: 1,
          gzip: { baseline: 1, budget: 1 },
          brotli: { baseline: 1, budget: 1 },
        };
      },
    },
    {
      key: 'variants.newname removed',
      expect: change('variants.newname'),
      touch: (base) => {
        base.variants.newname = {
          path: 'n',
          raw: 1,
          gzip: { baseline: 1, budget: 1 },
          brotli: { baseline: 1, budget: 1 },
        };
      },
    },
    {
      key: 'variants.light.path',
      expect: change('variants.light.path'),
      touch: (_base, head) => {
        head.variants.light.path = 'other.wasm';
      },
    },
    {
      key: 'variants.light.gzip.extra',
      expect: change('variants.light.gzip.extra'),
      touch: (_base, head) => {
        head.variants.light.gzip.extra = 1;
      },
    },
    {
      key: 'variants.light.raw',
      expect: 'wasm-size.json variants.light.raw must be a finite non-negative number',
      touch: (_base, head) => {
        head.variants.light.raw = 'nope';
      },
    },
    {
      key: 'variants.light.note',
      expect: change('variants.light.note'),
      touch: (base, head) => {
        base.variants.light.note = 'a';
        head.variants.light.note = 'b';
      },
    },
    {
      key: 'variants.light.gzip.tol',
      expect: change('variants.light.gzip.tol'),
      touch: (base, head) => {
        base.variants.light.gzip.tol = 0.05;
        head.variants.light.gzip.tol = 0.5;
      },
    },
    {
      key: 'variants.light.path deleted',
      expect: change('variants.light.path'),
      once: true,
      touch: (_base, head) => {
        delete head.variants.light.path;
      },
    },
    {
      key: 'variants.light.gzip deleted',
      expect: change('variants.light.gzip'),
      once: true,
      touch: (_base, head) => {
        delete head.variants.light.gzip;
      },
    },
    {
      key: 'variants.light.gzip.baseline',
      expect: 'wasm-size.json variants.light.gzip.baseline must be a finite non-negative number',
      touch: (_base, head) => {
        head.variants.light.gzip.baseline = 'nope';
      },
    },
    {
      key: 'variants.light.brotli.budget',
      expect: 'wasm-size.json variants.light.brotli.budget must be a finite non-negative number',
      touch: (_base, head) => {
        head.variants.light.brotli.budget = -1;
      },
    },
    {
      key: 'variants.light.raw deleted',
      expect: change('variants.light.raw'),
      once: true,
      touch: (_base, head) => {
        delete head.variants.light.raw;
      },
    },
    {
      key: 'variants.light.gzip.baseline deleted',
      expect: change('variants.light.gzip.baseline'),
      once: true,
      touch: (_base, head) => {
        delete head.variants.light.gzip.baseline;
      },
    },
    {
      key: 'variants.light.gzip.budget deleted',
      expect: change('variants.light.gzip.budget'),
      once: true,
      touch: (_base, head) => {
        delete head.variants.light.gzip.budget;
      },
    },
    {
      key: 'variants.light.brotli.baseline deleted',
      expect: change('variants.light.brotli.baseline'),
      once: true,
      touch: (_base, head) => {
        delete head.variants.light.brotli.baseline;
      },
    },
    {
      key: 'variants.light.brotli.budget deleted',
      expect: change('variants.light.brotli.budget'),
      once: true,
      touch: (_base, head) => {
        delete head.variants.light.brotli.budget;
      },
    },
    {
      key: 'variants.light.gzip.baseline added',
      expect: change('variants.light.gzip.baseline'),
      once: true,
      touch: (base) => {
        delete base.variants.light.gzip.baseline;
      },
    },
  ];
  for (const row of cases) {
    const base = wasmCatalog();
    const head = wasmCatalog();
    row.touch(base, head);
    const errors = reviewWasm({
      baseWasmSize: JSON.stringify(base),
      headWasmSize: JSON.stringify(head),
    });
    assert.ok(errors.includes(row.expect), row.key);
    if (row.once) assert.equal(errors.filter((error) => error === row.expect).length, 1, row.key);
  }
  const base = wasmCatalog();
  const head = wasmCatalog();
  head.variants.light.raw = 0;
  head.variants.light.gzip.baseline = 8;
  head.variants.light.gzip.budget = 9;
  head.variants.light.brotli.baseline = 7;
  head.variants.light.brotli.budget = 8;
  assert.deepEqual(
    reviewWasm({ baseWasmSize: JSON.stringify(base), headWasmSize: JSON.stringify(head) }),
    [],
  );
});

test('keeps the docs-only n/a line accepted and refuses workflow paths', () => {
  const docsBody = goodBody
    .replace(/## Red proof[\s\S]*?## Breaking changes/, '## Breaking changes')
    .replace('## Breaking changes', 'Red proof: n/a (no code change)\n\n## Breaking changes');
  assert.deepEqual(review(docsBody, 'docs: clarify the contract', [], ['docs/a.md', 'x.md']), []);
  const errors = reviewWasm({
    changedFiles: ['wasm-size.json', '.github/workflows/ci.yml'],
    changedTestFiles: [],
  });
  assert.ok(errors.includes(SOURCE_TEST_ERROR));
  assert.equal(
    errors.some((error) => error.startsWith('wasm-size.json')),
    false,
  );
});

test('follows the normal red proof path when a test file changes with wasm-size.json', () => {
  const section = '\n## WASM size budget\n\nlight gzip baseline re-recorded.\n';
  const present = `${goodBody}${section}`;
  const missing = present.replace(
    `| ${testFile} | git diff | AssertionError |`,
    '| scripts/other.test.mjs | git diff | AssertionError |',
  );
  const shared = {
    changedFiles: ['wasm-size.json', testFile],
    changedTestFiles: [testFile],
    exists: (file) => file === testFile,
  };
  const missingErrors = reviewWasm({ ...shared, body: missing });
  assert.ok(missingErrors.includes(`Red proof table is missing a row for ${testFile}`));
  assert.deepEqual(reviewWasm({ ...shared, body: present }), []);
});

test('uses the section detection of check-wasm-size.mjs', () => {
  // The contract is stricter (stripping fences with visibleLines) only inside fenced blocks, which A3 covers.
  assert.equal(typeof wasmSize.budgetSection, 'function');
  const bodies = [
    '## WASM size budget\n\nlight gzip baseline re-recorded.\n',
    '## WASM size budget\n',
    'no heading here\n',
    '## WASM size budget\n\n## Other\n',
    '## Other\n\ntext\n\n## WASM size budget\n\nbudget line\n',
  ];
  for (const body of bodies) {
    const content = wasmSize.budgetSection(body).content === true;
    const errors = reviewWasm({
      body,
      baseWasmSize: JSON.stringify(wasmCatalog()),
      headWasmSize: JSON.stringify(wasmCatalog()),
    });
    const exempt = !errors.some((error) => error.includes('WASM size budget'));
    assert.equal(exempt, content, body);
  }
});

test('refuses a wasm-size.json diff when the base has no wasm-size.json', () => {
  const errors = reviewWasm({ baseWasmSize: null });
  assert.ok(errors.includes('wasm-size.json cannot be compared with the base: absent on the base'));
});

test('refuses a wasm-size.json diff with invalid JSON on the base or the head', () => {
  const baseBad = reviewWasm({ baseWasmSize: '{', headWasmSize: JSON.stringify(wasmCatalog()) });
  assert.ok(baseBad.includes('wasm-size.json cannot be compared with the base: invalid JSON on the base'));
  const headBad = reviewWasm({ baseWasmSize: JSON.stringify(wasmCatalog()), headWasmSize: '{' });
  assert.ok(headBad.includes('wasm-size.json cannot be compared with the base: invalid JSON on the head'));
});

test('does not exempt a wasm-size.json in a subfolder', () => {
  const errors = reviewWasm({ changedFiles: ['packages/x/wasm-size.json'], changedTestFiles: [] });
  assert.ok(errors.includes(SOURCE_TEST_ERROR));
  assert.equal(
    errors.some((error) => error.startsWith('wasm-size.json')),
    false,
  );
});

test('asks the Acceptance table of a wasm-size.json diff to cite the check command', () => {
  const errors = reviewWasm({ body: wasmBudgetBody({ command: false }) });
  assert.deepEqual(errors, [WASM_COMMAND_ERROR]);
});

test('refuses a wasm-size.json diff whose Acceptance cell only names a longer command', () => {
  const body = wasmBudgetBody().replace(
    `| Record the wasm baseline | \`${WASM_COMMAND}\` |`,
    '| Record the wasm baseline | do not run node scripts/check-wasm-size.mjs.bak |',
  );
  assert.deepEqual(reviewWasm({ body }), [WASM_COMMAND_ERROR]);
});

test('refuses a wasm-size.json diff when the head file is absent', () => {
  for (const headWasmSize of [null, undefined]) {
    const errors = reviewPrContract({
      title: 'ci: record wasm baselines',
      body: wasmBudgetBody(),
      exists: () => false,
      changedTestFiles: [],
      changedFiles: ['wasm-size.json'],
      baseWasmSize: JSON.stringify(wasmCatalog()),
      headWasmSize,
    });
    assert.ok(
      errors.includes('wasm-size.json cannot be compared with the base: absent on the head'),
      String(headWasmSize),
    );
  }
});

/**
 * @param {string | undefined} hygieneBase
 * @returns {NodeJS.ProcessEnv}
 */
function gitEnv(hygieneBase) {
  /** @type {NodeJS.ProcessEnv} */
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('GIT_')) continue;
    if (value !== undefined) env[key] = value;
  }
  if (hygieneBase !== undefined) env.HYGIENE_BASE = hygieneBase;
  return env;
}

/**
 * @param {string} cwd
 * @param {string[]} args
 */
function git(cwd, args) {
  const result = spawnSync(
    'git',
    ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args],
    { cwd, env: gitEnv(), encoding: 'utf8' },
  );
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(' ')}`);
}

function initRepo() {
  const cwd = mkdtempSync(join(tmpdir(), 'pr-contract-'));
  git(cwd, ['init', '-b', 'main']);
  return cwd;
}

/**
 * @param {string} cwd
 * @param {string} message
 */
function commitAll(cwd, message) {
  git(cwd, ['add', '-A']);
  git(cwd, ['commit', '-m', message]);
}

/**
 * @param {string} cwd
 * @param {string} hygieneBase
 */
function runMain(cwd, hygieneBase) {
  const bodyFile = join(cwd, 'body.md');
  writeFileSync(bodyFile, wasmBudgetBody({ proof: 'none' }));
  return spawnSync(process.execPath, [CONTRACT_SCRIPT, '--body-file', bodyFile, '--title', 't'], {
    cwd,
    env: gitEnv(hygieneBase),
    encoding: 'utf8',
  });
}

test('accepts a root wasm-size.json value change through main', () => {
  const cwd = initRepo();
  try {
    writeFileSync(join(cwd, 'wasm-size.json'), JSON.stringify(wasmCatalog()));
    commitAll(cwd, 'base');
    git(cwd, ['branch', 'base']);
    const head = wasmCatalog();
    head.variants.light.gzip.baseline = 8;
    writeFileSync(join(cwd, 'wasm-size.json'), JSON.stringify(head));
    commitAll(cwd, 'head');
    const result = runMain(cwd, 'base');
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), 'PR contract ok');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('refuses a tolerance change through main', () => {
  const cwd = initRepo();
  try {
    writeFileSync(join(cwd, 'wasm-size.json'), JSON.stringify(wasmCatalog()));
    commitAll(cwd, 'base');
    git(cwd, ['branch', 'base']);
    const head = wasmCatalog();
    head.tolerance = 0.9;
    writeFileSync(join(cwd, 'wasm-size.json'), JSON.stringify(head));
    commitAll(cwd, 'head');
    const result = runMain(cwd, 'base');
    assert.equal(result.status, 1);
    assert.ok(result.stderr.includes('tolerance'), result.stderr);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('refuses a wasm-size.json added on the head through main', () => {
  const cwd = initRepo();
  try {
    writeFileSync(join(cwd, 'README'), 'x');
    commitAll(cwd, 'base');
    git(cwd, ['branch', 'base']);
    writeFileSync(join(cwd, 'wasm-size.json'), JSON.stringify(wasmCatalog()));
    commitAll(cwd, 'add');
    const result = runMain(cwd, 'base');
    assert.equal(result.status, 1);
    assert.ok(result.stderr.includes('absent on the base'), result.stderr);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('compares wasm-size.json with the merge-base when the base branch moved', () => {
  const cwd = initRepo();
  try {
    writeFileSync(join(cwd, 'wasm-size.json'), JSON.stringify(wasmCatalog()));
    commitAll(cwd, 'fork');
    git(cwd, ['branch', 'base']);
    const head = wasmCatalog();
    head.variants.light.gzip.baseline = 8;
    writeFileSync(join(cwd, 'wasm-size.json'), JSON.stringify(head));
    commitAll(cwd, 'head');
    git(cwd, ['checkout', 'base']);
    const moved = wasmCatalog();
    moved.tolerance = 0.9;
    writeFileSync(join(cwd, 'wasm-size.json'), JSON.stringify(moved));
    commitAll(cwd, 'base moved');
    git(cwd, ['checkout', 'main']);
    const result = runMain(cwd, 'base');
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), 'PR contract ok');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
