#!/usr/bin/env node
/**
 * PR contract: Acceptance -> test table, Red proof, Breaking changes section,
 * BREAKING CHANGE: footer when the title contains "!", no unfinished markers,
 * no self-written verdict, no Closes next to a NO TEST row.
 *
 * Tests pass the body in. CI (`pull_request`) reads `gh pr view`.
 * Run: node scripts/check-pr-contract.mjs
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PLACEHOLDER = ['MISS', 'ING'].join('');
const UNFINISHED = /not done/i;

/**
 * @typedef {{
 *   title: string,
 *   body: string,
 *   exists: (file: string) => boolean,
 *   changedTestFiles?: string[],
 * }} Input
 */

const DOCS_ONLY_LINE = 'Red proof: n/a (no code change)';

/**
 * @param {string} line
 * @returns {boolean}
 */
function isRow(line) {
  const trimmed = line.trim();
  return trimmed.startsWith('|') && trimmed.endsWith('|');
}

/**
 * @param {string} line
 * @returns {boolean}
 */
function isSeparator(line) {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

/**
 * @param {string} line
 * @returns {string[]}
 */
function splitRow(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

/**
 * @param {string} cell
 * @returns {{ file: string, name: string }[]}
 */
function pairsFromCell(cell) {
  const clean = cell.replace(/`/g, '').trim();
  const idx = clean.indexOf('::');
  if (idx === -1) return [];
  const file = clean.slice(0, idx).trim();
  const name = clean.slice(idx + 2).trim();
  if (!file || !name) return [];
  if (!/^[A-Za-z0-9_./@+-]+$/.test(file) || !file.includes('/') || !file.includes('.')) return [];
  if (file.startsWith('/') || file.includes('..')) return [{ file, name }];
  return [{ file, name }];
}

/**
 * @param {Input} input
 * @returns {string[]}
 */
export function reviewPrContract(input) {
  /** @type {string[]} */
  const errors = [];
  const body = input.body ?? '';
  const title = input.title ?? '';

  if (body.includes(PLACEHOLDER) || UNFINISHED.test(body)) {
    errors.push('body contains a forbidden unfinished marker');
  }

  const lines = body.split(/\r?\n/);
  /** @type {{ file: string, name: string }[]} */
  const pairs = [];
  let sawTable = false;
  for (let i = 0; i < lines.length; i++) {
    if (!isRow(lines[i] ?? '') || i + 1 >= lines.length || !isSeparator(lines[i + 1] ?? '')) continue;
    const header = splitRow(lines[i] ?? '').join(' ').toLowerCase();
    if (!header.includes('acceptance') || !header.includes('test')) continue;
    sawTable = true;
    for (let j = i + 2; j < lines.length && isRow(lines[j] ?? ''); j++) {
      for (const cell of splitRow(lines[j] ?? '')) {
        pairs.push(...pairsFromCell(cell));
      }
    }
  }
  if (!sawTable) errors.push('no Acceptance -> test table');
  else if (pairs.length === 0) errors.push('Acceptance table has no test file::test name pair');

  for (const pair of pairs) {
    if (pair.file.startsWith('/') || pair.file.includes('..')) {
      errors.push(`test path escapes the repo: ${pair.file}`);
      continue;
    }
    if (!input.exists(pair.file)) errors.push(`test path is not in the PR head: ${pair.file}`);
  }

  const heading = lines.findIndex((line) => /^#{1,6}\s+Breaking changes\b/i.test(line));
  if (heading === -1) {
    errors.push('no Breaking changes section');
  } else {
    let filled = false;
    for (let i = heading + 1; i < lines.length; i++) {
      if (/^#{1,6}\s+/.test(lines[i] ?? '')) break;
      if ((lines[i] ?? '').trim() !== '') {
        filled = true;
        break;
      }
    }
    if (!filled) errors.push('Breaking changes section is empty');
  }

  if (title.includes('!') && !body.includes('BREAKING CHANGE:')) {
    errors.push('title has ! but the body has no BREAKING CHANGE: footer');
  }

  checkRedProof(lines, errors, input.changedTestFiles);
  checkVerdict(lines, errors);
  checkNoTestCloses(lines, body, errors);

  return errors;
}

/**
 * @param {string[]} lines
 * @returns {string[][] | null}
 */
function redProofRows(lines) {
  const heading = lines.findIndex((line) => /^#{1,6}\s+Red proof\b/i.test(line));
  if (heading === -1) return null;
  /** @type {string[][]} */
  const rows = [];
  for (let i = heading + 1; i < lines.length; i++) {
    if (/^#{1,6}\s+/.test(lines[i] ?? '')) break;
    if (!isRow(lines[i] ?? '') || i + 1 >= lines.length || !isSeparator(lines[i + 1] ?? '')) continue;
    for (let j = i + 2; j < lines.length && isRow(lines[j] ?? ''); j++) {
      rows.push(splitRow(lines[j] ?? ''));
    }
    break;
  }
  return rows;
}

/**
 * @param {string[]} lines
 * @param {string[]} errors
 * @param {string[] | undefined} changedTestFiles
 */
function checkRedProof(lines, errors, changedTestFiles) {
  const docsOnly = lines.some((line) => line.trim() === DOCS_ONLY_LINE);
  const files = changedTestFiles ?? [];
  if (docsOnly) {
    if (files.length > 0) errors.push('Red proof says no code change but test files changed');
    return;
  }
  const rows = redProofRows(lines);
  if (rows === null) {
    errors.push('no Red proof section');
    return;
  }
  if (files.length === 0) {
    if (rows.length === 0) errors.push('Red proof table has no row');
    return;
  }
  for (const file of files) {
    const found = rows.some((row) => row.join(' ').replace(/`/g, '').includes(file));
    if (!found) errors.push(`Red proof table is missing a row for ${file}`);
  }
}

