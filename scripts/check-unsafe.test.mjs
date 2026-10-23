import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateUnsafe } from './check-unsafe.mjs';

/**
 * @param {Record<string, string>} sources
 * @returns {{ path: string, text: string }[]}
 */
function files(sources) {
  return Object.entries(sources).map(([path, text]) => ({ path, text }));
}

const validBlock = [
  'fn alloc() {',
  '    // SAFETY: the layout size is non-zero and the alignment is 8. [U-001]',
  '    unsafe { 1 }',
  '}',
  '',
].join('\n');

const validTest = 'fn unsafe_site_u001() {}\n';

const validDoc = [
  '| id | file::fn | kind | invariant | upheld by | test |',
  '| --- | --- | --- | --- | --- | --- |',
  '| U-001 | src/a.rs::alloc | raw-alloc | size is non-zero | the layout check | unsafe_site_u001 |',
  '',
].join('\n');

/**
 * @param {Record<string, string>} sources
 * @returns {{ path: string, text: string }[]}
 */
function withSite(sources) {
  return files({
    'crates/gwen-core/src/a.rs': validBlock,
    'crates/gwen-core/tests/unsafe_sites.rs': validTest,
    ...sources,
  });
}

test('a block without SAFETY fails', () => {
  const errors = evaluateUnsafe(
    files({ 'crates/gwen-core/src/a.rs': 'fn f() {\n    unsafe { 1 }\n}\n' }),
    [],
  );
  assert.deepEqual(errors, ['missing SAFETY: crates/gwen-core/src/a.rs:2']);
});

test('a SAFETY comment without an id fails', () => {
  const errors = evaluateUnsafe(
    files({
      'crates/gwen-core/src/a.rs':
        'fn f() {\n    // SAFETY: the layout size is non-zero\n    unsafe { 1 }\n}\n',
    }),
    [],
  );
  assert.deepEqual(errors, ['SAFETY has no id: crates/gwen-core/src/a.rs:3']);
});

test('an id that is missing from UNSAFE.md fails', () => {
  const errors = evaluateUnsafe(files({ 'crates/gwen-core/src/a.rs': validBlock }), []);
  assert.deepEqual(errors, ['id U-001 is not in UNSAFE.md']);
});

test('an UNSAFE.md id that is not in the code fails', () => {
  const errors = evaluateUnsafe([], [{ path: 'crates/gwen-core/UNSAFE.md', text: validDoc }]);
  assert.deepEqual(errors, [
    'UNSAFE.md id U-001 is not in the code',
    'test unsafe_site_u001 was not found',
  ]);
});

test('a duplicate id fails', () => {
  const text = `${validBlock}fn g() {\n    // SAFETY: same id on a second site. [U-001]\n    unsafe { 2 }\n}\n`;
  const errors = evaluateUnsafe(files({ 'crates/gwen-core/src/a.rs': text }), [
    { path: 'crates/gwen-core/UNSAFE.md', text: validDoc },
  ]);
  assert.ok(errors.includes('duplicate id U-001'));
});

test('a test cell that names a missing function fails', () => {
  const doc = validDoc.replace('unsafe_site_u001', 'missing_fn');
  const errors = evaluateUnsafe(files({ 'crates/gwen-core/src/a.rs': validBlock }), [
    { path: 'crates/gwen-core/UNSAFE.md', text: doc },
  ]);
  assert.deepEqual(errors, ['test missing_fn was not found']);
});

test('an unsafe fn without a Safety section fails', () => {
  const text = '// SAFETY: the caller keeps the pointer in range. [U-002]\npub unsafe fn f() {}\n';
  const errors = evaluateUnsafe(files({ 'crates/gwen-core/src/a.rs': text }), []);
  assert.ok(errors.includes('unsafe fn has no # Safety: crates/gwen-core/src/a.rs:2'));
});

test('an allow of clippy::panic without an issue number fails', () => {
  const text = '#[allow(clippy::panic, reason = "trust me")]\nfn f() {}\n';
  const errors = evaluateUnsafe(files({ 'crates/gwen-core/src/a.rs': text }), []);
  assert.deepEqual(errors, ['allow clippy::panic has no issue: crates/gwen-core/src/a.rs:1']);
});

