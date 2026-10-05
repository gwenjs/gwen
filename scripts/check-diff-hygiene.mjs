#!/usr/bin/env node
/**
 * Fail added lines that match PR-contract rule 3, attribution trailers
 * in origin/v1-alpha..HEAD, and mock helpers or spyOn under tests/integration-wasm.
 *
 * A same-line `// allowlist: <reason> #N` skips that line.
 * Run: node scripts/check-diff-hygiene.mjs
 */

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { hasAttribution } from './commitlint-gwen.mjs';

const GIT_MAX = 50 * 1024 * 1024;

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
const ALLOWLIST = /\/\/\s*allowlist:\s+\S.*#\d+\b/;
const RULE_LINT = ['lint', 'disable'].join('-');
const RULE_MOCK = ['vi', 'mock'].join('.');
const RULE_FN = ['vi', 'fn'].join('.');

/**
 * @param {string} line
 * @returns {boolean}
 */
export function isAllowlisted(line) {
  return ALLOWLIST.test(line);
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
 * @param {string} diffText
 * @returns {Hit[]}
 */
export function findDiffViolations(diffText) {
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
    if (isAllowlisted(text)) continue;
    for (const rule of matchAddedLine(text, file)) {
      hits.push({ file, rule, text });
    }
  }
  return hits;
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

function main() {
  const base = process.env.HYGIENE_BASE ?? 'origin/v1-alpha';
  ensureBase(base);
  const diff = git(['diff', `${base}...HEAD`]);
  const log = git(['log', `${base}..HEAD`, '--format=%B%x1e']);
  const hits = [...findDiffViolations(diff), ...findLogViolations(log)];
  if (hits.length === 0) {
    console.log('diff hygiene ok');
    return;
  }
  for (const hit of hits) {
    console.error(`${hit.file}: ${hit.rule}: ${hit.text}`);
  }
  process.exit(1);
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entry === fileURLToPath(import.meta.url)) main();
