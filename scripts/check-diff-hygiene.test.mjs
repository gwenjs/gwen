import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  addedAllowlistEntries,
  findDiffViolations,
  findLogViolations,
  isAllowlisted,
  reviewAllowlistChange,
} from './check-diff-hygiene.mjs';

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
const allowComment = ['//', ' allowlist: fixture #7'].join('');

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

test('a same-line allowlist comment grants nothing', () => {
  const line = `const x = value ${cast} Type; ${allowComment}`;
  const hits = findDiffViolations(diff('src/a.ts', [line]));
  assert.ok(hits.some((hit) => hit.rule === 'as-unknown-as'));
  assert.ok(hits.some((hit) => hit.text === 'invalid: use allowlist.json'));
});

test('a missing allowlist entry does not skip a flagged line', () => {
  const line = `const x = value ${cast} Type; ${allowComment}`;
  const entries = [{ file: 'src/other.ts', rule: 'as-unknown-as', reason: 'other file', ticket: '#7' }];
  const hits = findDiffViolations(diff('src/a.ts', [line]), entries);
  assert.ok(hits.some((hit) => hit.rule === 'as-unknown-as'));
  assert.equal(isAllowlisted(entries, 'src/a.ts', 'as-unknown-as'), false);
});

test('an allowlist entry skips that file and rule', () => {
  const line = `const x = value ${cast} Type;`;
  const entries = [{ file: 'src/a.ts', rule: 'as-unknown-as', reason: 'fixture', ticket: '#7' }];
  assert.equal(isAllowlisted(entries, 'src/a.ts', 'as-unknown-as'), true);
  assert.deepEqual(findDiffViolations(diff('src/a.ts', [line]), entries), []);
});

test('an allowlist.json change without the label fails', () => {
  const text = [diff('scripts/agent-hygiene/allowlist.json', ['[]']), diff('src/a.ts', [`const x = value ${cast} Type; ${allowComment}`])].join(
    '\n',
  );
  assert.deepEqual(reviewAllowlistChange(text, false), [
    'allowlist changed: needs a maintainer-applied allowlist-approved label',
  ]);
  const hits = findDiffViolations(text, []);
  assert.ok(hits.some((hit) => hit.rule === 'as-unknown-as'));
});

