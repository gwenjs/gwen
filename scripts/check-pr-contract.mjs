#!/usr/bin/env node
/**
 * PR contract: Acceptance -> test table, Red proof, Breaking changes section,
 * BREAKING CHANGE: footer when the title contains "!", no unfinished markers,
 * no verdict, approve, or self-review heading, no bare APPROVE line,
 * no closing keyword next to a "no test" cell. `Red proof: n/a (no code change)`
 * is accepted only when every changed path is under docs/, a markdown file, or .github/.
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
 *   changedFiles?: string[],
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

  const visible = visibleLines(lines);
  checkRedProof(visible, errors, input.changedTestFiles, input.changedFiles);
  checkVerdict(visible, errors);
  checkNoTestCloses(visible, visible.join('\n'), errors);

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
const NA_ONLY =
  'Red proof n/a is only allowed when every changed path is static docs under docs/, a markdown file, or .github/ outside workflows and actions';

/**
 * @param {string[]} lines
 * @returns {string[]}
 */
function visibleLines(lines) {
  /** @type {string[]} */
  const out = [];
  /** @type {string | null} */
  let fence = null;
  for (const line of lines) {
    // CommonMark: a fence is indented by at most three spaces. A line with
    // four spaces is text (an indented code block renders, but it never
    // opens a fence that hides the lines after it).
    // GFM: a backtick fence has no backtick in its info string; such a line
    // (```note```) is inline code and opens nothing.
    const match = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    const marker = match && !(match[1]?.[0] === '`' && (match[2] ?? '').includes('`')) ? (match[1] ?? null) : null;
    if (fence === null && marker) {
      fence = marker;
      continue;
    }
    if (fence !== null) {
      if (marker && marker[0] === fence[0] && marker.length >= fence.length && line.trim() === marker) fence = null;
      continue;
    }
    out.push(line);
  }
  return out;
}

/**
 * @param {string} file
 * @returns {boolean}
 */
function isDocsPath(file) {
  const normalized = String(file).split('\\').join('/');
  if (normalized.startsWith('.github/workflows/') || normalized.startsWith('.github/actions/')) return false;
  if (/\.(?:[cm]?[jt]s|tsx|jsx|vue|sh)$/.test(normalized) || /(?:^|\/)package\.json$/.test(normalized)) return false;
  return normalized.startsWith('docs/') || normalized.endsWith('.md') || normalized.startsWith('.github/');
}

/**
 * @param {string[] | undefined} changedFiles
 * @returns {boolean}
 */
function docsOnly(changedFiles) {
  return Array.isArray(changedFiles) && changedFiles.length > 0 && changedFiles.every(isDocsPath);
}

/**
 * @param {string} cell
 * @returns {boolean}
 */
function isNaCell(cell) {
  return /^n\/a$/i.test(cell.replace(/`/g, '').trim());
}

/**
 * @param {string[]} row
 * @returns {boolean}
 */
function isNaRow(row) {
  return row.length > 0 && row.every(isNaCell);
}

/**
 * @param {string[]} lines
 * @param {string[]} errors
 * @param {string[] | undefined} changedTestFiles
 * @param {string[] | undefined} changedFiles
 */
function checkRedProof(lines, errors, changedTestFiles, changedFiles) {
  const docs = docsOnly(changedFiles);
  const files = changedTestFiles ?? [];
  const sourceChange = Array.isArray(changedFiles) && changedFiles.some((file) => !isDocsPath(file));
  const naLine = lines.some((line) => line.trim() === DOCS_ONLY_LINE);
  if (naLine) {
    if (files.length > 0) {
      errors.push('Red proof says no code change but test files changed');
      return;
    }
    if (!docs) errors.push(NA_ONLY);
    return;
  }
  const rows = redProofRows(lines);
  if (rows === null) {
    errors.push('no Red proof section');
    return;
  }
  if (rows.length > 0 && rows.every(isNaRow)) {
    if (files.length > 0 || !docs) errors.push(NA_ONLY);
    return;
  }
  if (sourceChange && files.length === 0) errors.push('a source file change needs a changed test file');
  if (files.length === 0) {
    if (rows.length === 0) errors.push('Red proof table has no row');
    return;
  }
  for (const file of files) {
    const found = rows.some((row) => !isNaRow(row) && row.join(' ').replace(/`/g, '').includes(file));
    if (!found) errors.push(`Red proof table is missing a row for ${file}`);
  }
}