test('a block inside mod tests is ignored', () => {
  const text = '#[cfg(test)]\nmod tests {\n    fn f() {\n        unsafe { 1 }\n    }\n}\n';
  const errors = evaluateUnsafe(files({ 'crates/gwen-core/src/a.rs': text }), []);
  assert.deepEqual(errors, []);
});

test('a documented site with a matching row passes', () => {
  const errors = evaluateUnsafe(withSite({}), [
    { path: 'crates/gwen-core/UNSAFE.md', text: validDoc },
  ]);
  assert.deepEqual(errors, []);
});

test('an unsafe site in gwen-physics3d-fracture fails', () => {
  const errors = evaluateUnsafe(
    files({ 'crates/gwen-physics3d-fracture/src/lib.rs': 'fn f() {\n    unsafe { 1 }\n}\n' }),
    [],
  );
  assert.deepEqual(errors, [
    'gwen-physics3d-fracture has an unsafe site: crates/gwen-physics3d-fracture/src/lib.rs:2',
  ]);
});

test('a char quote before a block with no id fails', () => {
  const text = [
    "fn f<'a>() {",
    "    let c = '\"';",
    '    // SAFETY: no id',
    '    unsafe { 1 }',
    '}',
    '',
  ].join('\n');
  const errors = evaluateUnsafe(files({ 'crates/gwen-core/src/a.rs': text }), []);
  assert.deepEqual(errors, ['SAFETY has no id: crates/gwen-core/src/a.rs:4']);
});

test('a raw string before a block with no id fails', () => {
  const text = [
    'fn f() {',
    '    let s = r#"a"b"#;',
    '    // SAFETY: no id',
    '    unsafe { 1 }',
    '}',
    '',
  ].join('\n');
  const errors = evaluateUnsafe(files({ 'crates/gwen-core/src/a.rs': text }), []);
  assert.deepEqual(errors, ['SAFETY has no id: crates/gwen-core/src/a.rs:4']);
});

test('an expect of clippy::panic without an issue fails', () => {
  const text = '#[expect(clippy::panic, reason = "no issue")]\nfn f() {}\n';
  const errors = evaluateUnsafe(files({ 'crates/gwen-core/src/a.rs': text }), []);
  assert.deepEqual(errors, ['expect clippy::panic has no issue: crates/gwen-core/src/a.rs:1']);

  const allow = '#[allow(clippy::panic, reason = "bench (#80)")]\nfn f() {}\n';
  const ok = evaluateUnsafe(files({ 'crates/gwen-core/src/a.rs': allow }), []);
  assert.deepEqual(ok, []);
});

test('a Safety section on an earlier fn does not cover the next unsafe fn', () => {
  const detached = [
    '/// # Safety',
    '/// The earlier function upholds the invariant.',
    'const fn earlier() {}',
    '',
    '// SAFETY: the caller keeps the pointer in range. [U-002]',
    'pub unsafe fn later() {}',
    '',
  ].join('\n');
  const errors = evaluateUnsafe(files({ 'crates/gwen-core/src/a.rs': detached }), []);
  assert.deepEqual(errors, [
    'unsafe fn has no # Safety: crates/gwen-core/src/a.rs:6',
    'id U-002 is not in UNSAFE.md',
  ]);

  const attached = [
    '/// # Safety',
    '/// The caller keeps the pointer in range.',
    '// SAFETY: the caller keeps the pointer in range. [U-002]',
    'pub unsafe fn later() {}',
    '',
  ].join('\n');
  const ok = evaluateUnsafe(files({ 'crates/gwen-core/src/a.rs': attached }), []);
  assert.deepEqual(ok, ['id U-002 is not in UNSAFE.md']);
});

test('a Safety section on an earlier fn does not cover the next unsafe fn without a blank line', () => {
  const detached = [
    '/// # Safety',
    '/// The earlier function upholds the invariant.',
    'const fn earlier() {}',
    '// SAFETY: the caller keeps the pointer in range. [U-002]',
    'pub unsafe fn later() {}',
  ].join('\n');
  const errors = evaluateUnsafe(files({ 'crates/gwen-core/src/a.rs': detached }), []);
  assert.deepEqual(errors, [
    'unsafe fn has no # Safety: crates/gwen-core/src/a.rs:5',
    'id U-002 is not in UNSAFE.md',
  ]);
});

