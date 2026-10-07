#!/usr/bin/env node
/**
 * Compare a test run to the names in the source file.
 *
 * is-vitest --source <file>
 *   Exit 0 when the file imports vitest at the top level, 1 otherwise.
 *
 * classify --source <head> [--base <base copy>]
 *   Prints `NEW <name>` or `OLD <name>`. Exit 2 when the source has no literal names.
 *
 * judge --source <head> [--base <base copy>] --format tap|vitest|cargo --report <file>
 *   Exit 0 when every name that is absent from the base copy failed.
 *   Exit 1 when such a name passed, was skipped, or is absent from the report.
 *   Exit 2 when the report has no tests, or a runner name is not in the source.
 *   A name present in the base copy may pass (`KEEP`).
 */

import { readFileSync } from 'node:fs';

/**
 * @param {string} flag
 * @returns {string}
 */
function arg(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return '';
  return process.argv[index + 1] ?? '';
}

/**
 * @param {string} body
 * @returns {string}
 */
function unescapeLiteral(body) {
  return body.replace(/\\(.)/g, (_, char) => {
    if (char === 'n') return '\n';
    if (char === 't') return '\t';
    return char;
  });
}

/**
 * @param {string} source
 * @returns {string[]}
 */
function testNames(source) {
  /** @type {string[]} */
  const names = [];
  const re =
    /(?:^|[^.\w$])(?:it|test)(?:\.[A-Za-z_$][\w$]*)*\s*\(\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g;
  let match = re.exec(source);
  while (match) {
    names.push(unescapeLiteral(match[2] ?? ''));
    match = re.exec(source);
  }
  return names;
}

/**
 * @param {string} text
 * @returns {{ name: string, status: 'pass' | 'fail' | 'skip' }[] | null}
 */
function parseTap(text) {
  /** @type {{ name: string, status: 'pass' | 'fail' | 'skip' }[]} */
  const tests = [];
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^(not )?ok\s+\d+\s+-\s+(.+)$/);
    if (!match) continue;
    let raw = (match[2] ?? '').trim();
    /** @type {'pass' | 'fail' | 'skip'} */
    let status = match[1] ? 'fail' : 'pass';
    const directive = raw.match(/^((?:\\.|[^\\#])*?)\s+#\s+(SKIP|TODO)\b/i);
    if (directive) {
      status = 'skip';
      raw = directive[1] ?? '';
    }
    const name = unescapeTap(raw.trim());
    if (name === '') return null;
    tests.push({ name, status });
  }
  return tests;
}

/**
 * node:test escapes `#` and `\\` in TAP names.
 *
 * @param {string} name
 * @returns {string}
 */
function unescapeTap(name) {
  return name.replace(/\\([\\#])/g, '$1');
}

/**
 * @param {string} text
 * @returns {{ name: string, status: 'pass' | 'fail' | 'skip' }[] | null}
 */
function parseVitest(text) {
  /** @type {{ testResults?: { assertionResults?: { fullName?: string, title?: string, status?: string }[] }[] }} */
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  /** @type {{ name: string, status: 'pass' | 'fail' | 'skip' }[]} */
  const tests = [];
  for (const file of json.testResults ?? []) {
    for (const assertion of file.assertionResults ?? []) {
      const name = assertion.title || assertion.fullName || '';
      const fullName = assertion.fullName || name;
      if (!name && !fullName) return null;
      /** @type {'pass' | 'fail' | 'skip'} */
      let status = 'skip';
      if (assertion.status === 'passed') status = 'pass';
      else if (assertion.status === 'failed') status = 'fail';
      tests.push({ name: fullName || name, status });
    }
  }
  return tests;
}

/**
 * @param {string} text
 * @returns {{ name: string, status: 'pass' | 'fail' | 'skip' }[] | null}
 */
function parseCargo(text) {
  /** @type {{ name: string, status: 'pass' | 'fail' | 'skip' }[]} */
  const tests = [];
  const re = /^test\s+(.+?)\s+\.\.\.\s+(ok|FAILED|ignored)\s*$/gm;
  let match = re.exec(text);
  while (match) {
    const name = match[1] ?? '';
    const word = match[2];
    /** @type {'pass' | 'fail' | 'skip'} */
    let status = 'skip';
    if (word === 'ok') status = 'pass';
    else if (word === 'FAILED') status = 'fail';
    tests.push({ name, status });
    match = re.exec(text);
  }
  return tests;
}

/**
 * @param {string} runnerName
 * @param {string[]} sourceNames
 * @returns {string | null}
 */
function matchSource(runnerName, sourceNames) {
  if (sourceNames.includes(runnerName)) return runnerName;
  const hits = sourceNames.filter(
    (name) => runnerName === name || runnerName.endsWith(` ${name}`) || runnerName.endsWith(`>${name}`),
  );
  if (hits.length === 1) return hits[0] ?? null;
  return null;
}

/**
 * @param {string} message
 */
function failClosed(message) {
  console.error(`verify-red: not verifiable (${message})`);
  process.exit(2);
}

/**
 * True when the file imports vitest at the top level. A string that quotes a
 * vitest import (a fixture) does not count.
 *
 * @param {string} source
 * @returns {boolean}
 */
function importsVitest(source) {
  return /^(?:import\s(?:[^;'"`]*?\sfrom\s*)?|(?:const|let|var)\s[^=;]*=\s*require\(\s*)['"]vitest(?:\/[^'"]*)?['"]/m.test(
    source,
  );
}

const mode = process.argv[2];
const sourcePath = arg('--source');
if (mode === 'is-vitest') {
  if (!sourcePath) failClosed('missing --source');
  process.exit(importsVitest(readFileSync(sourcePath, 'utf8')) ? 0 : 1);
}
const basePath = arg('--base');
if (!sourcePath) failClosed('missing --source');
const sourceNames = testNames(readFileSync(sourcePath, 'utf8'));
const baseNames = new Set(basePath ? testNames(readFileSync(basePath, 'utf8')) : []);

if (mode === 'classify') {
  if (sourceNames.length === 0) failClosed('no test names in the source');
  for (const name of sourceNames) {
    console.log(`${baseNames.has(name) ? 'OLD' : 'NEW'} ${name}`);
  }
  process.exit(0);
}

if (mode !== 'judge') failClosed('unknown mode');
const format = arg('--format');
const reportPath = arg('--report');
if (!reportPath) failClosed('missing --report');
const report = readFileSync(reportPath, 'utf8');
const parsed =
  format === 'tap' ? parseTap(report) : format === 'vitest' ? parseVitest(report) : format === 'cargo' ? parseCargo(report) : null;
if (!parsed || parsed.length === 0) failClosed('no test results');

let blocking = false;
/** @type {Set<string>} */
const reported = new Set();
for (const result of parsed) {
  const sourceName = matchSource(result.name, sourceNames);
  if (!sourceName) failClosed(`runner name not in source: ${result.name}`);
  reported.add(sourceName);
  const isNew = !baseNames.has(sourceName);
  if (!isNew) {
    console.log(`${result.status === 'fail' ? 'FAIL' : 'KEEP'} ${sourceName}`);
    continue;
  }
  if (result.status === 'fail') {
    console.log(`FAIL ${sourceName}`);
    continue;
  }
  console.log(`PASS ${sourceName}`);
  blocking = true;
}
for (const name of sourceNames) {
  if (baseNames.has(name) || reported.has(name)) continue;
  console.log(`ABSENT ${name}`);
  blocking = true;
}
process.exit(blocking ? 1 : 0);
