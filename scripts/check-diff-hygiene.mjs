#!/usr/bin/env node
/**
 * Fail added lines that match PR-contract rule 3, attribution trailers
 * in origin/v1-alpha..HEAD, mock helpers or spyOn under tests/integration-wasm,
 * a createRealEngine call whose variable is not disposed or stopped in finally
 * or afterEach, and an added expect( inside finally.
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
 * @param {string} value
 * @returns {string}
 */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * @param {string} masked
 * @returns {Set<string>}
 */
function collectAliases(masked) {
  /** @type {Set<string>} */
  const names = new Set(['createRealEngine']);
  const importRe = /\bimport\s*\{([^}]+)\}/g;
  let match = importRe.exec(masked);
  while (match) {
    for (const part of (match[1] ?? '').split(',')) {
      const item = part.trim();
      const renamed = item.match(/^createRealEngine\s+as\s+([A-Za-z_$][\w$]*)$/);
      if (renamed?.[1]) names.add(renamed[1]);
    }
    match = importRe.exec(masked);
  }
  // `const { createRealEngine: mk } = H` and `= await import('./harness.js')`.
  const destructureRe = /\{([^{}]*)\}\s*=/g;
  let destructure = destructureRe.exec(masked);
  while (destructure) {
    for (const part of (destructure[1] ?? '').split(',')) {
      const renamed = part.trim().match(/^createRealEngine\s*:\s*([A-Za-z_$][\w$]*)$/);
      if (renamed?.[1]) names.add(renamed[1]);
    }
    destructure = destructureRe.exec(masked);
  }
  let grew = true;
  while (grew) {
    grew = false;
    // `const mk = alias` and `const mk = H.createRealEngine`.
    const bindRe =
      /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:[A-Za-z_$][\w$]*\s*\.\s*)?([A-Za-z_$][\w$]*)\b(?!\s*[(.])/g;
    let bind = bindRe.exec(masked);
    while (bind) {
      const lhs = bind[1] ?? '';
      const rhs = bind[2] ?? '';
      if (lhs && names.has(rhs) && !names.has(lhs)) {
        names.add(lhs);
        grew = true;
      }
      bind = bindRe.exec(masked);
    }
  }
  return names;
}

/**
 * @param {string} text
 * @returns {{ name: string, kind: 'engine' } | null}
 */
function engineFromDestructure(text) {
  const inner = text.replace(/^\{\s*/, '').replace(/\s*\}$/, '');
  for (const part of inner.split(',')) {
    const piece = part.trim();
    const renamed = piece.match(/^engine\s*:\s*([A-Za-z_$][\w$]*)$/);
    if (renamed?.[1]) return { name: renamed[1], kind: 'engine' };
    if (piece === 'engine') return { name: 'engine', kind: 'engine' };
  }
  return null;
}

/**
 * @param {string} masked
 * @param {Set<string>} names
 * @returns {{ index: number, binding: { name: string, kind: 'handle' | 'engine' | 'array' } | null }[]}
 */
function findEngineCalls(masked, names) {
  const alt = [...names].map(escapeRegExp).join('|');
  /** @type {{ index: number, binding: { name: string, kind: 'handle' | 'engine' | 'array' } | null }[]} */
  const calls = [];
  if (!alt) return calls;
  /** @type {Set<number>} */
  const taken = new Set();
  // `X.createRealEngine(` (namespace import, re-export object) counts too.
  // `(await import('./harness.js')).createRealEngine(` too.
  const callee = `(?:(?:[A-Za-z_$][\\w$]*|\\(\\s*await\\s+import\\s*\\([^()]*\\)\\s*\\))\\s*\\.\\s*)?(?:${alt})`;
  const assigned = new RegExp(
    `\\b(?:const|let|var)?\\s*(?:(\\{[^}]*\\})|([A-Za-z_$][\\w$]*))\\s*=\\s*(?:await\\s+)?${callee}\\s*\\(`,
    'g',
  );
  // `engines.push(await createRealEngine())`: the array is the binding.
  const pushed = new RegExp(`\\b([A-Za-z_$][\\w$]*)\\s*\\.\\s*push\\s*\\(\\s*(?:await\\s+)?${callee}\\s*\\(`, 'g');
  let push = pushed.exec(masked);
  while (push) {
    calls.push({ index: push.index, binding: { name: push[1] ?? '', kind: 'array' } });
    taken.add(push.index + push[0].length);
    push = pushed.exec(masked);
  }
  let match = assigned.exec(masked);
  while (match) {
    const destructure = match[1];
    const ident = match[2];
    const binding = destructure ? engineFromDestructure(destructure) : ident ? { name: ident, kind: 'handle' } : null;
    calls.push({ index: match.index, binding });
    taken.add(match.index + match[0].length);
    match = assigned.exec(masked);
  }
  const bare = new RegExp(`(?:^|[^\\w$.])(?:await\\s+)?${callee}\\s*\\(`, 'g');
  let bareMatch = bare.exec(masked);
  while (bareMatch) {
    const end = bareMatch.index + bareMatch[0].length;
    if (!taken.has(end)) calls.push({ index: bareMatch.index, binding: null });
    bareMatch = bare.exec(masked);
  }
  return calls;
}

