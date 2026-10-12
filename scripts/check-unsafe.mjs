#!/usr/bin/env node
/**
 * Every non-test unsafe site carries `// SAFETY:` and a workspace-unique `[U-NNN]`.
 * Run: node scripts/check-unsafe.mjs
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KINDS = new Set(['static-mut', 'ffi-ptr', 'raw-alloc', 'ptr-arith', 'send-sync']);
const ID_RE = /\[(U-\d+)\]/g;
const TEST_ATTR_RE = /^#\[\s*(tokio::test|wasm_bindgen_test|test)\b/;
const UNSAFE_SITE_RE = /^unsafe_site_[A-Za-z0-9_]+$/;

/**
 * @typedef {{ tests: Set<string>, all: Set<string> }} CrateFns
 * @typedef {{ exists?: (filePath: string) => boolean }} UnsafeAuditOptions
 */

/**
 * Check unsafe sites against UNSAFE.md rows.
 * `options.exists` reports whether a repo-relative ffi-ptr citation path is on
 * disk. When it returns true, the helper does not open the file: an integer
 * line greater than or equal to 1 is enough.
 *
 * @param {{ path: string, text: string }[]} files
 * @param {{ path: string, text: string }[]} docs
 * @param {UnsafeAuditOptions} [options]
 * @returns {string[]}
 */
export function evaluateUnsafe(files, docs, options) {
  const exists = options?.exists;
  /** @type {string[]} */
  const errors = [];
  /** @type {Map<string, CrateFns>} */
  const fns = new Map();
  /** @type {{ crate: string, id: string | null, path: string, line: number, fnItem: boolean }[]} */
  const sites = [];

  const ordered = [...files].sort((a, b) => a.path.localeCompare(b.path));
  for (const file of ordered) {
    if (!file.path.endsWith('.rs')) continue;
    const crate = crateName(file.path);
    if (crate === null) continue;
    collectFns(file.text, file.path, crate, fns);
    if (skipFile(file.path)) continue;
    scanFile(file, crate, sites, errors);
  }

  /** @type {Map<string, { crate: string, kind: string, test: string }>} */
  const rows = new Map();
  for (const doc of docs) {
    const crate = crateName(doc.path);
    if (crate === null) continue;
    for (const row of parseRows(doc.text)) {
      if (!KINDS.has(row.kind)) {
        errors.push(`kind ${row.kind} is not allowed: ${row.id}`);
      }
      if (rows.has(row.id)) errors.push(`duplicate id ${row.id}`);
      rows.set(row.id, { crate, kind: row.kind, test: row.test });
    }
  }

  /** @type {Map<string, number>} */
  const seen = new Map();
  for (const site of sites) {
    if (site.id === null) continue;
    seen.set(site.id, (seen.get(site.id) ?? 0) + 1);
  }
  for (const [id, count] of seen) {
    if (count > 1) errors.push(`duplicate id ${id}`);
  }

  /** @type {Map<string, Set<string>>} */
  const codeIds = new Map();
  for (const site of sites) {
    if (site.id === null) continue;
    let ids = codeIds.get(site.crate);
    if (ids === undefined) {
      ids = new Set();
      codeIds.set(site.crate, ids);
    }
    ids.add(site.id);
    const row = rows.get(site.id);
    if (row === undefined || row.crate !== site.crate) {
      errors.push(`id ${site.id} is not in UNSAFE.md`);
    }
  }
  for (const [id, row] of rows) {
    const ids = codeIds.get(row.crate);
    if (ids === undefined || !ids.has(id)) errors.push(`UNSAFE.md id ${id} is not in the code`);
    const problem = proofProblem(id, row, fns.get(row.crate), exists);
    if (problem !== null) errors.push(problem);
  }
  return errors;
}

/**
 * @param {string} filePath
 * @returns {string | null}
 */
function crateName(filePath) {
  const parts = filePath.split('/');
  const crates = parts.indexOf('crates');
  if (crates === -1 || parts[crates + 1] === undefined) return null;
  return parts[crates + 1];
}

/**
 * Skip site scanning for the crate's top-level tests directory, benches, and
 * `*_tests.rs`. A tests directory under `src/` stays in the scan.
 *
 * @param {string} filePath
 * @returns {boolean}
 */
