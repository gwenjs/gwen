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
  'fn unsafe_site_u001() {}',
  '',
].join('\n');

const validDoc = [
  '| id | file::fn | kind | invariant | upheld by | test |',
  '| --- | --- | --- | --- | --- | --- |',
  '| U-001 | src/a.rs::alloc | raw-alloc | size is non-zero | the layout check | unsafe_site_u001 |',
  '',
].join('\n');

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
      'crates/gwen-core/src/a.rs': 'fn f() {\n    // SAFETY: the layout size is non-zero\n    unsafe { 1 }\n}\n',
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
  assert.deepEqual(errors, ['UNSAFE.md id U-001 is not in the code']);
});

test('a duplicate id fails', () => {
  const text = `${validBlock}\nfn g() {\n    // SAFETY: same id on a second site. [U-001]\n    unsafe { 2 }\n}\n`;
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
  const errors = evaluateUnsafe(files({ 'crates/gwen-core/src/a.rs': validBlock }), [
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