/**
 * @param {string} masked
 * @param {number} index
 * @returns {[number, number][]}
 */
function containingBodies(masked, index) {
  /** @type {[number, number][]} */
  const spans = [];
  let depth = 0;
  for (let i = index; i >= 0; i -= 1) {
    const char = masked[i];
    if (char === '}') depth += 1;
    else if (char === '{') {
      if (depth === 0) spans.push([i, matchingBrace(masked, i, '{', '}')]);
      else depth -= 1;
    }
  }
  return spans;
}

/**
 * @param {string} slice
 * @param {RegExp} re
 * @param {string} open
 * @param {string} close
 * @param {boolean} skipDot
 * @returns {string}
 */
function collectSpans(slice, re, open, close, skipDot) {
  let out = '';
  let match = re.exec(slice);
  while (match) {
    if (!(skipDot && match.index > 0 && slice[match.index - 1] === '.')) {
      const start = slice.indexOf(open, match.index + match[0].length);
      if (start === -1) break;
      const end = matchingBrace(slice, start, open, close);
      out += slice.slice(start, end + 1);
      re.lastIndex = end + 1;
    }
    match = re.exec(slice);
  }
  return out;
}

/**
 * @param {string} masked
 * @param {number} endIndex
 * @returns {string}
 */
function finallyAttached(masked, endIndex) {
  let i = endIndex + 1;
  while (i < masked.length && /\s/.test(masked[i] ?? '')) i += 1;
  if (!masked.startsWith('finally', i)) return '';
  if (i > 0 && masked[i - 1] === '.') return '';
  const brace = masked.indexOf('{', i + 'finally'.length);
  if (brace === -1) return '';
  const close = matchingBrace(masked, brace, '{', '}');
  return masked.slice(brace, close + 1);
}

/**
 * @param {string} masked
 * @param {number} index
 * @returns {string}
 */
function cleanupFor(masked, index) {
  const bodies = containingBodies(masked, index);
  /** @type {string[]} */
  const chunks = [];
  if (bodies.length === 0) {
    chunks.push(collectSpans(masked, /\bfinally\b/g, '{', '}', true));
    chunks.push(collectSpans(masked, /\bafterEach\b/g, '(', ')', false));
    return chunks.join('\n');
  }
  for (let i = 0; i < bodies.length; i += 1) {
    const start = bodies[i]?.[0] ?? 0;
    const end = bodies[i]?.[1] ?? start;
    const slice = masked.slice(start, end + 1);
    if (i === 0) chunks.push(collectSpans(slice, /\bfinally\b/g, '{', '}', true));
    chunks.push(finallyAttached(masked, end));
    chunks.push(collectSpans(slice, /\bafterEach\b/g, '(', ')', false));
  }
  // An engine made in a `beforeEach` callback is released by an `afterEach`
  // of the scope that holds that `beforeEach` (the next body out, or the file).
  const hook = bodies[0];
  if (hook && /\bbeforeEach\s*\(\s*(?:async\s*)?(?:\(\s*\)|function\s*\(\s*\))\s*(?:=>)?\s*$/.test(masked.slice(0, hook[0]))) {
    const outer = bodies[1];
    const scope = outer ? masked.slice(outer[0], outer[1] + 1) : masked;
    chunks.push(collectSpans(scope, /\bafterEach\b/g, '(', ')', false));
  }
  return chunks.join('\n');
}

/**
 * @param {string} cleanup
 * @param {{ name: string, kind: 'handle' | 'engine' | 'array' } | null} binding
 * @param {number} [needed] releases required for this binding
 * @returns {boolean}
 */
function isGuarded(cleanup, binding, needed = 1) {
  if (!binding) return false;
  if (binding.kind === 'array') return arrayReleased(cleanup, binding.name);
  const name = escapeRegExp(binding.name);
  const re =
    binding.kind === 'handle'
      ? new RegExp(
          `\\b${name}\\s*\\?\\.\\s*dispose\\s*\\(|\\b${name}\\.dispose\\s*\\(|\\b${name}\\s*\\?\\.\\s*engine\\.stop\\s*\\(|\\b${name}\\.engine\\.stop\\s*\\(`,
          'g',
        )
      : new RegExp(`\\b${name}\\s*\\?\\.\\s*(?:stop|dispose)\\s*\\(|\\b${name}\\.(?:stop|dispose)\\s*\\(`, 'g');
  let count = 0;
  for (const match of cleanup.matchAll(re)) {
    if (!deadCondition(cleanup, match.index ?? 0, binding.name)) count += 1;
  }
  return count >= needed;
}

/**
 * True when a condition can never hold: one of its `&&` terms is a falsy
 * literal (`false`, `0`, `null`, `undefined`). A condition that tests a
 * binding or a local flag (`if (handle)`, `if (!disposed)`) may hold.
 *
 * @param {string} condition
 * @returns {boolean}
 */
function neverHolds(condition) {
  return condition.split('||').every((disjunct) =>
    disjunct.split('&&').some((raw) => {
      const term = raw.trim().replace(/^\(+|\)+$/g, '').trim();
      if (/^(?:false|0|null|undefined|void\s+0|!\s*true)$/.test(term)) return true;
      const compare = term.match(/^(-?\d+(?:\.\d+)?)\s*(===|==|!==|!=)\s*(-?\d+(?:\.\d+)?)$/);
      if (!compare) return false;
      const same = Number(compare[1]) === Number(compare[3]);
      return compare[2]?.startsWith('!') ? same : !same;
    }),
  );
}

const IF_BEFORE = /\b(?:if|while)\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)\s*$/;
const FALSY_LITERAL = '(?:false|0|null|undefined)';

