import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const PANIC_LINTS = [
  'clippy::unwrap_used',
  'clippy::expect_used',
  'clippy::panic',
  'clippy::unreachable',
  'clippy::todo',
  'clippy::unimplemented',
];

const BIN_SOURCE = /^crates\/(?:[^/]+\/)+src\/bin\/[^/]+\.rs$/;

/**
 * @param {string} filePath
 * @returns {boolean}
 */
function isBinSource(filePath) {
  return BIN_SOURCE.test(filePath);
}

/**
 * @param {string} text
 * @param {number} index
 * @returns {number}
 */
function skipWsAndComments(text, index) {
  const end = text.length;
  let i = index;
  while (i < end) {
    const ch = text[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f') {
      i += 1;
      continue;
    }
    if (ch === '/' && text[i + 1] === '/') {
      const nl = text.indexOf('\n', i + 2);
      i = nl === -1 ? end : nl + 1;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2);
      i = close === -1 ? end : close + 2;
      continue;
    }
    break;
  }
  return i;
}

/**
 * @param {string} text
 * @param {number} index
 * @returns {number}
 */
function skipLiteral(text, index) {
  let i = index;
  const two = text.slice(i, i + 2);
  if (two === 'br' || two === 'cr') i += 2;
  else if (text[index] === 'b' || text[index] === 'c' || text[index] === 'r') i += 1;

  if (i !== index && text[i] !== '"' && text[i] !== "'" && text[i] !== '#') return index;
  if (i === index && text[i] !== '"' && text[i] !== "'") return index;

  if (text[i] === '#') {
    let hashes = 0;
    while (text[i] === '#') {
      hashes += 1;
      i += 1;
    }
    if (text[i] !== '"') return index;
    i += 1;
    const closer = `"${'#'.repeat(hashes)}`;
    const at = text.indexOf(closer, i);
    return at === -1 ? text.length : at + closer.length;
  }

  const quote = text[i];
  i += 1;
  while (i < text.length) {
    if (text[i] === '\\') {
      i += 2;
      continue;
    }
    if (text[i] === quote) return i + 1;
    i += 1;
  }
  return text.length;
}

/**
 * @param {string} text
 * @param {number} open index of '('
 * @returns {number}
 */
function matchingParen(text, open) {
  let depth = 0;
  let i = open;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '/' && text[i + 1] === '/') {
      const nl = text.indexOf('\n', i + 2);
      i = nl === -1 ? text.length : nl + 1;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2);
      i = close === -1 ? text.length : close + 2;
      continue;
    }
    const afterLiteral = skipLiteral(text, i);
    if (afterLiteral !== i) {
      i = afterLiteral;
      continue;
    }
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
    i += 1;
  }
  return text.length;
}

/**
 * @param {string} body
 * @returns {boolean}
 */
function bodyHasPanicLint(body) {
  return PANIC_LINTS.some((lint) => {
    let from = 0;
    while (from < body.length) {
      const at = body.indexOf(lint, from);
      if (at === -1) return false;
      const before = at === 0 ? '' : body[at - 1];
      const after = body[at + lint.length] ?? '';
      const ident = /[A-Za-z0-9_]/;
      if ((before === '' || !ident.test(before)) && (after === '' || !ident.test(after))) {
        return true;
      }
      from = at + lint.length;
    }
    return false;
  });
}

/**
 * @param {string} text
 * @returns {boolean}
 */
function hasCrateLevelPanicAllow(text) {
  let i = 0;
  if (text.charCodeAt(0) === 0xfeff) i = 1;
  while (i < text.length) {
    i = skipWsAndComments(text, i);
    if (text.startsWith('#!', i) && text[i + 2] !== '[') {
      const nl = text.indexOf('\n', i);
      i = nl === -1 ? text.length : nl + 1;
      continue;
    }
    if (!text.startsWith('#![', i)) return false;
    let j = skipWsAndComments(text, i + 3);
    const ident = /^[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(j));
    if (!ident) return false;
    j = skipWsAndComments(text, j + ident[0].length);
    let body = '';
    if (text[j] === '(') {
      const close = matchingParen(text, j);
      body = text.slice(j + 1, close);
      j = close < text.length ? close + 1 : close;
    }
    j = skipWsAndComments(text, j);
    if (text[j] !== ']') return false;
    if (ident[0] === 'allow' && bodyHasPanicLint(body)) return true;
    i = j + 1;
  }
  return false;
}

/**
 * Bin sources whose crate-level allow lists a panic lint.
 * Only crates / src/bin / *.rs paths are considered.
 *
 * @param {{ path: string, text: string }[]} files
 * @returns {string[]}
 */
function blanketPanicAllows(files) {
  const hits = [];
  for (const file of files) {
    if (!isBinSource(file.path)) continue;
    if (hasCrateLevelPanicAllow(file.text)) hits.push(file.path);
  }
  hits.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return hits;
}

/**
 * @param {string} root
 * @returns {{ path: string, text: string }[]}
 */
function readBinSources(root) {
  /** @type {{ path: string, text: string }[]} */
  const files = [];
  walk(join(root, 'crates'), 'crates');
  return files;

  /**
   * @param {string} abs
   * @param {string} rel
   */
  function walk(abs, rel) {
    let entries;
    try {
      entries = readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === 'target') continue;
      const childRel = `${rel}/${entry.name}`;
      const childAbs = join(abs, entry.name);
      if (entry.isDirectory()) walk(childAbs, childRel);
      else if (entry.isFile() && isBinSource(childRel)) {
        files.push({ path: childRel, text: readFileSync(childAbs, 'utf8') });
      }
    }
  }
}

const BLANKET_ALLOW = [
  '#![allow(',
  '    clippy::unwrap_used,',
  '    clippy::expect_used,',
  '    clippy::panic,',
  '    clippy::unreachable,',
  '    clippy::todo,',
  '    clippy::unimplemented,',
  '    reason = "bench harness, not a wasm export (#183)"',
  ')]',
  '',
].join('\n');

test('a non-wasm binary has no blanket panic-lint allow', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  assert.deepEqual(blanketPanicAllows(readBinSources(root)), []);

  const virtualBin = 'crates/gwen-core/src/bin/fixture.rs';
  assert.deepEqual(blanketPanicAllows([{ path: virtualBin, text: BLANKET_ALLOW }]), [virtualBin]);

  assert.deepEqual(
    blanketPanicAllows([
      { path: 'crates/gwen-core/benches/transform_bench.rs', text: BLANKET_ALLOW },
    ]),
    [],
  );

  const clockOnly =
    '#[allow(clippy::disallowed_methods, reason = "bench binary, not engine runtime")]';
  assert.deepEqual(
    blanketPanicAllows([{ path: 'crates/gwen-core/src/bin/clock.rs', text: clockOnly }]),
    [],
  );

  assert.deepEqual(blanketPanicAllows([]), []);
});
