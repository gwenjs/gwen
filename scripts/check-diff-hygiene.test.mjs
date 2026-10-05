import assert from 'node:assert/strict';
import test from 'node:test';
import { findDiffViolations, findLogViolations, isAllowlisted } from './check-diff-hygiene.mjs';

const cast = ['as', 'unknown', 'as'].join(' ');
const anyAnn = [': ', 'any'].join('');
const asAny = ['as', 'any'].join(' ');
const genericAny = ['<', 'any>'].join('');
const anyList = ['any', '[]'].join('');
const tsIgnore = ['@', 'ts-ignore'].join('');
const tsExpect = ['@', 'ts-expect-error'].join('');
const lintDisable = ['lint', 'disable'].join('-');
const viMock = ['vi', 'mock('].join('.');
const viFn = ['vi', 'fn('].join('.');
const unwrap = ['.unwrap', '('].join('');
const expectCall = ['.expect', '('].join('');
const panic = ['panic!', '('].join('');
const assertBang = ['assert!', '('].join('');
const authored = ['Co', 'authored-by'].join('-');

/**
 * @param {string} file
 * @param {string[]} added
 * @returns {string}
 */
function diff(file, added) {
  return [
    `diff --git a/${file} b/${file}`,
    '--- /dev/null',
    `+++ b/${file}`,
    `@@ -0,0 +1,${added.length} @@`,
    ...added.map((line) => `+${line}`),
  ].join('\n');
}

test('rejects a double cast', () => {
  const hits = findDiffViolations(diff('src/a.ts', [`const x = value ${cast} Type;`]));
  assert.ok(hits.some((hit) => hit.rule === 'as-unknown-as'));
});

test('rejects any, directives, and mock helpers', () => {
  const lines = [
    `function f(x${anyAnn}) { return x; }`,
    `const y = value ${asAny};`,
    `type T = Promise${genericAny};`,
    `const list: ${anyList} = [];`,
    `// ${tsIgnore}`,
    `// ${tsExpect}`,
    `// eslint-${lintDisable}-next-line no-console`,
    `const mock = ${viMock} => mock);`,
    `const fn = ${viFn} => fn);`,
  ];
  const hits = findDiffViolations(diff('src/a.ts', lines));
  const expectRules = [
    'any',
    ['ts', 'ignore'].join('-'),
    ['ts', 'expect', 'error'].join('-'),
    ['lint', 'disable'].join('-'),
    ['vi', 'mock'].join('.'),
    ['vi', 'fn'].join('.'),
  ];
  for (const rule of expectRules) {
    assert.ok(hits.some((hit) => hit.rule === rule), rule);
  }
});

test('rejects unwrap, expect, panic!, and assert! on added Rust lines', () => {
  const lines = [`let a = item${unwrap});`, `let b = item${expectCall}"msg");`, `${panic}"no");`, `${assertBang}ok);`];
  const hits = findDiffViolations(diff('crates/gwen-core/src/bindings.rs', lines));
  for (const rule of ['unwrap', 'expect', 'panic!', 'assert!']) {
    assert.ok(hits.some((hit) => hit.rule === rule), rule);
  }
});

test('does not flag vitest expect or the word any in TypeScript', () => {
  const hits = findDiffViolations(
    diff('src/a.test.ts', ['expect(1).toBe(1);', 'const many = 1;', '// read any file the user passed']),
  );
  assert.deepEqual(hits, []);
});

test('does not flag Rust panic tokens in a TypeScript file', () => {
  const hits = findDiffViolations(diff('src/a.ts', [`const label = "${panic}docs)";`]));
  assert.deepEqual(hits, []);
});

test('honours a same-line allowlist', () => {
  const line = `const x = value ${cast} Type; // allowlist: fixture #7`;
  assert.equal(isAllowlisted(line), true);
  assert.deepEqual(findDiffViolations(diff('src/a.ts', [line])), []);
});

test('ignores an allowlist that is not on the same line or has no ticket', () => {
  const hits = findDiffViolations(
    diff('src/a.ts', [
      '// allowlist: wrong line #7',
      `const x = value ${cast} Type;`,
      `const y = value ${cast} Type; // allowlist: no ticket`,
    ]),
  );
  assert.equal(hits.length, 2);
});

test('does not flag a removed line', () => {
  const text = [
    'diff --git a/src/a.ts b/src/a.ts',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -1 +1 @@',
    `-const x = value ${cast} Type;`,
    '+const x = 1;',
  ].join('\n');
  assert.deepEqual(findDiffViolations(text), []);
});

test('rejects spyOn and mock helpers under integration-wasm', () => {
  const file = 'packages/core/tests/integration-wasm/engine.test.ts';
  const hits = findDiffViolations(diff(file, [`vi.spyOn(api, "step");`, `const f = ${viFn} => f);`]));
  assert.ok(hits.some((hit) => hit.rule === 'spyOn'));
  assert.ok(hits.some((hit) => hit.rule === ['vi', 'fn'].join('.')));
});

test('allows spyOn outside integration-wasm', () => {
  const hits = findDiffViolations(diff('packages/core/tests/engine.test.ts', ['vi.spyOn(api, "step");']));
  assert.deepEqual(hits, []);
});

test('rejects an attribution trailer', () => {
  const hits = findLogViolations(`ci: probe\n\n${authored}: A <a@example.com>\n\x1e`);
  assert.equal(hits.length, 1);
  assert.equal(hits[0]?.rule, 'attribution');
});

test('accepts a clean log', () => {
  assert.deepEqual(findLogViolations('ci: add checks\n\nNo trailer.\n\x1e'), []);
});