test('an allowlist.json change with the label passes', () => {
  const text = diff('scripts/agent-hygiene/allowlist.json', ['[]']);
  assert.deepEqual(reviewAllowlistChange(text, true), []);
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

test('creating allowlist.json empty needs no label', () => {
  const text = diff('scripts/agent-hygiene/allowlist.json', ['[]']);
  assert.deepEqual(reviewAllowlistChange(text, false, [], []), []);
});

test('an unchanged allowlist needs no label', () => {
  const entry = { file: 'src/a.ts', rule: 'as-unknown-as', reason: 'fixture', ticket: '#7' };
  const text = diff('scripts/agent-hygiene/allowlist.json', ['[]']);
  assert.deepEqual(reviewAllowlistChange(text, false, [entry], [entry]), []);
});

test('removing an allowlist entry needs no label', () => {
  const entry = { file: 'src/a.ts', rule: 'as-unknown-as', reason: 'fixture', ticket: '#7' };
  const text = diff('scripts/agent-hygiene/allowlist.json', ['[]']);
  assert.deepEqual(reviewAllowlistChange(text, false, [entry], []), []);
});

test('adding an allowlist entry without the label fails', () => {
  const entry = { file: 'src/a.ts', rule: 'as-unknown-as', reason: 'fixture', ticket: '#7' };
  const text = diff('scripts/agent-hygiene/allowlist.json', ['[{}]']);
  assert.deepEqual(reviewAllowlistChange(text, false, [], [entry]), [
    'allowlist changed: needs a maintainer-applied allowlist-approved label',
  ]);
  assert.deepEqual(addedAllowlistEntries([], [entry]), [entry]);
});

test('changing the reason of an existing entry counts as a new entry', () => {
  const before = { file: 'src/a.ts', rule: 'as-unknown-as', reason: 'fixture', ticket: '#7' };
  const after = { file: 'src/a.ts', rule: 'as-unknown-as', reason: 'because', ticket: '#7' };
  const text = diff('scripts/agent-hygiene/allowlist.json', ['[{}]']);
  assert.equal(reviewAllowlistChange(text, false, [before], [after]).length, 1);
});

test('without the entry lists the label stays required', () => {
  const text = diff('scripts/agent-hygiene/allowlist.json', ['[]']);
  assert.equal(reviewAllowlistChange(text, false, null, []).length, 1);
  assert.equal(reviewAllowlistChange(text, false, [], null).length, 1);
});

test('a diff that does not touch allowlist.json never needs the label', () => {
  const text = diff('src/a.ts', ['const x = 1;']);
  assert.deepEqual(reviewAllowlistChange(text, false, [], []), []);
});

const wasmFile = 'packages/core/tests/integration-wasm/engine.test.ts';

test('rejects createRealEngine without dispose in finally or afterEach', () => {
  const hits = findDiffViolations(
    diff(wasmFile, ['const handle = await createRealEngine();', 'handle.step();']),
  );
  assert.ok(hits.some((hit) => hit.rule === 'wasm-dispose'));
});

test('rejects dispose that sits outside finally and afterEach', () => {
  const hits = findDiffViolations(
    diff(wasmFile, ['function cleanup() { handle.dispose(); }', 'const handle = await createRealEngine();']),
  );
  assert.ok(hits.some((hit) => hit.rule === 'wasm-dispose'));
});

test('accepts dispose inside finally', () => {
  const bare = findDiffViolations(diff(wasmFile, ['const handle = await createRealEngine();']));
  const hits = findDiffViolations(
    diff(wasmFile, [
      'const handle = await createRealEngine();',
      'try {',
      '  handle.step();',
      '} finally {',
      '  await handle.dispose();',
      '}',
    ]),
  );
  assert.ok(bare.some((hit) => hit.rule === 'wasm-dispose'));
  assert.deepEqual(
    hits.filter((hit) => hit.rule === 'wasm-dispose' || hit.rule === 'expect-in-finally'),
    [],
  );
});

test('accepts dispose inside afterEach', () => {
  const bare = findDiffViolations(diff(wasmFile, ['const handle = await createRealEngine();']));
  const hits = findDiffViolations(
    diff(wasmFile, [
      'afterEach(() => {',
      '  handle.dispose();',
      '});',
      'const handle = await createRealEngine();',
    ]),
  );
  assert.ok(bare.some((hit) => hit.rule === 'wasm-dispose'));
  assert.deepEqual(
    hits.filter((hit) => hit.rule === 'wasm-dispose'),
    [],
  );
});

test('rejects an added expect inside finally', () => {
  const hits = findDiffViolations(
    diff(wasmFile, [
      'const handle = await createRealEngine();',
      'try {',
      '  handle.step();',
      '} finally {',
      '  expect(1).toBe(1);',
      '  await handle.dispose();',
      '}',
    ]),
  );
  assert.ok(hits.some((hit) => hit.rule === 'expect-in-finally'));
});

test('allows expect outside finally', () => {
  const inside = findDiffViolations(
    diff(wasmFile, [
      'const handle = await createRealEngine();',
      'try {',
      '  handle.step();',
      '} finally {',
      '  expect(1).toBe(1);',
      '  await handle.dispose();',
      '}',
    ]),
  );
  const hits = findDiffViolations(
    diff(wasmFile, [
      'const handle = await createRealEngine();',
      'try {',
      '  handle.step();',
      '  expect(1).toBe(1);',
      '} finally {',
      '  await handle.dispose();',
      '}',
    ]),
  );
  assert.ok(inside.some((hit) => hit.rule === 'expect-in-finally'));
  assert.deepEqual(
    hits.filter((hit) => hit.rule === 'expect-in-finally'),
    [],
  );
});

test('does not flag a pre-existing expect inside finally', () => {
  const content = [
    'const handle = await createRealEngine();',
    'try {',
    '  handle.step();',
    '} finally {',
    '  expect(1).toBe(1);',
    '  const note = 1;',
    '  await handle.dispose();',
    '}',
  ].join('\n');
  const text = [
    `diff --git a/${wasmFile} b/${wasmFile}`,
    `--- a/${wasmFile}`,
    `+++ b/${wasmFile}`,
    '@@ -1,7 +1,8 @@',
    ' const handle = await createRealEngine();',
    ' try {',
    '   handle.step();',
    ' } finally {',
    '   expect(1).toBe(1);',
    '+  const note = 1;',
    '   await handle.dispose();',
    ' }',
  ].join('\n');
  const added = findDiffViolations(
    diff(wasmFile, [
      'const handle = await createRealEngine();',
      'try {',
      '  handle.step();',
      '} finally {',
      '  expect(1).toBe(1);',
      '  await handle.dispose();',
      '}',
    ]),
  );
  const hits = findDiffViolations(text, [], { [wasmFile]: content });
  assert.ok(added.some((hit) => hit.rule === 'expect-in-finally'));
  assert.deepEqual(
    hits.filter((hit) => hit.rule === 'expect-in-finally' || hit.rule === 'wasm-dispose'),
    [],
  );
});

test('rejects a changed file that calls createRealEngine and never disposes', () => {
  const content = 'const handle = await createRealEngine();\nhandle.step();\n';
  const text = [
    `diff --git a/${wasmFile} b/${wasmFile}`,
    `--- a/${wasmFile}`,
    `+++ b/${wasmFile}`,
    '@@ -1 +1,2 @@',
    ' const handle = await createRealEngine();',
    '+handle.step();',
  ].join('\n');
  const hits = findDiffViolations(text, [], { [wasmFile]: content });
  assert.ok(hits.some((hit) => hit.rule === 'wasm-dispose'));
});

test('does not require dispose outside integration-wasm', () => {
  const inside = findDiffViolations(diff(wasmFile, ['await createRealEngine();']));
  const hits = findDiffViolations(diff('packages/core/src/testing.ts', ['await createRealEngine();']));
  assert.ok(inside.some((hit) => hit.rule === 'wasm-dispose'));
  assert.deepEqual(hits, []);
});

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

/**
 * @param {string} file
 * @returns {{ file: string, rule: string, text: string }[]}
 */
function scanWasmFile(file) {
  const content = readFileSync(`${repoRoot}/${file}`, 'utf8');
  return findDiffViolations(diff(file, content.split('\n'))).filter((hit) => hit.rule === 'wasm-dispose');
}

test('accepts engine.stop in finally for a destructured engine', () => {
  const bare = findDiffViolations(diff(wasmFile, ['const { engine } = await createRealEngine();']));
  const hits = findDiffViolations(
    diff(wasmFile, [
      'const { engine } = await createRealEngine();',
      'try {',
      '  engine.step();',
      '} finally {',
      '  await engine.stop();',
      '}',
    ]),
  );
  const renamed = findDiffViolations(
    diff(wasmFile, [
      'const { engine: eng } = await createRealEngine();',
      'try {',
      '  eng.step();',
      '} finally {',
      '  await eng.stop();',
      '}',
    ]),
  );
  assert.ok(bare.some((hit) => hit.rule === 'wasm-dispose'));
  assert.deepEqual(
    hits.filter((hit) => hit.rule === 'wasm-dispose'),
    [],
  );
  assert.deepEqual(
    renamed.filter((hit) => hit.rule === 'wasm-dispose'),
    [],
  );
});

test('accepts handle.engine.stop in finally', () => {
  const bare = findDiffViolations(diff(wasmFile, ['const handle = await createRealEngine();']));
  const hits = findDiffViolations(
    diff(wasmFile, [
      'const handle = await createRealEngine();',
      'try {',
      '  handle.step();',
      '} finally {',
      '  await handle.engine.stop();',
      '}',
    ]),
  );
  assert.ok(bare.some((hit) => hit.rule === 'wasm-dispose'));
  assert.deepEqual(
    hits.filter((hit) => hit.rule === 'wasm-dispose'),
    [],
  );
});

test('rejects two engines when only one is disposed', () => {
  const hits = findDiffViolations(
    diff(wasmFile, [
      'const first = await createRealEngine();',
      'const second = await createRealEngine();',
      'try {',
      '  first.step();',
      '} finally {',
      '  await first.dispose();',
      '}',
    ]),
  );
  assert.ok(hits.some((hit) => hit.rule === 'wasm-dispose'));
});

test('rejects an unrelated dispose call', () => {
  const hits = findDiffViolations(
    diff(wasmFile, [
      'function dispose() { return 1; }',
      'const handle = await createRealEngine();',
      'try {',
      '  handle.step();',
      '} finally {',
      '  dispose();',
      '}',
    ]),
  );
  assert.ok(hits.some((hit) => hit.rule === 'wasm-dispose'));
});

test('rejects createRealEngine imported under another name', () => {
  const bare = findDiffViolations(
    diff(wasmFile, [
      'import { createRealEngine as make } from "./harness.js";',
      'const handle = await make();',
    ]),
  );
  const hits = findDiffViolations(
    diff(wasmFile, [
      'import { createRealEngine as make } from "./harness.js";',
      'const handle = await make();',
      'try {',
      '  handle.step();',
      '} finally {',
      '  await handle.dispose();',
      '}',
    ]),
  );
  assert.ok(bare.some((hit) => hit.rule === 'wasm-dispose'));
  assert.deepEqual(
    hits.filter((hit) => hit.rule === 'wasm-dispose'),
    [],
  );
});

test('rejects a local function named dispose', () => {
  const hits = findDiffViolations(
    diff(wasmFile, [
      'const { engine } = await createRealEngine();',
      'const dispose = async () => { await engine.stop(); };',
      'try {',
      '  engine.step();',
      '} finally {',
      '  await dispose();',
      '}',
    ]),
  );
  assert.ok(hits.some((hit) => hit.rule === 'wasm-dispose'));
});

test('rejects dispose inside promise.finally', () => {
  const hits = findDiffViolations(
    diff(wasmFile, [
      'const handle = await createRealEngine();',
      'promise.finally(() => {',
      '  handle.dispose();',
      '});',
    ]),
  );
  assert.ok(hits.some((hit) => hit.rule === 'wasm-dispose'));
});

test('initial-scene-activation is not a wasm-dispose hit', () => {
  const bare = findDiffViolations(diff(wasmFile, ['const { engine } = await createRealEngine();']));
  assert.ok(bare.some((hit) => hit.rule === 'wasm-dispose'));
  assert.deepEqual(scanWasmFile('packages/core/tests/integration-wasm/initial-scene-activation.test.ts'), []);
});

test('p1-memory-growth is not a wasm-dispose hit', () => {
  const bare = findDiffViolations(diff(wasmFile, ['const { engine } = await createRealEngine();']));
  assert.ok(bare.some((hit) => hit.rule === 'wasm-dispose'));
  assert.deepEqual(scanWasmFile('packages/core/tests/integration-wasm/p1-memory-growth.test.ts'), []);
});

test('query-accessor is not a wasm-dispose hit', () => {
  const bare = findDiffViolations(diff(wasmFile, ['const handle = await createRealEngine();']));
  assert.ok(bare.some((hit) => hit.rule === 'wasm-dispose'));
  assert.deepEqual(scanWasmFile('packages/core/tests/integration-wasm/query-accessor.test.ts'), []);
});

test('p1-error-policy disposes every real engine', () => {
  const bare = findDiffViolations(diff(wasmFile, ['const { engine } = await createRealEngine();']));
  assert.ok(bare.some((hit) => hit.rule === 'wasm-dispose'));
  assert.deepEqual(scanWasmFile('packages/core/tests/integration-wasm/p1-error-policy.test.ts'), []);
});

test('p54-stale-physics-handles disposes every real engine', () => {
  const bare = findDiffViolations(diff(wasmFile, ['const handle = await createRealEngine();']));
  assert.ok(bare.some((hit) => hit.rule === 'wasm-dispose'));
  assert.deepEqual(scanWasmFile('packages/core/tests/integration-wasm/p54-stale-physics-handles.test.ts'), []);
});

test('wasm-errors disposes every real engine', () => {
  const bare = findDiffViolations(diff(wasmFile, ['const { engine } = await createRealEngine();']));
  assert.ok(bare.some((hit) => hit.rule === 'wasm-dispose'));
  assert.deepEqual(scanWasmFile('packages/core/tests/integration-wasm/wasm-errors.test.ts'), []);
});

test('wasm-trap disposes every real engine', () => {
  const bare = findDiffViolations(diff(wasmFile, ['const { engine } = await createRealEngine();']));
  assert.ok(bare.some((hit) => hit.rule === 'wasm-dispose'));
  assert.deepEqual(scanWasmFile('packages/core/tests/integration-wasm/wasm-trap.test.ts'), []);
});

test('netcode-ready local dispose is still a wasm-dispose hit', () => {
  const bare = findDiffViolations(diff(wasmFile, ['const handle = await createRealEngine();']));
  assert.ok(bare.some((hit) => hit.rule === 'wasm-dispose'));
  assert.ok(scanWasmFile('packages/core/tests/integration-wasm/netcode-ready.test.ts').length > 0);
});

test('determinism local dispose is still a wasm-dispose hit', () => {
  const bare = findDiffViolations(diff(wasmFile, ['const { engine } = await createRealEngine();']));
  assert.ok(bare.some((hit) => hit.rule === 'wasm-dispose'));
  assert.ok(scanWasmFile('packages/core/tests/integration-wasm/determinism.test.ts').length > 0);
});

test('rejects createRealEngine called through a namespace import', () => {
  const bare = findDiffViolations(
    diff(wasmFile, [
      "import * as H from './harness.js';",
      'const handle = await H.createRealEngine();',
      'handle.step();',
    ]),
  );
  assert.ok(bare.some((hit) => hit.rule === 'wasm-dispose'));
  const guarded = findDiffViolations(
    diff(wasmFile, [
      "import * as H from './harness.js';",
      'const handle = await H.createRealEngine();',
      'try {',
      '  handle.step();',
      '} finally {',
      '  await handle.dispose();',
      '}',
    ]),
  );
  assert.ok(!guarded.some((hit) => hit.rule === 'wasm-dispose'));
});

test('rejects a binding assigned two engines with one dispose', () => {
  const hits = findDiffViolations(
    diff(wasmFile, [
      'let handle = await createRealEngine();',
      'handle = await createRealEngine();',
      'try {',
      '  handle.step();',
      '} finally {',
      '  await handle.dispose();',
      '}',
    ]),
  );
  assert.ok(hits.some((hit) => hit.rule === 'wasm-dispose'));
  const late = findDiffViolations(
    diff(wasmFile, [
      'let handle;',
      'try {',
      '  handle = await createRealEngine();',
      '  handle.step();',
      '} finally {',
      '  await handle?.dispose();',
      '}',
    ]),
  );
  assert.ok(!late.some((hit) => hit.rule === 'wasm-dispose'));
});

/**
 * @param {string[]} lines
 * @returns {boolean}
 */
function disposeHit(lines) {
  return findDiffViolations(diff(wasmFile, lines)).some((hit) => hit.rule === 'wasm-dispose');
}

test('rejects createRealEngine reached through a renamed or computed reference', () => {
  const shapes = [
    ["import * as H from './harness.js';", 'const { createRealEngine: mk } = H;', 'const handle = await mk();'],
    ["import * as H from './harness.js';", 'const mk = H.createRealEngine;', 'const handle = await mk();'],
    ["import * as H from './harness.js';", "const handle = await H['createRealEngine']();"],
    ["const { createRealEngine: mk } = await import('./harness.js');", 'const handle = await mk();'],
    ["const { engine } = await (await import('./harness.js')).createRealEngine();"],
  ];
  for (const shape of shapes) {
    assert.ok(disposeHit([...shape, 'handle.step();']), shape.join('\n'));
  }
  const guarded = [
    ["import * as H from './harness.js';", 'const mk = H.createRealEngine;', 'const handle = await mk();'],
    ['try {', '  handle.step();', '} finally {', '  await handle.dispose();', '}'],
  ].flat();
  assert.ok(!disposeHit(guarded), guarded.join('\n'));
});

test('rejects a dispose behind a condition that never holds', () => {
  const dead = [
    'const handle = await createRealEngine();',
    'try {',
    '  handle.step();',
    '} finally {',
    '  if (false) handle.dispose();',
    '}',
  ];
  assert.ok(disposeHit(dead));
  const live = dead.map((line) => line.replace('if (false)', 'if (handle)'));
  assert.ok(!disposeHit(live), live.join('\n'));
});

test('accepts engines pushed into an array and released by a loop in finally', () => {
  const loop = [
    'const engines = [];',
    'try {',
    '  engines.push(await createRealEngine());',
    '  engines.push(await createRealEngine());',
    '} finally {',
    '  for (const h of engines) await h.dispose();',
    '}',
  ];
  assert.ok(!disposeHit(loop), loop.join('\n'));
  const leaked = loop.filter((line) => !line.includes('dispose'));
  assert.ok(disposeHit(leaked), leaked.join('\n'));
});

/**
 * @param {string[]} setup
 * @param {string[]} cleanup
 * @returns {string[]}
 */
function withFinally(setup, cleanup) {
  return [...setup, 'try {', '  handle.step();', '} finally {', ...cleanup.map((line) => `  ${line}`), '}'];
}

test('rejects a dispose behind a falsy literal or a bare return, accepts one behind a local flag', () => {
  const setup = ['const handle = await createRealEngine();'];
  const shapes = [
    ['false && handle.dispose();'],
    ['if (handle && false) handle.dispose();'],
    ['if (false) {', '  log();', '  handle.dispose();', '}'],
    ['return;', 'handle.dispose();'],
  ];
  for (const cleanup of shapes) {
    const lines = withFinally(setup, cleanup);
    assert.ok(disposeHit(lines), lines.join('\n'));
  }
  const flagged = withFinally(
    ['const handle = await createRealEngine();', 'let disposed = false;'],
    ['if (!disposed) await handle.dispose();'],
  );
  assert.ok(!disposeHit(flagged), flagged.join('\n'));
  const block = withFinally(
    ['const handle = await createRealEngine();', 'let disposed = false;'],
    ['if (!disposed) {', '  await handle.dispose();', '}'],
  );
  assert.ok(!disposeHit(block), block.join('\n'));
});