/**
 * True when `text` (the rest of a statement after `return` or `throw`) ends
 * that statement with a `;` outside any brace or paren.
 *
 * @param {string} text
 * @returns {boolean}
 */
function endsStatement(text) {
  let depth = 0;
  for (const char of text) {
    if (char === '(' || char === '{' || char === '[') depth += 1;
    else if (char === ')' || char === '}' || char === ']') depth -= 1;
    else if (char === ';' && depth === 0) return true;
  }
  return false;
}

/**
 * True when the release at `index` may never run: behind `false &&` or
 * `false ?`, behind an `if` or `while` whose condition never holds (directly
 * or around its block), or after a `return …;` or `throw …;` in the same
 * block.
 *
 * @param {string} cleanup
 * @param {number} index
 * @param {string} _name
 * @returns {boolean}
 */
function deadCondition(cleanup, index, _name) {
  const before = cleanup.slice(0, index).replace(/(?:\bawait\s+)$/, '').trimEnd();
  if (new RegExp(`(?:^|[^\\w$.])${FALSY_LITERAL}\\s*(?:&&|\\?)$`).test(before)) return true;
  const direct = before.match(IF_BEFORE);
  if (direct && neverHolds(direct[1] ?? '')) return true;
  let depth = 0;
  let innermost = true;
  for (let i = before.length - 1; i >= 0; i -= 1) {
    const char = before[i];
    if (char === '}') {
      depth += 1;
      continue;
    }
    if (char === '{') {
      if (depth > 0) {
        depth -= 1;
        continue;
      }
      innermost = false;
      const guard = before.slice(0, i).trimEnd().match(IF_BEFORE);
      if (guard && neverHolds(guard[1] ?? '')) return true;
      continue;
    }
    // `return;`, `return x;` or `throw x;` as its own statement in the
    // innermost block, before the release.
    if (!innermost || depth !== 0 || /[\w$]/.test(before[i - 1] ?? '')) continue;
    const keyword = ['return', 'throw'].find((word) => before.startsWith(word, i) && !/[\w$]/.test(before[i + word.length] ?? ''));
    if (!keyword) continue;
    const lead = before.slice(0, i).trimEnd();
    if ((lead === '' || /[;{}]$/.test(lead)) && endsStatement(before.slice(i + keyword.length))) return true;
  }
  return false;
}

/**
 * True when the cleanup releases every element of `name` in a loop:
 * `for (const h of name) h.dispose()`, `name.forEach((h) => h.dispose())`,
 * `name.map((h) => h.dispose())`.
 *
 * @param {string} cleanup
 * @param {string} name
 * @returns {boolean}
 */