const MAINTAINER_SENTENCE = /reviewed by the maintainer, who will approve or not/gi;

/**
 * The words of a line with markdown and punctuation removed, and the allowed
 * maintainer sentence cut out.
 *
 * @param {string} line
 * @returns {string}
 */
function plainWords(line) {
  return line
    .replace(/\p{Cf}/gu, '')
    .replace(MAINTAINER_SENTENCE, ' ')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The word verdict as a review outcome: in a heading, at the start of a line
 * or of a table cell, as the last word of a table cell (a label whose value
 * sits in the next cell), or followed by a colon, a dash, an em dash or `is`.
 * Each table cell is read as its own line. Inline code spans are cut out
 * first, so a field named verdict in code (`verdict === "pass"`) or in prose
 * is allowed.
 *
 * @param {string} line
 * @returns {boolean}
 */
function verdictForm(line) {
  const text = line.replace(/\p{Cf}/gu, '').replace(/(`+)[\s\S]*?\1/g, ' ');
  if (/^\s{0,3}#{1,6}\s/.test(text) && /\bverdict\b/i.test(text)) return true;
  const row = isRow(text);
  const parts = row ? splitRow(text) : [text];
  return parts.some(
    (part) =>
      /^[\s>*_\-+|]*verdict\b/i.test(part) ||
      (row && /\bverdict[*_\s]*$/i.test(part)) ||
      /\bverdict\b[*_\s]*(?::|\u2014|\u2013|-(?![\w-])|is\b)/i.test(part),
  );
}

/**
 * Reject any line or heading that carries a review outcome. Only the
 * maintainer gives one, outside the body.
 *
 * @param {string[]} lines
 * @param {string[]} errors
 */
function checkVerdict(lines, errors) {
  for (const line of lines) {
    const words = plainWords(line);
    if (/\breviewed[-\s]by\b/i.test(words)) {
      errors.push(`reviewed-by line: ${line.trim()}`);
      return;
    }
    if (/\bself[-\s]review\b/i.test(words)) {
      errors.push(`self-review section: ${line.trim()}`);
      return;
    }
    if (/\bapproved?\b/i.test(words) || verdictForm(line)) {
      errors.push(`self-written verdict or approve: ${line.trim()}`);
      return;
    }
  }
}

/**
 * @param {string[]} lines
 * @param {string} body
 * @param {string[]} errors
 */
const CLOSING =
  /\b(?:clos(?:e|es|ed)|fix(?:es|ed)?|resolv(?:e|es|ed))\b\s*:?\s*(?:#\d+|[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#\d+|https?:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/(?:issues|pull)\/\d+)/i;

/**
 * @param {string} cell
 * @returns {boolean}
 */
function cellHasNoTest(cell) {
  return /\bno(?:[-\s_]+automated)?[-\s_]?tests?\b|\bnot[-\s_]+tested\b|\buntested\b/i.test(cell.replace(/`/g, ''));
}

/**
 * @param {string[]} lines
 * @param {string} body
 * @param {string[]} errors
 */
function checkNoTestCloses(lines, body, errors) {
  if (!CLOSING.test(body)) return;
  for (let i = 0; i < lines.length; i++) {
    if (!isRow(lines[i] ?? '') || i + 1 >= lines.length || !isSeparator(lines[i + 1] ?? '')) continue;
    const header = splitRow(lines[i] ?? '').join(' ').toLowerCase();
    if (!header.includes('acceptance')) continue;
    for (let j = i + 2; j < lines.length && isRow(lines[j] ?? ''); j++) {
      for (const cell of splitRow(lines[j] ?? '')) {
        if (cellHasNoTest(cell)) {
          errors.push('NO TEST cannot use a closing keyword');
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
function listChangedFiles() {
  const base = process.env.HYGIENE_BASE ?? 'origin/v1-alpha';
  const out = execFileSync('git', ['diff', '--name-only', '--diff-filter=AMR', `${base}...HEAD`], {
    encoding: 'utf8',
  });
  return out
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
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
  const changedFiles = listChangedFiles();
  const errors = reviewPrContract({
    title,
    body,
    exists: (file) => existsSync(path.resolve(process.cwd(), file)),
    changedTestFiles: changedFiles.filter(isChangedTestFile),
    changedFiles,
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
