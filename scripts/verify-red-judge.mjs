#!/usr/bin/env node
/**
 * Compare a test run to the test names in the source file.
 *
 * A name is the describe path plus the test title, joined with ` > `.
 * A title that is not a literal (template with `${}`, `it.each` placeholder,
 * variable) is dynamic: it is matched as a pattern. It may pass only when the
 * base copy of the file has the same title.
 *
 * is-vitest --source <file>
 *   Exit 0 when the file imports vitest at the top level, 1 otherwise.
 *
 * classify --source <head> [--base <base copy>]
 *   Prints `NEW <name>` or `OLD <name>`. Exit 2 when the source has no test names.
 *
 * judge --source <head> [--base <base copy>] --format tap|vitest|cargo --report <file>
 *       [--file <path given to the runner>] [--head-report <head run>]
 *   Exit 0 when every name that is absent from the base copy failed.
 *   Exit 3 (`LOAD-ERROR`) when the file did not load on the base and no head
 *   run is given. With --head-report, every name the head run reports counts
 *   as failed on the base; a file that does not load on the head either exits 2.
 *   Exit 1 when such a name passed, was skipped, or is absent from the report.
 *   Exit 2 when the report has no tests.
 *   A name present in the base copy may pass (`KEEP`), a dynamic one too. A
 *   new dynamic name follows the rule of a new literal one. A runner name that
 *   matches no source name (renamed or aliased runner, `test.extend`) blocks
 *   when it passes; when it fails it prints `WARN` and does not block.
 */

import { readFileSync } from 'node:fs';

/** @typedef {'pass' | 'fail' | 'skip'} Status */
/** @typedef {{ path: string[], status: Status }} Result */
/**
 * @typedef {object} Segment
 * @property {string} text title as written in the source
 * @property {RegExp | null} pattern set when the title is dynamic
 */
/**
 * @typedef {object} Entry
 * @property {'suite' | 'test'} kind
 * @property {Segment[]} path
 * @property {string} name path joined with ` > `
 * @property {boolean} dynamic
 */

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
 * @param {string} text
 * @returns {string}
 */
function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * @param {string} src
 * @param {number} i index of the opening quote
 * @returns {number} index after the closing quote
 */
function skipString(src, i) {
  const quote = src[i];
  let j = i + 1;
  while (j < src.length) {
    const c = src[j];
    if (c === '\\') {
      j += 2;
      continue;
    }
    if (c === quote) return j + 1;
    if (c === '\n') return j;
    j++;
  }
  return j;
}

/**
 * @param {string} src
 * @param {number} i index after `${`
 * @returns {number} index after the matching `}`
 */
function skipExpression(src, i) {
  let depth = 1;
  let j = i;
  while (j < src.length) {
    const c = src[j];
    if (c === '"' || c === "'") {
      j = skipString(src, j);
      continue;
    }
    if (c === '`') {
      j = skipTemplate(src, j);
      continue;
    }
    if (c === '{') depth++;
    if (c === '}') {
      depth--;
      if (depth === 0) return j + 1;
    }
    j++;
  }
  return j;
}

/**
 * @param {string} src
 * @param {number} i index of the opening backtick
 * @returns {number} index after the closing backtick
 */
function skipTemplate(src, i) {
  let j = i + 1;
  while (j < src.length) {
    const c = src[j];
    if (c === '\\') {
      j += 2;
      continue;
    }
    if (c === '`') return j + 1;
    if (c === '$' && src[j + 1] === '{') {
      j = skipExpression(src, j + 2);
      continue;
    }
    j++;
  }
  return j;
}

/**
 * @param {string} src
 * @param {number} i index of the opening slash
 * @returns {number} index after the flags, or i + 1 when it is not a regex
 */
function skipRegex(src, i) {
  let j = i + 1;
  let inClass = false;
  while (j < src.length) {
    const c = src[j];
    if (c === '\n') return i + 1;
    if (c === '\\') {
      j += 2;
      continue;
    }
    if (c === '[') inClass = true;
    else if (c === ']') inClass = false;
    else if (c === '/' && !inClass) {
      j++;
      while (j < src.length && /[a-z]/i.test(src[j] ?? '')) j++;
      return j;
    }
    j++;
  }
  return i + 1;
}

/**
 * @param {string} src
 * @param {number} i
 * @returns {number} first index that is not whitespace or a comment
 */