function skipFile(filePath) {
  if (filePath.endsWith('_tests.rs')) return true;
  if (filePath.includes('/benches/')) return true;
  const parts = filePath.split('/');
  const crates = parts.indexOf('crates');
  return crates !== -1 && parts[crates + 2] === 'tests';
}

/**
 * @param {string} filePath
 * @returns {boolean}
 */
function fileCountsAsTests(filePath) {
  if (filePath.endsWith('_tests.rs')) return true;
  const parts = filePath.split('/');
  const crates = parts.indexOf('crates');
  if (crates === -1) return false;
  const file = parts[crates + 3];
  return (
    parts[crates + 2] === 'tests' &&
    file !== undefined &&
    file.endsWith('.rs') &&
    parts.length === crates + 4
  );
}

/**
 * @param {Map<string, CrateFns>} fns
 * @param {string} crate
 * @returns {CrateFns}
 */
function fnBucket(fns, crate) {
  let bucket = fns.get(crate);
  if (bucket === undefined) {
    bucket = { tests: new Set(), all: new Set() };
    fns.set(crate, bucket);
  }
  return bucket;
}

/**
 * @param {string} text
 * @param {string} filePath
 * @param {string} crate
 * @param {Map<string, CrateFns>} fns
 */
function collectFns(text, filePath, crate, fns) {
  const bucket = fnBucket(fns, crate);
  const lines = text.split('\n');
  const fileIsTest = fileCountsAsTests(filePath);
  let line = 1;
  let i = 0;
  while (i < text.length) {
    if (text[i] === '\n') {
      line += 1;
      i += 1;
      continue;
    }
    const skipped = skipTrivia(text, i);
    if (skipped !== null) {
      line += skipped.newlines;
      i = skipped.index;
      continue;
    }
    if (isIdentStart(text[i])) {
      const startLine = line;
      const start = i;
      i += 1;
      while (i < text.length && isIdent(text[i])) i += 1;
      const word = text.slice(start, i);
      if (word === 'r' && text[i] === '#' && isIdentStart(text[i + 1])) {
        i += 1;
        while (i < text.length && isIdent(text[i])) i += 1;
        continue;
      }
      if (word !== 'fn') continue;
      const name = readNextIdent(text, i);
      if (name === null) continue;
      bucket.all.add(name);
      if (fileIsTest || hasTestAttribute(lines, startLine)) bucket.tests.add(name);
      continue;
    }
    i += 1;
  }
}

/**
 * @param {string} text
 * @param {number} index
 * @returns {string | null}
 */
function readNextIdent(text, index) {
  let i = index;
  while (i < text.length) {
    const char = text[i];
    if (char === ' ' || char === '\t' || char === '\r' || char === '\n') {
      i += 1;
      continue;
    }
    const skipped = skipTrivia(text, i);
    if (skipped !== null) {
      i = skipped.index;
      continue;
    }
    if (!isIdentStart(char)) return null;
    const start = i;
    i += 1;
    while (i < text.length && isIdent(text[i])) i += 1;
    return text.slice(start, i);
  }
  return null;
}

/**
 * @param {readonly string[]} lines
 * @param {number} fnLine 1-based line of the `fn` token
 * @returns {boolean}
 */
function hasTestAttribute(lines, fnLine) {
  const own = (lines[fnLine - 1] ?? '').trim();
  if (TEST_ATTR_RE.test(own)) return true;
  for (let index = fnLine - 2; index >= 0; index -= 1) {
    const trimmed = (lines[index] ?? '').trim();
    if (trimmed === '') return false;
    if (TEST_ATTR_RE.test(trimmed)) return true;
    if (isPreludeLine(trimmed)) continue;
    return false;
  }
  return false;
}

/**
 * @param {string} text
 * @returns {{ id: string, kind: string, test: string }[]}
 */
function parseRows(text) {
  /** @type {{ id: string, kind: string, test: string }[]} */
  const rows = [];
  for (const line of text.split('\n')) {
    const match = line.match(/^\|\s*(U-\d+)\s*\|/);
    if (match === null || match[1] === undefined) continue;
    const cells = line.split('|').map((cell) => cell.trim());
    rows.push({
      id: match[1],
      kind: cells[3] ?? '',
      test: cells[6] ?? '',
    });
  }
  return rows;
}

/**
 * @param {string} id
 * @param {{ kind: string, test: string }} row
 * @param {CrateFns | undefined} bucket
 * @param {((filePath: string) => boolean) | undefined} exists
 * @returns {string | null}
 */
