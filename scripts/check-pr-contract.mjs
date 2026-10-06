#!/usr/bin/env node
/**
 * PR contract: Acceptance -> test table, Breaking changes section,
 * BREAKING CHANGE: footer when the title contains "!", no unfinished markers.
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
 * @typedef {{ title: string, body: string, exists: (file: string) => boolean }} Input
 */

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

  return errors;
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