function skipSpace(src, i) {
  let j = i;
  while (j < src.length) {
    const c = src[j];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      j++;
      continue;
    }
    if (c === '/' && src[j + 1] === '/') {
      const end = src.indexOf('\n', j);
      j = end === -1 ? src.length : end;
      continue;
    }
    if (c === '/' && src[j + 1] === '*') {
      const end = src.indexOf('*/', j + 2);
      j = end === -1 ? src.length : end + 2;
      continue;
    }
    break;
  }
  return j;
}

/**
 * @param {string} src
 * @param {number} i index of an opening paren
 * @returns {number} index after the matching paren
 */
function skipParens(src, i) {
  let depth = 0;
  let j = i;
  while (j < src.length) {
    const c = src[j];
    if (c === '"' || c === "'") {
      j = skipString(src, j);
      continue;
    }
    if (c === '`') {
      j = skipTemplate(src, j);
      continue;
    }
    if (c === '(') depth++;
    if (c === ')') {
      depth--;
      if (depth === 0) return j + 1;
    }
    j++;
  }
  return j;
}

const REGEX_BEFORE = new Set([
  '',
  '(',
  ',',
  '=',
  ':',
  '[',
  '!',
  '&',
  '|',
  '?',
  '{',
  '}',
  ';',
  '+',
  '-',
  '*',
  '%',
  '<',
  '>',
  '~',
  '^',
  'return',
  'typeof',
  'case',
  'in',
  'of',
  'new',
  'delete',
  'void',
  'throw',
  'else',
  'do',
  'await',
  'yield',
]);

const SUITES = new Set(['describe', 'suite', 'context']);
const TESTS = new Set(['it', 'test']);
const TABLE_MODIFIERS = new Set(['each', 'for']);
const CALL_MODIFIERS = new Set(['each', 'for', 'skipIf', 'runIf']);

/**
 * Turn an `it.each` / `test.for` title into a segment. `%s`, `%i`, `$name`,
 * `$0` … are dynamic.
 *
 * @param {string} title
 * @returns {Segment}
 */