test('a test name that appears only in a comment fails', () => {
  const text = `${validBlock}// fn unsafe_site_u001() {}\n`;
  const errors = evaluateUnsafe(files({ 'crates/gwen-core/src/a.rs': text }), [
    { path: 'crates/gwen-core/UNSAFE.md', text: validDoc },
  ]);
  assert.deepEqual(errors, ['test unsafe_site_u001 was not found']);
});

test('a production fn named unsafe_site_u001 is not a test', () => {
  const text = `${validBlock}fn unsafe_site_u001() {}\n`;
  const errors = evaluateUnsafe(files({ 'crates/gwen-core/src/a.rs': text }), [
    { path: 'crates/gwen-core/UNSAFE.md', text: validDoc },
  ]);
  assert.deepEqual(errors, ['test unsafe_site_u001 is not an unsafe_site test']);

  const marked = `${validBlock}#[test]\nfn unsafe_site_u001() {}\n`;
  const ok = evaluateUnsafe(files({ 'crates/gwen-core/src/a.rs': marked }), [
    { path: 'crates/gwen-core/UNSAFE.md', text: validDoc },
  ]);
  assert.deepEqual(ok, []);
});

test('kind nope is not allowed', () => {
  const nopeDoc = validDoc.replace('raw-alloc', 'nope');
  const nope = evaluateUnsafe(withSite({}), [{ path: 'crates/gwen-core/UNSAFE.md', text: nopeDoc }]);
  assert.deepEqual(nope, ['kind nope is not allowed: U-001']);

  const syncDoc = validDoc.replace('raw-alloc', 'send-sync');
  const sync = evaluateUnsafe(withSite({}), [{ path: 'crates/gwen-core/UNSAFE.md', text: syncDoc }]);
  assert.deepEqual(sync, []);
});

test("an id in another crate's UNSAFE.md does not cover this crate", () => {
  const errors = evaluateUnsafe(
    files({
      'crates/gwen-wasm-utils/src/a.rs': validBlock,
      'crates/gwen-core/tests/unsafe_sites.rs': validTest,
    }),
    [{ path: 'crates/gwen-core/UNSAFE.md', text: validDoc }],
  );
  assert.deepEqual(errors, [
    'id U-001 is not in UNSAFE.md',
    'UNSAFE.md id U-001 is not in the code',
  ]);
});

test('a block under src/foo/tests is still checked', () => {
  const nested = evaluateUnsafe(
    files({
      'crates/gwen-core/src/foo/tests/leak.rs': 'fn f() {\n    unsafe { 1 }\n}\n',
    }),
    [],
  );
  assert.deepEqual(nested, ['missing SAFETY: crates/gwen-core/src/foo/tests/leak.rs:2']);

  const top = evaluateUnsafe(
    files({
      'crates/gwen-core/tests/leak.rs': 'fn f() {\n    unsafe { 1 }\n}\n',
    }),
    [],
  );
  assert.deepEqual(top, []);
});

test('a removed test cell fails', () => {
  const doc = validDoc.replace('unsafe_site_u001', 'removed');
  const errors = evaluateUnsafe(files({ 'crates/gwen-core/src/a.rs': validBlock }), [
    { path: 'crates/gwen-core/UNSAFE.md', text: doc },
  ]);
  assert.deepEqual(errors, ['test cell removed is not a proof: U-001']);
});

test('an ffi-ptr row citing packages/physics3d/src/plugin/spatial-queries.ts:153 passes when exists() is true', () => {
  const doc = [
    '| id | file::fn | kind | invariant | upheld by | test |',
    '| --- | --- | --- | --- | --- | --- |',
    '| U-001 | src/a.rs::alloc | ffi-ptr | pointer stays in the buffer | the length check | packages/physics3d/src/plugin/spatial-queries.ts:153 |',
    '',
  ].join('\n');
  const errors = evaluateUnsafe(
    files({ 'crates/gwen-core/src/a.rs': validBlock }),
    [{ path: 'crates/gwen-core/UNSAFE.md', text: doc }],
    {
      /**
       * @param {string} filePath
       * @returns {boolean}
       */
      exists(filePath) {
        return filePath === 'packages/physics3d/src/plugin/spatial-queries.ts';
      },
    },
  );
  assert.deepEqual(errors, []);
});