/**
 * @param {string[]} lines
 * @param {string[]} errors
 */
function checkVerdict(lines, errors) {
  for (let i = 0; i < lines.length; i++) {
    const heading = (lines[i] ?? '').match(/^#{1,6}\s+(.*)$/);
    if (!heading) continue;
    const title = heading[1] ?? '';
    let end = lines.length;
    for (let j = i + 1; j < lines.length; j++) {
      if (/^#{1,6}\s+/.test(lines[j] ?? '')) {
        end = j;
        break;
      }
    }
    if (/reviewer\s+verdict/i.test(title)) errors.push('self-written verdict section');
    const blob = [title, ...lines.slice(i + 1, end)].join('\n');
    if (/reviewed\s+by\b/i.test(blob) && /\bapprove\b/i.test(blob)) {
      errors.push('reviewed-by approve section');
    }
  }
}

/**
 * @param {string[]} lines
 * @param {string} body
 * @param {string[]} errors
 */
function checkNoTestCloses(lines, body, errors) {
  if (!/closes\s+#\d+/i.test(body)) return;
  for (let i = 0; i < lines.length; i++) {
    if (!isRow(lines[i] ?? '') || i + 1 >= lines.length || !isSeparator(lines[i + 1] ?? '')) continue;
    for (let j = i + 2; j < lines.length && isRow(lines[j] ?? ''); j++) {
      for (const cell of splitRow(lines[j] ?? '')) {
        if (cell.replace(/`/g, '').includes('NO TEST')) {
          errors.push('NO TEST cannot use Closes');
          return;
        }
      }
    }
  }
}

/**
 * @param {string} file
 * @returns {boolean}
 */
function isChangedTestFile(file) {
  return /\.(?:test|spec)\.(?:mjs|cjs|js|ts|tsx|mts)$/.test(file) || /(?:_test|\.test)\.rs$/.test(file);
}

/**
 * @returns {string[]}
 */
function listChangedTestFiles() {
  const base = process.env.HYGIENE_BASE ?? 'origin/v1-alpha';
  const out = execFileSync('git', ['diff', '--name-only', '--diff-filter=AMR', `${base}...HEAD`], {
    encoding: 'utf8',
  });
  return out
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && isChangedTestFile(line));
}

/**
 * @returns {{ title: string, body: string }}
 */
function loadFromGh() {
  const args = ['pr', 'view'];
  if (process.env.PR_NUMBER) args.push(process.env.PR_NUMBER);
  if (process.env.PR_REPO) args.push('--repo', process.env.PR_REPO);
  args.push('--json', 'title,body');
  const out = execFileSync('gh', args, { encoding: 'utf8' });
  const parsed = JSON.parse(out);
  return { title: parsed.title ?? '', body: parsed.body ?? '' };
}

function main() {
  const bodyFlag = process.argv.indexOf('--body-file');
  const titleFlag = process.argv.indexOf('--title');
  /** @type {string} */
  let title = '';
  /** @type {string} */
  let body = '';
  if (bodyFlag !== -1) {
    const file = process.argv[bodyFlag + 1];
    if (!file) {
      console.error('--body-file needs a path');
      process.exit(1);
    }
    body = readFileSync(file, 'utf8');
    title = titleFlag === -1 ? '' : (process.argv[titleFlag + 1] ?? '');
  } else if (process.env.GITHUB_EVENT_NAME === 'pull_request' || process.env.PR_NUMBER) {
    const view = loadFromGh();
    title = view.title;
    body = view.body;
  } else {
    console.log('no pull request: skip PR contract');
    return;
  }
  const errors = reviewPrContract({
    title,
    body,
    exists: (file) => existsSync(path.resolve(process.cwd(), file)),
    changedTestFiles: listChangedTestFiles(),
  });
  if (errors.length === 0) {
    console.log('PR contract ok');
    return;
  }
  for (const error of errors) console.error(`pr-contract: ${error}`);
  process.exit(1);
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entry === fileURLToPath(import.meta.url)) main();