function tableSegment(title) {
  const placeholder = /%[sdifjoOc#$]|\$[A-Za-z_][\w.]*|\$\d+/;
  if (!placeholder.test(title)) return { text: title, pattern: null };
  const parts = title.split(/%[sdifjoOc#$]|\$[A-Za-z_][\w.]*|\$\d+/);
  const body = parts.map((part) => escapeRegExp(part.replace(/%%/g, '%'))).join('[\\s\\S]*?');
  return { text: title, pattern: new RegExp(`^${body}$`) };
}

/**
 * @param {string} src
 * @param {number} i index of the opening backtick
 * @returns {Segment}
 */
function templateSegment(src, i) {
  const end = skipTemplate(src, i);
  const raw = src.slice(i + 1, end - 1);
  if (!raw.includes('${')) return { text: unescapeLiteral(raw), pattern: null };
  /** @type {string[]} */
  const parts = [];
  let j = 0;
  let current = '';
  while (j < raw.length) {
    if (raw[j] === '\\') {
      current += raw.slice(j, j + 2);
      j += 2;
      continue;
    }
    if (raw[j] === '$' && raw[j + 1] === '{') {
      parts.push(unescapeLiteral(current));
      current = '';
      j = skipExpression(raw, j + 2);
      continue;
    }
    current += raw[j];
    j++;
  }
  parts.push(unescapeLiteral(current));
  return {
    text: raw,
    pattern: new RegExp(`^${parts.map(escapeRegExp).join('[\\s\\S]*?')}$`),
  };
}

/**
 * Read the title argument of a test or suite call.
 *
 * @param {string} src
 * @param {number} i index after the opening paren
 * @param {boolean} table the call is `.each` / `.for`
 * @returns {Segment}
 */
function readTitle(src, i, table) {
  const j = skipSpace(src, i);
  const c = src[j];
  if (c === '"' || c === "'") {
    const end = skipString(src, j);
    const text = unescapeLiteral(src.slice(j + 1, end - 1));
    return table ? tableSegment(text) : { text, pattern: null };
  }
  if (c === '`') {
    const segment = templateSegment(src, j);
    return table && !segment.pattern ? tableSegment(segment.text) : segment;
  }
  const word = src.slice(j).match(/^[^,)]*/)?.[0]?.trim() || '<expression>';
  return { text: `<${word}>`, pattern: /^[\s\S]*$/ };
}

/**
 * Find every describe/it/test call and its describe path.
 *
 * @param {string} src
 * @returns {Entry[]}
 */
function scanJs(src) {
  /** @type {Entry[]} */
  const entries = [];
  /** @type {{ segment: Segment, kind: 'suite' | 'test', depth: number }[]} */
  const stack = [];
  let depth = 0;
  let prev = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i] ?? '';
    if (c === '/' && (src[i + 1] === '/' || src[i + 1] === '*')) {
      i = skipSpace(src, i);
      continue;
    }
    if (c === '"' || c === "'") {
      i = skipString(src, i);
      prev = 'x';
      continue;
    }
    if (c === '`') {
      i = skipTemplate(src, i);
      prev = 'x';
      continue;
    }
    if (c === '/' && REGEX_BEFORE.has(prev)) {
      const end = skipRegex(src, i);
      prev = end === i + 1 ? '/' : 'x';
      i = end;
      continue;
    }
    if (c === '(') {
      depth++;
      prev = '(';
      i++;
      continue;
    }
    if (c === ')') {
      depth--;
      while (stack.length > 0 && (stack[stack.length - 1]?.depth ?? 0) > depth) stack.pop();
      prev = ')';
      i++;
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      const word = src.slice(i).match(/^[A-Za-z_$][\w$]*/)?.[0] ?? c;
      const before = src.slice(0, i).trimEnd();
      const member = before.endsWith('.') && !before.endsWith('..');
      const insideTest = stack.some((item) => item.kind === 'test');
      const candidate =
        (!member && (SUITES.has(word) || TESTS.has(word))) ||
        (member && insideTest && (TESTS.has(word) || word === 'describe'));
      if (candidate && !/[\w$]/.test(src[i - 1] ?? '')) {
        let j = i + word.length;
        let table = false;
        let ok = true;
        for (;;) {
          j = skipSpace(src, j);
          if (src[j] !== '.') break;
          j = skipSpace(src, j + 1);
          const modifier = src.slice(j).match(/^[A-Za-z_$][\w$]*/)?.[0];
          if (!modifier) {
            ok = false;
            break;
          }
          j += modifier.length;
          // `test.extend({...})` builds a runner, it is not a test.
          if (modifier === 'extend') {
            ok = false;
            break;
          }
          if (CALL_MODIFIERS.has(modifier)) {
            j = skipSpace(src, j);
            if (src[j] !== '(') {
              ok = false;
              break;
            }
            j = skipParens(src, j);
            if (TABLE_MODIFIERS.has(modifier)) table = true;
          }
        }
        if (ok && src[j] === '(') {
          const titleStart = j + 1;
          const segment = readTitle(src, titleStart, table);
          if (member && segment.pattern && !segment.text.startsWith('`') && segment.text.startsWith('<')) {
            i += word.length;
            prev = word;
            continue;
          }
          const kind = SUITES.has(word) ? 'suite' : 'test';
          depth++;
          const path = [...stack.map((item) => item.segment), segment];
          entries.push({
            kind,
            path,
            name: path.map((item) => item.text).join(' > '),
            dynamic: path.some((item) => item.pattern !== null),
          });
          stack.push({ segment, kind, depth });
          prev = '(';
          i = titleStart;
          continue;
        }
      }
      i += word.length;
      prev = word;
      continue;
    }
    if (!/\s/.test(c)) prev = c === ']' ? 'x' : c;
    i++;
  }
  return entries;
}

/**
 * `#[test]` / `#[wasm_bindgen_test]` functions of a Rust test file.
 *
 * @param {string} src
 * @returns {Entry[]}
 */
function scanRust(src) {
  /** @type {Entry[]} */
  const entries = [];
  const re = /#\[(?:tokio::)?(?:test|wasm_bindgen_test)[^\]]*\]\s*(?:#\[[^\]]*\]\s*)*(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)/g;
  let match = re.exec(src);
  while (match) {
    const text = match[1] ?? '';
    entries.push({ kind: 'test', path: [{ text, pattern: null }], name: text, dynamic: false });
    match = re.exec(src);
  }
  return entries;
}

/**
 * @param {string} file
 * @returns {Entry[]}
 */
function scanFile(file) {
  const src = readFileSync(file, 'utf8');
  return file.endsWith('.rs') ? scanRust(src) : scanJs(src);
}

/**
 * node:test escapes `#` and `\` in TAP names.
 *
 * @param {string} name
 * @returns {string}
 */