test('an unsafe_site name must use the same id number as the row', () => {
  const mismatchDoc = validDoc.replace('unsafe_site_u001', 'unsafe_site_u999_records_align');
  const mismatch = evaluateUnsafe(
    withSite({
      'crates/gwen-core/tests/unsafe_sites.rs':
        '#[test]\nfn unsafe_site_u999_records_align() {}\n',
    }),
    [{ path: 'crates/gwen-core/UNSAFE.md', text: mismatchDoc }],
  );
  assert.deepEqual(mismatch, ['test unsafe_site_u999_records_align does not match id U-001']);

  const sameDoc = validDoc.replace('unsafe_site_u001', 'unsafe_site_u001_records_align_8');
  const same = evaluateUnsafe(
    withSite({
      'crates/gwen-core/tests/unsafe_sites.rs':
        '#[test]\nfn unsafe_site_u001_records_align_8() {}\n',
    }),
    [{ path: 'crates/gwen-core/UNSAFE.md', text: sameDoc }],
  );
  assert.deepEqual(same, []);

  const paddedDoc = validDoc.replace('unsafe_site_u001', 'unsafe_site_u1_records_align_8');
  const padded = evaluateUnsafe(
    withSite({
      'crates/gwen-core/tests/unsafe_sites.rs': '#[test]\nfn unsafe_site_u1_records_align_8() {}\n',
    }),
    [{ path: 'crates/gwen-core/UNSAFE.md', text: paddedDoc }],
  );
  assert.deepEqual(padded, []);
});

test('an unconditional ignore on an unsafe_site test is not a proof', () => {
  const bare = evaluateUnsafe(
    withSite({
      'crates/gwen-core/tests/unsafe_sites.rs': '#[test]\n#[ignore]\nfn unsafe_site_u001() {}\n',
    }),
    [{ path: 'crates/gwen-core/UNSAFE.md', text: validDoc }],
  );
  assert.deepEqual(bare, ['test unsafe_site_u001 is ignored: U-001']);

  const reason = evaluateUnsafe(
    withSite({
      'crates/gwen-core/tests/unsafe_sites.rs':
        '#[ignore = "needs a gpu"]\n#[test]\nfn unsafe_site_u001() {}\n',
    }),
    [{ path: 'crates/gwen-core/UNSAFE.md', text: validDoc }],
  );
  assert.deepEqual(reason, ['test unsafe_site_u001 is ignored: U-001']);
});

test('a proof under cfg_attr(miri, ignore) is refused', () => {
  const doc = [{ path: 'crates/gwen-core/UNSAFE.md', text: validDoc }];
  const expected = ['test unsafe_site_u001 is ignored under Miri: U-001'];
  const bodies = [
    '#[test]\n#[cfg_attr(miri, ignore = "x")]\nfn unsafe_site_u001() {}\n',
    '#[test]\n#[cfg_attr(miri, ignore)]\nfn unsafe_site_u001() {}\n',
    '#[test]\n#[cfg_attr(all(miri, not(target_arch = "x86_64")), ignore)]\nfn unsafe_site_u001() {}\n',
    '#[test]\n#[cfg_attr(any(miri, windows), ignore)]\nfn unsafe_site_u001() {}\n',
    [
      '#[test]',
      '#[cfg_attr(',
      '    miri,',
      '    ignore = "wall-clock bound; Miri interprets allocation and 100 ms cannot hold. Measured 4100 ms."',
      ')]',
      'fn unsafe_site_u001() {}',
      '',
    ].join('\n'),
    '#[test]\n#[cfg_attr(miri, ignore, should_panic)]\nfn unsafe_site_u001() {}\n',
  ];
  for (const body of bodies) {
    const errors = evaluateUnsafe(
      withSite({ 'crates/gwen-core/tests/unsafe_sites.rs': body }),
      doc,
    );
    assert.deepEqual(errors, expected);
  }

  const src = `${validBlock}#[cfg(test)]\nmod tests {\n    #[test]\n    #[cfg_attr(miri, ignore = "x")]\n    fn unsafe_site_u001() {}\n}\n`;
  const srcErrors = evaluateUnsafe(files({ 'crates/gwen-core/src/a.rs': src }), doc);
  assert.deepEqual(srcErrors, expected);

  const quiet = [
    '#[test]\n#[cfg_attr(feature = "slow", ignore)]\nfn unsafe_site_u001() {}\n',
    '#[test]\n#[cfg_attr(target_arch = "wasm32", ignore)]\nfn unsafe_site_u001() {}\n',
    '#[test]\n#[cfg_attr(miri, should_panic)]\nfn unsafe_site_u001() {}\n',
    '#[test]\n#[cfg_attr(feature = "miri", ignore)]\nfn unsafe_site_u001() {}\n',
    '#[test]\n// #[cfg_attr(miri, ignore)]\nfn unsafe_site_u001() {}\n',
  ];
  for (const body of quiet) {
    const errors = evaluateUnsafe(
      withSite({ 'crates/gwen-core/tests/unsafe_sites.rs': body }),
      doc,
    );
    assert.deepEqual(errors, []);
  }

  const precedence = evaluateUnsafe(
    files({
      'crates/gwen-core/src/a.rs': validBlock,
      'crates/gwen-core/tests/other.rs':
        '#[ignore]\n#[cfg_attr(miri, ignore)]\nfn unsafe_site_u001() {}\n',
    }),
    doc,
  );
  assert.deepEqual(precedence, ['test unsafe_site_u001 is ignored: U-001']);
});

