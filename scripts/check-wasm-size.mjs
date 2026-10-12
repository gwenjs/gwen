#!/usr/bin/env node
/**
 * Compare shipped WASM artifacts with wasm-size.json.
 * Run: node scripts/check-wasm-size.mjs
 * Stamp helper: node scripts/check-wasm-size.mjs --write-report-only
 */

import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const TOLERANCE = 0.05;
const TOLERANCE_MIN_BYTES = 2048;
const ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * @param {number} baseline
 * @param {number} tolerance
 * @param {number} minBytes
 * @returns {number}
 */
function budgetFor(baseline, tolerance, minBytes) {
  return baseline + Math.max(Math.ceil(baseline * tolerance), minBytes);
}

/**
 * @param {number} baseline
 * @returns {number}
 */
export function allowedBudget(baseline) {
  return budgetFor(baseline, TOLERANCE, TOLERANCE_MIN_BYTES);
}

/**
 * @param {number} baseline
 * @param {number} measured
 * @returns {string}
 */
function formatPct(baseline, measured) {
  if (baseline === 0) return '+n/a%';
  const pct = ((measured - baseline) / baseline) * 100;
  const digits = Math.abs(pct).toFixed(1);
  if (pct > 0) return `+${digits}%`;
  if (pct < 0) return `-${digits}%`;
  return '+0.0%';
}

/**
 * @param {Buffer} buf
 * @returns {{ raw: number, gzip: number, brotli: number }}
 */
function measureBuffer(buf) {
  return {
    raw: buf.length,
    gzip: gzipSync(buf, { level: 9 }).length,
    brotli: brotliCompressSync(buf, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
    }).length,
  };
}

/**
 * @param {string} name
 * @param {string} metric
 * @param {{ baseline: number, budget: number }} spec
 * @param {number} measured
 * @param {number} tolerance
 * @param {number} minBytes
 */
function judge(name, metric, spec, measured, tolerance, minBytes) {
  const budget = budgetFor(spec.baseline, tolerance, minBytes);
  /** @type {string[]} */
  const failures = [];
  /** @type {string[]} */
  const notes = [];
  if (measured > budget) {
    failures.push(
      `[WASM SIZE] ${name} ${metric}: baseline ${spec.baseline} → measured ${measured} (budget ${budget}, ${formatPct(spec.baseline, measured)})`,
    );
  }
  if (spec.budget !== budget) {
    failures.push(
      `[WASM SIZE] ${name} ${metric}: stored budget ${spec.budget} != formula ${budget}`,
    );
  }
  if (measured < spec.baseline * 0.95) notes.push(`${name} ${metric}: can be lowered`);
  return { budget, failures, notes };
}

/**
 * @param {{ failures: string[], notes: string[] }} gzip
 * @param {{ failures: string[], notes: string[] }} brotli
 * @returns {string}
 */
function statusFor(gzip, brotli) {
  const failures = [...gzip.failures, ...brotli.failures];
  if (failures.some((line) => line.includes('→ measured'))) return 'over';
  if (gzip.notes.length > 0 || brotli.notes.length > 0) return 'can be lowered';
  if (failures.length > 0) return 'budget mismatch';
  return 'ok';
}

/**
 * @param {string} name
 * @param {{ path: string }} variant
 * @param {{ measured?: Record<string, { raw: number, gzip: number, brotli: number }>, files?: Record<string, Buffer> }} input
 * @returns {{ raw: number, gzip: number, brotli: number } | null}
 */
function sampleFor(name, variant, input) {
  if (input.measured && Object.prototype.hasOwnProperty.call(input.measured, name)) {
    return input.measured[name] ?? null;
  }
  if (input.files && Object.prototype.hasOwnProperty.call(input.files, variant.path)) {
    const buf = input.files[variant.path];
    if (!buf) return null;
    return measureBuffer(buf);
  }
  return null;
}

/**
 * @param {number} baseline
 * @param {number} measured
 * @returns {string}
 */
function delta(baseline, measured) {
  return `${formatPct(baseline, measured)} (${measured})`;
}

/**
 * @typedef {{
 *   version: number,
 *   toolchain: { rust: string, wasmPack: string, wasmOpt: string },
 *   tolerance: number,
 *   toleranceMinBytes: number,
 *   variants: Record<string, {
 *     path: string,
 *     raw: number,
 *     gzip: { baseline: number, budget: number },
 *     brotli: { baseline: number, budget: number },
 *   }>,
 *   reportOnly?: Record<string, { path: string }>,
 * }} Catalog
 */

