#!/usr/bin/env node
/**
 * Fail added lines that match PR-contract rule 3, attribution trailers
 * in origin/v1-alpha..HEAD, mock helpers or spyOn under tests/integration-wasm,
 * a createRealEngine call with no dispose( in finally or afterEach, and an
 * added expect( inside finally.
 *
 * A flagged line is skipped only when scripts/agent-hygiene/allowlist.json
 * has an entry for that file and rule. A same-line allowlist comment grants
 * nothing. A diff that adds or changes allowlist entries fails unless the PR
 * has the maintainer label allowlist-approved. Creating the file empty, or
 * removing entries, grants nothing and needs no label.
 * Run: node scripts/check-diff-hygiene.mjs
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { hasAttribution } from './commitlint-gwen.mjs';

const GIT_MAX = 50 * 1024 * 1024;
const ALLOWLIST_PATH = 'scripts/agent-hygiene/allowlist.json';
const ALLOWLIST_LABEL = 'allowlist-approved';
const INVALID_ALLOWLIST = 'invalid: use allowlist.json';
const ALLOWLIST_CHANGED = 'allowlist changed: needs a maintainer-applied allowlist-approved label';

/**
 * @param {string[]} parts
 * @returns {RegExp}
 */
function re(parts) {
  return new RegExp(parts.join(''));
}