function proofProblem(id, row, bucket, exists) {
  if (row.test === 'removed') return `test cell removed is not a proof: ${id}`;
  if (UNSAFE_SITE_RE.test(row.test)) {
    if (bucket !== undefined && bucket.tests.has(row.test)) return null;
    if (bucket !== undefined && bucket.all.has(row.test)) {
      return `test ${row.test} is not an unsafe_site test`;
    }
    return `test ${row.test} was not found`;
  }
  if (row.kind === 'ffi-ptr') {
    const citation = parseCitation(row.test);
    if (citation !== null && exists !== undefined && exists(citation.path)) return null;
  }
  return `test ${row.test} was not found`;
}

/**
 * Repo-relative `path:line`. The line must be an integer >= 1. Callers that
 * trust `exists` do not read the file, so they do not check the line exists.
 *
 * @param {string} cell
 * @returns {{ path: string, line: number } | null}
 */
function parseCitation(cell) {
  const match = /^([^:\s]+):(\d+)$/.exec(cell);
  if (match === null) return null;
  const filePath = match[1];
  const digits = match[2];
  if (filePath === undefined || digits === undefined) return null;
  if (filePath.startsWith('/') || filePath.split('/').includes('..')) return null;
  const line = Number(digits);
  if (!Number.isInteger(line) || line < 1) return null;
  return { path: filePath, line };
}

/**
 * @param {{ path: string, text: string }} file
 * @param {string} crate
 * @param {{ crate: string, id: string | null, path: string, line: number, fnItem: boolean }[]} sites
 * @param {string[]} errors
 */
function scanFile(file, crate, sites, errors) {
  const hidden = testModLines(file.text);
  const lines = file.text.split('\n');
  for (const hit of codeHits(file.text)) {
    if (hidden.has(hit.line)) continue;
    if (hit.word === 'unsafe') {
      if (crate === 'gwen-physics3d-fracture') {
        errors.push(`gwen-physics3d-fracture has an unsafe site: ${file.path}:${hit.line}`);
        continue;
      }
      const comment = commentAbove(lines, hit.line - 1);
      const id = firstId(comment);
      const fnItem = /^\s*(pub(\([^)]*\))?\s+)?(async\s+)?unsafe\s+fn\b/.test(lines[hit.line - 1] ?? '');
      if (!comment.includes('SAFETY')) {
        errors.push(`missing SAFETY: ${file.path}:${hit.line}`);
      } else if (id === null) {
        errors.push(`SAFETY has no id: ${file.path}:${hit.line}`);
      }
      if (fnItem && !hasSafetySection(lines, hit.line - 1)) {
        errors.push(`unsafe fn has no # Safety: ${file.path}:${hit.line}`);
      }
      sites.push({ crate, id, path: file.path, line: hit.line, fnItem });
      continue;
    }
    if ((hit.word === 'allow' || hit.word === 'expect') && !mentionsIssue(hit.text)) {
      const lint = hit.text.match(/clippy::(unwrap_used|expect_used|panic)\b/);
      if (lint !== null && lint[1] !== undefined) {
        errors.push(`${hit.word} clippy::${lint[1]} has no issue: ${file.path}:${hit.line}`);
      }
    }
  }
}

/**
 * @param {string[]} lines
 * @param {number} index
 * @returns {string}
 */
function commentAbove(lines, index) {
  let cursor = index - 1;
  /** @type {string[]} */
  const chunk = [];
  while (cursor >= 0 && isComment(lines[cursor] ?? '')) {
    chunk.push(lines[cursor] ?? '');
    cursor -= 1;
  }
  return chunk.reverse().join('\n');
}

/**
 * @param {string} line
 * @returns {boolean}
 */
function isComment(line) {
  const trimmed = line.trim();
  return trimmed.startsWith('//');
}

/**
 * @param {string} comment
 * @returns {string | null}
 */
function firstId(comment) {
  const match = ID_RE.exec(comment);
  ID_RE.lastIndex = 0;
  return match?.[1] ?? null;
}

/**
 * Doc comments and attributes on this item only. A blank line, another item,
 * or a previous item's docs end the prelude.
 *
 * @param {string[]} lines
 * @param {number} index
 * @returns {boolean}
 */