function arrayReleased(cleanup, name) {
  const list = escapeRegExp(name);
  const loops = [
    new RegExp(`\\bfor\\s*\\(\\s*(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s+of\\s+${list}\\s*\\)`, 'g'),
    new RegExp(
      `\\b${list}\\s*\\.\\s*(?:forEach|map)\\s*\\(\\s*(?:async\\s+)?\\(?\\s*([A-Za-z_$][\\w$]*)\\s*\\)?\\s*=>`,
      'g',
    ),
  ];
  for (const re of loops) {
    for (const match of cleanup.matchAll(re)) {
      const item = match[1] ?? '';
      if (item && isGuarded(cleanup.slice(match.index ?? 0), { name: item, kind: 'handle' })) return true;
    }
  }
  return false;
}

/**
 * @param {string} content
 * @returns {boolean}
 */
function unguardedRealEngines(content) {
  // `H['createRealEngine']` reads as `H.createRealEngine` (masking blanks strings).
  const masked = maskSource(content.replace(/\[\s*(['"`])([A-Za-z_$][\w$]*)\1\s*\]/g, '.$2'));
  const calls = findEngineCalls(masked, collectAliases(masked));
  // A binding assigned N engines needs N releases in reach: one dispose in
  // finally does not release the engine the second assignment replaced.
  // Assignments are counted per binding and per enclosing block.
  /** @param {{ index: number, binding: { name: string } | null }} call */
  const key = (call) => `${call.binding?.name ?? ''}@${containingBodies(masked, call.index)[0]?.[0] ?? -1}`;
  /** @type {Map<string, number>} */
  const perBinding = new Map();
  for (const call of calls) {
    if (call.binding && call.binding.kind !== 'array') perBinding.set(key(call), (perBinding.get(key(call)) ?? 0) + 1);
  }
  return calls.some(
    (call) => !isGuarded(cleanupFor(masked, call.index), call.binding, perBinding.get(key(call)) ?? 1),
  );
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
    if (unguardedRealEngines(content) && !isAllowlisted(entries, filePath, 'wasm-dispose')) {
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
 * A comma that rustfmt inserts before `)`, `]` or `}` is formatting.
 * A comma between arguments stays.
 * @param {string} text
 * @returns {string}
 */
function stripFormatCommas(text) {
  let prev = '';
  let next = text;
  while (next !== prev) {
    prev = next;
    next = next.replace(/,(?=[)\]}])/g, '');
  }
  return next;
}

/**
 * Drops line comments, block comments, and whitespace outside strings.
 * A line whose first non-whitespace character is `*` is a block-comment
 * continuation, so the whole line is dropped. Comment text must not match code.
 * @param {string} line
 * @returns {string}
 */
function normalizeRustLine(line) {
  if (/^\s*\*/.test(line)) return '';
  let out = '';
  let quote = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i] ?? '';
    const next = line[i + 1] ?? '';
    if (quote) {
      out += c;
      if (c === '\\' && i + 1 < line.length) {
        out += next;
        i += 1;
        continue;
      }
      if (c === '"') quote = false;
      continue;
    }
    if (c === '"') {
      quote = true;
      out += c;
      continue;
    }
    if (c === '/' && next === '/') break;
    if (c === '/' && next === '*') {
      const end = line.indexOf('*/', i + 2);
      if (end === -1) break;
      i = end + 1;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r') continue;
    out += c;
  }
  return out;
}

/**
 * @param {string[]} lines normalized lines
 * @param {number[]} indexes positions in `lines`; a span must be contiguous
 * @param {number} start first position in `indexes` to try
 * @param {string} target normalized text the span must equal
 * @returns {number} index in `indexes` just past the match, or `start` when no span matches
 */
function concatSpan(lines, indexes, start, target) {
  const goal = stripFormatCommas(target);
  let acc = '';
  for (let cursor = start; cursor < indexes.length; cursor += 1) {
    if (cursor > start && indexes[cursor] !== indexes[cursor - 1] + 1) return start;
    acc += lines[indexes[cursor]] ?? '';
    const folded = stripFormatCommas(acc);
    if (folded === goal) return cursor + 1;
    if (folded.length > goal.length && !folded.startsWith(goal)) return start;
  }
  return start;
}

/**
 * Added-line indexes that repeat removed Rust text in one contiguous block.
 * Comments and whitespace outside strings are ignored. One removed line
 * exempts one identical added line. A call split or joined across lines
 * matches when the normalized text concatenates.
 * @param {string[]} removed
 * @param {string[]} added
 * @returns {Set<number>}
 */
function rustfmtReflowAdded(removed, added) {
  /** @type {Set<number>} */
  const exempt = new Set();
  if (removed.length === 0 || added.length === 0) return exempt;
  const removedNorm = removed.map(normalizeRustLine);
  const addedNorm = added.map(normalizeRustLine);
  const flatRemoved = stripFormatCommas(removedNorm.join(''));
  const flatAdded = stripFormatCommas(addedNorm.join(''));
  if (flatRemoved !== '' && flatRemoved === flatAdded) {
    for (let index = 0; index < added.length; index += 1) exempt.add(index);
    return exempt;
  }
  /** @type {Set<number>} */
  const usedRemoved = new Set();
  for (let addedIndex = 0; addedIndex < addedNorm.length; addedIndex += 1) {
    const line = stripFormatCommas(addedNorm[addedIndex] ?? '');
    if (line === '') continue;
    for (let removedIndex = 0; removedIndex < removedNorm.length; removedIndex += 1) {
      if (usedRemoved.has(removedIndex)) continue;
      if (stripFormatCommas(removedNorm[removedIndex] ?? '') === line) {
        usedRemoved.add(removedIndex);
        exempt.add(addedIndex);
        break;
      }
    }
  }
  /** @type {number[]} */
  const removedLeft = [];
  for (let index = 0; index < removedNorm.length; index += 1) {
    if (!usedRemoved.has(index) && stripFormatCommas(removedNorm[index] ?? '') !== '') removedLeft.push(index);
  }
  /** @type {number[]} */
  const addedLeft = [];
  for (let index = 0; index < addedNorm.length; index += 1) {
    if (!exempt.has(index) && stripFormatCommas(addedNorm[index] ?? '') !== '') addedLeft.push(index);
  }
  let removedCursor = 0;
  let addedCursor = 0;
  while (removedCursor < removedLeft.length && addedCursor < addedLeft.length) {
    const removedIndex = removedLeft[removedCursor] ?? 0;
    const addedIndex = addedLeft[addedCursor] ?? 0;
    const split = concatSpan(addedNorm, addedLeft, addedCursor, removedNorm[removedIndex] ?? '');
    if (split > addedCursor) {
      for (let cursor = addedCursor; cursor < split; cursor += 1) exempt.add(addedLeft[cursor] ?? -1);
      removedCursor += 1;
      addedCursor = split;
      continue;
    }
    const joined = concatSpan(removedNorm, removedLeft, removedCursor, addedNorm[addedIndex] ?? '');
    if (joined > removedCursor) {
      exempt.add(addedIndex);
      removedCursor = joined;
      addedCursor += 1;
      continue;
    }
    removedCursor += 1;
  }
  return exempt;
}

/**
 * Records hits for one contiguous change block. A context line is not part
 * of the block. concatSpan returns `start` when the block holds no reflow span.
 * @param {string} file
 * @param {string[]} removed
 * @param {string[]} added
 * @param {AllowEntry[]} entries
 * @param {Hit[]} hits
 */
function recordHunk(file, removed, added, entries, hits) {
  const reflow = file.endsWith('.rs') ? rustfmtReflowAdded(removed, added) : new Set();
  for (let index = 0; index < added.length; index += 1) {
    const text = added[index] ?? '';
    if (!reflow.has(index)) {
      for (const rule of matchAddedLine(text, file)) {
        if (isAllowlisted(entries, file, rule)) continue;
        hits.push({ file, rule, text });
      }
    }
    if (ALLOWLIST_COMMENT.test(text)) {
      hits.push({ file, rule: 'allowlist-comment', text: INVALID_ALLOWLIST });
    }
  }
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
  /** @type {string[]} */
  let removed = [];
  /** @type {string[]} */
  let added = [];
  const flush = () => {
    if (!binary) recordHunk(file, removed, added, entries, hits);
    removed = [];
    added = [];
  };
  for (const line of diffText.split('\n')) {
    if (line.startsWith('diff --git ')) {
      flush();
      binary = false;
      const match = line.match(/^diff --git a\/(.+) b\/(.+)$/);
      file = match ? match[2] : '';
      continue;
    }
    if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) {
      flush();
      binary = true;
      continue;
    }
    if (line.startsWith('+++ ')) {
      const next = line.slice(4).trim();
      if (next !== '/dev/null') file = next.replace(/^b\//, '');
      continue;
    }
    if (line.startsWith('@@')) {
      flush();
      continue;
    }
    if (binary) continue;
    if (line.startsWith('+')) {
      added.push(line.slice(1));
      continue;
    }
    if (line.startsWith('-') && !line.startsWith('---')) {
      removed.push(line.slice(1));
      continue;
    }
    // A context line splits the change. Removed text on one side of it must
    // not exempt added text on the other side. A file line that starts with
    // `++` is an added line (`+++text`), not the `+++ ` header, so it is scanned.
    if (line.startsWith(' ')) flush();
  }
  flush();
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