const AS_UNKNOWN_AS = re(['as\\s+', 'unknown\\s+', 'as\\b']);
const AS_ANY = re(['\\bas\\s+', 'any\\b']);
const COLON_ANY = re([':\\s*', 'any\\b']);
const GENERIC_ANY = re(['<', 'any\\s*[,>]']);
const ANY_ARRAY = re(['\\b', 'any\\[\\]']);
const COMMA_ANY = re([',\\s*', 'any\\s*[,>]']);
const TS_IGNORE = re(['@', 'ts-ignore']);
const TS_EXPECT_ERROR = re(['@', 'ts-expect-error']);
const LINT_DISABLE = re(['lint-', 'disable']);
const VI_MOCK = re(['vi\\.', 'mock\\b']);
const VI_FN = re(['vi\\.', 'fn\\b']);
const UNWRAP = re(['\\.unwrap\\s*\\(']);
const UNWRAP_UNCHECKED = re(['\\.unwrap_unchecked\\s*\\(']);
const EXPECT_CALL = re(['\\.expect\\s*\\(']);
const EXPECT_ERR = re(['\\.expect_err\\s*\\(']);
const PANIC = re(['panic!', '\\s*\\(']);
const ASSERT = re(['assert!', '\\s*\\(']);
const SPY_ON = /\bspyOn\s*\(/;
const ALLOWLIST_COMMENT = re(['//\\s*', 'allowlist:']);
const RULE_LINT = ['lint', 'disable'].join('-');
const RULE_MOCK = ['vi', 'mock'].join('.');
const RULE_FN = ['vi', 'fn'].join('.');

/**
 * @typedef {{ file: string, rule: string, reason: string, ticket: string }} AllowEntry
 */

/**
 * @param {AllowEntry[]} entries
 * @param {string} file
 * @param {string} rule
 * @returns {boolean}
 */
export function isAllowlisted(entries, file, rule) {
  if (!Array.isArray(entries)) return false;
  const normalized = String(file).split('\\').join('/');
  return entries.some((entry) => {
    if (!entry || typeof entry.file !== 'string' || typeof entry.rule !== 'string') return false;
    if (typeof entry.reason !== 'string' || entry.reason.trim() === '') return false;
    if (typeof entry.ticket !== 'string' || !/^#\d+$/.test(entry.ticket)) return false;
    const entryFile = entry.file.split('\\').join('/');
    return entryFile === normalized && entry.rule === rule;
  });
}

/**
 * @param {string} text
 * @returns {boolean}
 */
function hasAnyType(text) {
  return AS_ANY.test(text) || COLON_ANY.test(text) || GENERIC_ANY.test(text) || ANY_ARRAY.test(text) || COMMA_ANY.test(text);
}

/**
 * @param {string} text
 * @param {string} file
 * @returns {string[]}
 */
export function matchAddedLine(text, file) {
  /** @type {string[]} */
  const rules = [];
  if (AS_UNKNOWN_AS.test(text)) rules.push('as-unknown-as');
  if (hasAnyType(text)) rules.push('any');
  if (TS_IGNORE.test(text)) rules.push('ts-ignore');
  if (TS_EXPECT_ERROR.test(text)) rules.push('ts-expect-error');
  if (LINT_DISABLE.test(text)) rules.push(RULE_LINT);
  if (VI_MOCK.test(text)) rules.push(RULE_MOCK);
  if (VI_FN.test(text)) rules.push(RULE_FN);
  if (file.endsWith('.rs')) {
    if (UNWRAP.test(text) || UNWRAP_UNCHECKED.test(text)) rules.push('unwrap');
    if (EXPECT_CALL.test(text) || EXPECT_ERR.test(text)) rules.push('expect');
    if (PANIC.test(text)) rules.push('panic!');
    if (ASSERT.test(text)) rules.push('assert!');
  }
  const normalized = file.split('\\').join('/');
  if (normalized.includes('tests/integration-wasm')) {
    if (VI_MOCK.test(text) && !rules.includes(RULE_MOCK)) rules.push(RULE_MOCK);
    if (VI_FN.test(text) && !rules.includes(RULE_FN)) rules.push(RULE_FN);
    if (SPY_ON.test(text)) rules.push('spyOn');
  }
  return rules;
}

/**
 * @typedef {{ file: string, rule: string, text: string }} Hit
 */

/**
 * @param {string} content
 * @returns {string}
 */
function maskSource(content) {
  let out = '';
  let i = 0;
  while (i < content.length) {
    const c = content[i];
    const next = content[i + 1];
    if (c === '/' && next === '/') {
      while (i < content.length && content[i] !== '\n') {
        out += ' ';
        i += 1;
      }
      continue;
    }
    if (c === '/' && next === '*') {
      out += '  ';
      i += 2;
      while (i < content.length && !(content[i] === '*' && content[i + 1] === '/')) {
        out += content[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      if (i < content.length) {
        out += '  ';
        i += 2;
      }
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      out += ' ';
      i += 1;
      while (i < content.length && content[i] !== quote) {
        if (content[i] === '\\') {
          out += ' ';
          i += 1;
          if (i < content.length) {
            out += content[i] === '\n' ? '\n' : ' ';
            i += 1;
          }
          continue;
        }
        out += content[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      if (i < content.length) {
        out += ' ';
        i += 1;
      }
      continue;
    }
    if (c === '`') {
      out += ' ';
      i += 1;
      while (i < content.length && content[i] !== '`') {
        if (content[i] === '\\') {
          out += ' ';
          i += 1;
          if (i < content.length) {
            out += content[i] === '\n' ? '\n' : ' ';
            i += 1;
          }
          continue;
        }
        if (content[i] === '$' && content[i + 1] === '{') {
          out += '  ';
          i += 2;
          let depth = 1;
          while (i < content.length && depth > 0) {
            if (content[i] === '{') depth += 1;
            else if (content[i] === '}') depth -= 1;
            if (depth === 0) {
              out += ' ';
              i += 1;
              break;
            }
            out += content[i] === '\n' ? '\n' : content[i];
            i += 1;
          }
          continue;
        }
        out += content[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      if (i < content.length && content[i] === '`') {
        out += ' ';
        i += 1;
      }
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/**
 * @param {string} content
 * @param {number} index
 * @returns {number}
 */
function lineNumberAt(content, index) {
  let line = 1;
  const stop = Math.min(index, content.length);
  for (let i = 0; i < stop; i += 1) if (content[i] === '\n') line += 1;
  return line;
}

/**
 * @param {string} content
 * @param {number} openIndex
 * @param {string} open
 * @param {string} close
 * @returns {number}
 */
function matchingBrace(content, openIndex, open, close) {
  let depth = 0;
  for (let i = openIndex; i < content.length; i += 1) {
    if (content[i] === open) depth += 1;
    else if (content[i] === close) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return content.length - 1;
}

/**
 * @param {string} masked
 * @param {RegExp} re
 * @param {string} open
 * @param {string} close
 * @returns {boolean}
 */
function spanHasDispose(masked, re, open, close) {
  let match = re.exec(masked);
  while (match) {
    const start = masked.indexOf(open, match.index + match[0].length);
    if (start === -1) break;
    const end = matchingBrace(masked, start, open, close);
    if (/\bdispose\s*\(/.test(masked.slice(start, end + 1))) return true;
    re.lastIndex = end + 1;
    match = re.exec(masked);
  }
  return false;
}

/**
 * @param {string} content
 * @returns {boolean}
 */
function callsCreateRealEngine(content) {
  return /\bcreateRealEngine\s*\(/.test(maskSource(content));
}

/**
 * @param {string} content
 * @returns {boolean}
 */
function hasGuardedDispose(content) {
  const masked = maskSource(content);
  if (spanHasDispose(masked, /\bfinally\b/g, '{', '}')) return true;
  return spanHasDispose(masked, /\bafterEach\b/g, '(', ')');
}

/**
 * @param {string} content
 * @returns {Set<number>}
 */
function linesInsideFinally(content) {
  const masked = maskSource(content);
  /** @type {Set<number>} */
  const lines = new Set();
  const re = /\bfinally\b/g;
  let match = re.exec(masked);
  while (match) {
    const brace = masked.indexOf('{', match.index + match[0].length);
    if (brace === -1) break;
    const end = matchingBrace(masked, brace, '{', '}');
    const from = lineNumberAt(masked, brace);
    const to = lineNumberAt(masked, end);
    for (let n = from; n <= to; n += 1) lines.add(n);
    re.lastIndex = end + 1;
    match = re.exec(masked);
  }
  return lines;
}

/**
 * @typedef {{ added: Set<number>, isNew: boolean, rebuilt: string[] }} WasmFile
 */

/**
 * @param {string} diffText
 * @param {AllowEntry[]} entries
 * @param {Record<string, string> | null | undefined} contents
 * @returns {Hit[]}
 */
function wasmTeardownHits(diffText, entries, contents) {
  /** @type {Map<string, WasmFile>} */
  const files = new Map();
  let file = '';
  let isNew = false;
  let inHunk = false;
  let newLine = 0;
  for (const line of diffText.split('\n')) {
    if (line.startsWith('diff --git ')) {
      const match = line.match(/^diff --git a\/(.+) b\/(.+)$/);
      file = match ? (match[2] ?? '') : '';
      isNew = false;
      inHunk = false;
      continue;
    }
    if (!file.split('\\').join('/').includes('tests/integration-wasm')) continue;
    if (line.startsWith('--- ')) {
      isNew = line.slice(4).trim() === '/dev/null';
      continue;
    }
    if (line.startsWith('+++ ')) {
      const next = line.slice(4).trim();
      if (next !== '/dev/null') file = next.replace(/^b\//, '');
      continue;
    }
    if (line.startsWith('@@')) {
      const match = line.match(/\+(\d+)/);
      newLine = match ? Number(match[1]) : 1;
      inHunk = true;
      const key = file.split('\\').join('/');
      const state = files.get(key) ?? { added: new Set(), isNew: false, rebuilt: [] };
      state.isNew = state.isNew || isNew;
      files.set(key, state);
      continue;
    }
    if (!inHunk) continue;
    const key = file.split('\\').join('/');
    const state = files.get(key) ?? { added: new Set(), isNew, rebuilt: [] };
    files.set(key, state);
    if (line.startsWith('+')) {
      state.added.add(newLine);
      state.rebuilt.push(line.slice(1));
      newLine += 1;
      continue;
    }
    if (line.startsWith('-') || line.startsWith('\\')) continue;
    state.rebuilt.push(line.startsWith(' ') ? line.slice(1) : line);
    newLine += 1;
  }

  /** @type {Hit[]} */
  const hits = [];
  for (const [filePath, state] of files) {
    const provided = contents ? contents[filePath] : undefined;
    const content = typeof provided === 'string' ? provided : state.isNew ? state.rebuilt.join('\n') : null;
    if (content == null) continue;
    if (callsCreateRealEngine(content) && !hasGuardedDispose(content) && !isAllowlisted(entries, filePath, 'wasm-dispose')) {
      hits.push({ file: filePath, rule: 'wasm-dispose', text: 'createRealEngine' });
    }
    const finallyLines = linesInsideFinally(content);
    const sourceLines = content.split('\n');
    for (const n of state.added) {
      const text = sourceLines[n - 1] ?? '';
      if (!finallyLines.has(n)) continue;
      if (!/\bexpect\s*\(/.test(maskSource(text))) continue;
      if (isAllowlisted(entries, filePath, 'expect-in-finally')) continue;
      hits.push({ file: filePath, rule: 'expect-in-finally', text });
    }
  }
  return hits;
}

/**
 * @param {string} diffText
 * @returns {Record<string, string>}
 */
function readWasmContents(diffText) {
  /** @type {Record<string, string>} */
  const contents = {};
  for (const line of diffText.split('\n')) {
    if (!line.startsWith('diff --git ')) continue;
    const match = line.match(/^diff --git a\/(.+) b\/(.+)$/);
    if (!match) continue;
    const file = (match[2] ?? '').split('\\').join('/');
    if (!file.includes('tests/integration-wasm')) continue;
    const abs = path.resolve(process.cwd(), file);
    if (!existsSync(abs)) continue;
    contents[file] = readFileSync(abs, 'utf8');
  }
  return contents;
}

/**
 * @param {string} diffText
 * @param {AllowEntry[]} [entries]
 * @param {Record<string, string> | null} [contents]
 * @returns {Hit[]}
 */
export function findDiffViolations(diffText, entries = [], contents = null) {
  /** @type {Hit[]} */
  const hits = [];
  let file = '';
  let binary = false;
  for (const line of diffText.split('\n')) {
    if (line.startsWith('diff --git ')) {
      binary = false;
      const match = line.match(/^diff --git a\/(.+) b\/(.+)$/);
      file = match ? match[2] : '';
      continue;
    }
    if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) {
      binary = true;
      continue;
    }
    if (line.startsWith('+++ ')) {
      const next = line.slice(4).trim();
      if (next !== '/dev/null') file = next.replace(/^b\//, '');
      continue;
    }
    if (binary || !line.startsWith('+') || line.startsWith('+++')) continue;
    const text = line.slice(1);
    for (const rule of matchAddedLine(text, file)) {
      if (isAllowlisted(entries, file, rule)) continue;
      hits.push({ file, rule, text });
    }
    if (ALLOWLIST_COMMENT.test(text)) {
      hits.push({ file, rule: 'allowlist-comment', text: INVALID_ALLOWLIST });
    }
  }
  hits.push(...wasmTeardownHits(diffText, entries, contents));
  return hits;
}

/**
 * @param {string} diffText
 * @returns {boolean}
 */
function diffChangesAllowlist(diffText) {
  for (const line of diffText.split('\n')) {
    if (!line.startsWith('diff --git ')) continue;
    const match = line.match(/^diff --git a\/(.+) b\/(.+)$/);
    if (!match) continue;
    const paths = [match[1] ?? '', match[2] ?? ''].map((item) => item.split('\\').join('/'));
    if (paths.includes(ALLOWLIST_PATH)) return true;
  }
  return false;
}

/**
 * @param {AllowEntry} entry
 * @returns {string}
 */
function entryKey(entry) {
  return JSON.stringify([entry?.file, entry?.rule, entry?.reason, entry?.ticket]);
}

/**
 * Entries present at the head that are not at the base. A removed entry only
 * tightens the allowlist, so it is not reported.
 * @param {AllowEntry[]} baseEntries
 * @param {AllowEntry[]} headEntries
 * @returns {AllowEntry[]}
 */
export function addedAllowlistEntries(baseEntries, headEntries) {
  const known = new Set(baseEntries.map(entryKey));
  return headEntries.filter((entry) => !known.has(entryKey(entry)));
}

/**
 * Fail closed: without both entry lists, any diff on the allowlist file needs the label.
 * @param {string} diffText
 * @param {boolean} allowlistApproved
 * @param {AllowEntry[] | null} [baseEntries] entries at the merge base, `[]` when the file did not exist
 * @param {AllowEntry[] | null} [headEntries] entries in the working tree
 * @returns {string[]}
 */
export function reviewAllowlistChange(diffText, allowlistApproved, baseEntries, headEntries) {
  if (!diffChangesAllowlist(diffText)) return [];
  if (allowlistApproved === true) return [];
  if (
    Array.isArray(baseEntries) &&
    Array.isArray(headEntries) &&
    addedAllowlistEntries(baseEntries, headEntries).length === 0
  ) {
    return [];
  }
  return [ALLOWLIST_CHANGED];
}

/**
 * @param {string} logText `git log --format=%B%x1e`
 * @returns {Hit[]}
 */
export function findLogViolations(logText) {
  /** @type {Hit[]} */
  const hits = [];
  for (const message of logText.split('\x1e')) {
    if (!message.trim()) continue;
    for (const line of message.split('\n')) {
      if (!hasAttribution(line)) continue;
      hits.push({ file: '(commit)', rule: 'attribution', text: line.trim() });
    }
  }
  return hits;
}

/**
 * @param {string[]} args
 * @returns {string}
 */
function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: GIT_MAX });
}

/**
 * @param {string} base
 */
function ensureBase(base) {
  try {
    execFileSync('git', ['rev-parse', '--verify', base], { stdio: 'ignore' });
  } catch {
    execFileSync('git', ['fetch', '--no-tags', 'origin', 'v1-alpha:refs/remotes/origin/v1-alpha'], {
      stdio: 'inherit',
    });
  }
}

/**
 * @returns {AllowEntry[]}
 */
function loadAllowlistEntries() {
  const file = path.resolve(process.cwd(), ALLOWLIST_PATH);
  if (!existsSync(file)) return [];
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    console.error(`${ALLOWLIST_PATH}: invalid JSON`);
    process.exit(1);
  }
  if (!Array.isArray(parsed)) {
    console.error(`${ALLOWLIST_PATH}: expected an array`);
    process.exit(1);
  }
  return parsed;
}

/**
 * Allowlist entries at the merge base. `[]` when the file did not exist there.
 * `null` when it cannot be read, so the label stays required.
 * @param {string} base
 * @returns {AllowEntry[] | null}
 */
function loadBaseAllowlistEntries(base) {
  try {
    const mergeBase = git(['merge-base', base, 'HEAD']).trim();
    const out = execFileSync('git', ['show', `${mergeBase}:${ALLOWLIST_PATH}`], {
      encoding: 'utf8',
      maxBuffer: GIT_MAX,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const parsed = JSON.parse(out);
    return Array.isArray(parsed) ? parsed : null;
  } catch (error) {
    const text = String(error?.stderr ?? '');
    if (/exists on disk, but not in|does not exist in|path .* does not exist/i.test(text)) return [];
    return null;
  }
}

/**
 * @returns {string}
 */
function pullRequestNumber() {
  const fromEnv = process.env.PR_NUMBER ?? '';
  if (/^\d+$/.test(fromEnv)) return fromEnv;
  const refMatch = (process.env.GITHUB_REF ?? '').match(/^refs\/pull\/(\d+)(?:\/|$)/);
  if (refMatch) return refMatch[1] ?? '';
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath || !existsSync(eventPath)) return '';
  try {
    const event = JSON.parse(readFileSync(eventPath, 'utf8'));
    const number = event.pull_request?.number ?? event.number;
    if (typeof number === 'number' && number > 0) return String(number);
  } catch {
    return '';
  }
  return '';
}

/**
 * Fail closed when `gh pr view --json labels` cannot be read.
 * @returns {boolean}
 */
function resolveAllowlistApproved() {
  try {
    const args = ['pr', 'view'];
    const number = pullRequestNumber();
    if (number) args.push(number);
    const repo = process.env.PR_REPO || process.env.GITHUB_REPOSITORY;
    if (repo) args.push('--repo', repo);
    args.push('--json', 'labels');
    const env = { ...process.env };
    const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
    if (token) env.GH_TOKEN = token;
    const out = execFileSync('gh', args, { encoding: 'utf8', env });
    const parsed = JSON.parse(out);
    const labels = Array.isArray(parsed.labels) ? parsed.labels : [];
    return labels.some((label) => label && label.name === ALLOWLIST_LABEL);
  } catch {
    return false;
  }
}

function main() {
  const base = process.env.HYGIENE_BASE ?? 'origin/v1-alpha';
  ensureBase(base);
  const diff = git(['diff', `${base}...HEAD`]);
  const log = git(['log', `${base}..HEAD`, '--format=%B%x1e']);
  const headEntries = loadAllowlistEntries();
  const hits = [...findDiffViolations(diff, headEntries, readWasmContents(diff)), ...findLogViolations(log)];
  const baseEntries = diffChangesAllowlist(diff) ? loadBaseAllowlistEntries(base) : [];
  const needsLabel =
    diffChangesAllowlist(diff) &&
    (baseEntries === null || addedAllowlistEntries(baseEntries, headEntries).length > 0);
  const approved = needsLabel ? resolveAllowlistApproved() : false;
  const allowErrors = reviewAllowlistChange(diff, approved, baseEntries, headEntries);
  if (hits.length === 0 && allowErrors.length === 0) {
    console.log('diff hygiene ok');
    return;
  }
  for (const hit of hits) {
    if (hit.text === INVALID_ALLOWLIST) {
      console.error(`${hit.file}: ${INVALID_ALLOWLIST}`);
      continue;
    }
    console.error(`${hit.file}: ${hit.rule}: ${hit.text}`);
  }
  for (const error of allowErrors) console.error(error);
  process.exit(1);
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entry === fileURLToPath(import.meta.url)) main();