function unescapeTap(name) {
  return name.replace(/\\([\\#])/g, '$1');
}

/**
 * @param {string} text
 * @returns {Result[] | null}
 */
function parseTap(text) {
  /** @type {Result[]} */
  const tests = [];
  /** @type {string[]} */
  const subtests = [];
  /** @type {string | null} indent of the open YAML diagnostic block */
  let yaml = null;
  for (const line of text.split(/\r?\n/)) {
    if (yaml !== null) {
      if (line === `${yaml}...`) yaml = null;
      continue;
    }
    const yamlStart = line.match(/^( *)---$/);
    if (yamlStart) {
      yaml = yamlStart[1] ?? '';
      continue;
    }
    const subtest = line.match(/^( *)# Subtest: (.*)$/);
    if (subtest) {
      const level = Math.floor((subtest[1] ?? '').length / 4);
      subtests.length = level;
      subtests[level] = unescapeTap((subtest[2] ?? '').trim());
      continue;
    }
    const match = line.match(/^( *)(not )?ok\s+\d+\s+-\s+(.+)$/);
    if (!match) continue;
    const level = Math.floor((match[1] ?? '').length / 4);
    let raw = (match[3] ?? '').trim();
    /** @type {Status} */
    let status = match[2] ? 'fail' : 'pass';
    const directive = raw.match(/^((?:\\.|[^\\#])*?)\s+#\s+(SKIP|TODO)\b/i);
    if (directive) {
      status = 'skip';
      raw = directive[1] ?? '';
    }
    const name = unescapeTap(raw.trim());
    if (name === '') return null;
    tests.push({ path: [...subtests.slice(0, level), name], status });
  }
  return tests;
}

/**
 * @param {string} text
 * @returns {Result[] | null}
 */
function parseVitest(text) {
  /** @type {{ testResults?: { assertionResults?: { ancestorTitles?: string[], fullName?: string, title?: string, status?: string }[] }[] }} */
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  /** @type {Result[]} */
  const tests = [];
  for (const file of json.testResults ?? []) {
    for (const assertion of file.assertionResults ?? []) {
      const title = assertion.title ?? assertion.fullName ?? '';
      if (!title) return null;
      /** @type {Status} */
      let status = 'skip';
      if (assertion.status === 'passed') status = 'pass';
      else if (assertion.status === 'failed') status = 'fail';
      tests.push({ path: [...(assertion.ancestorTitles ?? []), title], status });
    }
  }
  return tests;
}

/**
 * @param {string} text
 * @returns {Result[] | null}
 */
function parseCargo(text) {
  /** @type {Result[]} */
  const tests = [];
  const re = /^test\s+(.+?)\s+\.\.\.\s+(ok|FAILED|ignored)\s*$/gm;
  let match = re.exec(text);
  while (match) {
    const name = (match[1] ?? '').split('::').pop() ?? '';
    const word = match[2];
    /** @type {Status} */
    let status = 'skip';
    if (word === 'ok') status = 'pass';
    else if (word === 'FAILED') status = 'fail';
    tests.push({ path: [name], status });
    match = re.exec(text);
  }
  return tests;
}

/**
 * @param {Segment} segment
 * @param {string} title
 * @returns {boolean}
 */
function segmentMatches(segment, title) {
  return segment.pattern ? segment.pattern.test(title) : segment.text === title;
}

/**
 * The source entry for a runner path: an exact literal match first, then a
 * dynamic one.
 *
 * @param {string[]} path
 * @param {Entry[]} entries
 * @returns {Entry | null}
 */
function matchEntry(path, entries) {
  const sameLength = entries.filter((entry) => entry.path.length === path.length);
  const exact = sameLength.find(
    (entry) => !entry.dynamic && entry.path.every((segment, k) => segment.text === path[k]),
  );
  if (exact) return exact;
  return (
    sameLength.find(
      (entry) => entry.dynamic && entry.path.every((segment, k) => segmentMatches(segment, path[k] ?? '')),
    ) ?? null
  );
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
const allEntries = scanFile(sourcePath);
const sourceTests = allEntries.filter((entry) => entry.kind === 'test');
const baseNames = new Set(
  basePath
    ? scanFile(basePath)
        .filter((entry) => entry.kind === 'test')
        .map((entry) => entry.name)
    : [],
);

if (mode === 'classify') {
  if (sourceTests.length === 0) failClosed('no test names in the source');
  for (const entry of sourceTests) {
    console.log(`${baseNames.has(entry.name) ? 'OLD' : 'NEW'} ${entry.name}`);
  }
  process.exit(0);
}

if (mode !== 'judge') failClosed('unknown mode');
const format = arg('--format');
const reportPath = arg('--report');
const runFile = arg('--file');
const headReportPath = arg('--head-report');
if (!reportPath) failClosed('missing --report');

/**
 * @param {string} text
 * @returns {Result[] | null}
 */
function parseReport(text) {
  if (format === 'tap') return parseTap(text);
  if (format === 'vitest') return parseVitest(text);
  if (format === 'cargo') return parseCargo(text);
  return null;
}

/**
 * The reason a test file did not load (import error, compile error), or null
 * when it loaded and ran.
 *
 * @param {string} text raw report
 * @param {Result[] | null} results
 * @returns {string | null}
 */
function loadFailure(text, results) {
  if (format === 'vitest') {
    if (results && results.length > 0) return null;
    /** @type {{ testResults?: { status?: string, message?: string, assertionResults?: unknown[] }[] }} */
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      return null;
    }
    const broken = (json.testResults ?? []).find(
      (file) => file.status === 'failed' && (file.assertionResults ?? []).length === 0,
    );
    if (!broken) return null;
    return (broken.message ?? '').split('\n')[0] || 'the file failed to load';
  }
  if (format === 'tap') {
    if (!results || !runFile) return null;
    const fileEntry = (result) =>
      result.path.length === 1 &&
      (result.path[0] === runFile || runFile.endsWith(`/${result.path[0]}`) || (result.path[0] ?? '').endsWith(runFile));
    const others = results.filter((result) => !fileEntry(result));
    const failed = results.some((result) => fileEntry(result) && result.status === 'fail');
    if (!failed || others.length > 0) return null;
    const error = text.split(/\r?\n/).find((line) => /^# .*(?:Error|error)\b/.test(line));
    return error ? error.slice(2).trim() : 'the file failed to load';
  }
  if (format === 'cargo') {
    if (results && results.length > 0) return null;
    const error = text.split(/\r?\n/).find((line) => /^error(?:\[E\d+\])?:/.test(line));
    return error ?? null;
  }
  return null;
}

const report = readFileSync(reportPath, 'utf8');
let parsed = parseReport(report);
const baseLoadError = loadFailure(report, parsed);
if (baseLoadError && !headReportPath) {
  console.log(`LOAD-ERROR ${baseLoadError}`);
  process.exit(3);
}
if (baseLoadError) {
  const headText = readFileSync(headReportPath, 'utf8');
  const headParsed = parseReport(headText);
  const headError = loadFailure(headText, headParsed);
  if (headError || !headParsed || headParsed.length === 0) {
    failClosed(`does not load on the head either: ${headError ?? 'no test results'}`);
  }
  // Every name the head runs failed on the base: the file could not load there.
  parsed = (headParsed ?? []).map((result) => ({ path: result.path, status: /** @type {Status} */ ('fail') }));
}
if (!parsed || parsed.length === 0) failClosed('no test results');
const suffix = baseLoadError ? ` (base load error: ${baseLoadError})` : '';

/** @type {Map<Entry, Status[]>} */
const statuses = new Map();
let unplacedPassed = false;
for (const result of parsed) {
  const entry = matchEntry(result.path, allEntries);
  if (entry?.kind === 'suite') continue;
  if (!entry) {
    const isParent = parsed.some(
      (other) =>
        other.path.length > result.path.length && result.path.every((title, k) => other.path[k] === title),
    );
    if (isParent) continue;
    // A renamed or aliased runner (`import { test as check }`, `const t = test`,
    // `test.extend`) hides its names from the scan: a passing one blocks.
    if (result.status === 'fail') console.log(`WARN runner name not in source: ${result.path.join(' > ')}`);
    else {
      console.log(`PASS ${result.path.join(' > ')} (runner name not in source)`);
      unplacedPassed = true;
    }
    continue;
  }
  const list = statuses.get(entry) ?? [];
  list.push(result.status);
  statuses.set(entry, list);
}

let blocking = false;
for (const entry of sourceTests) {
  const isNew = !baseNames.has(entry.name);
  const list = statuses.get(entry) ?? [];
  const allFailed = list.length > 0 && list.every((status) => status === 'fail');
  if (list.length === 0) {
    if (!isNew) console.log(`KEEP ${entry.name} (not run)`);
    else {
      console.log(`ABSENT ${entry.name}`);
      blocking = true;
    }
    continue;
  }
  if (allFailed) {
    console.log(`FAIL ${entry.name}${suffix}`);
    continue;
  }
  if (!isNew) {
    console.log(`KEEP ${entry.name}`);
    continue;
  }
  console.log(`PASS ${entry.name}`);
  blocking = true;
}
process.exit(blocking || unplacedPassed ? 1 : 0);