function hasSafetySection(lines, index) {
  let pending = 0;
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const trimmed = (lines[cursor] ?? '').trim();
    if (trimmed === '') {
      if (pending === 0) return false;
      continue;
    }
    if (pending === 0 && isFnLine(trimmed)) return false;
    const counts = bracketCounts(trimmed);
    const insideAttribute = pending > 0 || counts.closes > counts.opens || trimmed.startsWith('#');
    if (!insideAttribute && !isPreludeLine(trimmed)) return false;
    if (
      pending === 0 &&
      (trimmed.startsWith('//') || trimmed.startsWith('/*')) &&
      trimmed.includes('# Safety')
    ) {
      return true;
    }
    const nextPending = pending + counts.closes - counts.opens;
    if (nextPending < 0) return false;
    pending = nextPending;
  }
  return false;
}

/**
 * Brackets outside comments and strings. Comments contribute nothing so a
 * `(...)` in a SAFETY line does not look like an open attribute.
 *
 * @param {string} trimmed
 * @returns {{ opens: number, closes: number }}
 */
function bracketCounts(trimmed) {
  if (trimmed.startsWith('//') || trimmed.startsWith('/*')) return { opens: 0, closes: 0 };
  let opens = 0;
  let closes = 0;
  let i = 0;
  while (i < trimmed.length) {
    const char = trimmed[i];
    if (char === '"') {
      i += 1;
      while (i < trimmed.length && trimmed[i] !== '"') {
        if (trimmed[i] === '\\') i += 1;
        i += 1;
      }
      i += 1;
      continue;
    }
    if (char === '(' || char === '[') opens += 1;
    else if (char === ')' || char === ']') closes += 1;
    i += 1;
  }
  return { opens, closes };
}

/**
 * @param {string} trimmed
 * @returns {boolean}
 */
function isFnLine(trimmed) {
  if (trimmed.startsWith('//') || trimmed.startsWith('/*')) return false;
  const code = trimmed.replace(/"(?:\\.|[^"\\])*"/g, '""');
  return /\bfn\b/.test(code);
}

/**
 * @param {string} trimmed
 * @returns {boolean}
 */
function isPreludeLine(trimmed) {
  return (
    trimmed.startsWith('//') ||
    trimmed.startsWith('/*') ||
    trimmed.startsWith('#') ||
    trimmed.startsWith(']') ||
    trimmed.startsWith(')')
  );
}

/**
 * @param {string} text
 * @returns {boolean}
 */
function mentionsIssue(text) {
  return /#\d+/.test(text);
}

/**
 * @param {string} text
 * @returns {Set<number>}
 */
function testModLines(text) {
  const source = strip(text).split('\n');
  /** @type {Set<number>} */
  const inside = new Set();
  /** @type {number[]} */
  const open = [];
  let depth = 0;
  let pending = false;
  for (let i = 0; i < source.length; i += 1) {
    const line = source[i] ?? '';
    if (/#\[cfg\(test\)\]/.test(line)) pending = true;
    else if (pending && line.trim() !== '') {
      if (/\bmod\s+tests\b/.test(line)) open.push(-1);
      pending = false;
    }
    for (const char of line) {
      if (char === '{') {
        depth += 1;
        if (open.length > 0 && open[open.length - 1] === -1) open[open.length - 1] = depth;
      } else if (char === '}') {
        if (open.length > 0 && open[open.length - 1] === depth) open.pop();
        depth -= 1;
      }
    }
    if (open.some((level) => level !== -1)) inside.add(i + 1);
  }
  return inside;
}

/**
 * @param {string} text
 * @returns {{ word: string, line: number, text: string }[]}
 */
function codeHits(text) {
  /** @type {{ word: string, line: number, text: string }[]} */
  const hits = [];
  let line = 1;
  let i = 0;
  while (i < text.length) {
    if (text[i] === '\n') {
      line += 1;
      i += 1;
      continue;
    }
    const skipped = skipTrivia(text, i);
    if (skipped !== null) {
      line += skipped.newlines;
      i = skipped.index;
      continue;
    }
    if (isIdentStart(text[i])) {
      const start = i;
      const startLine = line;
      i += 1;
      while (i < text.length && isIdent(text[i])) i += 1;
      const word = text.slice(start, i);
      if (word === 'r' && text[i] === '#' && isIdentStart(text[i + 1])) {
        i += 1;
        while (i < text.length && isIdent(text[i])) i += 1;
        continue;
      }
      if (word === 'unsafe') {
        hits.push({ word, line: startLine, text: '' });
        continue;
      }
      if (word === 'allow' || word === 'expect') {
        const call = readBalancedCall(text, i, line);
        if (call !== null) {
          if (/clippy::(unwrap_used|expect_used|panic)\b/.test(call.text)) {
            hits.push({ word, line: startLine, text: call.text });
          }
          line = call.line;
          i = call.index;
        }
        continue;
      }
      continue;
    }
    i += 1;
  }
  return hits;
}

/**
 * @param {string} text
 * @param {number} index index just after the ident
 * @param {number} line
 * @returns {{ text: string, index: number, line: number } | null}
 */
function readBalancedCall(text, index, line) {
  let i = index;
  let cursorLine = line;
  while (i < text.length) {
    if (text[i] === '\n') {
      cursorLine += 1;
      i += 1;
      continue;
    }
    if (text[i] === ' ' || text[i] === '\t' || text[i] === '\r') {
      i += 1;
      continue;
    }
    const skipped = skipTrivia(text, i);
    if (skipped !== null) {
      cursorLine += skipped.newlines;
      i = skipped.index;
      continue;
    }
    break;
  }
  if (text[i] !== '(') return null;
  const open = i;
  let depth = 0;
  while (i < text.length) {
    if (text[i] === '\n') {
      cursorLine += 1;
      i += 1;
      continue;
    }
    const skipped = skipTrivia(text, i);
    if (skipped !== null) {
      cursorLine += skipped.newlines;
      i = skipped.index;
      continue;
    }
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')') {
      depth -= 1;
      if (depth === 0) {
        i += 1;
        return { text: text.slice(open, i), index: i, line: cursorLine };
      }
    }
    i += 1;
  }
  return { text: text.slice(open), index: text.length, line: cursorLine };
}