/**
 * @param {{
 *   catalog: Catalog,
 *   measured?: Record<string, { raw: number, gzip: number, brotli: number }>,
 *   files?: Record<string, Buffer>,
 *   reports?: Record<string, { raw: number, gzip: number, brotli: number } | null>,
 *   observed: { rust: string, wasmPack: string, wasmOpt: string },
 *   jsonChanged: boolean,
 *   prBody: string,
 * }} input
 * @returns {{ ok: boolean, lines: string[], table: string }}
 */
export function evaluateWasmSize(input) {
  const catalog = input.catalog;
  /** @type {string[]} */
  const lines = [];
  /** @type {string[]} */
  const rows = [];
  let ok = true;

  for (const [name, variant] of Object.entries(catalog.variants)) {
    const sample = sampleFor(name, variant, input);
    if (!sample) {
      ok = false;
      lines.push(`[WASM SIZE] ${name}: artifact missing at ${variant.path}`);
      rows.push(`${name} | — | — | — | — | missing`);
      continue;
    }
    const gzip = judge(
      name,
      'gzip',
      variant.gzip,
      sample.gzip,
      catalog.tolerance,
      catalog.toleranceMinBytes,
    );
    const brotli = judge(
      name,
      'brotli',
      variant.brotli,
      sample.brotli,
      catalog.tolerance,
      catalog.toleranceMinBytes,
    );
    lines.push(...gzip.failures, ...brotli.failures, ...gzip.notes, ...brotli.notes);
    if (gzip.failures.length > 0 || brotli.failures.length > 0) ok = false;
    rows.push(
      `${name} | ${sample.raw} | ${delta(variant.gzip.baseline, sample.gzip)} | ${delta(variant.brotli.baseline, sample.brotli)} | ${gzip.budget} / ${brotli.budget} | ${statusFor(gzip, brotli)}`,
    );
  }

  const reports = input.reports ?? {};
  for (const name of Object.keys(catalog.reportOnly ?? {})) {
    const sample = Object.prototype.hasOwnProperty.call(reports, name) ? reports[name] : null;
    if (!sample) {
      rows.push(`${name} | — | — | — | — | not recorded`);
      continue;
    }
    rows.push(`${name} | ${sample.raw} | n/a (${sample.gzip}) | n/a (${sample.brotli}) | — | report`);
  }

  const pinned = catalog.toolchain;
  const toolchainKeys = ['rust', 'wasmPack', 'wasmOpt'];
  for (const key of toolchainKeys) {
    const seen = input.observed[key];
    const want = pinned[key];
    if (seen !== want) {
      ok = false;
      lines.push(
        `[WASM SIZE] toolchain ${key}: observed ${seen || 'missing'} != pinned ${want}; re-record`,
      );
    }
  }

  if (input.jsonChanged) {
    const hasSection = input.prBody.split(/\r?\n/).some((line) => line.trim() === '## WASM size budget');
    if (!hasSection) {
      ok = false;
      lines.push(
        '[WASM SIZE] wasm-size.json changed without a "WASM size budget" section in the PR body',
      );
    }
  }

  const table = ['variant | raw | gzip Δ | brotli Δ | budget | status', ...rows].join('\n');
  return { ok, lines, table };
}

/**
 * @param {string} root
 * @returns {Record<string, unknown> | null}
 */
function readStamp(root) {
  const stampPath = path.join(root, 'packages/core/wasm/toolchain.json');
  if (!existsSync(stampPath)) return null;
  return JSON.parse(readFileSync(stampPath, 'utf8'));
}

/**
 * @param {string} cmd
 * @param {string[]} args
 * @returns {string}
 */
function runVersion(cmd, args) {
  const result = spawnSync(cmd, args, { encoding: 'utf8' });
  if (result.status !== 0) return '';
  return (result.stdout ?? '').trim();
}

/**
 * @returns {{ rust: string, wasmPack: string, wasmOpt: string }}
 */
function observeCommands() {
  const rustText = runVersion('rustc', ['--version']);
  const packText = runVersion('wasm-pack', ['--version']);
  const optText = runVersion('wasm-opt', ['--version']);
  const rust = rustText.match(/^rustc (\S+)/);
  const pack = packText.match(/^wasm-pack (\S+)/);
  const opt = optText.match(/^wasm-opt version (\d+) \(version_\1\)$/);
  return {
    rust: rust?.[1] ?? 'missing',
    wasmPack: pack?.[1] ?? 'missing',
    wasmOpt: opt?.[1] ?? (optText || 'missing'),
  };
}

/**
 * @param {string} root
 * @returns {boolean}
 */
