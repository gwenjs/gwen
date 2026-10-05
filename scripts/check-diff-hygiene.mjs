#!/usr/bin/env node
/**
 * Fail added lines that match PR-contract rule 3, attribution trailers
 * in origin/v1-alpha..HEAD, and mock helpers or spyOn under tests/integration-wasm.
 *
 * A flagged line is skipped only when scripts/agent-hygiene/allowlist.json
 * has an entry for that file and rule. A same-line allowlist comment grants
 * nothing. A diff that changes the allowlist file fails unless the PR has
 * the maintainer label allowlist-approved.
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
 * @param {string} diffText
 * @param {AllowEntry[]} [entries]
 * @returns {Hit[]}
 */
export function findDiffViolations(diffText, entries = []) {
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
 * @param {string} diffText
 * @param {boolean} allowlistApproved
 * @returns {string[]}
 */
export function reviewAllowlistChange(diffText, allowlistApproved) {
  if (!diffChangesAllowlist(diffText)) return [];
  if (allowlistApproved === true) return [];
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
  const hits = [...findDiffViolations(diff, loadAllowlistEntries()), ...findLogViolations(log)];
  const approved = diffChangesAllowlist(diff) ? resolveAllowlistApproved() : false;
  const allowErrors = reviewAllowlistChange(diff, approved);
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