/**
 * Comments, strings, and char literals. Lifetimes stay in the code stream.
 * Shared by the site scan and the `#[cfg(test)] mod tests` brace tracker.
 *
 * @param {string} text
 * @param {number} index
 * @returns {{ index: number, newlines: number } | null}
 */
function skipTrivia(text, index) {
  if (text[index] === '/' && text[index + 1] === '/') {
    let i = index + 2;
    while (i < text.length && text[i] !== '\n') i += 1;
    return { index: i, newlines: 0 };
  }
  if (text[index] === '/' && text[index + 1] === '*') return skipBlockComment(text, index);
  const raw = skipRawString(text, index);
  if (raw !== null) return raw;
  if (text[index] === '"') return skipCookedString(text, index);
  if (text[index] === "'") return skipCharLiteral(text, index);
  return null;
}

/**
 * @param {string} text
 * @param {number} index
 * @returns {{ index: number, newlines: number }}
 */
function skipBlockComment(text, index) {
  let i = index + 2;
  let depth = 1;
  let newlines = 0;
  while (i < text.length && depth > 0) {
    if (text[i] === '\n') {
      newlines += 1;
      i += 1;
      continue;
    }
    if (text[i] === '/' && text[i + 1] === '*') {
      depth += 1;
      i += 2;
      continue;
    }
    if (text[i] === '*' && text[i + 1] === '/') {
      depth -= 1;
      i += 2;
      continue;
    }
    i += 1;
  }
  return { index: i, newlines };
}

/**
 * `r"..."`, `r#"..."#`, `r##"..."##`, plus `b` and `c` prefixes.
 *
 * @param {string} text
 * @param {number} index
 * @returns {{ index: number, newlines: number } | null}
 */
function skipRawString(text, index) {
  if (index > 0 && isIdent(text[index - 1])) return null;
  let k = index;
  if ((text[k] === 'b' || text[k] === 'c') && text[k + 1] === 'r') k += 1;
  if (text[k] !== 'r') return null;
  k += 1;
  let hashes = 0;
  while (text[k] === '#') {
    hashes += 1;
    k += 1;
  }
  if (text[k] !== '"') return null;
  let i = k + 1;
  let newlines = 0;
  while (i < text.length) {
    if (text[i] === '\n') {
      newlines += 1;
      i += 1;
      continue;
    }
    if (text[i] === '"') {
      let matched = 0;
      while (matched < hashes && text[i + 1 + matched] === '#') matched += 1;
      if (matched === hashes) return { index: i + 1 + hashes, newlines };
    }
    i += 1;
  }
  return { index: text.length, newlines };
}