function jsonChanged(root) {
  const base = process.env.SIZE_BASE ?? '';
  if (base === '') return false;
  const diff = spawnSync('git', ['diff', '--name-only', `${base}...HEAD`, '--', 'wasm-size.json'], {
    cwd: root,
    encoding: 'utf8',
  });
  if (diff.status !== 0) {
    process.stderr.write(diff.stderr || `git diff failed against ${base}\n`);
    process.exit(1);
  }
  return diff.stdout.trim() !== '';
}

/**
 * @returns {string}
 */
function readPrBody() {
  const number = process.env.PR_NUMBER ?? '';
  if (number === '') return '';
  const args = ['pr', 'view', number, '--json', 'body', '--jq', '.body'];
  const repo = process.env.PR_REPO ?? '';
  if (repo !== '') args.push('--repo', repo);
  const view = spawnSync('gh', args, { encoding: 'utf8' });
  if (view.status !== 0) return '';
  return view.stdout ?? '';
}

/**
 * @param {string} root
 * @param {Catalog} catalog
 */
function writeReportOnly(root, catalog) {
  const stampPath = path.join(root, 'packages/core/wasm/toolchain.json');
  /** @type {Record<string, unknown>} */
  const stamp = existsSync(stampPath) ? JSON.parse(readFileSync(stampPath, 'utf8')) : {};
  /** @type {Record<string, { raw: number, gzip: number, brotli: number }>} */
  const reportOnly = {};
  const previous = stamp.reportOnly;
  if (previous && typeof previous === 'object') {
    Object.assign(reportOnly, previous);
  }
  for (const [name, entry] of Object.entries(catalog.reportOnly ?? {})) {
    const full = path.join(root, entry.path);
    if (!existsSync(full)) continue;
    reportOnly[name] = measureBuffer(readFileSync(full));
  }
  stamp.reportOnly = reportOnly;
  writeFileSync(stampPath, `${JSON.stringify(stamp, null, 2)}\n`);
}

/**
 * @param {unknown} reports
 * @param {string} name
 * @returns {boolean}
 */
function isReportRow(reports, name) {
  return Boolean(reports && typeof reports === 'object' && Object.prototype.hasOwnProperty.call(reports, name));
}

/**
 * @param {unknown} reports
 * @param {string} name
 * @returns {{ raw: number, gzip: number, brotli: number } | null}
 */
function readReportRow(reports, name) {
  if (!reports || typeof reports !== 'object') return null;
  const row = Object.prototype.hasOwnProperty.call(reports, name)
    ? Reflect.get(reports, name)
    : null;
  if (!row || typeof row !== 'object') return null;
  return {
    raw: Number(Reflect.get(row, 'raw')),
    gzip: Number(Reflect.get(row, 'gzip')),
    brotli: Number(Reflect.get(row, 'brotli')),
  };
}

function main() {
  const catalog = JSON.parse(readFileSync(path.join(ROOT, 'wasm-size.json'), 'utf8'));
  if (process.argv.includes('--write-report-only')) {
    writeReportOnly(ROOT, catalog);
    return;
  }
  const stamp = readStamp(ROOT);
  const observed = stamp
    ? {
        rust: String(stamp.rust ?? 'missing'),
        wasmPack: String(stamp.wasmPack ?? 'missing'),
        wasmOpt: String(stamp.wasmOpt ?? 'missing'),
      }
    : observeCommands();
  /** @type {Record<string, Buffer>} */
  const files = {};
  for (const variant of Object.values(catalog.variants)) {
    const full = path.join(ROOT, variant.path);
    if (existsSync(full)) files[variant.path] = readFileSync(full);
  }
  /** @type {Record<string, { raw: number, gzip: number, brotli: number } | null>} */
  const reports = {};
  const stampedReports = stamp?.reportOnly;
  for (const [name, entry] of Object.entries(catalog.reportOnly ?? {})) {
    const full = path.join(ROOT, entry.path);
    if (existsSync(full)) {
      reports[name] = measureBuffer(readFileSync(full));
    } else if (isReportRow(stampedReports, name)) {
      reports[name] = readReportRow(stampedReports, name);
    } else {
      reports[name] = null;
    }
  }
  const changed = jsonChanged(ROOT);
  const result = evaluateWasmSize({
    catalog,
    files,
    reports,
    observed,
    jsonChanged: changed,
    prBody: changed ? readPrBody() : '',
  });
  const text = `${[...result.lines, '', result.table, ''].join('\n')}`;
  process.stdout.write(text);
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) appendFileSync(summary, text);
  if (!result.ok) process.exit(1);
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entry === fileURLToPath(import.meta.url)) main();