test('a proof outside unsafe_sites.rs and src tests is refused', () => {
  const doc = [{ path: 'crates/gwen-core/UNSAFE.md', text: validDoc }];
  const other = evaluateUnsafe(
    files({
      'crates/gwen-core/src/a.rs': validBlock,
      'crates/gwen-core/tests/other.rs': 'fn unsafe_site_u001() {}\n',
    }),
    doc,
  );
  assert.deepEqual(other, ['test unsafe_site_u001 is not in a Miri target: U-001']);

  const nested = evaluateUnsafe(
    files({
      'crates/gwen-core/src/a.rs': validBlock,
      'crates/gwen-core/tests/sub/unsafe_sites.rs': '#[test]\nfn unsafe_site_u001() {}\n',
    }),
    doc,
  );
  assert.deepEqual(nested, ['test unsafe_site_u001 is not in a Miri target: U-001']);

  const sites = evaluateUnsafe(
    withSite({
      'crates/gwen-core/tests/unsafe_sites.rs': '#[test]\nfn unsafe_site_u001() {}\n',
    }),
    doc,
  );
  assert.deepEqual(sites, []);

  const src = `${validBlock}#[cfg(test)]\nmod tests {\n    #[test]\n    fn unsafe_site_u001() {}\n}\n`;
  const srcErrors = evaluateUnsafe(files({ 'crates/gwen-core/src/a.rs': src }), doc);
  assert.deepEqual(srcErrors, []);

  const nestedSrc = evaluateUnsafe(
    files({
      'crates/gwen-core/src/a.rs': validBlock,
      'crates/gwen-core/src/x/tests/y.rs': '#[test]\nfn unsafe_site_u001() {}\n',
    }),
    doc,
  );
  assert.deepEqual(nestedSrc, []);

  const wasm = evaluateUnsafe(
    files({
      'crates/gwen-wasm-utils/src/a.rs': validBlock,
      'crates/gwen-wasm-utils/tests/unsafe_sites.rs': '#[test]\nfn unsafe_site_u001() {}\n',
    }),
    [{ path: 'crates/gwen-wasm-utils/UNSAFE.md', text: validDoc }],
  );
  assert.deepEqual(wasm, []);
});

test('a multi-line attribute between the test attribute and the fn does not hide either', () => {
  const between = ['#[allow(', '    dead_code,', '    reason = "x"', ')]'].join('\n');
  const doc = [{ path: 'crates/gwen-core/UNSAFE.md', text: validDoc }];
  const seen = evaluateUnsafe(
    files({
      'crates/gwen-core/src/a.rs': validBlock,
      'crates/gwen-core/src/b.rs': ['#[test]', between, 'fn unsafe_site_u001() {}', ''].join('\n'),
    }),
    doc,
  );
  assert.deepEqual(seen, []);

  const ignored = evaluateUnsafe(
    withSite({
      'crates/gwen-core/tests/unsafe_sites.rs': [
        '#[ignore]',
        between,
        '#[test]',
        'fn unsafe_site_u001() {}',
        '',
      ].join('\n'),
    }),
    doc,
  );
  assert.deepEqual(ignored, ['test unsafe_site_u001 is ignored: U-001']);
});