/**
 * @param {string} text
 * @param {number} index
 * @returns {{ index: number, newlines: number }}
 */
function skipCookedString(text, index) {
  let i = index + 1;
  let newlines = 0;
  while (i < text.length) {
    if (text[i] === '\n') {
      newlines += 1;
      i += 1;
      continue;
    }
    if (text[i] === '\\') {
      i += 1;
      if (i >= text.length) break;
      if (text[i] === '\n') newlines += 1;
      i += 1;
      continue;
    }
    if (text[i] === '"') return { index: i + 1, newlines };
    i += 1;
  }
  return { index: text.length, newlines };
}

/**
 * A char literal (`'"'`, `'\\'`, `'\n'`, `'a'`). A lifetime (`'` + ident, no
 * closing quote) returns null so the caller keeps it as code.
 *
 * @param {string} text
 * @param {number} index
 * @returns {{ index: number, newlines: number } | null}
 */
function skipCharLiteral(text, index) {
  const next = text[index + 1];
  if (next === undefined || next === '\n' || next === '\r') return null;
  if (next === '\\') {
    let i = index + 2;
    if (text[i] === undefined) return null;
    if (text[i] === 'u' && text[i + 1] === '{') {
      i += 2;
      while (i < text.length && text[i] !== '}') i += 1;
      if (text[i] === '}') i += 1;
    } else if (text[i] === 'x') {
      i += 1;
      let hex = 0;
      while (hex < 2 && i < text.length && /[0-9a-fA-F]/.test(text[i] ?? '')) {
        hex += 1;
        i += 1;
      }
    } else {
      i += 1;
    }
    if (text[i] !== "'") return null;
    return { index: i + 1, newlines: 0 };
  }
  if (isIdentStart(next)) {
    let i = index + 2;
    while (i < text.length && isIdent(text[i])) i += 1;
    if (i === index + 2 && text[i] === "'") return { index: i + 1, newlines: 0 };
    return null;
  }
  if (text[index + 2] === "'") return { index: index + 3, newlines: 0 };
  return null;
}

/**
 * @param {string | undefined} char
 * @returns {boolean}
 */
function isIdentStart(char) {
  return char !== undefined && /[A-Za-z_]/.test(char);
}

/**
 * @param {string | undefined} char
 * @returns {boolean}
 */
function isIdent(char) {
  return char !== undefined && /[A-Za-z0-9_]/.test(char);
}

/**
 * @param {string} text
 * @returns {string}
 */
function strip(text) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const skipped = skipTrivia(text, i);
    if (skipped !== null) {
      out += text.slice(i, skipped.index).replace(/[^\n]/g, ' ');
      i = skipped.index;
      continue;
    }
    out += text[i] ?? '';
    i += 1;
  }
  return out;
}

function main() {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const files = walkRust(path.join(root, 'crates')).map((filePath) => ({
    path: path.relative(root, filePath).split(path.sep).join('/'),
    text: readFileSync(filePath, 'utf8'),
  }));
  const docs = ['gwen-core', 'gwen-wasm-utils'].map((crate) => {
    const filePath = path.join(root, 'crates', crate, 'UNSAFE.md');
    return {
      path: `crates/${crate}/UNSAFE.md`,
      text: readFileSync(filePath, 'utf8'),
    };
  });
  const errors = evaluateUnsafe(files, docs, {
    exists(filePath) {
      return repoFileExists(root, filePath);
    },
  });
  if (errors.length > 0) {
    for (const error of errors) console.error(error);
    process.exit(1);
  }
  console.log(`unsafe audit ok (${files.length} rust files)`);
}

/**
 * Does not read the file. A true result does not prove the citation line is in range.
 *
 * @param {string} root
 * @param {string} filePath
 * @returns {boolean}
 */
function repoFileExists(root, filePath) {
  if (filePath.startsWith('/') || filePath.includes('\\')) return false;
  const parts = filePath.split('/');
  if (parts.includes('..') || parts.includes('')) return false;
  return existsSync(path.join(root, filePath));
}

/**
 * @param {string} dir
 * @returns {string[]}
 */
function walkRust(dir) {
  /** @type {string[]} */
  const found = [];
  for (const name of readdirSync(dir)) {
    if (name === 'target') continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) found.push(...walkRust(full));
    else if (name.endsWith('.rs')) found.push(full);
  }
  return found;
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entry === fileURLToPath(import.meta.url)) main();
