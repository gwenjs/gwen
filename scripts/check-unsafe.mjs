#!/usr/bin/env node
/**
 * Every non-test unsafe site carries `// SAFETY:` and a workspace-unique `[U-NNN]`.
 * Run: node scripts/check-unsafe.mjs
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KINDS = new Set(['static-mut', 'ffi-ptr', 'raw-alloc', 'ptr-arith']);
const ID_RE = /\[(U-\d+)\]/g;

/**
 * @param {{ path: string, text: string }[]} files
 * @param {{ path: string, text: string }[]} docs
 * @returns {string[]}
 */
export function evaluateUnsafe(files, docs) {
  /** @type {string[]} */
  const errors = [];
  /** @type {Map<string, Set<string>>} */
  const fns = new Map();
  /** @type {{ crate: string, id: string | null, path: string, line: number, fnItem: boolean }[]} */
  const sites = [];

  const ordered = [...files].sort((a, b) => a.path.localeCompare(b.path));
  for (const file of ordered) {
    if (!file.path.endsWith('.rs')) continue;
    const crate = crateName(file.path);
    if (crate === null) continue;
    collectFns(file.text, crate, fns);
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

  /** @type {Set<string>} */
  const codeIds = new Set();
  for (const site of sites) {
    if (site.id === null) continue;
    codeIds.add(site.id);
    const row = rows.get(site.id);
    if (row === undefined || row.crate !== site.crate) {
      errors.push(`id ${site.id} is not in UNSAFE.md`);
    }
  }
  for (const [id, row] of rows) {
    if (!codeIds.has(id)) errors.push(`UNSAFE.md id ${id} is not in the code`);
    if (row.test === 'removed') continue;
    const names = fns.get(row.crate) ?? new Set();
    if (!names.has(row.test)) errors.push(`test ${row.test} was not found`);
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
 * @param {string} filePath
 * @returns {boolean}
 */
function skipFile(filePath) {
  return (
    filePath.includes('/tests/') ||
    filePath.includes('/benches/') ||
    filePath.endsWith('_tests.rs')
  );
}

/**
 * @param {string} text
 * @param {string} crate
 * @param {Map<string, Set<string>>} fns
 */
function collectFns(text, crate, fns) {
  let names = fns.get(crate);
  if (names === undefined) {
    names = new Set();
    fns.set(crate, names);
  }
  for (const match of text.matchAll(/\bfn\s+([A-Za-z0-9_]+)/g)) {
    if (match[1] !== undefined) names.add(match[1]);
  }
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
    if (hit.word === 'allow' && !allowNamesIssue(hit.text)) {
      const lint = hit.text.match(/clippy::(unwrap_used|expect_used|panic)\b/);
      if (lint !== null) {
        errors.push(`allow clippy::${lint[1]} has no issue: ${file.path}:${hit.line}`);
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
 * @param {string[]} lines
 * @param {number} index
 * @returns {boolean}
 */
function hasSafetySection(lines, index) {
  for (let cursor = index - 1; cursor >= 0 && index - cursor <= 40; cursor -= 1) {
    const trimmed = (lines[cursor] ?? '').trim();
    if (/^(pub(\([^)]*\))?\s+)?(async\s+)?(unsafe\s+)?fn\b/.test(trimmed)) return false;
    if (trimmed.includes('# Safety')) return true;
  }
  return false;
}

/**
 * @param {string} text
 * @returns {boolean}
 */
function allowNamesIssue(text) {
  return /#\d+/.test(text);
}

/**
 * @param {string} text
 * @returns {Set<number>}
 */
function testModLines(text) {
  const stripped = strip(text);
  const source = stripped.split('\n');
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
    const char = text[i];
    if (char === '\n') {
      line += 1;
      i += 1;
      continue;
    }
    if (char === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
      continue;
    }
    if (char === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
        if (text[i] === '\n') line += 1;
        i += 1;
      }
      i += 2;
      continue;
    }
    if (char === '"') {
      i += 1;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === '\\') i += 1;
        else if (text[i] === '\n') line += 1;
        i += 1;
      }
      i += 1;
      continue;
    }
    if (isIdentStart(char)) {
      const start = i;
      const startLine = line;
      i += 1;
      while (i < text.length && isIdent(text[i])) i += 1;
      const word = text.slice(start, i);
      if (word === 'unsafe') hits.push({ word, line: startLine, text: '' });
      else if (word === 'allow' && text[i] === '(') {
        const allowStart = i;
        let depth = 0;
        let cursor = i;
        let allowLine = line;
        while (cursor < text.length) {
          const next = text[cursor];
          if (next === '\n') allowLine += 1;
          if (next === '(') depth += 1;
          else if (next === ')') {
            depth -= 1;
            if (depth === 0) {
              cursor += 1;
              break;
            }
          }
          cursor += 1;
        }
        const body = text.slice(start, cursor);
        if (/clippy::(unwrap_used|expect_used|panic)\b/.test(body)) {
          hits.push({ word: 'allow', line: startLine, text: body });
        }
        line = allowLine;
        i = cursor;
        void allowStart;
      }
      continue;
    }
    i += 1;
  }
  return hits;
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
    if (text[i] === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') {
        out += ' ';
        i += 1;
      }
      continue;
    }
    if (text[i] === '/' && text[i + 1] === '*') {
      out += '  ';
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
        out += text[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      out += '  ';
      i += 2;
      continue;
    }
    if (text[i] === '"') {
      out += ' ';
      i += 1;
      while (i < text.length && text[i] !== '"') {
        out += text[i] === '\n' ? '\n' : ' ';
        if (text[i] === '\\') {
          i += 1;
          if (i < text.length) out += text[i] === '\n' ? '\n' : ' ';
        }
        i += 1;
      }
      out += ' ';
      i += 1;
      continue;
    }
    out += text[i];
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
  const errors = evaluateUnsafe(files, docs);
  if (errors.length > 0) {
    for (const error of errors) console.error(error);
    process.exit(1);
  }
  console.log(`unsafe audit ok (${files.length} rust files)`);
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
